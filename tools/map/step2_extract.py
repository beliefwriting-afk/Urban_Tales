"""
步驟 2：把台北範圍的幾何抽出來，存成快取。

★ 為什麼要多這一步，不直接從 PBF 畫圖：
  美術是要反覆調的——換個色、改個線寬、試試看建築要不要合併成街廓，
  每試一次都重讀 311 MB 的 PBF 是不可能工作的（每次一分半起跳）。
  這一步跑一次，之後步驟 3 讀快取，**每次重畫只要幾秒**。

★ v2（2026-08-28）：改用 `.with_areas()`，開始讀 multipolygon relation。

  v1 只讀 way，結果陽明山一帶幾乎整片空白——OSM 裡大面積的森林、國家公園、
  大型水域**經常是 multipolygon relation 而不是單一封閉 way**，那些整批被漏掉了。
  `.with_areas()` 會請 libosmium 把 relation 的成員 way 組裝成完整的面，
  連同一般的封閉 way 一起吐出來，而且**帶內環（洞）**。

  分工很乾淨，不會重複計算：
    面（建築、綠地、水域）→ 只從 Area 物件拿
    線（道路、水道）      → 只從 Way 物件拿
  判準就是 config.classify() 回傳的線寬：0 是面，大於 0 是線。

輸出：
  out/taipei_geom.npz   台北範圍內的四層幾何（壓縮過的整數座標）

座標怎麼存：
  存成 **near 層級（4 m/px）的像素座標 × 16 的整數**。
  - 不存經緯度：float32 的精度在經度 121 度這個量級只剩約 1 公尺，會抖；
    存 float64 又肥一倍。
  - 乘 16 是留次像素精度，1/16 像素 = 0.25 公尺，遠比畫得出來的細。
  - far 層級只要把值再除以 4 就好（16 / 4 = 4 倍關係）。

形狀的三種 kind：
  0 = 線（道路、水道）
  1 = 面的外環
  2 = 面的內環（洞）——步驟 3 會把它從外環挖掉

用法：
    python tools\\map\\step2_extract.py

⚠️ 比 v1 慢：`.with_areas()` 要多掃一次檔案來組裝 relation，
   而且組裝時會佔比較多記憶體。預期三到四分鐘。
"""

from __future__ import annotations

import sys
import time

import config

try:
    import numpy as np
except ImportError:  # pragma: no cover
    sys.exit("缺少 numpy。請執行： tools\\map\\.venv\\Scripts\\python.exe -m pip install -r tools\\map\\requirements.txt")

try:
    import osmium
except ImportError:  # pragma: no cover
    sys.exit("缺少 osmium。請執行： tools\\map\\.venv\\Scripts\\python.exe -m pip install -r tools\\map\\requirements.txt")

SUBPIXEL = 16  # 座標的放大倍率，見檔頭說明

# 形狀種類與快取版本都定義在 config.py——步驟 2 寫、步驟 3 讀，
# 定義只有一份才不會兩邊漂移。
KIND_LINE = config.KIND_LINE
KIND_OUTER = config.KIND_OUTER
KIND_INNER = config.KIND_INNER
CACHE_VERSION = config.CACHE_VERSION


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="抽出台北範圍的幾何並存成快取")
    ap.add_argument("--pbf", default=str(config.DATA_DIR / "taiwan-latest.osm.pbf"))
    args = ap.parse_args()

    level = config.LEVEL_NEAR  # 快取一律以最細的層級為基準

    print(config.describe())
    print(f"\n讀取 {args.pbf}")
    print(f"座標基準：{level.name} 層級（{level.ground_m_per_px} m/px）× {SUBPIXEL}")
    print("模式：with_areas（會組裝 multipolygon relation，比只讀 way 慢）\n")

    xy: dict[str, list[int]] = {k: [] for k in config.LAYER_ORDER}
    off: dict[str, list[int]] = {k: [0] for k in config.LAYER_ORDER}
    kind: dict[str, list[int]] = {k: [] for k in config.LAYER_ORDER}
    width: dict[str, list[float]] = {k: [] for k in config.LAYER_ORDER}
    tagval: dict[str, list[str]] = {k: [] for k in config.LAYER_ORDER}

    # 從 relation 組裝出來的面有幾個，單獨數一份——
    # 這個數字就是「v1 到底漏掉多少」的答案。
    from_relation = {k: 0 for k in config.LAYER_ORDER}

    def tag_of(tags) -> str:
        return (
            tags.get("highway") or tags.get("waterway") or tags.get("leisure")
            or tags.get("landuse") or tags.get("natural") or tags.get("building") or ""
        )

    def push(layer: str, coords, k: int, width_m: float, tag: str) -> bool:
        """把一串經緯度存進快取。回傳有沒有真的存（範圍外就不存）。"""
        if len(coords) < 2:
            return False
        if not config.in_bbox([c[0] for c in coords], [c[1] for c in coords]):
            return False
        flat = xy[layer]
        for lon, lat in coords:
            px, py = level.lonlat_to_px(lon, lat)
            flat.append(int(round(px * SUBPIXEL)))
            flat.append(int(round(py * SUBPIXEL)))
        off[layer].append(len(flat) // 2)
        kind[layer].append(k)
        width[layer].append(width_m)
        tagval[layer].append(tag)
        return True

    started = time.time()
    seen = 0

    fp = (
        osmium.FileProcessor(args.pbf)
        .with_locations()
        .with_areas()
        # 沒有任何 tag 的物件不可能被分類，先丟掉省下後面的工
        .with_filter(osmium.filter.EmptyTagFilter())
    )

    for obj in fp:
        seen += 1
        if seen % 500_000 == 0:
            print(f"  已處理 {seen:,} 個物件，{time.time() - started:.0f} 秒")

        hit = config.classify(obj.tags)
        if hit is None:
            continue
        layer, width_m = hit
        tag = tag_of(obj.tags)

        if isinstance(obj, osmium.osm.Area):
            # 面：只收線寬為 0 的分類。線狀的東西不該從 Area 拿，
            # 否則 waterway=river 之類的會被當成面重複進來。
            if width_m > 0.0:
                continue
            stored = False
            for ring in obj.outer_rings():
                pts = [(n.location.lon, n.location.lat) for n in ring if n.location.valid()]
                if push(layer, pts, KIND_OUTER, 0.0, tag):
                    stored = True
                for inner in obj.inner_rings(ring):
                    ipts = [(n.location.lon, n.location.lat) for n in inner if n.location.valid()]
                    push(layer, ipts, KIND_INNER, 0.0, tag)
            if stored and not obj.from_way():
                from_relation[layer] += 1

        elif isinstance(obj, osmium.osm.Way):
            # 線：只收線寬大於 0 的分類。封閉的面已經由 Area 那條路徑處理過了。
            if width_m == 0.0:
                continue
            pts = [(n.location.lon, n.location.lat) for n in obj.nodes if n.location.valid()]
            push(layer, pts, KIND_LINE, width_m, tag)

    elapsed = time.time() - started
    print(f"\n讀完 {seen:,} 個物件，耗時 {elapsed:.0f} 秒\n")

    payload: dict[str, np.ndarray] = {}
    print("── 快取內容 ───────────────────────────")
    print(f"  {'層':<9}{'形狀':>9}{'點':>12}{'其中來自 relation':>20}")
    for layer in config.LAYER_ORDER:
        payload[f"{layer}_xy"] = np.asarray(xy[layer], dtype=np.int32).reshape(-1, 2)
        payload[f"{layer}_off"] = np.asarray(off[layer], dtype=np.int64)
        payload[f"{layer}_kind"] = np.asarray(kind[layer], dtype=np.int8)
        payload[f"{layer}_width"] = np.asarray(width[layer], dtype=np.float32)
        # 固定寬度的 unicode 而不是 object：object 陣列存進 npz 要 pickle，
        # 讀回來得開 allow_pickle=True。少一個坑，也少一個安全警告。
        payload[f"{layer}_tag"] = np.asarray(tagval[layer], dtype="<U20")
        print(f"  {layer:<9}{len(kind[layer]):>9,}{len(xy[layer]) // 2:>12,}"
              f"{from_relation[layer]:>20,}")

    holes = sum(int((payload[f'{k}_kind'] == KIND_INNER).sum()) for k in config.LAYER_ORDER)
    print(f"\n  內環（洞）合計 {holes:,} 個")

    payload["_meta"] = np.asarray(
        [CACHE_VERSION, level.name, str(level.ground_m_per_px), str(SUBPIXEL),
         str(level.width_px), str(level.height_px)],
        dtype="<U20",
    )

    out_path = config.OUT_DIR / "taipei_geom.npz"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out_path, **payload)

    print()
    print(f"快取 → {out_path}   ({out_path.stat().st_size / 1024 / 1024:.1f} MB)")
    print("(列表結束)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
