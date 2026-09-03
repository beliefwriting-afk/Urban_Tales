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
| Name | `tales` |
| IPv4 | VM 的外部 IP（第二步拿到後填） |
| Proxy status | **DNS only（灰色雲朵）** |

⚠️ **一定要灰雲。** 橘色雲朵會讓 certbot 的 HTTP-01 驗證打到 Cloudflare 邊緣而不是 VM，
時好時壞，失敗還會吃掉 Let's Encrypt 的重試配額。

---

## 第二步：建立 VM

Compute Engine → 建立執行個體

| 欄位 | 設定 |
|---|---|
| 地區 | **us-central1**（跟 Roku 同區，之後要互相搬東西比較方便） |
| 機型 | **e2-small**（2 vCPU 共用、2GB RAM） |
| 作業系統 | **Ubuntu 24.04 LTS** |
| 開機磁碟 | **平衡永久磁碟 20GB** |
| 外部 IP | **保留靜態外部 IP**，取名 `urban-tales-ip` |
| 防火牆 | **HTTP 與 HTTPS 兩個都勾** |

⚠️ **磁碟一定要「平衡」不要「標準」。** 標準是 HDD，IOPS 跟容量成正比，
20GB 只有約 15 讀取 IOPS——`npm ci` 那一步會從兩三分鐘拖到十幾分鐘。
**磁碟類型建立後不能改**，選錯要重建 VM。

⚠️ **80 埠一定要開**，不能只開 443。certbot 的 HTTP-01 驗證走的是 80。

⚠️ **不要開 3000 或 5432。** node 只綁 loopback、PostgreSQL 也只聽 loopback，
對外一律經 nginx 的 443。少開一個埠就少一個被掃到的面。

SSH 金鑰照 Roku 那份教學的做法（Compute Engine → 中繼資料 → 安全殼層金鑰）。

---

## 第三步：佈署

```bash
git clone git@github.com:beliefwriting-afk/Urban_Tales.git ~/Urban_Tales
cd ~/Urban_Tales
bash deploy/bootstrap.sh tales.alcloud.us
```

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

- **資料庫備份。** 現在沒有任何備份機制。真的有玩家之後這是第一優先。
  建議照 Roku 的做法：每日 `pg_dump` ＋ 傳到 Google Drive ＋ 保留最近幾份。
  在那之前，玩家進度遺失的後果是「重新收集成就卡」，不是災難，但別忘了。
- **開發用資料庫。** 現在開發直接連正式庫。有真玩家之前可以接受，之後要分開。
- **90 天換帳號的 SOP。** Roku 那份寫得很完整，我們也需要一份——
  尤其是「靜態 IP 要沿用不要新建」與「重建時用同一個帳號跑 bootstrap」這兩個坑。
