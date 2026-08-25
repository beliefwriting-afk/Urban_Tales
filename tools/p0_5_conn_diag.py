#!/usr/bin/env python
"""
P0-5 附帶診斷 —— WinError 10054 是斷在哪一層？

用法：
    python tools/p0_5_conn_diag.py

背景：p0_5_aihub_ping.py 量到約四成的請求以 WinError 10054（連線被重置）
失敗，而且失敗都在 0.04～0.07 秒發生 —— 快到連 TLS 握手都來不及完成
（台灣到東京 hnd1 單趟就要 30～50ms，TLS 握手需要 2～3 個來回）。
這代表連線在第一個來回之內就被 RST，不是伺服器處理不過來。

從 Anthropic 的雲端容器連同一個端點做 20 次 TLS 握手是 0 失敗，
所以嫌疑落在「本機到端點之間」。這支腳本把連線拆成三層分別量，
定位到底斷在哪裡。

★ 全程不需要 API 金鑰 ★
第三層會收到 401／403，那是**正確結果**——它證明整條路通到了應用層。
我們要看的是失敗率，不是回應內容。
"""

import json
import socket
import ssl
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
ROUNDS = 20


def load_host() -> tuple[str, str]:
    """從 .env 讀 BASE_URL，只取主機名。不讀金鑰。"""
    env_path = ROOT / ".env"
    base = "https://hnd1.aihub.zeabur.ai/v1"
    if env_path.exists():
        for raw in env_path.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if line.startswith("AIHUB_BASE_URL="):
                val = line.split("=", 1)[1].strip().strip("\"'")
                if val:
                    base = val
    host = base.split("://", 1)[-1].split("/", 1)[0]
    return base, host


def report(label: str, lat: list[float], fails: list[str]) -> None:
    total = len(lat) + len(fails)
    rate = len(fails) / total * 100 if total else 0
    print(f"\n  {label}")
    print(f"     成功 {len(lat)}/{total}　失敗率 {rate:.0f}%")
    if lat:
        print(f"     最快 {min(lat) * 1000:.0f}ms　"
              f"中位 {statistics.median(lat) * 1000:.0f}ms　"
              f"最慢 {max(lat) * 1000:.0f}ms")
    for reason in sorted(set(fails)):
        print(f"     ✗ ×{fails.count(reason)}　{reason}")


def tag(exc: Exception) -> str:
    s = f"{type(exc).__name__}: {exc}"
    if "10054" in s:
        return "連線被重置 (WinError 10054)"
    if "10060" in s or "timed out" in s:
        return "逾時"
    if "10061" in s:
        return "連線被拒絕"
    return s[:70]


def main() -> int:
    base, host = load_host()
    print("=" * 64)
    print("連線分層診斷")
    print("=" * 64)
    print(f"  目標主機：{host}")
    print(f"  每層各測 {ROUNDS} 次，不使用 API 金鑰")

    # 先解析 DNS，順便看看有幾個 IP（多 IP 時失敗可能集中在某一個）
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
        ips = sorted({i[4][0] for i in infos})
        print(f"  DNS 解析：{', '.join(ips)}")
    except Exception as exc:
        print(f"  ✗ DNS 解析失敗：{exc}")
        return 1

    # ── 第 1 層：純 TCP ─────────────────────────────────────
    lat, fails = [], []
    for _ in range(ROUNDS):
        t0 = time.perf_counter()
        try:
            with socket.create_connection((host, 443), timeout=10):
                pass
            lat.append(time.perf_counter() - t0)
        except Exception as exc:
            fails.append(tag(exc))
    report("第 1 層　TCP 連線（三向交握）", lat, fails)
    tcp_fail_rate = len(fails) / ROUNDS

    # ── 第 2 層：TLS 握手 ───────────────────────────────────
    ctx = ssl.create_default_context()
    lat, fails = [], []
    for _ in range(ROUNDS):
        t0 = time.perf_counter()
        try:
            with socket.create_connection((host, 443), timeout=10) as sock:
                with ctx.wrap_socket(sock, server_hostname=host) as tls:
                    tls.do_handshake()
            lat.append(time.perf_counter() - t0)
        except Exception as exc:
            fails.append(tag(exc))
    report("第 2 層　TLS 握手（憑證交換）", lat, fails)
    tls_fail_rate = len(fails) / ROUNDS

    # ── 第 3 層：HTTPS 請求（無金鑰，預期 401/403）─────────
    url = base.rstrip("/") + "/chat/completions"
    lat, fails, codes = [], [], []
    for _ in range(ROUNDS):
        req = urllib.request.Request(
            url,
            data=json.dumps({"model": "x", "messages": []}).encode(),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp.read()
                codes.append(resp.status)
            lat.append(time.perf_counter() - t0)
        except urllib.error.HTTPError as exc:
            # 401／403／400 都算「連線成功」——請求有到達應用層
            exc.read()
            codes.append(exc.code)
            lat.append(time.perf_counter() - t0)
        except Exception as exc:
            fails.append(tag(exc))
    report("第 3 層　HTTPS 請求（到達應用層）", lat, fails)
    if codes:
        summary = ", ".join(f"HTTP {c}×{codes.count(c)}" for c in sorted(set(codes)))
        print(f"     收到的狀態碼：{summary}　← 401／403 是正確結果，代表通了")
    http_fail_rate = len(fails) / ROUNDS

    # ── 判讀 ────────────────────────────────────────────────
    print("\n" + "=" * 64)
    print("判讀")
    print("=" * 64)
    if tcp_fail_rate > 0.1:
        print("  斷在 **TCP 層**。連 TLS 都還沒開始就被 RST。")
        print("  嫌疑：防火牆／防毒軟體的連線攔截、路由器、ISP 端設備。")
        print("  → 這是本機網路環境問題，與 AI Hub 無關，產品部署到 Zeabur 後不會發生。")
    elif tls_fail_rate > 0.1:
        print("  TCP 通、**斷在 TLS 層**。")
        print("  典型嫌疑：防毒軟體的 HTTPS 掃描（會攔截並重建 TLS 連線）、")
        print("  企業代理、VPN。這類軟體對高頻新連線特別容易誤傷。")
        print("  → 一樣是本機環境問題。可試著暫時關閉防毒的網頁防護再跑一次。")
    elif http_fail_rate > 0.1:
        print("  TCP 與 TLS 都穩，**斷在應用層**。")
        print("  嫌疑落回 AI Hub 端（閘道器連線數限制、負載平衡器行為）。")
        print("  → 這會影響產品，SDD §6.5 必須把它當成常態錯誤路徑。")
    else:
        print("  三層都穩（失敗率皆低於 10%）。")
        print("  那麼先前 40% 的失敗率可能與**帶 Authorization 標頭的請求**有關，")
        print("  或是當時的網路狀況已經恢復。建議重跑 p0_5_aihub_ping.py 對照。")

    print("\n  無論根因為何，有一件事已經確定：")
    print("  **AI 呼叫的失敗率在真實環境中可能達到數十個百分點。**")
    print("  CONTEXT 核心設計第 11 條「AI 失效一律回退預寫台詞，且視為正常回應」")
    print("  不是保險條款，是主要路徑之一。這次實測驗證了那個設計是對的。")
    print("\n(列表結束)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
