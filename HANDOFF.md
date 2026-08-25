# HANDOFF — 給接手的下一個對話

> 由 Roku 於 2026-08-25 寫下。**新對話開始時，讀完 `CONTEXT.md` 之後接著讀這一份。**
> 這份是「上一次做到哪、下一步做什麼」，不是專案本身的定義。專案定義看企劃書與 SDD。

---

## 0. 三十秒摘要

企劃階段已結束，**SDD v0.1 已完成**（`Urban_Tales_SDD_v0.1.md`，15 章 ＋ 附錄 A–E）。

目前正在做的事是：**建立開發環境、接上 GitHub**。已完成的是清掉了一個擋路的系統問題（OneDrive 資料夾重導向），**尚未開始產專案骨架**。

**下一步 = 確認 Windows 工具鏈 → 產 SvelteKit 專案骨架 → 君和自己在 VS Code 終端機 git init / npm install / push。**

---

## 1. 專案基本資訊

| 項目 | 內容 |
|---|---|
| 專案資料夾 | `C:\Users\erics\Desktop\Urban_Tales` |
| 開發環境 | Windows 11、VS Code、PowerShell 7.6.5（**無**系統管理員權限） |
| 部署 | Zeabur |
| AI | Zeabur AI Hub（已儲值） |

### 文件閱讀順序

1. `CONTEXT.md` — 專案入口
2. `Urban_Tales_企劃書_v0.2.md` — **權威文件**，定義做什麼／為什麼／刻意不做什麼
3. `Urban_Tales_SDD_v0.1.md` — 定義怎麼實作。**附錄 A 是可推翻的暫定決策表，每一項都附連動影響**

---

## 2. 這次對話新增的定案

| # | 決策 | 理由 |
|---|---|---|
| 1 | **前端框架 = SvelteKit** | 君和 Svelte 和 React 都沒寫過，他授權我決定。Svelte 概念少（沒有 hooks 規則、沒有重渲染心智負擔），且本專案大量 canvas 操作（像素地圖、角色、相機合成），Svelte 不搶 DOM。**SDD 的 T1 就此定案** |
| 2 | **專案位置 = 桌面的 `Urban_Tales`，不搬走** | 原本建議搬到 `C:\Users\erics\dev\` 是為了躲 OneDrive 同步。OneDrive 現已徹底移除，桌面是乾淨的本機資料夾，且君和其他十個專案都在桌面，維持一致 |
| 3 | **GitHub repo 先私有**，做到一個段落再公開 | 早期 commit 較亂，作品集觀眾看到的應該是整齊的版本 |

---

## 3. 已完成：OneDrive 已知資料夾重導向（花了不少工，別重做）

**症狀**：OneDrive 早已解除安裝，桌面路徑卻仍是 `C:\Users\erics\OneDrive\Desktop`。

**原因**：OneDrive 的「備份重要資料夾」(Known Folder Move) 會改寫登錄檔的 shell folder 指標並實際搬移資料夾。**解除安裝或登出不會把它搬回去。**

**現在的狀態（已全部修好）**：

```
Desktop     : C:\Users\erics\Desktop      ✅
Personal    : C:\Users\erics\Documents    ✅
My Pictures : C:\Users\erics\Pictures     ✅
OneDrive 資料夾：已刪除
```

**過程中的兩個教訓（如果之後又碰到類似問題）**：

1. **Desktop** 走「資料夾內容 → 位置 → 移動」成功，但**刪除舊資料夾那一步失敗**——OneDrive 的雲端檔案 reparse 標籤 `0x9000601a` 卡住，結果變成「複製」而非「移動」。事後手動 `Remove-Item` 就清掉了（沒用到 robocopy）。
2. **Pictures 用圖形介面怎麼試都失敗**，錯誤是「相同位置中有無法重新導向的資料夾。存取被拒。」真正原因是 **Pictures 底下有巢狀的已知資料夾**（相機相簿 / 螢幕擷取畫面 / Saved Pictures），Windows 必須連它們一起重導，其中一個卡住就整批放棄。最後改走手動路線：`robocopy /E /MOVE` 搬檔案 → 掃描 `User Shell Folders` 與 `Shell Folders` 兩個登錄檔位置把**所有**指向舊路徑的值改掉（本例共 6 筆，含 4 個 GUID 命名的巢狀已知資料夾）→ 重啟 Explorer。**寫回登錄檔時務必保留原值型別**（REG_EXPAND_SZ vs REG_SZ），型別寫錯 Explorer 會讀不到。

**收尾腳本（移除 OneDrive 資料夾與環境變數）已交給君和，執行結果尚未回報。** 新對話可先確認一次：`Test-Path "$env:USERPROFILE\OneDrive"` 應為 False。

---

## 4. ⚠️ 給君和的 PowerShell 指令必須「貼上安全」

**這個坑踩過一次，別再踩。**

PowerShell 主控台在貼上多行時，看到 `}` 單獨在行首且語句已完整，會**當場送出執行**，導致下一行的 `else` 變成孤兒語句而報錯（`Unexpected token 'else'`）。

規則：

- `if` / `else` 壓在**同一行**，或改用行內的 `$(if (...) { ... } else { ... })`
- **絕不讓 `else` / `elseif` 出現在行首**
- `foreach (...) {` 這種以開括號結尾的多行區塊是安全的（parser 仍在續行狀態）
- 長腳本結尾加一行 `Write-Host "(列表結束)"`——君和貼回來的輸出**經常在最後一個指令被截斷**，有結束標記才知道有沒有貼完
- 破壞性操作一律加**安全閘門**（先檢查前提條件，不符就不執行），並印出檢查結果

---

## 5. 下一步（照這個順序做）

### 步驟 1：確認 Windows 工具鏈（**還沒做**）

原本要跑的檢查被 OneDrive 問題插隊了。需要知道 git / node / npm / gh 是否安裝、版本為何，以及 git 的 `user.name` / `user.email` / `core.autocrlf`。

`core.autocrlf` 一定要在第一天處理掉，否則之後會出現「整個檔案都是差異」的假 diff。

### 步驟 2：產專案骨架（**尚未開始**）

由 AI 產生後寫進專案資料夾。內容至少包含：

- `package.json`、`svelte.config.js`、`vite.config.ts`、`tsconfig.json`
- **`eslint.config.js` 含 SDD §6.1 的唯一出口封鎖規則**（`no-restricted-imports` 擋 `openai` 與 AI client，只開放給 `src/lib/server/soul/speak.ts`）
- `content/schema.ts`（Zod）＋ `content:check` 驗證腳本（SDD §2.4 的十項）
- `.gitignore`、`.env.example`、`.nvmrc`、`.editorconfig`
- `.vscode/extensions.json` ＋ `settings.json`
- `.github/workflows/ci.yml`（content:check ＋ lint ＋ build）
- `drizzle.config.ts` ＋ 資料表 schema 骨架（SDD §3.2）
- `README.md`
- 目錄骨架：`src/lib/server/soul/`、`src/lib/client/soul/`、`content/sites/` 等

> **唯一出口的 ESLint 規則要在第一天就裝上，不是之後補。** 等到有五個檔案在呼叫 AI 才想加就晚了。這是 SDD 最核心的架構決定，也是前身專案失敗的那一點。

### 步驟 3：君和自己接 GitHub

**他明確要求自己在 VS Code 終端機下 git 指令，不要用工具替他跑。** AI 的角色是給逐條指令、說明每一步做什麼、在旁邊看輸出排錯。

順序：`git init` → `npm install` → `npm run dev` 驗證 → 建 GitHub repo（私有）→ 首次 push。

### 步驟 4：驗收

- `npm run dev` 起得來
- **故意寫一個違規的 `import OpenAI from 'openai'`，確認 `npm run lint` 會擋下來**（驗證護欄機制本身有效，這條最容易被忽略）
- CI 綠燈

---

## 6. 🔸 還等君和拍板的事

| # | 項目 | 現況 |
|---|---|---|
| 1 | **另外兩個景點** | 我建議 **西本願寺廣場 ＋ 新富町文化市場**。理由四點：皆在萬華所以手繪像素地圖蓋得住、皆非宗教場域（五站中只有龍山寺要扛高風險內容治理）、加上既有三站剛好覆蓋清代到戰後是一部萬華斷代史、三個地標形狀在像素地圖上畫得出來。排除了青草巷（離龍山寺不到 100m，判定半徑會打架）。**他還沒回覆** |
| 2 | **地圖方案 A/B** | 隨 #1 連動。若兩個景點都在萬華，方案 A（手繪像素地圖）成立，SDD 已按 A 設計 |

其餘未定案項目見 SDD 附錄 A（12 項暫定決策，每項附連動影響）與附錄 B（企劃書 11 項待確認的處理狀態）。

---

## 7. 我在企劃書找到的問題（SDD 附錄 C，尚未回寫企劃書）

| # | 嚴重度 | 問題 |
|---|---|---|
| C-1 | 🔴 | **相機實作矛盾**：§5.1 描述即時疊層（需 `getUserMedia`），§5.4 卻寫「呼叫原生相機介面」——後者無法即時疊層，兩者不能同時成立。SDD 已選即時疊層為主路徑、原生相機為權限被拒時的降級路徑 |
| C-2 | 🟠 | 引導提問「要當內容設計」與「預寫 vs 生成待確認」互相排除——生成的提問無法逐字審 |
| C-3 | 🟡 | 進度遺失風險比企劃書描述的高（Safari ITP 會清除部分儲存） |
| C-4 | 🟡 | 「一趟拿完一站的卡」與劇情卡的線性前置條件衝突 |

這些要改上游的企劃書，不是 SDD 能自己吸收的。下次動企劃書時一併處理。

---

## 8. 與君和協作的方式

- 稱呼「君和」，用「你」不用「您」
- **辦正事前先講方案、取得明確確認才動手**（他的偏好設定明訂）
- 技術選擇要附邏輯根據，不要只給結論
- 破壞性操作前先診斷、先驗證、先講風險，不要用猜的動他的系統
