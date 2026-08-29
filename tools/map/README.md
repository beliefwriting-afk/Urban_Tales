# tools/map —— 真實地圖 → 像素圖磚

把 OpenStreetMap 的台北市資料，離線光柵化成本專案自己的像素風圖磚。

**為什麼是離線做，不是執行期即時渲染**（2026-08-28 定案）：

1. 只有離線生成，地圖才能跟 UI **共用同一份色盤**——那是 CONTEXT 核心設計第 12 條
   「材質落差是設計」的前提。即時向量渲染的色彩由 style 決定，控制不到這個粒度。
2. 玩家站在街邊用行動網路開網頁，**少一個外部請求就少一個失敗點**。
3. 台北市的地圖不會變。用即時渲染引擎去畫一塊固定不變的區域，
   是把執行期複雜度花在一個不會動的東西上。

**為什麼是圖磚，不是單張 PNG**：全台北市在 4 m/px 下是 5369 × 7069 像素，
手機解碼後約佔 146 MB，iOS Safari 會直接砍掉。切成 256×256 的圖磚後，
手機一次只載視野內的 6～12 張。

---

## 一次性準備

```powershell
# 1. 建虛擬環境（不需要管理員權限）
python -m venv tools\map\.venv
tools\map\.venv\Scripts\Activate.ps1
pip install -r tools\map\requirements.txt
```

```
# 2. 下載台灣的 OSM 資料（約 150 MB，用瀏覽器下載即可）
https://download.geofabrik.de/asia/taiwan-latest.osm.pbf

放到 tools/map/data/taiwan-latest.osm.pbf
（data/ 與 out/ 都在 .gitignore 裡，不會進 repo）
```

---

## 步驟

| 檔案 | 做什麼 | 產出 |
|---|---|---|
| `config.py` | 範圍、層級、投影、色盤、標籤分類——**唯一一份地圖常數** | 直接執行會印出目前設定 |
| `step1_inspect.py` | 資料落地與覆蓋度檢查 | `out/step1_check.png`、`out/step1_stats.json` |
| `step2_extract.py` | 抽出台北範圍的幾何，存成快取（v2：含 relation） | `out/taipei_geom.npz` |
| `step3_render.py` | 把快取光柵化成整層大圖 | `out/level_near.png`、`out/level_far.png` |
| `step4_tiles.py` | 切成 256×256 圖磚 | `static/map/{near,far}/{x}_{y}.png`、`meta.json` |

```powershell
tools\map\.venv\Scripts\python.exe tools\map\config.py          # 先看設定對不對
tools\map\.venv\Scripts\python.exe tools\map\step1_inspect.py   # 再看資料實際長什麼樣
tools\map\.venv\Scripts\python.exe tools\map\step2_extract.py   # 抽快取，之後調美術靠它
tools\map\.venv\Scripts\python.exe tools\map\step3_render.py    # 畫整層大圖（約 35 秒）
tools\map\.venv\Scripts\python.exe tools\map\step4_tiles.py     # 切磚（約 9 秒）
```

調風格時不必每次都畫整市，用 `--preview` 只畫一小塊，一兩秒就有結果：

```powershell
tools\map\.venv\Scripts\python.exe tools\map\step3_render.py --preview 121.503,25.0395,420,520
```

**步驟 1 的實測結果（2026-08-28，台灣全檔 311 MB，跑 51 秒）**：

```
green 9,616   water 3,525   building 102,027   road 93,076
道路總長 10,530 km
建築物覆蓋率 87.7%（554 / 632 個有道路的 1km 格子）
```

覆蓋率 87.7% ⇒ **可以用建築物當畫面主體**，不需要退回「只靠道路網撐畫面」的備案。

**步驟 3／4 的實測結果（2026-08-28）**：

```
near  5369 × 7069 px   28 秒   單張 2.7 MB   → 切成 21 × 28 = 588 張
far   1342 × 1767 px    7 秒   單張 0.3 MB   → 切成  6 ×  7 =  42 張
圖磚合計 630 張 3.37 MB，手機一次載視野內約 9 張 ≈ 49 KB
光柵化的記憶體峰值約 1.2 GB（離線跑，沒問題）
```

### 風格定案（君和 2026-08-28 選了「街廓填色 · 積極」）

```
底色米色 → 街廓底 → 綠地 → 水域 → 建築（兩階 ＋ 描邊）→ 道路（四階）
```

- **底色是米色不是草綠**：真實城市裡草地是例外不是常態，草綠底在真地圖上會滿到不合理。
- **街廓底**：道路圍出的封閉區域，**面積小於 96,000 m²、而且裡面有建築物**的整塊填淺色。
  「夠小」排掉河面與山區，「有建築」排掉公園與空地。
  ⚠️ 這是必要的補救：OSM 在萬華舊城區的建物測繪比中正、大安稀疏得多，
  而三個景點全在那一區。只畫實際輪廓的話那一帶會是一大片空米色，看起來像未開發。
- **建築兩階深淺是「一棟一階」**，不是逐像素雜訊——後者是 dithering，讀起來是髒不是質感。
- **綠地也分兩階，但依「語意」分不是依雜湊分**：都市公園用淺的 `--ut-px-grass`、
  山林（`wood` / `forest` / `scrub` / `grassland` / `nature_reserve` / `golf_course`）
  用深的 `--ut-px-grass-2`。大面積的單一多邊形用雜湊只會整塊同色，分不出來。
- **衍生色一律只動 HSL 的明度 L，不做 RGB 三通道等量加減**。
  實測本專案的色票：等量 +18 讓飽和度暴增 36%、等量 −45 讓飽和度掉 33%，
  結果是「調亮的偏豔、調深的偏灰」，一整組衍生色會愈調愈不像同一家人。
- **山區步道（footway / path / steps）整層不畫**：全市 3,337 km、佔道路總長 32%，
  集中在陽明山，畫下去整個北半部會糊成一團毛。
- **道路四階深淺**，遠景層再把寬度乘 2.2，否則四階在 16 m/px 下會全變成 1 像素。

步驟 5（前端接圖磚、`terrain.ts` 改寫、標示 © OpenStreetMap contributors）尚未實作。

### ⚠️ 快取 v2：一定要讀 relation

v1 只讀 way，結果陽明山一帶幾乎整片是背景色——一座山被畫成空曠平地。
原因是 **OSM 裡大面積的森林、國家公園、大型水域經常是 multipolygon relation，
不是單一封閉 way**，v1 把它們整批漏掉了。

v2 改用 `osmium.FileProcessor(...).with_locations().with_areas()`，
由 libosmium 把 relation 的成員 way 組裝成完整的面，**而且帶內環（洞）**。
分工是：**面只從 `Area` 物件拿、線只從 `Way` 物件拿**，判準就是
`config.classify()` 回傳的線寬（0 是面、大於 0 是線）。這樣不會重複計算——
`.with_areas()` 會把封閉 way 也包成 `Area` 再吐一次。

⚠️ **挖洞一定要「全部外環畫完、再一次挖掉全部內環」**，不能一個外環各自挖：
相鄰的面共用邊界時，後畫的外環會把前一個已經挖好的洞補回去。

快取格式有版本號（`_meta[0]`），步驟 3 讀到舊版會直接擋下並叫你重跑步驟 2。

### 為什麼中間要插一個「抽快取」

美術是要反覆調的。每調一次色就重讀 311 MB 的 PBF，每次一分鐘起跳，根本沒辦法工作。
`step2_extract.py` 跑一次把台北範圍的幾何存成幾十 MB 的 `.npz`，
之後步驟 3 讀快取，**重畫只要幾秒**。

座標存成 **near 層級像素座標 × 16 的整數**：不存經緯度是因為 float32 在經度 121 度
這個量級只剩約 1 公尺精度會抖，float64 又肥一倍；乘 16 留次像素精度（1/16 px = 0.25 m）。
far 層級把值再除以 4 就是了。

---

## 設計上的注意事項

- **色盤只有一份**：`config.py` 從 `src/lib/styles/tokens.css` 讀色票，
  缺任何一個就拋例外。這裡**不准**另外寫死 hex。
- **層次由我們決定，不是由檔案順序決定**：OSM 物件的出現順序是任意的，
  所以每一層各畫在自己的畫布上，最後才依 `LAYER_ORDER` 疊起來。
  邊讀邊畫進同一張的話，先讀到的建築會被後讀到的綠地蓋掉。
- **切磚一定要「先畫整張、再切」**：一張一張獨立光柵化，跨磚的道路兩邊會對不上，
  接縫會裂開。整層在記憶體裡是 8-bit 索引圖，全市 4 m/px 也只有約 38 MB，離線跑毫無壓力。
- **輸出是索引圖（P 模式）不是 RGB**：整張圖只有十一種顏色，檔案小一個量級、
  記憶體只要三分之一，而且索引圖天生沒有中間色，反鋸齒不可能偷偷混進來。
- **「整層才 2.7 MB，為什麼還要切磚？」**——檔案大小不等於解碼後的記憶體。
  瀏覽器要把它展開成 5369×7069×4 位元組 = **152 MB** 的貼圖，iOS Safari 會砍掉分頁。
- **覆蓋率的分母只算「有路的格子」**：台北市的外接框裡有一大塊是山區與河道，
  拿整個框當分母會低估到毫無意義。

---

## 授權

地圖資料來自 OpenStreetMap，授權為 **ODbL 1.0**。
由這份資料產生的圖磚屬於 Produced Work，**畫面上必須標示**：

```
© OpenStreetMap contributors
```

這是作品集會被人看的東西，這條不要省。
