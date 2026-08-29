"""
步驟 1：OSM 資料落地與覆蓋度檢查。

★ 這一步**不做美術**，只回答一個問題：
  「台北市的 OSM 資料，實際上畫得出什麼？」

  為什麼要先做這件事：OSM 是志願者維護的，建築物輪廓的覆蓋率各區差很多。
  如果直接跳去做美術，很可能整套色盤調完才發現某幾區是空的，
  那時候已經沒有便宜的退路了。這支工具二十分鐘就給你答案。

輸出兩份東西：
  out/step1_stats.json   每一層有幾筆、道路總長、逐 1 公里格的覆蓋率
  out/step1_check.png    整市的灰階檢查圖（不是成品，是給你「看一眼」用的）

用法：
    python tools/map/step1_inspect.py
    python tools/map/step1_inspect.py --pbf D:\\somewhere\\taiwan-latest.osm.pbf
    python tools/map/step1_inspect.py --limit 2000000     # 只讀前兩百萬筆，快速試跑
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import Counter, defaultdict

import config

try:
    import osmium
except ImportError:  # pragma: no cover
    sys.exit("缺少 osmium。請先執行： pip install -r tools/map/requirements.txt")

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    sys.exit("缺少 Pillow。請先執行： pip install -r tools/map/requirements.txt")


# 檢查圖用灰階，一層一階。這裡刻意不用真色盤——
# 這張圖是拿來判斷「資料有沒有」，不是拿來看美術的。
CHECK_GREY = {
    "bg": 236,
    "green": 205,
    "water": 158,
    "building": 96,
    "road": 40,
}

GRID_KM = 1.0  # 覆蓋率統計的格子邊長（公里）


def ground_length_m(coords: list[tuple[float, float]]) -> float:
    """一串經緯度點的地面總長度（公尺）。小範圍用平面近似就夠準。"""
    if len(coords) < 2:
        return 0.0
    total = 0.0
    mlat = math.radians(config.CENTER_LAT)
    for (lon1, lat1), (lon2, lat2) in zip(coords, coords[1:]):
        dx = math.radians(lon2 - lon1) * config.EARTH_R * math.cos(mlat)
        dy = math.radians(lat2 - lat1) * config.EARTH_R
        total += math.hypot(dx, dy)
    return total


def main() -> int:
    ap = argparse.ArgumentParser(description="OSM 資料落地與覆蓋度檢查")
    ap.add_argument(
        "--pbf",
        default=str(config.DATA_DIR / "taiwan-latest.osm.pbf"),
        help="OSM PBF 檔的路徑",
    )
    ap.add_argument("--level", default="far", choices=list(config.LEVELS))
    ap.add_argument("--limit", type=int, default=0, help="只讀前 N 筆物件（0 = 全部）")
    args = ap.parse_args()

    pbf = args.pbf
    level = config.LEVELS[args.level]

    print(config.describe())
    print()
    print(f"讀取   {pbf}")
    print(f"檢查圖 {level.name} 層級 {level.width_px} × {level.height_px} px")
    print()

    try:
        import os

        size_mb = os.path.getsize(pbf) / 1024 / 1024
        print(f"檔案大小 {size_mb:.0f} MB")
    except OSError:
        return _missing_file(pbf)

    # ── 準備畫布 ────────────────────────────────────────────────
    img = Image.new("L", (level.width_px, level.height_px), CHECK_GREY["bg"])
    # 一層一張畫布，最後才依序疊起來。
    # ⚠️ 不能邊讀邊直接畫進同一張：OSM 的物件順序是任意的，
    #   先讀到的建築物會被後讀到的綠地蓋掉。層次必須由我們決定，不是由檔案順序決定。
    layers = {
        name: Image.new("L", (level.width_px, level.height_px), 0)
        for name in config.LAYER_ORDER
    }
    draws = {name: ImageDraw.Draw(im) for name, im in layers.items()}

    # ── 統計容器 ────────────────────────────────────────────────
    counts: Counter[str] = Counter()
    road_len: defaultdict[str, float] = defaultdict(float)
    grid_building: Counter[tuple[int, int]] = Counter()
    grid_road: Counter[tuple[int, int]] = Counter()

    grid_w = int(math.ceil(level.width_px * level.ground_m_per_px / (GRID_KM * 1000)))
    grid_h = int(math.ceil(level.height_px * level.ground_m_per_px / (GRID_KM * 1000)))
    px_per_cell = GRID_KM * 1000 / level.ground_m_per_px

    started = time.time()
    seen = 0

    fp = (
        osmium.FileProcessor(pbf)
        .with_locations()
        .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
    )

    for obj in fp:
        seen += 1
        if args.limit and seen > args.limit:
            print(f"（--limit {args.limit} 到了，提早結束）")
            break
        if seen % 1_000_000 == 0:
            print(f"  已讀 {seen:,} 筆 way，{time.time() - started:.0f} 秒")

        hit = config.classify(obj.tags)
        if hit is None:
            continue
        layer, width_m = hit

        coords = [
            (n.location.lon, n.location.lat) for n in obj.nodes if n.location.valid()
        ]
        if len(coords) < 2:
            continue
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        if not config.in_bbox(lons, lats):
            continue

        counts[layer] += 1
        pts = [level.lonlat_to_px(lon, lat) for lon, lat in coords]

        if width_m > 0.0:
            # 線：道路與水道
            w = max(1, int(round(level.metres_to_px(width_m))))
            draws[layer].line(pts, fill=255, width=w, joint="curve")
            if layer == "road":
                hw = obj.tags.get("highway")
                road_len[hw] += ground_length_m(coords)
                cx, cy = pts[len(pts) // 2]
                grid_road[(int(cx // px_per_cell), int(cy // px_per_cell))] += 1
        else:
            # 面：建築、水域、綠地。沒閉合就當線畫，總比整條丟掉好
            closed = len(obj.nodes) > 3 and obj.nodes[0].ref == obj.nodes[-1].ref
            if closed and len(pts) >= 3:
                draws[layer].polygon(pts, fill=255)
            else:
                draws[layer].line(pts, fill=255, width=1)
            if layer == "building":
                cx = sum(p[0] for p in pts) / len(pts)
                cy = sum(p[1] for p in pts) / len(pts)
                grid_building[(int(cx // px_per_cell), int(cy // px_per_cell))] += 1

    elapsed = time.time() - started
    print(f"\n讀完 {seen:,} 筆 way，耗時 {elapsed:.0f} 秒\n")

    # ── 疊圖 ────────────────────────────────────────────────────
    for name in config.LAYER_ORDER:
        img.paste(CHECK_GREY[name], mask=layers[name])

    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    check_png = config.OUT_DIR / "step1_check.png"
    img.save(check_png)

    # ── 覆蓋率 ──────────────────────────────────────────────────
    # 分母只算「有路的格子」——台北市的框裡有一大塊是山區與河道，
    # 拿整個框當分母會低估到毫無意義。
    road_cells = {c for c in grid_road if 0 <= c[0] < grid_w and 0 <= c[1] < grid_h}
    bld_cells = {c for c in grid_building if c in road_cells}
    coverage = len(bld_cells) / len(road_cells) if road_cells else 0.0

    print("── 各層筆數 ───────────────────────────")
    for name in config.LAYER_ORDER:
        print(f"  {name:9s} {counts[name]:>9,}")
    print()
    print("── 道路總長（公里，依等級）─────────────")
    for hw, m in sorted(road_len.items(), key=lambda kv: -kv[1]):
        print(f"  {hw:18s} {m / 1000:>8.1f}")
    print(f"  {'合計':18s} {sum(road_len.values()) / 1000:>8.1f}")
    print()
    print("── 建築物覆蓋率 ───────────────────────")
    print(f"  有道路的 1km 格子   {len(road_cells):>5}")
    print(f"  其中有建築物的      {len(bld_cells):>5}")
    print(f"  覆蓋率              {coverage * 100:>5.1f}%")
    print()

    stats = {
        "pbf": pbf,
        "level": level.name,
        "elapsedSeconds": round(elapsed, 1),
        "waysScanned": seen,
        "counts": {k: counts[k] for k in config.LAYER_ORDER},
        "roadLengthKm": {k: round(v / 1000, 2) for k, v in sorted(road_len.items())},
        "roadLengthTotalKm": round(sum(road_len.values()) / 1000, 2),
        "coverage": {
            "gridKm": GRID_KM,
            "cellsWithRoad": len(road_cells),
            "cellsWithBuilding": len(bld_cells),
            "ratio": round(coverage, 4),
        },
    }
    stats_path = config.OUT_DIR / "step1_stats.json"
    stats_path.write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"檢查圖 → {check_png}")
    print(f"統計   → {stats_path}")
    print("(列表結束)")
    return 0


def _missing_file(pbf: str) -> int:
    print()
    print(f"找不到 OSM 檔：{pbf}")
    print()
    print("請先下載台灣的 OSM 資料（約 150 MB，用瀏覽器下載就行）：")
    print("  https://download.geofabrik.de/asia/taiwan-latest.osm.pbf")
    print()
    print(f"下載後放到：{config.DATA_DIR}")
    print("（這個資料夾已經在 .gitignore 裡，不會進 repo）")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
