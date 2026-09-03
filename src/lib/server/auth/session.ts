/**
 * 訪客身分憑證的簽發與驗證 —— SDD §4.1。
 *
 * ★ 這個檔案是**純的**：它不讀環境變數、不碰資料庫、不認識 SvelteKit。
 *   金鑰由呼叫端（hooks.server.ts）傳進來。
 *
 *   為什麼要這樣切：這裡的邏輯是「錯了很難從畫面看出來」的那一種——
 *   簽章驗錯了畫面照常運作，只是任何人都能偽造身分。所以它必須能被單元測試
 *   直接測，而測試不應該需要先架起一整個 SvelteKit 環境才跑得動。
 *   （SDD §14：單元測試花在純函式、邏輯密集的地方。）
 *
 * 給 Python 背景的對照：
 *   jose ≈ PyJWT。`new SignJWT({}).setSubject(x).sign(key)` 這種一路接下去的
 *   寫法叫 builder pattern，等同 Python 裡回傳 self 的鏈式呼叫。
 *   `new TextEncoder().encode(s)` ≈ `s.encode('utf-8')`，得到的是 bytes。
 */
import { SignJWT, jwtVerify } from 'jose';

/** Cookie 名稱。前端永遠讀不到它（HttpOnly），只有伺服器看得見 */
export const PLAYER_COOKIE = 'ut_player';

/** 一年。SDD §4.1：清除瀏覽器資料 = 失去進度，這是第一版接受的已知代價 */
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * ★ 演算法寫死，而且驗證時也要再指定一次。
 *
 * 不指定的話會踩到 JWT 最有名的坑：攻擊者把 token 的 header 改成
 * `{"alg":"none"}`，某些函式庫就真的不驗簽章了。jose 預設不吃 none，
 * 但把允許的演算法明確列出來是零成本的第二道鎖。
 */
const ALG = 'HS256';

/**
 * HS256 的金鑰至少要 32 bytes。
 * 短於這個長度時 HMAC 的安全性會掉到可暴力破解的範圍——
 * 而「密鑰太短」在執行期不會有任何症狀，所以必須在啟動時就擋下來。
 */
const MIN_SECRET_BYTES = 32;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 把 .env 的字串換成簽章金鑰，順便驗長度。
 *
 * ★ 這裡刻意用 throw 而不是回傳 null：密鑰沒設好是**部署錯誤**，不是執行期
 *   可以降級處理的狀況。讓它在第一個請求就整個炸掉，好過安靜地用一把
 *   弱金鑰跑上線——後者沒有人會發現。
 */
export function toKey(rawSecret: string | undefined): Uint8Array {
	if (!rawSecret) {
		throw new Error('SESSION_SECRET 未設定。見 .env.example 的產生方式。');
	}
	const key = new TextEncoder().encode(rawSecret);
	if (key.length < MIN_SECRET_BYTES) {
		throw new Error(
			`SESSION_SECRET 太短（${key.length} bytes），至少要 ${MIN_SECRET_BYTES} bytes。` +
				"產生方式：node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\""
		);
	}
	return key;
}

/**
 * 簽一張玩家憑證。
 *
 * payload 只有 `sub`（玩家 uuid）、`iat`、`exp`——沒有暱稱、沒有權限、
 * 沒有進度快取（SDD §4.1）。進度一律即時查 DB。
 *
 * ★ 為什麼不放進度：JWT 一旦簽出去就無法更新，放進去的任何東西都會在
 *   玩家拿到卡片的那一刻變成過期資料，然後你得為了同步它再寫一套機制。
 */
export async function signPlayerToken(playerId: string, key: Uint8Array): Promise<string> {
	return new SignJWT({})
		.setProtectedHeader({ alg: ALG })
		.setSubject(playerId)
		.setIssuedAt()
		.setExpirationTime(`${COOKIE_MAX_AGE_SECONDS}s`)
		.sign(key);
}

/**
 * 驗一張玩家憑證，回傳玩家 uuid；任何不合格的情況一律回 null。
 *
 * ★ 這個函式永遠不 throw。呼叫端只需要處理「有身分／沒身分」兩種情況，
 *   不需要分辨是過期、被竄改、還是根本不是一張 token——對系統的反應
 *   完全一樣（重新發一張）。分辨它們只會讓呼叫端多長出用不到的分支。
 *
 * ★ 最後那道 uuid 格式檢查不是多餘的：`sub` 是從外部來的字串，
 *   直接拿去查 `WHERE id = $1`（uuid 欄位）的話，格式不對會讓 Postgres
 *   丟出型別錯誤，於是一張爛 cookie 就變成 500。擋在這裡讓它變成「沒身分」。
 */
export async function verifyPlayerToken(token: string, key: Uint8Array): Promise<string | null> {
	try {
		const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
		const sub = payload.sub;
		if (typeof sub !== 'string' || !UUID_RE.test(sub)) return null;
		return sub;
	} catch {
		// 過期、簽章不符、格式不是 JWT —— 全部視為「沒有身分」
		return null;
	}
}

/**
 * 這個請求需不需要身分？
 *
 * ★★★ 這道閘門是必要的，不是效能微調。★★★
 *
 * `handle` 會攔到**每一個**請求，包括地圖那 630 張圖磚 PNG。玩家第一次開頁時
 * 瀏覽器會**同時**發出十幾個請求，每一個都還沒有 cookie——如果每一個都去建立
 * 玩家，一次開頁就會生出十幾列 players，而且它們互相不知道對方存在。
 *
 * 判準只有兩條：
 *   1. `/api/*` —— 後端呼叫，一定要知道是誰
 *   2. `Accept` 含 `text/html` —— 瀏覽器只有在要**一整份 HTML 文件**時才這樣送。
 *      圖磚送 `image/*`、CSS 送 `text/css`、JS 送萬用 Accept，都不會命中。
 *
 * ⚠️ **為什麼不用 `Sec-Fetch-Mode: navigate`**（那才是語意最準的信號）：
 *    `Sec-` 開頭的是 forbidden header，程式改不了它——Node 的 fetch 會自己
 *    塞 `cors` 並覆蓋你設的值。也就是說，用它當判準的話，**這道閘門就永遠
 *    寫不出自動化測試**，只能靠人開瀏覽器手動確認。
 *
 *    測不到的護欄哪天壞了不會有人發現。這個專案在 ESLint 圍籬上已經學過一次
 *    這個教訓（`test:guard` 抓到過安靜失效）。所以寧可用語意稍弱但測得到的
 *    `Accept`——它對真實瀏覽器一樣可靠，因為文件請求一定帶 `text/html`。
 */
export function needsIdentity(pathname: string, headers: Headers): boolean {
	if (pathname.startsWith('/api/')) return true;
	return headers.get('accept')?.includes('text/html') ?? false;
}
