#!/usr/bin/env bash
# =============================================================================
# 城市物語 Urban Tales —— GCP VM 一鍵佈署（Ubuntu 24.04 LTS）
#
# 用法（在 VM 上，以一般帳號執行，不要用 sudo 跑整支）：
#     git clone <你的 repo> ~/Urban_Tales
#     cd ~/Urban_Tales
#     bash deploy/bootstrap.sh tales.alcloud.us
#
# ⚠️ 服務會以「執行這支腳本的那個帳號」的身分跑。重建時務必用相同帳號登入執行，
#    否則 systemd unit 的 User= 會被改掉，而既有的 /etc/urban-tales/urban-tales.env
#    （640 root:<原帳號>）不會跟著更新 → 服務起得來卻讀不到金鑰。
#    要指定帳號：UT_USER=someone bash deploy/bootstrap.sh <網域>
#
# 這支腳本是**冪等**的：重跑不會弄壞既有設定，也不會覆蓋環境變數檔與資料庫。
# =============================================================================
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
if [[ -z "$DOMAIN" ]]; then
    echo "用法：bash deploy/bootstrap.sh <你的網域>"
    echo "例：  bash deploy/bootstrap.sh tales.alcloud.us"
    exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${UT_USER:-$(id -un)}"
ENV_FILE="/etc/urban-tales/urban-tales.env"
DB_NAME="urban_tales"
DB_USER="urban_tales"
NODE_MAJOR=24

if [[ "$APP_USER" == "root" ]]; then
    echo "✗ 請用一般帳號執行（腳本內部會自己 sudo）。以 root 長駐沒必要也不安全。"
    exit 1
fi

# ⚠️ 重建守門：跟 Roku 同一個坑。既有安裝若是別的帳號建的，用不同帳號重跑會讓
#    服務讀不到環境變數檔，症狀是「金鑰明明填了卻像沒填」。
if [[ -f /etc/systemd/system/urban-tales.service ]]; then
    EXISTING_USER="$(sed -n 's/^User=//p' /etc/systemd/system/urban-tales.service | head -1)"
    if [[ -n "$EXISTING_USER" && "$EXISTING_USER" != "$APP_USER" ]]; then
        echo "✗ 既有服務以 '$EXISTING_USER' 身分執行，但你現在是 '$APP_USER'。"
        echo "  請改用：UT_USER=$EXISTING_USER bash deploy/bootstrap.sh $DOMAIN"
        exit 1
    fi
fi

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
echo "服務將以帳號執行：$APP_USER"

# ─────────────────────────────────────────────────────────────
say "1/9 系統套件"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    nginx git curl ca-certificates gnupg postgresql postgresql-contrib

# ─────────────────────────────────────────────────────────────
say "2/9 Node.js $NODE_MAJOR"
# Ubuntu 24.04 內建的 nodejs 是 18，太舊（專案用 Node 24）。走 NodeSource。
if ! command -v node >/dev/null || [[ "$(node -v | sed 's/^v\([0-9]*\).*/\1/')" -lt "$NODE_MAJOR" ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - >/dev/null
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
fi
echo "  node $(node -v) / npm $(npm -v)"

# ─────────────────────────────────────────────────────────────
say "3/9 交換空間（建置用）"
# e2-small 只有 2GB。vite build 會瞬間吃掉不少記憶體，沒有 swap 時可能被 OOM killer
# 砍掉，而症狀是「npm run build 沒有錯誤訊息就中斷了」——極難查。
# 2GB swap 只在建置那幾十秒會用到，平時不影響效能。
if ! swapon --show | grep -q '/swapfile'; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
    sudo swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    echo "  已建立 2GB swap"
else
    echo "  已存在，跳過"
fi

# ─────────────────────────────────────────────────────────────
say "4/9 PostgreSQL 資料庫與帳號"
# ★ 不動 postgresql.conf 的 listen_addresses：預設就只聽 127.0.0.1。
#   這正是我們離開 Zeabur 的理由之一——資料庫不該有對外的面。
#   開發機要連，請走 SSH 通道（見 deploy/README.md）。
sudo systemctl enable --now postgresql >/dev/null

DB_EXISTS="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" || true)"
if [[ "$DB_EXISTS" == "1" ]]; then
    echo "  資料庫 $DB_NAME 已存在，保留不動（★ 不會碰你的資料）"
    NEW_DB_PASSWORD=""
else
    NEW_DB_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
    sudo -u postgres psql -qc "CREATE USER $DB_USER WITH PASSWORD '$NEW_DB_PASSWORD';"
    sudo -u postgres psql -qc "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
    echo "  已建立資料庫與帳號"
fi

# ─────────────────────────────────────────────────────────────
say "5/9 環境變數檔 $ENV_FILE"
sudo mkdir -p "$(dirname "$ENV_FILE")"
if [[ -f "$ENV_FILE" ]]; then
    echo "  已存在，保留不覆蓋（要改請 sudo nano $ENV_FILE）"
else
    sudo cp "$APP_DIR/deploy/env.example" "$ENV_FILE"
    sudo chown "root:$APP_USER" "$ENV_FILE"
    sudo chmod 640 "$ENV_FILE"   # 只有 root 可寫、只有服務帳號可讀
    # 順手把剛產生的資料庫密碼與一把 SESSION_SECRET 填進去，少兩個手動步驟就少兩個手滑機會
    if [[ -n "$NEW_DB_PASSWORD" ]]; then
        sudo sed -i "s|__填密碼__|$NEW_DB_PASSWORD|" "$ENV_FILE"
    fi
    SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
    sudo sed -i "s|^SESSION_SECRET=$|SESSION_SECRET=$SECRET|" "$ENV_FILE"
    sudo sed -i "s|https://__填網域__|https://$DOMAIN|g" "$ENV_FILE"   # ORIGIN 與 PUBLIC_SITE_URL 兩處
    echo "  已從範本建立，並自動填入資料庫密碼與 SESSION_SECRET。"
    echo "  ⚠️ 還缺 AI_API_KEY 與 DEMO_PASSPHRASE，稍後 sudo nano $ENV_FILE 補上。"
fi

# systemd 的 EnvironmentFile 是「後面覆蓋前面」。重複的變數名會讓下面那個空值
# 把上面填好的值蓋掉，而錯誤訊息完全指不到這裡（Roku 專案 2026-08-31 踩過）。
DUPES="$(sudo grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" 2>/dev/null | sort | uniq -d || true)"
if [[ -n "$DUPES" ]]; then
    echo ""
    echo "  ⚠️  $ENV_FILE 有重複定義的變數："
    echo "$DUPES" | sed 's/^/       /'
    echo "     systemd 取最後一次出現的值 —— 請刪掉多餘的那幾行。"
    echo ""
fi

# ─────────────────────────────────────────────────────────────
say "6/9 安裝相依套件並建置"
cd "$APP_DIR"
npm ci --no-audit --no-fund
# ★ 建置需要讀 .env 之外的東西嗎？不需要——內容在建置期由 import.meta.glob 打包，
#   環境變數是執行期才讀的（$env/dynamic/private）。所以這裡不必先填金鑰。
npm run build

# 資料庫結構。★ 用 migrate 不用 push：正式環境要有可追溯、可重播的變更紀錄，
# push 是「看現況差異直接改」，在正式環境等於沒有紀錄。
set -a; source <(sudo cat "$ENV_FILE" | grep '^DATABASE_URL='); set +a
npm run db:migrate

# ─────────────────────────────────────────────────────────────
say "7/9 systemd 服務"
sed -e "s|__USER__|$APP_USER|g" -e "s|__APPDIR__|$APP_DIR|g" \
    "$APP_DIR/deploy/urban-tales.service" | sudo tee /etc/systemd/system/urban-tales.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable urban-tales >/dev/null

# ─────────────────────────────────────────────────────────────
say "8/9 nginx（$DOMAIN）"
sed -e "s|__DOMAIN__|$DOMAIN|g" "$APP_DIR/deploy/nginx-urban-tales.conf" \
    | sudo tee /etc/nginx/sites-available/urban-tales.conf >/dev/null
sudo ln -sf /etc/nginx/sites-available/urban-tales.conf /etc/nginx/sites-enabled/urban-tales.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

sudo systemctl restart urban-tales
sleep 3
if ! systemctl is-active --quiet urban-tales; then
    echo "✗ 服務沒起來。看 log：sudo journalctl -u urban-tales -n 50 --no-pager"
    exit 1
fi
curl -fsS --max-time 10 -o /dev/null http://127.0.0.1:3000/ && echo "  本機自我測試通過" \
    || echo "  ⚠️ 本機沒回應，看 journalctl"

# ─────────────────────────────────────────────────────────────
say "9/9 HTTPS 憑證"
# ★ 對這個專案 HTTPS 不是選配：定位與羅盤都只在安全情境下可用。
MY_IP="$(curl -fsS --max-time 5 -H 'Metadata-Flavor: Google' \
    http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
echo "  這台 VM 的外部 IP：${MY_IP:-（取不到）}"
echo "  $DOMAIN 解析到：   ${DNS_IP:-（解析不到）}"

if [[ -n "$MY_IP" && "$MY_IP" == "$DNS_IP" ]]; then
    command -v certbot >/dev/null || {
        sudo snap install --classic certbot
        sudo ln -sf /snap/bin/certbot /usr/bin/certbot
    }
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
        --register-unsafely-without-email --redirect
    echo "  憑證已簽發，certbot 會自動每日檢查續約。"
else
    cat <<MSG

  ⚠️ 跳過憑證申請：DNS 還沒指到這台機器。
     到 Cloudflare 把 $DOMAIN 指向 ${MY_IP:-這台 VM 的外部 IP}，
     ⚠️ A 記錄必須是「DNS only」灰色雲朵 —— 開橘色雲朵 certbot 會驗證失敗。
     等 nslookup $DOMAIN 回傳正確 IP 後再執行：

         sudo certbot --nginx -d $DOMAIN

MSG
fi

cat <<DONE

═══════════════════════════════════════════════════════════════
 完成。接下來：
   1. 補金鑰：      sudo nano $ENV_FILE   （AI_API_KEY、DEMO_PASSPHRASE）
   2. 重啟服務：    sudo systemctl restart urban-tales
   3. 看即時 log：  sudo journalctl -u urban-tales -f

 日常維護：
   更新程式  cd $APP_DIR && git pull && npm ci && npm run build \\
             && npm run db:migrate && sudo systemctl restart urban-tales
   服務狀態  systemctl status urban-tales
   資料庫    sudo -u postgres psql $DB_NAME

 從開發機連資料庫（★ 不要對外開放 5432）：
   ssh -i <金鑰> -N -L 55432:127.0.0.1:5432 $APP_USER@${MY_IP:-<VM IP>}
   然後本機 .env：DATABASE_URL=postgres://$DB_USER:<密碼>@127.0.0.1:55432/$DB_NAME
═══════════════════════════════════════════════════════════════
DONE
