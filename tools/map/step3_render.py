"""
步驟 3：把快取光柵化成整層大圖。

風格定案（2026-08-28 君和選了「街廓填色 · 積極」）：

  底色米色（不是草綠——真實城市裡草地是例外不是常態）
    → 街廓底：道路圍出的封閉區域，夠小且裡面有建築的整塊填淺色
    → 綠地 → 水域 → 建築（一棟一階兩色 ＋ 深一階描邊）→ 道路（四階深淺）

★ 為什麼需要「街廓底」：OSM 在萬華舊城區的建物測繪比中正、大安稀疏得多，
  只畫實際輪廓的話，三個景點所在的那一帶會是一大片空的米色，看起來像未開發。
  街廓底用**道路網**把城市切成街廓，再把「夠小（排掉河面山區）且裡面有建築
  （排掉公園空地）」的區塊填起來，補回城市感而不是憑空捏造建築。

★ 輸出是 8 位元索引圖（P 模式），不是 RGB：
  整張圖只有十來種顏色，索引圖的檔案小一個量級，記憶體也只要三分之一
  （near 層級 5369×7069 的 RGB 是 114 MB，索引圖只有 38 MB）。
  而且索引圖天生沒有中間色，不會有反鋸齒偷偷混進來。

用法：
    python tools\\map\\step3_render.py                      # 兩個層級都畫
    python tools\\map\\step3_render.py --level near
    python tools\\map\\step3_render.py --preview 121.503,25.0395,420,520   # 只畫一小塊來看
"""

from __future__ import annotations

import argparse
import colorsys
import sys
import time
from pathlib import Path

import config

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter
    from scipy import ndimage
except ImportError as e:  # pragma: no cover
    sys.exit(f"缺少套件（{e.name}）。請執行： tools\\map\\.venv\\Scripts\\python.exe -m pip install -r tools\\map\\requirements.txt")

SUB = 16  # 快取座標的次像素倍率，要跟 step2_extract.py 一致

# ── 調色盤（索引圖用）────────────────────────────────────────────
# 索引順序就是畫的順序，後畫的蓋前畫的。
IDX_BG = 0
IDX_BLOCK_FILL = 1  # 街廓底
IDX_GRASS = 2  # 都市綠地：公園、校園、球場
IDX_WATER = 3
IDX_BLOCK = 4
IDX_BLOCK2 = 5
IDX_EDGE = 6
IDX_ROAD0 = 7  # 步道（目前不畫，位置保留）
IDX_ROAD1 = 8  # 巷弄、住宅道路
IDX_ROAD2 = 9  # 次要幹道
IDX_ROAD3 = 10  # 主要幹道、快速道路
IDX_GRASS2 = 11  # 山林：樹林、灌叢、保護區

# 綠地分兩階。★ 依**語意**分，不是隨機分：
#   都市公園（淺）vs 山林（深）。這樣陽明山跟大安森林公園自然就有色差，
#   而不是靠雜湊亂灑——大面積的單一多邊形用雜湊只會整塊同色，分不出來。
GREEN_DARK_TAGS = {"wood", "scrub", "grassland", "forest", "nature_reserve", "golf_course"}

# 道路分級。★ 山區步道（tier 0）整層不畫：全市 3,337 km，佔道路總長 32%，
#   而且集中在陽明山，畫下去會讓整個北半部糊成一團毛。
ROAD_TIER = {
    "motorway": 3, "trunk": 3, "primary": 3, "motorway_link": 3, "trunk_link": 3,
    "secondary": 2, "secondary_link": 2, "tertiary": 2, "tertiary_link": 2, "primary_link": 2,
    "residential": 1, "unclassified": 1, "living_street": 1, "pedestrian": 1, "service": 1,
    "footway": 0, "path": 0, "steps": 0,
}
ROAD_IDX = {0: IDX_ROAD0, 1: IDX_ROAD1, 2: IDX_ROAD2, 3: IDX_ROAD3}
# 相對 --ut-px-road 的**明度**位移（HSL 的 L，0..1）。見下面 shade() 的說明。
ROAD_L_SHIFT = {0: 0.16, 1: 0.0, 2: -0.09, 3: -0.17}

DRAW_FOOTPATHS = False
BLOCK_MAX_AREA_M2 = 96_000  # 街廓填色的面積上限（約 310 m 見方）

# 每個層級的差異：遠景要把道路加粗，否則四階的層次在 16 m/px 下會全變 1 像素
LEVEL_STYLE = {
    "near": dict(road_boost=1.0, merge_buildings=0, shade=True, edge=True),
    "far": dict(road_boost=2.2, merge_buildings=3, shade=False, edge=False),
}


def shade(rgb: tuple[int, int, int], delta_l: float) -> tuple[int, int, int]:
    """把顏色調亮或調暗，只動 HSL 的明度 L。

    ★ 為什麼不是 RGB 三通道等量加減：那會連飽和度一起改，而且方向不受控。
      實測本專案的色票：等量 +18 讓飽和度暴增 36%、等量 −45 讓飽和度掉 33%。
      結果是「調亮的偏豔、調深的偏灰」，一整組衍生色會愈調愈不像同一家人。
      只動 L、保住 H 與 S，衍生色才會是同一個顏色的不同明度。
    """
    h, l, s = colorsys.rgb_to_hls(*[c / 255 for c in rgb])
    r, g, b = colorsys.hls_to_rgb(h, max(0.0, min(1.0, l + delta_l)), s)
    return tuple(round(c * 255) for c in (r, g, b))


def build_palette() -> list[int]:
    pal = config.load_palette()
    colours = {
        IDX_BG: pal["bg"],
        IDX_BLOCK_FILL: shade(pal["block"], 0.07),
        IDX_GRASS: pal["grass"],
        IDX_WATER: pal["water"],
        IDX_BLOCK: pal["block"],
        IDX_BLOCK2: pal["block2"],
        IDX_EDGE: shade(pal["block2"], -0.18),
        IDX_ROAD0: shade(pal["road"], ROAD_L_SHIFT[0]),
        IDX_ROAD1: shade(pal["road"], ROAD_L_SHIFT[1]),
        IDX_ROAD2: shade(pal["road"], ROAD_L_SHIFT[2]),
        IDX_ROAD3: shade(pal["road"], ROAD_L_SHIFT[3]),
        IDX_GRASS2: pal["grass2"],
    }
    flat: list[int] = []
    for i in range(256):
        flat.extend(colours.get(i, (0, 0, 0)))
    return flat


def load_cache(path: Path):
    d = np.load(path)
    meta = d["_meta"]
    if len(meta) == 0 or str(meta[0]) != config.CACHE_VERSION:
        sys.exit(
            f"快取是舊版格式（{str(meta[0]) if len(meta) else '未知'}），"
            f"現在需要 {config.CACHE_VERSION}。\n"
            "請重跑： tools\\map\\.venv\\Scripts\\python.exe tools\\map\\step2_extract.py"
        )
    return {
        layer: (d[f"{layer}_xy"], d[f"{layer}_off"], d[f"{layer}_kind"],
                d[f"{layer}_width"], d[f"{layer}_tag"])
        for layer in config.LAYER_ORDER
    }


def render(data, level: config.Level, x0: int, y0: int, w: int, h: int) -> np.ndarray:
    """回傳 (h, w) 的 uint8 索引陣列。"""
    st = LEVEL_STYLE[level.name]
    # 快取存的是 near 層級像素 × SUB。換到本層：near 與本層的比例是
    # 4 / 16 = 0.25，所以 far 的除數是 SUB / 0.25 = 64，near 是 16。
    q = SUB / (config.LEVEL_NEAR.ground_m_per_px / level.ground_m_per_px)

    def canvas():
        return Image.new("L", (w, h), 0)

    def shapes(layer):
        xy, off, kind, width, tag = data[layer]
        for i in range(len(kind)):
            pts = xy[off[i]:off[i + 1]].astype(np.float64) / q
            pts[:, 0] -= x0
            pts[:, 1] -= y0
            if pts[:, 0].max() < -8 or pts[:, 0].min() > w + 8:
                continue
            if pts[:, 1].max() < -8 or pts[:, 1].min() > h + 8:
                continue
            yield i, [tuple(p) for p in pts], int(kind[i]), float(width[i]), str(tag[i])

    def punch(outer: Image.Image, inner: Image.Image) -> np.ndarray:
        """外環減內環。★ 一定要「全部外環畫完、再一次挖掉全部內環」，
        不能一個一個外環各自挖——相鄰的面共用邊界時，後畫的外環會把前一個
        已經挖好的洞補回去。"""
        return (np.array(outer) > 0) & ~(np.array(inner) > 0)

    def road_px(width_m: float) -> int:
        return max(1, round(level.metres_to_px(width_m * st["road_boost"])))

    # ── 先收道路，街廓底要用它當牆 ──
    tiers: dict[int, list] = {}
    for _, pts, _, wm, tag in shapes("road"):
        t = ROAD_TIER.get(tag, 1)
        if t == 0 and not DRAW_FOOTPATHS:
            continue
        tiers.setdefault(t, []).append((pts, wm))

    road_mask = canvas()
    rdr = ImageDraw.Draw(road_mask)
    for items in tiers.values():
        for pts, wm in items:
            rdr.line(pts, fill=255, width=road_px(wm), joint="curve")

    # ── 建築：兩階是「一棟一階」，不是逐像素雜訊 ──
    # 逐像素會變成 dithering，在像素風裡讀起來是髒，不是質感。
    m0, m1, mh = canvas(), canvas(), canvas()
    d0, d1, dh = ImageDraw.Draw(m0), ImageDraw.Draw(m1), ImageDraw.Draw(mh)
    for i, pts, k, _, _ in shapes("building"):
        if len(pts) < 3:
            continue
        if k == config.KIND_INNER:
            dh.polygon(pts, fill=255)  # 中庭之類的洞
        else:
            (d1 if (i * 2654435761) % 4294967296 > 2147483648 else d0).polygon(pts, fill=255)

    a0, a1 = punch(m0, mh), punch(m1, mh)
    bld = a0 | a1
    if st["merge_buildings"]:
        r = st["merge_buildings"]
        merged = Image.fromarray((bld * 255).astype(np.uint8), "L")
        merged = merged.filter(ImageFilter.MaxFilter(r)).filter(ImageFilter.MinFilter(r))
        bld = np.array(merged) > 0

    idx = np.full((h, w), IDX_BG, dtype=np.uint8)

    # 1. 街廓底
    walls = np.array(road_mask.filter(ImageFilter.MaxFilter(3))) > 0
    lab, _ = ndimage.label(~walls)
    areas = np.bincount(lab.ravel())
    has_bld = np.bincount(lab.ravel(), weights=bld.ravel())
    max_area_px = BLOCK_MAX_AREA_M2 / (level.ground_m_per_px ** 2)
    keep = (areas < max_area_px) & (has_bld > 0)
    keep[0] = False
    idx[keep[lab]] = IDX_BLOCK_FILL
    del lab, walls, areas, has_bld, keep

    # 2. 綠地：都市公園（淺）與山林（深）分兩階，依標籤語意分
    g_light, g_dark, g_hole = canvas(), canvas(), canvas()
    dl, dd, dgh = ImageDraw.Draw(g_light), ImageDraw.Draw(g_dark), ImageDraw.Draw(g_hole)
    for _, pts, k, _, tag in shapes("green"):
        if len(pts) < 3:
            continue
        if k == config.KIND_INNER:
            dgh.polygon(pts, fill=255)
        elif k == config.KIND_OUTER:
            (dd if tag in GREEN_DARK_TAGS else dl).polygon(pts, fill=255)
    idx[punch(g_light, g_hole)] = IDX_GRASS
    idx[punch(g_dark, g_hole)] = IDX_GRASS2

    # 3. 水域：面（湖、河道）與線（溪流）都有，洞是水域中的島
    w_area, w_hole = canvas(), canvas()
    dw, dwh = ImageDraw.Draw(w_area), ImageDraw.Draw(w_hole)
    for _, pts, k, wm, _ in shapes("water"):
        if k == config.KIND_LINE:
            if wm > 0:
                dw.line(pts, fill=255, width=max(1, round(level.metres_to_px(wm))), joint="curve")
        elif len(pts) >= 3:
            (dwh if k == config.KIND_INNER else dw).polygon(pts, fill=255)
    idx[punch(w_area, w_hole)] = IDX_WATER

    # 4. 建築
    if st["shade"]:
        idx[a0] = IDX_BLOCK
        idx[a1] = IDX_BLOCK2
    else:
        idx[bld] = IDX_BLOCK

    if st["edge"]:
        inner = np.array(
            Image.fromarray((bld * 255).astype(np.uint8), "L").filter(ImageFilter.MinFilter(3))
        ) > 0
        idx[bld & ~inner] = IDX_EDGE

    # 5. 道路，由細到粗，粗的蓋上去
    for t in sorted(tiers):
        m = canvas()
        dr = ImageDraw.Draw(m)
        for pts, wm in tiers[t]:
            dr.line(pts, fill=255, width=road_px(wm), joint="curve")
        idx[np.array(m) > 0] = ROAD_IDX[t]

    return idx


def to_image(idx: np.ndarray, palette: list[int]) -> Image.Image:
    im = Image.fromarray(idx, mode="P")
    im.putpalette(palette)
    return im


def main() -> int:
    ap = argparse.ArgumentParser(description="把快取光柵化成整層大圖")
    ap.add_argument("--cache", default=str(config.OUT_DIR / "taipei_geom.npz"))
    ap.add_argument("--level", choices=list(config.LEVELS) + ["all"], default="all")
    ap.add_argument("--preview", default="", help="lon,lat,寬,高 —— 只畫一小塊，用來快速看風格")
    args = ap.parse_args()

    cache = Path(args.cache)
    if not cache.exists():
        print(f"找不到快取：{cache}")
        print("請先執行： tools\\map\\.venv\\Scripts\\python.exe tools\\map\\step2_extract.py")
        return 1

    print(config.describe())
    print(f"\n讀取快取 {cache}")
    data = load_cache(cache)
    palette = build_palette()
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)

    names = list(config.LEVELS) if args.level == "all" else [args.level]

    if args.preview:
        lon, lat, w, h = args.preview.split(",")
        lon, lat, w, h = float(lon), float(lat), int(w), int(h)
        for name in names:
            lv = config.LEVELS[name]
            cx, cy = lv.lonlat_to_px(lon, lat)
            t = time.time()
            idx = render(data, lv, int(cx - w / 2), int(cy - h / 2), w, h)
            out = config.OUT_DIR / f"preview_{name}.png"
            to_image(idx, palette).resize((w * 3, h * 3), Image.NEAREST).save(out)
            print(f"  {name}  {time.time() - t:.1f} 秒  → {out}")
        print("(列表結束)")
        return 0

    for name in names:
        lv = config.LEVELS[name]
        t = time.time()
        print(f"\n畫 {name} 層級 {lv.width_px} × {lv.height_px} px …")
        idx = render(data, lv, 0, 0, lv.width_px, lv.height_px)
        out = config.OUT_DIR / f"level_{name}.png"
        to_image(idx, palette).save(out, optimize=True)
        mb = out.stat().st_size / 1024 / 1024
        print(f"  {time.time() - t:.0f} 秒   {mb:.1f} MB   → {out}")

    print("\n(列表結束)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
