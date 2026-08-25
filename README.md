# 城市物語 Urban Tales

玩家實際走到台北的景點，召喚出該地標的「城市靈魂」，透過對話了解這個地方的故事。

手機瀏覽器優先的網頁應用，免安裝。

> **判準**：玩法好玩但玩家講不出故事 = 失敗；
> 玩家能跟朋友說「原來剝皮寮以前是⋯⋯」= 成功。

---

## 文件

接手這個專案請照這個順序讀：

| 檔案                         | 是什麼                                     |
| ---------------------------- | ------------------------------------------ |
| `CONTEXT.md`                 | 專案入口與現況                             |
| `HANDOFF.md`                 | 上一次做到哪、下一步做什麼                 |
| `Urban_Tales_企劃書_v0.2.md` | **權威文件**。做什麼／為什麼／刻意不做什麼 |
| `Urban_Tales_SDD_v0.1.md`    | **系統設計**。怎麼實作                     |
| `PY_TO_TS.md`                | Python → TypeScript 速查表                 |

---

## 技術棧

| 層           | 選擇                                       |
| ------------ | ------------------------------------------ |
| 前端 ＋ 後端 | SvelteKit 2（Svelte 5 runes）＋ TypeScript |
| 部署         | Zeabur（Node adapter，單一服務）           |
| 資料庫       | PostgreSQL 16 ＋ Drizzle ORM               |
| AI           | Zeabur AI Hub（HND1 東京，OpenAI 相容）    |
| 內容         | Content-as-Code，YAML 進 Git ＋ Zod 驗證   |

單一部署單元。沒有 Redis、沒有物件儲存、沒有 CDN、沒有訊息佇列。

---

## 開始開發

```bash
npm install
cp .env.example .env     # 填入實際值；AIHUB_API_KEY 留空 = 本機 mock，不燒點數
npm run dev
```

| 指令                    | 做什麼                                                   |
| ----------------------- | -------------------------------------------------------- |
| `npm run dev`           | 開發伺服器                                               |
| `npm run verify`        | **提交前跑這個** —— 內容驗證 ＋ lint ＋ 測試 ＋ 護欄測試 |
| `npm run content:check` | 內容驗證（SDD §2.4 十項）                                |
| `npm run lint`          | 含 speak() 唯一出口封鎖檢查                              |
| `npm run test`          | 單元測試                                                 |
| `npm run test:guard`    | **驗證護欄機制本身有效**                                 |
| `npm run check`         | TypeScript 型別檢查                                      |
| `npm run db:push`       | 套用資料庫 schema                                        |

---

## ★ 這個專案最重要的一條規則

**所有會產出「靈魂說出口的文字」的路徑，都必須經過 `speak()`。**

對話、引導提問、任務台詞、劇情、保底台詞 —— 全景點適用，不分景點。

前身專案的失敗原因（企劃書 §4.2）是規則只掛在主要對話路徑上，其餘生成路徑
繞過了它。本專案把這件事從**紀律問題**變成**機械問題**：

```
src/lib/server/ai/client.ts     ← 唯一可以 import 'openai' 的檔案
        ▲
        │ 只有這一條線
        │
src/lib/server/soul/speak.ts    ← 唯一可以 import AI client 的檔案
        ▲
        │
    其他所有程式碼               ← 想繞過？ESLint 直接擋，CI 建置失敗
```

由 `eslint.config.js` 的 `AI_SDK_FENCE` 與 `AI_CLIENT_FENCE` 強制，
`npm run test:guard` 驗證這道圍籬本身沒有失效。

**改動這兩處之前，先讀 SDD §6.1 與企劃書 §4.2。**

---

## 目錄

```
content/            內容層（進 Git，不做 CMS）
  schema.ts           ★ Zod 定義，型別與驗證的單一事實來源
  guardrails.yaml     ★ 全站唯一一份安全界線
  cards.yaml          13 張成就卡
  sites/<id>/         每站六個 YAML
  _template/          新增景點時複製這裡
scripts/            建置期工具（TypeScript，會影響 CI 判定）
tools/              離線工具（Python，不部署、不影響建置）
src/lib/server/     伺服器端。★ SvelteKit 禁止前端 import 這個目錄
  soul/speak.ts       ★ 唯一出口
  ai/client.ts        ★ 唯一的 AI SDK 入口
  presence/geo.ts     到場判定（純函式，有測試）
  db/schema.ts        資料表。★ 不存在任何經緯度欄位
src/lib/client/
  soul/renderer.ts    SoulRenderer 抽象層（Live2D vs 分層 PNG 可抽換）
static/art/         立繪、圖層、像素卡框
```

---

## 隱私硬約束

這四條在架構層面落實，不是靠自律：

- **不做背景定位追蹤** —— 僅在玩家主動使用時前景取得位置
- **座標判定後即丟棄** —— 資料庫 schema 裡沒有任何經緯度欄位，
  `content:check` 有一條檢查會掃 `lat`／`lng`／`geography` 欄位，出現即建置失敗
- **不上傳、不保存玩家照片** —— 整個系統沒有能接收圖片的端點
- **訪客模式不蒐集個資** —— `players` 表無 email、姓名、IP
