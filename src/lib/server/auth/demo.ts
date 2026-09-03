/**
 * 展示模式 —— SDD §5.4。
 *
 * ★★★ 這是產品功能，不是 debug 開關（企劃書 §5.8）。★★★
 *
 * 核心設計第 1 條是「硬到場」，但作品集的觀眾不會跑到萬華去。所以要有一條
 * 讓人看得到成品的路——同時又不能讓那條路把「硬到場」在事實上廢掉。
 *
 * 【暫定 T3】開放程度：通關密語。完全公開等於沒有硬到場；僅特定網址則不便於
 * 放在履歷連結上。密語寫在作品集頁面，觀眾看得到、隨機到訪者看不到。
 *
 * ★ 為什麼是第三個檔案、第三把金鑰
 *   同 presence.ts 檔頭的理由：三種憑證的驗證邏輯不共用，才不會有人為了
 *   某一種放寬條件時，順手把另外兩種也放寬了。
 *
 *   demoKey = HMAC-SHA256(SESSION_SECRET, 'urban-tales/demo/v1')
 *
 * ⚠️ 前端那個「展示模式」開關**不能**是唯一的判準。開關只是 UI 狀態，
 *   玩家改得動；真正決定的是這張伺服器簽的 cookie。
 */
import { SignJWT, jwtVerify } from 'jose';
import { createHmac, timingSafeEqual } from 'node:crypto';

const ALG = 'HS256';
const DEMO_INFO = 'urban-tales/demo/v1';

/** SDD §5.4：兩小時。夠看完一輪展示，不夠拿來當長期後門 */
export const DEMO_TTL_SECONDS = 2 * 60 * 60;

export const DEMO_COOKIE = 'ut_demo';

export function deriveDemoKey(sessionSecret: string | undefined): Uint8Array {
	if (!sessionSecret || new TextEncoder().encode(sessionSecret).length < 32) {
		throw new Error('SESSION_SECRET 未設定或短於 32 bytes —— 展示模式的金鑰是從它推導的');
	}
	return new Uint8Array(createHmac('sha256', sessionSecret).update(DEMO_INFO).digest());
}

/**
 * 比對通關密語。**常數時間比較。**
 *
 * ★ 為什麼不能直接用 `===`：字串比較會在第一個不同的字元就回傳，
 *   所以「答對前三個字」比「第一個字就錯」慢一點點。攻擊者可以靠這個
 *   時間差一個字元一個字元地把密語問出來。這種攻擊在網路延遲下不容易做，
 *   但「不容易」不是理由——常數時間比較是免費的。
 *
 * 長度不同時直接回 false：`timingSafeEqual` 對長度不同的輸入會丟例外，
 * 而長度本身本來就藏不住（它不影響逐字元的猜測）。
 */
export function passphraseMatches(input: string, expected: string | undefined): boolean {
	if (!expected) return false; // 沒設定密語 = 展示模式關閉，不是「任何人都能進」
	const a = Buffer.from(input, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/** 密語對了之後發的通行證。內容只有「這個瀏覽器可以用展示模式」與到期時間 */
export async function signDemoCookie(key: Uint8Array): Promise<string> {
	return new SignJWT({ purpose: 'demo' })
		.setProtectedHeader({ alg: ALG })
		.setIssuedAt()
		.setExpirationTime(`${DEMO_TTL_SECONDS}s`)
		.sign(key);
}

/** 這個請求處於展示模式嗎。永遠不 throw */
export async function isDemoSession(
	cookie: string | null | undefined,
	key: Uint8Array
): Promise<boolean> {
	if (!cookie) return false;
	try {
		const { payload } = await jwtVerify(cookie, key, { algorithms: [ALG] });
		return payload.purpose === 'demo';
	} catch {
		return false;
	}
}
