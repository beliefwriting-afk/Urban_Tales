/**
 * 在場憑證 —— SDD §5.3。
 *
 * ★★★ 這張憑證是 AI 成本的第一道閘門。★★★
 * 沒有它就打不了 `/api/chat`，也就花不掉一分錢。這比事後限流有效得多——
 * 攻擊者得先偽造座標才能開始燒錢。
 *
 * 它同時讓「硬到場」變成**伺服器端的事實**，而不是前端的君子協定。
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 為什麼這個檔案不重用 session.ts 的任何一行
 * ─────────────────────────────────────────────────────────────
 *
 * 前身專案在三個檔案裡把幾乎一樣的驗證邏輯寫了三次，註解寫得很直白：
 *
 *   「抽成共用函式的誘惑很大，但那正是這條規則要擋的事：一旦共用，
 *     某天有人為了某個情境放寬其中一種的條件（例如『過期一點點就算了吧』），
 *     三種 token 會一起被放寬，而 code review 只會看到一個看似無害的參數變更。」
 *
 * 我們只有兩種憑證，但道理一樣。這裡的重複是刻意的，不是可以順手抽出來的
 * 共用程式碼。兩者的語意也不同：
 *
 *   身分憑證（一年）  ＝ 你是誰
 *   在場憑證（15 分鐘）＝ 你剛才真的站在那個景點的判定範圍內
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 金鑰分離：從 SESSION_SECRET 推導，而不是共用它
 * ─────────────────────────────────────────────────────────────
 *
 *   presenceKey = HMAC-SHA256(SESSION_SECRET, 'urban-tales/presence/v1')
 *
 * HMAC 在這裡當虛擬亂數函數用：知道 presenceKey 推不回 SESSION_SECRET，
 * 兩把金鑰在數學上互相獨立。所以拿身分 cookie 去冒充在場憑證會直接驗不過
 * ——簽章對不上，連 payload 都不會被讀到。
 *
 * 為什麼不在 .env 多放一個 PRESENCE_SECRET：多一個要產生、要保管、要在
 * 正式環境同步的祕密，而安全性完全相同。少一個會忘記設定的東西。
 */
import { SignJWT, jwtVerify } from 'jose';
import { createHmac } from 'node:crypto';

const ALG = 'HS256';

/** SDD §5.3：15 分鐘。★ 這個數字對應真實行為——玩家在現場聊天會續期，離開後自然失效 */
export const PRESENCE_TTL_SECONDS = 900;

/** 剩餘時間低於這個值時，`/api/chat` 回應要附一張新的（滑動視窗，SDD §5.3） */
export const PRESENCE_RENEW_THRESHOLD_SECONDS = 300;

/** 金鑰推導的 info 字串。★ 改它等於讓所有已發出的在場憑證立刻失效 */
const PRESENCE_INFO = 'urban-tales/presence/v1';

/** field ＝ 真的走到現場；demo ＝ 展示模式（SDD §5.4） */
export type PresenceMode = 'field' | 'demo';

export type PresenceClaims = {
	playerId: string;
	siteId: string;
	mode: PresenceMode;
	/** Unix 秒。呼叫端用它決定要不要續期 */
	expiresAt: number;
};

/**
 * 從 SESSION_SECRET 推出在場憑證專用的金鑰。
 *
 * ★ 長度檢查在這裡自己做一次，不呼叫 session.ts 的 toKey——
 *   見檔頭：兩種憑證的程式碼刻意不相依。
 */
export function derivePresenceKey(sessionSecret: string | undefined): Uint8Array {
	if (!sessionSecret || new TextEncoder().encode(sessionSecret).length < 32) {
		throw new Error('SESSION_SECRET 未設定或短於 32 bytes —— 在場憑證的金鑰是從它推導的');
	}
	return new Uint8Array(createHmac('sha256', sessionSecret).update(PRESENCE_INFO).digest());
}

/**
 * 簽一張在場憑證。
 *
 * ★★★ payload 裡沒有座標。★★★
 *   憑證只證明「這個玩家在這個時間點通過了這個景點的到場判定」。
 *   當初用來判定的座標在判定完成的那一刻就該消失，不該被憑證夾帶著到處走
 *   （企劃書 §7、§8.8：不建立任何位置軌跡類的資料）。
 */
export async function signPresenceToken(
	claims: { playerId: string; siteId: string; mode: PresenceMode },
	key: Uint8Array
): Promise<string> {
	return new SignJWT({ site: claims.siteId, mode: claims.mode, purpose: 'presence' })
		.setProtectedHeader({ alg: ALG })
		.setSubject(claims.playerId)
		.setIssuedAt()
		.setExpirationTime(`${PRESENCE_TTL_SECONDS}s`)
		.sign(key);
}

/**
 * 驗證在場憑證。任何不合格的情況一律回 null。
 *
 * ★ `expectedSiteId` 不符也是 null。呼叫端不需要分辨「憑證無效」與
 *   「憑證是別站的」——兩種情況玩家都不該進得去。前身在這裡回 403 而不是 401，
 *   那是因為它的 API 要對外提供除錯資訊；我們的前端不需要，少一個分支少一個洞。
 *
 * ★ 這個函式永遠不 throw。
 */
export async function verifyPresenceToken(
	token: string | null | undefined,
	key: Uint8Array,
	expectedSiteId: string
): Promise<PresenceClaims | null> {
	if (!token) return null;

	try {
		const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });

		if (payload.purpose !== 'presence') return null;
		if (payload.site !== expectedSiteId) return null;

		const mode = payload.mode;
		if (mode !== 'field' && mode !== 'demo') return null;

		const sub = payload.sub;
		if (typeof sub !== 'string' || !sub) return null;
		if (typeof payload.exp !== 'number') return null;

		return { playerId: sub, siteId: expectedSiteId, mode, expiresAt: payload.exp };
	} catch {
		return null;
	}
}

/** 剩不到五分鐘就該換一張。SDD §5.3 的滑動視窗 */
export function needsRenewal(claims: PresenceClaims, nowSeconds: number): boolean {
	return claims.expiresAt - nowSeconds < PRESENCE_RENEW_THRESHOLD_SECONDS;
}
