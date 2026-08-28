#!/usr/bin/env python
"""
像素邊框產生器 —— 產生 tokens.css 裡的 .ut-px-frame 系列。

用法（專案根目錄）：
    python tools/gen_px_frame.py

要調外觀就改下面的 PARAMS，重跑即可。產出會覆寫 tokens.css 中
PX_FRAME_BEGIN / PX_FRAME_END 兩個標記之間的內容，其餘一律不動。

★ 為什麼要有這支腳本：點陣的四個角必須彼此對稱，手改 path 一定會有
  一角對不上（而且不會報錯，只會看起來怪）。參數化重生才不會出錯。

★ 這支腳本不參與 CI 判定，所以照 tools/README.md 的判準放這裡而不是 scripts/。

三個尺度要分清楚：
    N        邏輯點陣的邊長（格）
    INSET    角的內縮序列，由外而內每列縮幾格 → 決定「形狀」
    SCALE    一個邏輯格畫成幾個 CSS px → 決定「顆粒有多粗」（描邊寬度＝SCALE）
    slice    ＝ len(INSET) × SCALE，元件寬高不得小於 slice×2
"""

import re
import sys
from pathlib import Path

# ── 參數：要調外觀就改這裡 ──────────────────────────────────
PARAMS = {
    'N': 12,                    # 邏輯點陣 12×12
    'INSET': [3, 2, 1, 0, 0],   # 每階固定縮 1 格；差 2 格會看起來像多長一個尖角
    'SCALE': 2                  # 一格 = 2 CSS px，描邊也是 2px
}

VARIANTS = [
    ('.ut-px-frame', '2b2620', 'ffffff', '白底——按鈕、輸入框、頂列，介面的預設框'),
    ('.ut-px-frame--me', '2b2620', 'e5decc', '玩家氣泡'),
    ('.ut-px-frame--win', '2b2620', 'fbf7ee', '浮空視窗、名牌'),
    ('.ut-px-frame--dark', '15120f', '2b2823', 'Toast——深底，描邊只比底色深一階')
]

BEGIN = '/* === PX_FRAME_BEGIN（由 tools/gen_px_frame.py 產生，不要手改）=== */'
END = '/* === PX_FRAME_END === */'


def build_grid(n: int, inset: list[int]) -> list[list[bool]]:
    """依內縮序列畫出圓角矩形。每一列往內縮多少，由它離上下邊界的距離決定。"""
    grid = [[False] * n for _ in range(n)]
    for y in range(n):
        d = min(y, n - 1 - y)
        k = inset[d] if d < len(inset) else 0
        for x in range(k, n - k):
            grid[y][x] = True
    return grid


def edge_fn(grid, n):
    def is_edge(x, y):
        if not grid[y][x]:
            return False
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < n and 0 <= ny < n) or not grid[ny][nx]:
                return True
        return False
    return is_edge


def to_path(pred, n: int) -> str:
    """同一列連續的格子合併成一個 rect，data URI 才不會太長。"""
    parts = []
    for y in range(n):
        x = 0
        while x < n:
            if pred(x, y):
                run = 0
                while x + run < n and pred(x + run, y):
                    run += 1
                parts.append(f'M{x} {y}h{run}v1H{x}z')
                x += run
            else:
                x += 1
    return ''.join(parts)


def main() -> int:
    n, inset, scale = PARAMS['N'], PARAMS['INSET'], PARAMS['SCALE']
    slice_px = len(inset) * scale

    grid = build_grid(n, inset)
    is_edge = edge_fn(grid, n)
    stroke_d = to_path(is_edge, n)
    fill_d = to_path(lambda x, y: grid[y][x] and not is_edge(x, y), n)

    print(f'邏輯 {n}×{n}　內縮 {inset}　一格 {scale}px')
    print(f'→ 圖 {n * scale}×{n * scale}　描邊 {scale}px　slice {slice_px}px'
          f'　元件最小邊長 {slice_px * 2}px')
    for y in range(n):
        print('   ', ''.join('#' if is_edge(x, y) else ('·' if grid[y][x] else ' ')
                             for x in range(n)))

    def uri(stroke_hex: str, fill_hex: str) -> str:
        # viewBox 用邏輯格、width/height 用放大後的值——SVG 是向量，放大不會糊
        return ("url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' "
                f"width='{n * scale}' height='{n * scale}' viewBox='0 0 {n} {n}' "
                "shape-rendering='crispEdges'%3E"
                f"%3Cpath fill='%23{stroke_hex}' d='{stroke_d}'/%3E"
                f"%3Cpath fill='%23{fill_hex}' d='{fill_d}'/%3E%3C/svg%3E\")")

    blocks = []
    for cls, stroke, fill, note in VARIANTS:
        blocks.append(f'''/* {note} */
{cls} {{
\tdisplay: flex;
\talign-items: center;
\tbackground: transparent;
\t/* ★ border 只佔 1px 版面，border-image-width 卻畫 {slice_px}px——見上面的說明 */
\tborder: 1px solid transparent;
\tborder-image-source: {uri(stroke, fill)};
\tborder-image-slice: {slice_px} fill;
\tborder-image-width: {slice_px}px;
\tborder-image-repeat: stretch;
}}''')

    body = '\n\n'.join(blocks)
    css_path = Path(__file__).resolve().parent.parent / 'src' / 'lib' / 'styles' / 'tokens.css'
    css = css_path.read_text(encoding='utf-8')

    if BEGIN in css and END in css:
        new_css = re.sub(
            re.escape(BEGIN) + r'.*?' + re.escape(END),
            BEGIN + '\n\n' + body + '\n\n' + END,
            css, flags=re.S)
    else:
        # 第一次執行：把標記裝上去，取代現有的四個變體
        try:
            head = css.index(VARIANTS[0][3].join(['/* ', ' */']))
        except ValueError:
            print('✘ 找不到現有的變體區塊，請確認 tokens.css 沒被大改')
            return 1
        tail = css.index('/*\n\tCubic 11 的字身在 em box 裡偏上')
        new_css = css[:head] + BEGIN + '\n\n' + body + '\n\n' + END + '\n\n' + css[tail:]

    css_path.write_text(new_css, encoding='utf-8')
    print(f'\n✔ 已寫入 {css_path.name}')
    print('  記得跑：npx prettier --write src/lib/styles/tokens.css')
    print('(列表結束)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
