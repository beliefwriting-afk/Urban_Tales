# 部署到 GCP

> 2026-09-03 從 Zeabur 搬過來。搬家理由與各項決策見 SDD §13。
> 這份是操作步驟；`bootstrap.sh` 是它的可執行版本。

---

## 架構

```
玩家的手機
   │  HTTPS :443
   │  ★ 定位與羅盤只在安全情境下可用，所以 HTTPS 不是選配
   ▼
[ GCP VM · Ubuntu 24.04 · e2-small ]
   nginx                      ← 終結 TLS（Let's Encrypt，certbot 自動續約）
   │  http://127.0.0.1:3000   ← 只綁 loopback，外網掃不到
   ▼
   node build                 ← adapter-node 的產出，由 systemd 管
   │
   ├─→ PostgreSQL 127.0.0.1:5432   ★ 不對外開放。開發機走 SSH 通道
   └─→ Gemini API（OpenAI 相容端點）
```

**為什麼資料庫不對外開放**：Zeabur 的做法是把 PostgreSQL 掛在一個公開的 TCP 連接埠上，
全世界都連得到，只靠密碼擋。那正是我們離開的理由之一。這裡的資料庫只聽 loopback，
沒有任何對外的面——要從開發機連進去，請走 SSH 通道（見下面）。

---

## 你需要準備的

| 項目 | 用途 | 費用 |
|---|---|---|
| Google Cloud 帳號 | 開 VM | 新帳號送 $300 / 90 天 |
| 網域 | Let's Encrypt 不簽 IP | 已有 `alcloud.us`（Cloudflare） |
| Google AI Studio 金鑰 | AI 對話 | 免費層 |
| GitHub deploy key | VM 上 clone 私有 repo | 免費 |

**成本**：VM 約 $12.2/月 ＋ 磁碟約 $2/月 ＋ 靜態 IP 約 $3.6/月 ≈ **$18/月**，90 天約 $53。

---

## 第一步：DNS

Cloudflare → `alcloud.us` → DNS → Add record

| 欄位 | 值 |
|---|---|
| Type | `A` |
| Name | `urbantales` |
| IPv4 | VM 的外部 IP（第二步拿到後填） |
| Proxy status | **DNS only（灰色雲朵）** |

⚠️ **一定要灰雲。** 橘色雲朵會讓 certbot 的 HTTP-01 驗證打到 Cloudflare 邊緣而不是 VM，
時好時壞，失敗還會吃掉 Let's Encrypt 的重試配額。

---

## 第二步：建立 VM

**GCP 專案：`larp-507213`**（跟謎案迴聲同一個專案）。

> **為什麼不開新專案**：GCP 對「一個帳單帳戶能綁幾個專案」有配額，君和的已經滿了。
> 同專案不影響隔離——**共用的只有帳單帳戶、SSH 金鑰與 VPC 網路**，
> VM、磁碟、靜態 IP、nginx、憑證、服務全都各自獨立。
> 一台搞掛不影響另一台，90 天重建也能一次搬一支。
>
> 💡 附帶好處：**SSH 金鑰設在專案層級**（Compute Engine → 中繼資料 → 安全殼層金鑰），
> 同專案下的新 VM 會自動繼承，不必再貼一次公鑰。

Compute Engine → 建立執行個體

| 欄位 | 設定 |
|---|---|
| 名稱 | `urban-tales`（與 `larp` 那台分開） |
| 地區 | **us-central1**（與 larp 同區） |
| 機型 | **e2-small**（2 vCPU 共用、2GB RAM）—— 理由見下 |
| 作業系統 | **Ubuntu 24.04 LTS** |
| 開機磁碟 | **平衡永久磁碟 20GB** |
| 外部 IP | **新建保留靜態位址**，取名 `urbantales2`（沿用命名慣例：內部 1、外部 2） |
| 防火牆 | **HTTP 與 HTTPS 兩個都勾** |

**為什麼不跟 larp 一樣用 e2-micro**：

1. larp 那台跑的是 FastAPI ＋ Redis，相依全是小套件，實測只吃 76MB。
   我們這台要同時跑 **Node SSR ＋ PostgreSQL ＋ `vite build`**，1GB 會很緊。
2. ⚠️ **GCP 長期免費層的 e2-micro 是「每個帳單帳戶每月一台」**，
   而那一台已經被 larp 用掉了。所以第二台 e2-micro **要收費**（約 $7/月），
   省下來的錢不足以換來「隨時可能因為記憶體不夠而卡住」的風險。

> 💡 **機型之後可以改**：關機 → 改機型 → 開機，IP 與磁碟都保留，不必重建 VM。
> 這跟磁碟類型不同——**磁碟類型建立後根本不能改**（只能走快照 → 建新磁碟 → 換掉）。
> 所以機型可以先保守、之後再降；磁碟那格才是選錯就要重來的。

⚠️ **磁碟一定要「平衡」不要「標準」。** 標準是 HDD，IOPS 跟容量成正比，
20GB 只有約 15 讀取 IOPS——`npm ci` 那一步會從兩三分鐘拖到十幾分鐘。
**磁碟類型建立後不能改**，選錯要重建 VM。

⚠️ **80 埠一定要開**，不能只開 443。certbot 的 HTTP-01 驗證走的是 80。

⚠️ **不要開 3000 或 5432。** node 只綁 loopback、PostgreSQL 也只聽 loopback，
對外一律經 nginx 的 443。少開一個埠就少一個被掃到的面。

SSH 金鑰照 Roku 那份教學的做法（Compute Engine → 中繼資料 → 安全殼層金鑰）。

---

## 第三步：佈署

⚠️ **deploy key 要重新產一把。** 這是一台全新機器，larp 或 Roku 那台上的金鑰不在這裡。

```bash
ssh-keygen -t ed25519 -f ~/.ssh/gh_urban_tales -N "" -C "urban-tales-deploy"
cat ~/.ssh/gh_urban_tales.pub
```

把印出來的公鑰貼到 GitHub → `Urban_Tales` repo → Settings → Deploy keys →
Add deploy key（**不要勾寫入權限**）。然後告訴 ssh 要用哪一把：

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/gh_urban_tales\n  IdentitiesOnly yes\n' >> ~/.ssh/config
```

接著 clone 並佈署（⚠️ **用 SSH 網址，不是 https://**）：

```bash
git clone git@github.com:beliefwriting-afk/Urban_Tales.git ~/Urban_Tales
cd ~/Urban_Tales
nohup bash deploy/bootstrap.sh urbantales.alcloud.us > ~/bootstrap.log 2>&1 &
tail -f ~/bootstrap.log
```

⚠️ **用 `nohup`**：bootstrap 要跑好幾分鐘（`npm ci` ＋ `vite build`），
SSH 一斷腳本就會被中止，而且可能停在很難收拾的中間狀態。
`Ctrl+C` 只會停掉 `tail`，不會停掉腳本；要再看進度就重連後 `tail -f ~/bootstrap.log`。
（這招是從 larp 那份遷移文件學來的。）

腳本會做完九件事：系統套件 → Node 24 → 2GB swap → PostgreSQL ＋ 建庫建帳號 →
環境變數檔（自動填資料庫密碼與 `SESSION_SECRET`）→ `npm ci` ＋ `npm run build` ＋
`db:migrate` → systemd → nginx → certbot。

**跑完還要手動補兩個值**：

```bash
sudo nano /etc/urban-tales/urban-tales.env
#   AI_API_KEY=        ← aistudio.google.com 產生
#   DEMO_PASSPHRASE=   ← 作品集頁面上要放的那句
sudo systemctl restart urban-tales
```

⚠️ **為什麼要 2GB swap**：e2-small 只有 2GB 記憶體，`vite build` 會瞬間吃掉不少。
沒有 swap 時可能被 OOM killer 砍掉，而症狀是「`npm run build` 沒有錯誤訊息就中斷了」——
極難查。swap 只在建置那幾十秒用得到，平時不影響效能。

---

## 從開發機連資料庫

**不要對外開放 5432。** 開一條 SSH 通道就好：

```powershell
ssh -i <你的金鑰> -N -L 55432:127.0.0.1:5432 <帳號>@<VM 外部 IP>
```

這個視窗保持開著，然後本機 `.env`：

```
DATABASE_URL=postgres://urban_tales:<密碼>@127.0.0.1:55432/urban_tales
```

密碼在 VM 上：`sudo grep DATABASE_URL /etc/urban-tales/urban-tales.env`

> 用 55432 而不是 5432，是為了不跟「哪天本機真的裝了 PostgreSQL」打架。

⚠️ 開發時連的是**正式資料庫**。跑 `npm run smoke:api -- --purge` 會清掉 players 表——
真的有玩家之後不要再這樣做。到那時候應該另外開一個 `urban_tales_dev` 資料庫。

---

## 日常維護

```bash
# 更新程式
cd ~/Urban_Tales && git pull && npm ci && npm run build \
  && npm run db:migrate && sudo systemctl restart urban-tales

# 看即時 log
sudo journalctl -u urban-tales -f

# 服務狀態
systemctl status urban-tales

# 進資料庫
sudo -u postgres psql urban_tales
```

---

## 🔜 還沒做的

- **資料庫的邏輯備份。** GCP 建立 VM 時掛了每日磁碟快照（`default-schedule-1`，
  每天中午 12:00–13:00），**那不能取代 `pg_dump`**：

  | | 磁碟快照 | `pg_dump` |
  |---|---|---|
  | 一致性 | crash-consistent（等同拔電源後重開） | 交易一致 |
  | 還原粒度 | 整顆磁碟，要換掉整台機器 | 單一資料表、單一列都行 |
  | 看得到內容嗎 | 不行，是二進位映像 | 是純 SQL，可以直接讀 |

  快照擋得住「VM 整台掛掉」，擋不住「某張表被誤刪」或「想看三天前那筆資料長怎樣」。
  真的有玩家之後照 Roku 的做法補上：每日 `pg_dump` ＋ 傳 Google Drive ＋ 保留最近幾份。
  在那之前，玩家進度遺失的後果是「重新收集成就卡」，不是災難，但別忘了。
- **開發用資料庫。** 現在開發直接連正式庫。有真玩家之前可以接受，之後要分開。
- **90 天換帳號的 SOP。** Roku 那份寫得很完整，我們也需要一份——
  尤其是「靜態 IP 要沿用不要新建」與「重建時用同一個帳號跑 bootstrap」這兩個坑。
