/**
 * 身分憑證的單元測試 —— SDD §14。
 *
 * ★ 這裡測的每一條都是「錯了畫面完全正常，但任何人都能冒充別的玩家」的那種錯。
 *   簽章驗錯了不會有紅字、不會有例外，只會安靜地放行。所以它必須被測。
 *
 * 給 Python 背景的對照：vitest ≈ pytest。
 *   `await expect(p).resolves.toBe(x)` ≈ 對 async 函式的結果做 assert
 *   `expect(fn).toThrow()`             ≈ pytest.raises
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { signPlayerToken, verifyPlayerToken, toKey, needsIdentity } from './session';

const PLAYER = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

// 兩把不同的金鑰。長度都刻意剛好 32 bytes（純 ASCII，一個字元一個 byte）
const KEY_A = toKey('a'.repeat(32));
const KEY_B = toKey('b'.repeat(32));

describe('toKey', () => {
	it('沒設定就丟錯，不安靜放行', () => {
		expect(() => toKey(undefined)).toThrow(/SESSION_SECRET 未設定/);
		expect(() => toKey('')).toThrow(/SESSION_SECRET 未設定/);
	});

	it('太短就丟錯', () => {
		// 31 bytes：只差一個，但 HMAC 的強度差在這裡，不能通融
		expect(() => toKey('a'.repeat(31))).toThrow(/太短/);
	});

	it('剛好 32 bytes 就通過', () => {
		expect(toKey('a'.repeat(32))).toHaveLength(32);
	});
});

describe('簽發與驗證', () => {
	it('自己簽的自己驗得回同一個玩家', async () => {
		const token = await signPlayerToken(PLAYER, KEY_A);
		await expect(verifyPlayerToken(token, KEY_A)).resolves.toBe(PLAYER);
	});

	it('換一把金鑰就驗不過', async () => {
		// 這條在防的是「金鑰換了但舊 cookie 還能用」。若它失敗，
		// 表示簽章根本沒有真的被檢查。
		const token = await signPlayerToken(PLAYER, KEY_A);
		await expect(verifyPlayerToken(token, KEY_B)).resolves.toBeNull();
	});

	it('內容被竄改就驗不過', async () => {
		const token = await signPlayerToken(PLAYER, KEY_A);
		// JWT 是 header.payload.signature，三段用 . 分開。
		// 動 payload 的最後一個字元，簽章就對不上了。
		const [h, p, s] = token.split('.');
		const tampered = `${h}.${p.slice(0, -1)}${p.slice(-1) === 'A' ? 'B' : 'A'}.${s}`;
		await expect(verifyPlayerToken(tampered, KEY_A)).resolves.toBeNull();
	});

	it('過期的驗不過', async () => {
		// 用 jose 自己捏一張已經過期的 token——測試要能構造出攻擊者能構造的東西，
		// 不該為了測試而在正式函式上開一個「自訂效期」的參數。
		const expired = await new SignJWT({})
			.setProtectedHeader({ alg: 'HS256' })
			.setSubject(PLAYER)
			.setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
			.setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
			.sign(KEY_A);
		await expect(verifyPlayerToken(expired, KEY_A)).resolves.toBeNull();
	});

	it('sub 不是合法 uuid 就當成沒有身分', async () => {
		// 這條防的是「一張爛 cookie 變成 500」：sub 會被拿去查 uuid 欄位，
		// 格式不對時 Postgres 會丟型別錯誤。
		const weird = await new SignJWT({})
			.setProtectedHeader({ alg: 'HS256' })
			.setSubject("'; DROP TABLE players; --")
			.setIssuedAt()
			.setExpirationTime('1h')
			.sign(KEY_A);
		await expect(verifyPlayerToken(weird, KEY_A)).resolves.toBeNull();
	});

	it('根本不是 JWT 的字串不會丟例外', async () => {
		// verifyPlayerToken 的契約是「永遠不 throw」。若這條失敗，
		// 隨便一個亂改 cookie 的人就能讓整站回 500。
		await expect(verifyPlayerToken('這不是一張 token', KEY_A)).resolves.toBeNull();
		await expect(verifyPlayerToken('', KEY_A)).resolves.toBeNull();
	});
});

describe('needsIdentity —— 哪些請求才建立玩家', () => {
	const h = (accept: string) => new Headers({ accept });

	it('導覽請求要有身分', () => {
		// 瀏覽器實際會送的 Accept（Chrome 的文件請求）
		expect(
			needsIdentity('/', h('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'))
		).toBe(true);
	});

	it('API 呼叫要有身分，不管 Accept 是什麼', () => {
		expect(needsIdentity('/api/presence', h('application/json'))).toBe(true);
		expect(needsIdentity('/api/chat', new Headers())).toBe(true);
	});

	it('★ 地圖圖磚不能有身分', () => {
		// 這條若失敗，玩家開一次頁會生出十幾列 players。
		// 630 張圖磚，每一張都是一個請求。
		expect(needsIdentity('/map/far/0_0.png', h('image/avif,image/webp,image/png,*/*;q=0.8'))).toBe(
			false
		);
	});

	it('CSS / JS / 字型都不能有身分', () => {
		expect(needsIdentity('/app.css', h('text/css,*/*;q=0.1'))).toBe(false);
		expect(needsIdentity('/app.js', h('*/*'))).toBe(false);
		expect(needsIdentity('/fonts/cubic11.woff2', h('*/*'))).toBe(false);
	});

	it('完全沒有 Accept 也不會誤判成需要身分', () => {
		expect(needsIdentity('/', new Headers())).toBe(false);
	});

	it('/api 前綴要精確，不能被 /apiary 這種路徑蹭到', () => {
		expect(needsIdentity('/apiary', h('application/json'))).toBe(false);
	});
});
