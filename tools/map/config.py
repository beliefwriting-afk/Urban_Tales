"""
地圖工具的共用設定 —— 範圍、層級、投影、色盤、OSM 標籤分類。

★ 這個檔是「唯一一份地圖常數」。跟 tokens.css 之於視覺、
  content/guardrails.yaml 之於護欄是同一個原則：只有一個地方可以改，
  就不會出現第二套互相漂移的定義。

★ 色盤不寫死在這裡，是**從 tokens.css 讀出來的**。
  CONTEXT 核心設計第 12 條要求「像素的城市」與「非像素的靈魂」共用色盤，
  如果這裡另抄一份 hex，那條設計第一天就破了。
  少一個 token 就直接拋例外——寧可工具跑不起來，也不要安靜地用錯顏色。
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

# ── 路徑 ────────────────────────────────────────────────────────────
# 這個檔在 <專案根>/tools/map/config.py，所以往上三層就是專案根
ROOT = Path(__file__).resolve().parents[2]
TOKENS_CSS = ROOT / "src" / "lib" / "styles" / "tokens.css"
DATA_DIR = Path(__file__).resolve().parent / "data"  # 放 .osm.pbf，不進 git
OUT_DIR = Path(__file__).resolve().parent / "out"  # 中間產物，不進 git
TILE_DIR = ROOT / "static" / "map"  # 最終圖磚，進 git

# ── 台北市範圍 ──────────────────────────────────────────────────────
# 台北市行政區界的極值，四邊各留了一點餘裕（免得邊界上的路被切掉半條）。
# 換範圍只改這四個數字，其餘全部自動跟著算。
WEST = 121.4550
EAST = 121.6680
SOUTH = 24.9580
NORTH = 25.2120

# 三個景點的真實座標（步驟 4 前端要用；先放這裡當單一來源）
LANDMARKS = {
    "ximen_red_house": (121.5069, 25.0421),  # 西門紅樓
    "longshan_temple": (121.4997, 25.0372),  # 龍山寺
    "bopiliao": (121.4990, 25.0359),  # 剝皮寮歷史街區
}

# ── 投影：Web Mercator（EPSG:3857）────────────────────────────────
# 為什麼用 Mercator 而不是簡單的等距投影：
#   前端未來若要跟任何標準圖磚系統對齊，Mercator 是共通語言。
#   而且工具端與前端用同一組公式換算，位置就是精準的，不會有偏移。
#
# ⚠️ 已知失真：Mercator 的「一像素等於幾公尺」會隨緯度變化。
#   台北從南到北跨 24.958～25.212，cos 值差約 0.2%，
#   也就是整座城市南北端的比例尺差 0.2%。走路遊戲完全不在意這個量級。
#   下面的 metres-per-pixel 一律以**中心緯度**為準。

EARTH_R = 6378137.0  # WGS84 赤道半徑（公尺）
CENTER_LAT = (SOUTH + NORTH) / 2.0


def lonlat_to_merc(lon: float, lat: float) -> tuple[float, float]:
    """經緯度 → Web Mercator 公尺座標。"""
    x = math.radians(lon) * EARTH_R
    y = math.log(math.tan(math.pi / 4.0 + math.radians(lat) / 2.0)) * EARTH_R
    return x, y


MERC_W, MERC_S = lonlat_to_merc(WEST, SOUTH)
MERC_E, MERC_N = lonlat_to_merc(EAST, NORTH)


# ── 層級 ────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Level:
    """一個縮放層級。

    ground_m_per_px：在中心緯度上，畫面一個像素代表地面幾公尺。
      4  → 8 公尺寬的巷子畫得出 2 像素，巷弄看得見
      16 → 同一條巷子只有 0.5 像素，會整層消失，只剩幹道
    """

    name: str
    ground_m_per_px: float

    @property
    def merc_m_per_px(self) -> float:
        # Mercator 的公尺被緯度拉伸過，換回來才是真實地面尺度
        return self.ground_m_per_px / math.cos(math.radians(CENTER_LAT))

    @property
    def width_px(self) -> int:
        return int(round((MERC_E - MERC_W) / self.merc_m_per_px))

    @property
    def height_px(self) -> int:
        return int(round((MERC_N - MERC_S) / self.merc_m_per_px))

    def lonlat_to_px(self, lon: float, lat: float) -> tuple[float, float]:
        """經緯度 → 這個層級的像素座標（左上角為原點，y 向下）。"""
        mx, my = lonlat_to_merc(lon, lat)
        return (mx - MERC_W) / self.merc_m_per_px, (MERC_N - my) / self.merc_m_per_px

    def metres_to_px(self, metres: float) -> float:
        """地面公尺 → 像素長度（拿來把道路寬度換成筆刷粗細）。"""
        return metres / self.ground_m_per_px


LEVEL_NEAR = Level("near", 4.0)
LEVEL_FAR = Level("far", 16.0)
LEVELS = {lv.name: lv for lv in (LEVEL_NEAR, LEVEL_FAR)}

TILE_SIZE = 256  # 圖磚邊長（像素）


# ── 色盤：從 tokens.css 讀 ──────────────────────────────────────────
_PALETTE_TOKENS = {
    "bg": "--ut-bg-map",
    "grass": "--ut-px-grass",
    "grass2": "--ut-px-grass-2",
    "block": "--ut-px-block",
    "block2": "--ut-px-block-2",
    "water": "--ut-px-water",
    "road": "--ut-px-road",
}


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    v = value.strip().lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6:
        raise ValueError(f"看不懂的色碼：{value}")
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def load_palette() -> dict[str, tuple[int, int, int]]:
    """讀 tokens.css 裡的地形色票。少一個就拋例外，不給預設值。"""
    if not TOKENS_CSS.exists():
        raise FileNotFoundError(f"找不到 tokens.css：{TOKENS_CSS}")
    css = TOKENS_CSS.read_text(encoding="utf-8")

    palette: dict[str, tuple[int, int, int]] = {}
    missing: list[str] = []
    for key, token in _PALETTE_TOKENS.items():
        m = re.search(rf"{re.escape(token)}\s*:\s*(#[0-9a-fA-F]{{3,8}})\s*;", css)
        if not m:
            missing.append(token)
            continue
        palette[key] = _hex_to_rgb(m.group(1))
    if missing:
        raise KeyError(
            "tokens.css 缺少這些色票，地圖工具不能自己編一個："
            + "、".join(missing)
        )
    return palette


# ── OSM 標籤分類 ────────────────────────────────────────────────────
# 判斷順序有意義：一條 way 只會被歸進第一個命中的層。
# 例如 leisure=park 又標了 landuse=grass，算綠地一次就好。

WATER_AREA_TAGS = {
    "natural": {"water", "wetland"},
    "landuse": {"reservoir", "basin"},
    "waterway": {"riverbank", "dock"},
}
# 線狀水道：沒有面積，要當成有寬度的線來畫
WATER_LINE_WIDTHS_M = {
    "river": 30.0,
    "canal": 15.0,
    "stream": 6.0,
}

GREEN_TAGS = {
    "leisure": {"park", "garden", "pitch", "golf_course", "nature_reserve"},
    "landuse": {"grass", "forest", "meadow", "recreation_ground", "cemetery", "village_green"},
    "natural": {"wood", "scrub", "grassland"},
}

# 道路寬度（公尺）。這是「畫出來看起來對」的視覺寬度，不是法定路寬。
ROAD_WIDTHS_M = {
    "motorway": 22.0,
    "trunk": 20.0,
    "primary": 17.0,
    "secondary": 13.0,
    "tertiary": 10.0,
    "unclassified": 8.0,
    "residential": 8.0,
    "living_street": 6.0,
    "pedestrian": 6.0,
    "service": 5.0,
    "footway": 3.0,
    "path": 3.0,
    "steps": 3.0,
    "motorway_link": 10.0,
    "trunk_link": 10.0,
    "primary_link": 9.0,
    "secondary_link": 8.0,
    "tertiary_link": 7.0,
}

LAYER_ORDER = ("green", "water", "building", "road")

# 快取裡每個形狀的種類。步驟 2 寫、步驟 3 讀，定義放這裡才不會兩邊漂移。
KIND_LINE = 0  # 線：道路、水道
KIND_OUTER = 1  # 面的外環
KIND_INNER = 2  # 面的內環（洞）——步驟 3 要把它從外環挖掉
CACHE_VERSION = "v2"


def classify(tags) -> tuple[str, float] | None:
    """把一條 OSM way 分到某一層。

    回傳 (層名, 線寬公尺)；線寬 0 代表這是要填滿的面，不是線。
    不屬於任何一層就回傳 None。

    tags 可以是 osmium 的 TagList，也可以是普通的 dict——
    兩者都支援 .get()，所以這個函式在單元測試裡可以直接餵 dict。
    """
    # 1. 建築物：只看有沒有 building 這個 key，值是什麼不重要
    if tags.get("building") is not None and tags.get("building") != "no":
        return "building", 0.0

    # 2. 道路
    highway = tags.get("highway")
    if highway is not None:
        width = ROAD_WIDTHS_M.get(highway)
        if width is not None:
            return "road", width
        return None  # bus_stop、crossing 之類的點狀標籤，不畫

    # 3. 水域（面）
    for key, values in WATER_AREA_TAGS.items():
        v = tags.get(key)
        if v is not None and v in values:
            return "water", 0.0

    # 4. 水道（線）
    waterway = tags.get("waterway")
    if waterway is not None:
        width = WATER_LINE_WIDTHS_M.get(waterway)
        if width is not None:
            return "water", width
        return None

    # 5. 綠地（面）
    for key, values in GREEN_TAGS.items():
        v = tags.get(key)
        if v is not None and v in values:
            return "green", 0.0

    return None


def in_bbox(lons: list[float], lats: list[float]) -> bool:
    """這條 way 的外接框有沒有跟台北市的框重疊。"""
    if not lons:
        return False
    return not (
        max(lons) < WEST or min(lons) > EAST or max(lats) < SOUTH or min(lats) > NORTH
    )


def describe() -> str:
    """把目前設定攤開成一段人看得懂的字，每支工具開頭都印一次。"""
    lines = [
        f"範圍   經度 {WEST} ~ {EAST}   緯度 {SOUTH} ~ {NORTH}",
        f"       約 {(MERC_E - MERC_W) * math.cos(math.radians(CENTER_LAT)) / 1000:.1f}"
        f" km × {(MERC_N - MERC_S) * math.cos(math.radians(CENTER_LAT)) / 1000:.1f} km",
    ]
    for lv in LEVELS.values():
        tiles_x = math.ceil(lv.width_px / TILE_SIZE)
        tiles_y = math.ceil(lv.height_px / TILE_SIZE)
        lines.append(
            f"層級 {lv.name:5s} {lv.ground_m_per_px:>4.0f} m/px   "
            f"{lv.width_px} × {lv.height_px} px   "
            f"圖磚 {tiles_x} × {tiles_y} = {tiles_x * tiles_y} 張"
        )
    return "\n".join(lines)


def write_meta(path: Path) -> dict:
    """輸出前端要用的換算資料。前端靠這份把經緯度換成像素座標。"""
    meta = {
        "bbox": {"west": WEST, "east": EAST, "south": SOUTH, "north": NORTH},
        "merc": {"west": MERC_W, "east": MERC_E, "south": MERC_S, "north": MERC_N},
        "earthRadius": EARTH_R,
        "centerLat": CENTER_LAT,
        "tileSize": TILE_SIZE,
        "levels": {
            lv.name: {
                "groundMetresPerPixel": lv.ground_m_per_px,
                "mercMetresPerPixel": lv.merc_m_per_px,
                "widthPx": lv.width_px,
                "heightPx": lv.height_px,
                "tilesX": math.ceil(lv.width_px / TILE_SIZE),
                "tilesY": math.ceil(lv.height_px / TILE_SIZE),
            }
            for lv in LEVELS.values()
        },
        "landmarks": {k: {"lon": v[0], "lat": v[1]} for k, v in LANDMARKS.items()},
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL 1.0",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


if __name__ == "__main__":
    print(describe())
    print()
    pal = load_palette()
    print("色盤（讀自 tokens.css）：")
    for k, v in pal.items():
        print(f"  {k:7s} rgb{v}")
