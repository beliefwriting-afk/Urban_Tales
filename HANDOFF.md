# HANDOFF — 給接手的下一個對話

> 由 Roku 於 2026-08-25 寫下（第二版）。**新對話開始時，讀完 `CONTEXT.md` 之後接著讀這一份。**
> 這份是「上一次做到哪、下一步做什麼」，不是專案本身的定義。專案定義看企劃書與 SDD。

---

## 0. 三十秒摘要

**環境與骨架都完成了，程式碼已經在 GitHub 上。**

上一版 HANDOFF 列的四個步驟（工具鏈 → 骨架 → 接 GitHub → 驗收）**全部做完**，
首次 commit `86e9741`，49 個檔案。SDD §6.1 的唯一出口護欄第一天就裝上了，
並且用 `npm run test:guard` 驗證過它**真的擋得下來**。

**下一步 = P0 技術驗證。先做 P0-4 與 P0-5，兩件各五分鐘、但驗晚了會很痛的事。**

---

## 1. 專案基本資訊

| 項目 | 內容 |
|---|---|
| 專案資料夾 | `C:\Users\erics\Desktop\Urban_Tales` |
| GitHub | `https://github.com/beliefwriting-afk/Urban_Tales`（私有） |
| 開發環境 | Windows 11 家用版、VS Code、PowerShell 7.6.5（**無**系統管理員權限） |
| Node | **24.19.0**，由 **fnm** 管理（`%LOCALAPPDATA%\Programs\fnm`） |
| npm | 11.17.0 |
| git | 2.55.0，`user.name` / `user.email` / `init.defaultBranch=main` 都已設定 |
| 部署 | Zeabur（尚未建立服務） |
| AI | Zeabur AI Hub（已儲值，**金鑰尚未建立**） |

### 文件閱讀順序

1. `CONTEXT.md` — 專案入口
2. `Urban_Tales_企劃書_v0.2.md` — **權威文件**，定義做什麼／為什麼／刻意不做什麼
3. `Urban_Tales_SDD_v0.1.md` — 定義怎麼實作。**附錄 A 是可推翻的暫定決策表，每一項都附連動影響**
4. `README.md` — repo 門面，指令與目錄速查

---

## 2. ⚠️ 已完整評估並否決：改用 Python（不要重做）

君和的程式背景是**只會 Python**，因此問過「可以全部改用 Python 嗎」。
這件事被完整評估過，結論是**維持 TypeScript 全端**。理由留在這裡，避免下次重跑一遍：

**前端不可行**（不是不建議，是物理限制）：

- 瀏覽器只執行 JavaScript
- Pyodide / PyScript：Python runtime 本身數 MB、啟動秒級。玩家是**站在街邊用行動網路**開這個網頁的，直接撞到核心設計第 1 條「硬到場」
- Reflex / NiceGUI / Flet：本專案三個最難的技術點（`getUserMedia` 相機即時疊層、Canvas 像素地圖、立繪拖曳縮放）全是瀏覽器原生 API 的精細操作，這類框架碰到就要寫自訂元件 —— 而自訂元件就是 JavaScript，只是多隔一層抽象要 debug

**前後端分離（FastAPI ＋ SvelteKit）也否決**：

- 本專案後端極薄（定位判定、AI 轉發、成就卡讀寫、內容驗證，數百行量級），主體難度全在前端
- 分離的好處只作用在薄的那一半，代價（兩個部署單元、兩套環境變數、型別斷開要人工對齊）整個專案在付 —— **槓桿是反的**
- 「團隊分工」「多客戶端」「獨立擴展」「故障隔離」對一人專案 ＋ 純網頁 ＋ 已設計降級 的本專案皆不成立
- 而且對只會 Python 的人來說它是**最差**選項：前端該學的一件都沒少，只是額外多背了部署複雜度

**Python 的正當位置**：`tools/` 底下的離線工具，不部署、不進 runtime、不影響 CI 判定。
判準寫在 `tools/README.md`：**這個腳本的產出會不會被 CI 拿來決定建置過不過？會 → TypeScript 放 `scripts/`；不會 → 放 `tools/`，語言隨意。**

> 特別注意：`content:check` **不能**改用 Python 重寫，因為它跟執行期共用 `content/schema.ts` 的 Zod 定義。
> 另寫一份 pydantic 會造成兩份會漂移的 schema —— 那正是企劃書 §4.2 記錄的前身專案失敗模式換個位置復發。

---

## 3. 這次對話新增的定案

| # | 決策 | 理由 |
|---|---|---|
| 1 | **維持 TypeScript 全端** | 見上面 §2 |
| 2 | **Node 用 fnm 管理，不用 nvm-windows** | nvm-windows 靠 symlink 切版本，需要提權或開發者模式，君和過不了。fnm 直接改 shell 的 PATH，零提權，且原生讀 `.nvmrc` |
| 3 | **`.gitattributes` 走 LF，不改全域 `core.autocrlf`** | 他全域是 `autocrlf=true`，其他十個專案吃這個設定，改了會造成假 diff。`.gitattributes` 的 `eol` 優先權高於 `core.autocrlf`，只影響本 repo，而且跟著 repo 走，換機器行為一致 |
| 4 | **`*.md` 排除在 Prettier 之外** | 企劃書、SDD 有大量對齊表格與 ASCII 架構圖，Prettier 會重排。文件排版是內容的一部分，由人負責 |
| 5 | **卡片總數檢查「自動啟用」** | 兩個景點未拍板，13 張卡現在不可能齊。`content:check #7` 在 `content/sites/` 湊滿五站時自動開始強制，未啟用時會**明確印出來**，不靜默跳過 |
| 6 | **不生 drizzle migration** | 需要真的 DB 連線。等 Zeabur 開好 Postgres 再跑 `npm run db:generate` |
| 7 | **不預先生成任何景點內容** | 靈魂台詞要逐字審（企劃書 §4.3），不代寫。`content/_template/` 有六個註解齊全的範本可複製 |

---

## 4. 骨架裡有什麼（已驗收）

```
content/            內容層（進 Git，不做 CMS）
  schema.ts           ★ Zod 定義，型別與驗證的單一事實來源（SDD §2.3 全量）
  guardrails.yaml     ★ 全站唯一一份安全界線，8 條
  cards.yaml          空的，等景點拍板
  sites/              空的
  _template/          新增景點時複製這裡（六個 YAML，註解齊全）
scripts/            建置期工具（TypeScript，影響 CI 判定）
  content-check.ts    SDD §2.4 十項 ＋ 隱私 schema 掃描
  guard-test.ts       ★ 驗證護欄本身有效
tools/              離線工具（Python，不部署）
src/lib/server/
  soul/speak.ts       ★ 唯一出口（型別完整，九步驟以 TODO 註解列出）
  ai/client.ts        ★ 唯一 AI SDK 入口（含本機 mock 模式）
  presence/geo.ts     haversine ＋ 到場判定（純函式，8 個測試全過）
  db/schema.ts        七張表（SDD §3.2 全量），★ 無任何經緯度欄位
src/lib/client/
  soul/renderer.ts    SoulRenderer 介面 ＋ 工廠（SDD §9.4）
```

**驗收結果（在君和的機器上跑的，不是沙箱）**：

| 指令 | 結果 |
|---|---|
| `npm run content:check` | ✅ 護欄 8 條，卡片檢查正確顯示「尚未啟用（0/5 站）」 |
| `npm run lint` | ✅ 0 問題 |
| `npm run test` | ✅ 8 個測試通過 |
| `npm run test:guard` | ✅ 6 個案例全對 |
| `npm run check` | ✅ 856 檔案 0 錯誤 |
| `npm run build` | ✅ |
| 實測違規 `import OpenAI from 'openai'` | ✅ **ESLint 擋下並印出中文說明** |

> **`npm run verify` 是提交前該跑的那一個指令**（= content:check ＋ lint ＋ test ＋ test:guard）。

---

## 5. 踩過的坑（別重踩）

### 5.1 ⚠️ 給君和的 PowerShell 指令必須「貼上安全」

PowerShell 主控台在貼上多行時，看到 `}` 單獨在行首且語句已完整，會**當場送出執行**，導致下一行的 `else` 變成孤兒語句而報錯（`Unexpected token 'else'`）。

規則：

- `if` / `else` 壓在**同一行**，或改用行內的 `$(if (...) { ... } else { ... })`
- **絕不讓 `else` / `elseif` 出現在行首**
- 雙引號字串裡的子運算式只用單引號，避免巢狀雙引號
- `foreach (...) {` 這種以開括號結尾的多行區塊是安全的（parser 仍在續行狀態）
- 長腳本結尾加一行 `Write-Host "(列表結束)"` —— 他貼回來的輸出**經常在最後一個指令被截斷**
- 破壞性操作一律加**安全閘門**（先檢查前提條件，不符就不執行），並印出檢查結果

### 5.2 ESLint flat config 的規則會「整個覆蓋」，不是合併

原本把兩道圍籬寫成兩個設定區塊（一個擋 `openai`、一個擋 `ai/client`），
結果後者把前者**整個蓋掉**，`openai` 被放行 —— 護欄安靜地失效了。

正解：一條規則一次列完所有限制，再用「豁免區塊」對特定檔案重新宣告剩下的限制。
`eslint.config.js` 裡有註解說明，**別重構回兩個區塊的寫法**。

> 這個洞是 `npm run test:guard` 抓到的。**這就是 SDD §14 那條「最容易被忽略」的測試存在的理由**——
> 沒有它，「沒有錯誤」跟「規則有效」長得一模一樣。

### 5.3 winget 來源索引壞了

`winget install` 報 `0x8a15000f`（遺失來源所需的資料）。**沒有去修**——
fnm 本來就是單一個 `fnm.exe`，直接從 GitHub releases 下載、解到
`%LOCALAPPDATA%\Programs\fnm`、寫進使用者 PATH 就好，三十秒的事。
winget 本身的問題與本專案無關，等他有空再修。

### 5.4 OneDrive 已知資料夾重導向（上一版就修好了，別重做）

Desktop / Documents / Pictures 都已指回 `C:\Users\erics\`，OneDrive 資料夾與環境變數皆已清除，
本次已驗證（`Test-Path $env:USERPROFILE\OneDrive` = False）。

過程中的教訓：Pictures 用圖形介面會失敗，因為底下有巢狀的已知資料夾；
手動路線是 `robocopy /E /MOVE` ＋ 改 `User Shell Folders` 與 `Shell Folders` 兩處登錄檔，
**寫回時務必保留原值型別**（REG_EXPAND_SZ vs REG_SZ）。

---

## 6. 下一步：P0 技術驗證

照這個順序，前兩件各五分鐘：

### P0-4 — Cubism FREE 能否匯出 `.moc3`（**先做這個**）

SDD §15 標記「在 P0-1 之前做，五分鐘」。
若不能匯出，Live2D 路線的成本結構會從「試用期綁完五隻」變成「每年 US$100」，
**那是另一個決定**，會影響 P0-1 要不要做兩版。

### P0-5 — AI Hub 連通與快取驗證

打通 `hnd1.aihub.zeabur.ai` 端點、量測實際延遲、確認 `cached_tokens` 有回報。
`src/lib/server/ai/client.ts` 已經寫好，`complete()` 也已經把 `cachedTokens` 讀出來了。
需要先去 Zeabur Dashboard 建 API 金鑰（**只顯示一次**），填進 `.env` 的 `AIHUB_API_KEY`。

> `.env` 目前是 `.env.example` 的複本，`AIHUB_API_KEY` 留空 = **本機 mock 模式**，
> `complete()` 直接回固定字串不燒點數。這是刻意的（SDD §13.2）。

### 然後才是

- **P0-1** 角色在手機網頁上會動（`LayeredPngRenderer` 先做，記錄實際工時）
- **P0-2** 定位判定實地量測（`resolvePresence` 已經寫好且有測試，缺的是真實座標與 `radiusM`）
- **P0-3** 相機 ＋ 角色合成輸出（iOS ＋ Android 各一台）

---

## 7. 🔸 還等君和拍板的事

| # | 項目 | 現況 |
|---|---|---|
| 1 | **另外兩個景點** | 建議 **西本願寺廣場 ＋ 新富町文化市場**。理由四點：皆在萬華所以手繪像素地圖蓋得住、皆非宗教場域（五站中只有龍山寺要扛高風險內容治理）、加上既有三站剛好覆蓋清代到戰後是一部萬華斷代史、三個地標形狀在像素地圖上畫得出來。排除了青草巷（離龍山寺不到 100m，判定半徑會打架）。**問過兩次，他說晚點再決定** |
| 2 | **地圖方案 A/B** | 隨 #1 連動。若兩個景點都在萬華，方案 A（手繪像素地圖）成立，SDD 已按 A 設計 |

這兩項不擋 P0-4 與 P0-5，但**擋 P0-2 實地量測**（不知道要去哪量）。

其餘未定案項目見 SDD 附錄 A（12 項暫定決策，每項附連動影響）與附錄 B（企劃書 11 項待確認的處理狀態）。

---

## 8. 企劃書待修正的問題（SDD 附錄 C，尚未回寫企劃書）

| # | 嚴重度 | 問題 |
|---|---|---|
| C-1 | 🔴 | **相機實作矛盾**：§5.1 描述即時疊層（需 `getUserMedia`），§5.4 卻寫「呼叫原生相機介面」——後者無法即時疊層，兩者不能同時成立。SDD 已選即時疊層為主路徑、原生相機為權限被拒時的降級路徑 |
| C-2 | 🟠 | 引導提問「要當內容設計」與「預寫 vs 生成待確認」互相排除——生成的提問無法逐字審 |
| C-3 | 🟡 | 進度遺失風險比企劃書描述的高（Safari ITP 會清除部分儲存） |
| C-4 | 🟡 | 「一趟拿完一站的卡」與劇情卡的線性前置條件衝突 |

這些要改上游的企劃書，不是 SDD 能自己吸收的。下次動企劃書時一併處理。

---

## 9. 與君和協作的方式

- 稱呼「君和」，用「你」不用「妳」
- **辦正事前先講方案、取得明確確認才動手**（他的偏好設定明訂）
- 技術選擇要附邏輯根據，不要只給結論
- 破壞性操作前先診斷、先驗證、先講風險，不要用猜的動他的系統
- **git 指令他要自己在 VS Code 終端機下**，不要用工具替他跑。AI 的角色是給逐條指令、說明每一步做什麼、在旁邊看輸出排錯

### ★ 他的程式背景是「只會 Python」

寫程式碼時：

- 附 **Python 對照註解**——「這行等於 Python 的什麼」，不要寫空泛的 `// 設定路由`
- 型別先幫他寫好，讓他踩在上面填函式內容，靠編輯器自動補完學
- **主動指出坑，不要等他自己撞**。已寫在 `PY_TO_TS.md`：
  空陣列是 truthy、`null` vs `undefined`、`.sort()` 預設按字串排、
  負索引不能用、標準庫幾乎沒有
- 好用的對照：Zod ≈ pydantic、Drizzle ≈ SQLAlchemy、Vitest ≈ pytest、
  tsc ≈ mypy、npm ≈ pip、`package.json` ≈ `pyproject.toml`、`node_modules` ≈ `.venv`
- 真正花時間的**不是 TypeScript，是 Canvas 與瀏覽器 API**——那是專案本身的難度
- P0-1 要拆得比原計畫更細，先給他一個「動起來了」的小成功，再進角色動畫
