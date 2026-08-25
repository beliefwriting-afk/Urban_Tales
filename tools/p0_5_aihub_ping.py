#!/usr/bin/env python
"""
P0-5 —— Zeabur AI Hub 連通 / 延遲 / 連線穩定度 / 前綴快取驗證（第二版）

用法（在專案根目錄）：
    python tools/p0_5_aihub_ping.py

零依賴：只用 Python 標準庫，不需要 pip install 任何東西。
理由是開發機沒有管理員權限，少一個安裝步驟就少一個坑。

不參與 CI 判定，所以照 tools/README.md 的判準放這裡而不是 scripts/。
也因此不受 eslint.config.js 的「唯一出口」圍籬約束——那道圍籬只管
src/ scripts/ content/ 三個目錄。這是離線驗證工具，不是產品程式碼；
產品端呼叫 AI 的唯一路徑仍然是 src/lib/server/soul/speak.ts。

── 第二版的修正（第一版的教訓）──────────────────────────────
1. 延遲測試每次換不同的 user message。第一版寫死同一句，量到的
   0.15s 是 AI Hub 的「回應快取」在回同一份答案，不是真的推論延遲。
2. 新增 A/B 對照組（無間隔 vs 有間隔），用來判定 WinError 10054
   到底是速率限制還是連線層問題。這兩者的對策完全不同。
3. 失敗自動重試，並統計失敗率——單次失敗說明不了任何事。
"""

import json
import socket
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Windows 主控台預設不是 UTF-8，中文會炸 UnicodeEncodeError。先改掉。
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
TIMEOUT_S = 30  # 測試用寬鬆值；產品端是 8 秒（SDD §6.5）


# ── IPv4 強制（2026-08-25 診斷結果）─────────────────────────────────
#
# 開發機這條線路的 IPv6 路徑不穩：TCP 三向交握 100% 成功，但 TLS 握手
# （憑證鏈是大封包，需要分片）約有四成被 RST——PMTU 黑洞的典型形狀。
# 實測 curl 強制 IPv4 是 0/12 失敗，強制 IPv6 是 3/12 失敗。
#
# 這是本機網路環境問題，不是 AI Hub 的問題，Zeabur 上的容器不會遇到。
# 這裡強制走 IPv4 只是為了讓「量延遲」與「量 token」拿得到乾淨數據，
# 不是產品端的對策。產品端走 Node 的 openai SDK，Node 20+ 預設開啟
# Happy Eyeballs（autoSelectFamily），IPv6 失敗會自動退回 IPv4。
#
# 想看未強制的原始行為：改成 FORCE_IPV4 = False 再跑一次對照。
FORCE_IPV4 = True

if FORCE_IPV4:
    _orig_getaddrinfo = socket.getaddrinfo

    def _ipv4_only(*args, **kwargs):
        """濾掉 AF_INET6，只留 IPv4。等於在 Python 層面做 curl -4。"""
        return [r for r in _orig_getaddrinfo(*args, **kwargs)
                if r[0] == socket.AF_INET]

    socket.getaddrinfo = _ipv4_only


# ── 工具 ────────────────────────────────────────────────────────────

def load_env(path: Path) -> dict[str, str]:
    """把 .env 解析成 dict。等同 python-dotenv 的 dotenv_values()，但零依賴。"""
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        env[key.strip()] = val
    return env


def mask(secret: str) -> str:
    return f"{secret[:4]}…{secret[-2:]}" if len(secret) > 8 else "(太短，可疑)"


def post_once(base: str, key: str, model: str, system: str, user: str):
    """打一次 /chat/completions。回傳 (耗時, 狀態碼, 回應dict, 錯誤字串)。"""
    url = base.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return time.perf_counter() - started, resp.status, body, None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        return time.perf_counter() - started, exc.code, None, detail
    except Exception as exc:
        return time.perf_counter() - started, None, None, f"{type(exc).__name__}: {exc}"


def post_with_retry(base, key, model, system, user, retries=1, backoff=2.0):
    """失敗時重試。回傳 (耗時, 狀態, 回應, 錯誤, 用掉幾次嘗試)。"""
    last = None
    for attempt in range(1, retries + 2):
        secs, status, body, err = post_once(base, key, model, system, user)
        if err is None:
            return secs, status, body, None, attempt
        last = (secs, status, body, err)
        if attempt <= retries:
            time.sleep(backoff)
    return (*last, retries + 1)


def short_err(err: str) -> str:
    """把錯誤壓成一行標籤，方便統計分類。"""
    if err is None:
        return "OK"
    if "10054" in err:
        return "連線被重置 (WinError 10054)"
    if "timed out" in err or "timeout" in err.lower():
        return "逾時"
    if "URLError" in err:
        return "連線失敗"
    return err.split("\n")[0][:60]


def usage_of(body) -> dict:
    return (body or {}).get("usage") or {}


def cached_tokens_of(usage: dict):
    details = usage.get("prompt_tokens_details")
    if not isinstance(details, dict):
        return None
    return details.get("cached_tokens")


def head(title: str) -> None:
    print()
    print("=" * 64)
    print(title)
    print("=" * 64)


# ── 各段測試 ────────────────────────────────────────────────────────

def test_connect(base, key, primary, fallback) -> list[str]:
    head("測試 1／3　連通")
    ok = []
    for label, model in [("primary", primary), ("fallback", fallback)]:
        if not model:
            print(f"  [{label:8}] (未設定，略過)")
            continue
        secs, status, body, err, tries = post_with_retry(
            base, key, model,
            "你是測試用的回應器。只回覆四個字：連線正常。",
            "測試",
        )
        note = "" if tries == 1 else f"（重試 {tries - 1} 次後成功）"
        if err:
            print(f"  [{label:8}] {model}")
            print(f"             ✗ {short_err(err)}　{secs:.2f}s")
            print(f"             {err[:200]}")
            continue
        text = (body["choices"][0]["message"]["content"] or "").strip()
        print(f"  [{label:8}] {model}")
        print(f"             ✓ HTTP {status}　{secs:.2f}s　回應：{text[:40]}{note}")
        ok.append(model)
    return ok


def run_batch(base, key, model, label, count, gap):
    """跑一組請求。每次 user message 都不同，避開 AI Hub 的回應快取。"""
    print(f"\n  ── {label}（{count} 次，"
          f"{'無間隔' if gap == 0 else f'每次間隔 {gap}s'}）──")
    lat, fails = [], []
    for i in range(1, count + 1):
        # 每次問不同的東西：繞開回應快取，量真正的推論延遲
        user = f"用一句話說第 {i} 件關於這條街的小事，不超過二十個字。"
        secs, status, body, err = post_once(
            base, key, model, "你是城市的靈魂。回答簡短。", user
        )
        if err:
            fails.append(short_err(err))
            print(f"     {i:2}　✗ {secs:5.2f}s　{short_err(err)}")
        else:
            u = usage_of(body)
            lat.append(secs)
            print(f"     {i:2}　✓ {secs:5.2f}s　"
                  f"in={u.get('prompt_tokens', '?')} out={u.get('completion_tokens', '?')}")
        if gap:
            time.sleep(gap)
    return lat, fails


def test_latency(base, key, primary):
    head("測試 2／3　延遲與連線穩定度（A/B 對照）")
    print("  產品端 timeout 是 8 秒（SDD §6.5）。這裡同時回答兩個問題：")
    print("    Q1 真實推論延遲是多少（每次換不同問題，繞開回應快取）")
    print("    Q2 WinError 10054 是速率限制，還是連線層問題")

    a_lat, a_fail = run_batch(base, key, primary, "A 組：連續請求", 5, 0)
    time.sleep(3)
    b_lat, b_fail = run_batch(base, key, primary, "B 組：間隔請求", 5, 1.5)

    print("\n  ── 統計 ──")
    for name, lat, fail in [("A 組（無間隔）", a_lat, a_fail),
                            ("B 組（間隔 1.5s）", b_lat, b_fail)]:
        total = len(lat) + len(fail)
        print(f"     {name}：成功 {len(lat)}/{total}", end="")
        if lat:
            print(f"　最快 {min(lat):.2f}s　中位 {statistics.median(lat):.2f}s"
                  f"　最慢 {max(lat):.2f}s")
        else:
            print()
        for reason in sorted(set(fail)):
            print(f"        失敗 ×{fail.count(reason)}：{reason}")

    all_lat = a_lat + b_lat
    print()
    if all_lat and max(all_lat) > 8:
        print("     ⚠ 有樣本超過 8 秒 —— SDD §6.5 的 timeout 需要重新評估")
    elif all_lat:
        print(f"     ✓ 全部在 8 秒內（最慢 {max(all_lat):.2f}s）")

    print("\n  ── 判讀 ──")
    if not a_fail and not b_fail:
        print("     兩組都全過 → 第一輪的 10054 是偶發，仍建議 SDD §6.5 納入重試，")
        print("     但不需要為它設計退避節流。")
    elif a_fail and not b_fail:
        print("     A 組失敗、B 組全過 → **速率限制**。SDD §6.5 的重試策略必須加上")
        print("     退避（backoff），而且產品端要限制同一玩家的送出頻率。")
    elif a_fail and b_fail:
        print("     兩組都失敗 → 不是速率問題，是連線層（TLS／網路／供應商端不穩）。")
        print("     產品端必須把「連線被重置」當成常態錯誤路徑，直接走預寫台詞降級。")
    else:
        print("     B 組失敗而 A 組沒有 → 樣本太少或網路抖動，建議再跑一次。")


def test_cache(base, key, primary):
    head("測試 3／3　前綴快取（cached_tokens 有沒有回報）")
    guard_path = ROOT / "content" / "guardrails.yaml"
    if not guard_path.exists():
        print(f"  ✗ 找不到 {guard_path}")
        return
    guard = guard_path.read_text(encoding="utf-8")
    system = (
        "你是城市的靈魂，以下是你必須遵守的安全界線，逐字生效：\n\n"
        + guard
        + "\n\n請用一句話回應玩家，不超過二十個字。"
    )
    print(f"  system prompt：{len(system)} 字元"
          f"（來源 content/guardrails.yaml，真實護欄文字）")
    print("  相同 system ＋ 不同 user 打三次。前綴快取要快取的是 system 那一段，")
    print("  user 每次不同才不會被回應快取蓋掉。\n")

    questions = [
        "你好，這裡以前是什麼樣子？",
        "這條街上最老的建築是哪一棟？",
        "你看過最熱鬧的一天是什麼時候？",
    ]
    for i, q in enumerate(questions, 1):
        secs, status, body, err, tries = post_with_retry(
            base, key, primary, system, q, retries=2, backoff=2.0
        )
        if err:
            print(f"  第 {i} 次　✗ {secs:5.2f}s　{short_err(err)}（重試 {tries - 1} 次仍失敗）")
            continue
        u = usage_of(body)
        cached = cached_tokens_of(u)
        shown = "(未回報此欄位)" if cached is None else cached
        note = "" if tries == 1 else f"（重試 {tries - 1} 次）"
        print(f"  第 {i} 次　{secs:5.2f}s　"
              f"prompt_tokens={u.get('prompt_tokens', '?')}　"
              f"cached_tokens={shown}{note}")
        print(f"         原始 usage：{json.dumps(u, ensure_ascii=False)}")
        if i < len(questions):
            time.sleep(2)

    print("\n  " + "-" * 60)
    print("  判讀：")
    print("    cached_tokens > 0   → 前綴快取生效，SDD §6.3 的成本估算成立")
    print("    cached_tokens = 0   → 有欄位但沒命中；前綴可能不夠長")
    print("    (未回報此欄位)      → AI Hub 沒透傳。client.ts 的 cachedTokens 恆為 0，")
    print("                          不能拿它當成本依據，§10 用量控制要改用別的量法")
    print("  " + "-" * 60)


# ── 主流程 ──────────────────────────────────────────────────────────

def main() -> int:
    env = load_env(ROOT / ".env")
    key = env.get("AIHUB_API_KEY", "")
    base = env.get("AIHUB_BASE_URL", "")
    primary = env.get("AIHUB_MODEL_PRIMARY", "")
    fallback = env.get("AIHUB_MODEL_FALLBACK", "")

    head("設定檢查")
    print(f"  BASE_URL       : {base or '(空)'}")
    print(f"  MODEL_PRIMARY  : {primary or '(空)'}")
    print(f"  MODEL_FALLBACK : {fallback or '(空)'}")
    print(f"  API_KEY        : {mask(key) if key else '(空)'}")
    print(f"  連線協定       : {'強制 IPv4（見檔頭說明）' if FORCE_IPV4 else '系統自選'}")

    missing = [n for n, v in
               [("AIHUB_API_KEY", key), ("AIHUB_BASE_URL", base),
                ("AIHUB_MODEL_PRIMARY", primary)] if not v]
    if missing:
        print(f"\n  ✗ .env 缺少：{', '.join(missing)}")
        return 1

    if not test_connect(base, key, primary, fallback):
        print("\n  ✗ 兩個模型都打不通，後面的測試沒有意義。")
        print("    先確認：金鑰是否貼錯／Dashboard 是否已儲值／BASE_URL 結尾是否為 /v1")
        return 1

    test_latency(base, key, primary)
    test_cache(base, key, primary)

    print("\n(列表結束)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
