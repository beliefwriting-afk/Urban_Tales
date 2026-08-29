"""
步驟 4：把整層大圖切成 256×256 的圖磚，輸出到 static/map/。

★ 為什麼「先畫整張、再切」，不是一磚一磚各自光柵化：
  一磚一磚獨立畫的話，跨越磚界的道路兩邊會對不上，接縫會裂開一條線。
  整層先畫成一張大圖（near 層級 5369×7069，記憶體峰值約 1.2 GB，離線跑沒問題），
  切片就純粹是裁切，接縫不可能出錯。

★ 為什麼不乾脆用那一張大圖就好——它壓縮後只有 2.7 MB：
  **檔案大小不等於解碼後的記憶體。** 瀏覽器要把它展開成 5369×7069×4 位元組
  = 152 MB 的貼圖，iOS Safari 會直接砍掉分頁。圖磚讓手機一次只解碼視野內的六到十二張。

★ 邊緣的磚會補到滿 256×256（補背景色），前端不必處理「半塊磚」。
  真正的層級尺寸寫在 meta.json 的 widthPx / heightPx，超出的部分前端自己夾住。

用法：
    python tools\\map\\step4_tiles.py
"""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

import config
import step3_render as r3

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("缺少 Pillow。請執行： tools\\map\\.venv\\Scripts\\python.exe -m pip install -r tools\\map\\requirements.txt")

Image.MAX_IMAGE_PIXELS = None  # 預設有 ~1.8 億像素的防呆上限，我們是刻意要開大圖


def main() -> int:
    ap = argparse.ArgumentParser(description="把整層大圖切成圖磚")
    ap.add_argument("--clean", action="store_true", help="先清掉 static/map/ 再輸出")
    args = ap.parse_args()

    palette = r3.build_palette()
    if args.clean and config.TILE_DIR.exists():
        shutil.rmtree(config.TILE_DIR)

    total_files = 0
    total_bytes = 0

    for name, level in config.LEVELS.items():
        src = config.OUT_DIR / f"level_{name}.png"
        if not src.exists():
            print(f"找不到 {src}")
            print("請先執行： tools\\map\\.venv\\Scripts\\python.exe tools\\map\\step3_render.py")
            return 1

        big = Image.open(src)
        tx = -(-level.width_px // config.TILE_SIZE)  # 無條件進位
        ty = -(-level.height_px // config.TILE_SIZE)
        out_dir = config.TILE_DIR / name
        out_dir.mkdir(parents=True, exist_ok=True)

        started = time.time()
        n, b = 0, 0
        for gy in range(ty):
            for gx in range(tx):
                box = (
                    gx * config.TILE_SIZE,
                    gy * config.TILE_SIZE,
                    min((gx + 1) * config.TILE_SIZE, level.width_px),
                    min((gy + 1) * config.TILE_SIZE, level.height_px),
                )
                tile = Image.new("P", (config.TILE_SIZE, config.TILE_SIZE), r3.IDX_BG)
                tile.putpalette(palette)
                tile.paste(big.crop(box), (0, 0))
                path = out_dir / f"{gx}_{gy}.png"
                tile.save(path, optimize=True)
                n += 1
                b += path.stat().st_size

        print(f"{name:5s} {tx} × {ty} = {n} 張   {b / 1024 / 1024:.2f} MB   "
              f"{time.time() - started:.0f} 秒")
        total_files += n
        total_bytes += b

    meta_path = config.TILE_DIR / "meta.json"
    config.write_meta(meta_path)

    print()
    print(f"合計 {total_files} 張   {total_bytes / 1024 / 1024:.2f} MB")
    print(f"換算：手機一次載視野內約 6～12 張 ≈ {total_bytes / total_files * 9 / 1024:.0f} KB")
    print(f"圖磚 → {config.TILE_DIR}")
    print(f"對照表 → {meta_path}")
    print()
    print("⚠️ 地圖資料來自 OpenStreetMap（ODbL 1.0）。")
    print("   畫面上必須標示 © OpenStreetMap contributors —— 這在步驟 5 接前端時處理。")
    print("(列表結束)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
