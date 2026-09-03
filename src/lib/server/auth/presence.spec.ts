/**
 * 在場憑證與展示模式的測試。
 *
 * ★ 這裡每一條測的都是「錯了畫面完全正常」的東西：
 *   憑證驗鬆了不會有紅字，只會讓沒到現場的人也能燒我們的 AI 額度。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import {
	derivePresenceKey,
	signPresenceToken,
	verifyPresenceToken,
	needsRenewal,
	PRESENCE_TTL_SECONDS
} from './presence';
import { deriveDemoKey, passphraseMatches, signDemoCookie, isDemoSession } from './demo';
import { toKey, signPlayerToken } from './session';

const SECRET = 'a'.repeat(32);
const OTHER_SECRET = 'b'.repeat(32);
const PLAYER = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const SITE = 'longshan-temple';

const pKey = derivePresenceKey(SECRET);

describe('金鑰分離', () => {
	it('★ 身分憑證驗不過在場憑證的關卡', async () => {
		// 這是整個設計的重點：拿一年期的身分 cookie 冒充 15 分鐘的在場憑證，
		// 必須連 payload 都讀不到。若這條失敗，「硬到場」就只剩前端的君子協定。
		const sessionToken = await signPlayerToken(PLAYER, toKey(SECRET));
		await expect(verifyPresenceToken(sessionToken, pKey, SITE)).resolves.toBeNull();
	});

	it('presence 與 demo 從同一個祕密推出來，但彼此不通用', async () => {
		const dKey = deriveDemoKey(SECRET);
		expect(Buffer.from(pKey).equals(Buffer.from(dKey))).toBe(false);

		const demoCookie = await signDemoCookie(dKey);
		// 展示模式的 cookie 不該能當在場憑證用
		await expect(verifyPresenceToken(demoCookie, pKey, SITE)).resolves.toBeNull();
	});

	it('換掉 SESSION_SECRET，舊的在場憑證全部失效', async () => {
		const token = await signPresenceToken({ playerId: PLAYER, siteId: SITE, mode: 'field' }, pKey);
		const newKey = derivePresenceKey(OTHER_SECRET);
		await expect(verifyPresenceToken(token, newKey, SITE)).resolves.toBeNull();
	});

	it('祕密太短就丟錯，不安靜用一把弱金鑰', () => {
		expect(() => derivePresenceKey(undefined)).toThrow(/SESSION_SECRET/);
		expect(() => derivePresenceKey('a'.repeat(31))).toThrow(/SESSION_SECRET/);
		expect(() => deriveDemoKey('')).toThrow(/SESSION_SECRET/);
	});
});

describe('在場憑證', () => {
	it('自己簽的驗得回來', async () => {
		const token = await signPresenceToken({ playerId: PLAYER, siteId: SITE, mode: 'field' }, pKey);
		const claims = await verifyPresenceToken(token, pKey, SITE);
		expect(claims).toMatchObject({ playerId: PLAYER, siteId: SITE, mode: 'field' });
	});

	it('★ 別站的憑證進不了這一站', async () => {
		// 沒有這條的話，走到西門紅樓拿一張憑證，就能拿去跟龍山寺的靈魂聊天。
		const token = await signPresenceToken(
			{ playerId: PLAYER, siteId: 'ximen-red-house', mode: 'field' },
			pKey
		);
		await expect(verifyPresenceToken(token, pKey, SITE)).resolves.toBeNull();
	});

	it('★ payload 裡沒有座標', async () => {
		// 企劃書 §7：座標判定後即丟棄，不該被憑證夾帶著到處走。
		const token = await signPresenceToken({ playerId: PLAYER, siteId: SITE, mode: 'demo' }, pKey);
		const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
		expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'mode', 'purpose', 'site', 'sub']);
		expect(JSON.stringify(payload)).not.toMatch(/lat|lng|accuracy|coord/i);
	});

	it('過期的驗不過', async () => {
		const now = Math.floor(Date.now() / 1000);
		const expired = await new SignJWT({ site: SITE, mode: 'field', purpose: 'presence' })
			.setProtectedHeader({ alg: 'HS256' })
			.setSubject(PLAYER)
			.setIssuedAt(now - 3600)
			.setExpirationTime(now - 60)
			.sign(pKey);
		await expect(verifyPresenceToken(expired, pKey, SITE)).resolves.toBeNull();
	});

	it('purpose 不對就驗不過', async () => {
		// 防的是「未來多了第四種憑證，剛好用同一把金鑰」這種情況
		const wrong = await new SignJWT({ site: SITE, mode: 'field', purpose: 'something-else' })
			.setProtectedHeader({ alg: 'HS256' })
			.setSubject(PLAYER)
			.setIssuedAt()
			.setExpirationTime('15m')
			.sign(pKey);
		await expect(verifyPresenceToken(wrong, pKey, SITE)).resolves.toBeNull();
	});

	it('mode 只能是 field 或 demo', async () => {
		const wrong = await new SignJWT({ site: SITE, mode: 'superuser', purpose: 'presence' })
			.setProtectedHeader({ alg: 'HS256' })
			.setSubject(PLAYER)
			.setIssuedAt()
			.setExpirationTime('15m')
			.sign(pKey);
		await expect(verifyPresenceToken(wrong, pKey, SITE)).resolves.toBeNull();
	});

	it('空的、亂編的都回 null，不丟例外', async () => {
		await expect(verifyPresenceToken(null, pKey, SITE)).resolves.toBeNull();
		await expect(verifyPresenceToken('', pKey, SITE)).resolves.toBeNull();
		await expect(verifyPresenceToken('not.a.token', pKey, SITE)).resolves.toBeNull();
	});

	it('剩不到五分鐘才需要續期', () => {
		const now = 1_000_000;
		expect(
			needsRenewal({ playerId: PLAYER, siteId: SITE, mode: 'field', expiresAt: now + 299 }, now)
		).toBe(true);
		expect(
			needsRenewal({ playerId: PLAYER, siteId: SITE, mode: 'field', expiresAt: now + 301 }, now)
		).toBe(false);
		// 剛簽出來的一定不用續
		expect(
			needsRenewal(
				{ playerId: PLAYER, siteId: SITE, mode: 'field', expiresAt: now + PRESENCE_TTL_SECONDS },
				now
			)
		).toBe(false);
	});
});

describe('展示模式', () => {
	const dKey = deriveDemoKey(SECRET);

	it('密語對了才算數', () => {
		expect(passphraseMatches('開門', '開門')).toBe(true);
		expect(passphraseMatches('開門了', '開門')).toBe(false);
		expect(passphraseMatches('關門', '開門')).toBe(false);
	});

	it('★ 沒設定密語 ＝ 展示模式關閉，不是任何人都能進', () => {
		// 這條防的是「環境變數忘了設，結果門大開」——那是最糟的失敗方向。
		expect(passphraseMatches('', undefined)).toBe(false);
		expect(passphraseMatches('隨便打', undefined)).toBe(false);
		expect(passphraseMatches('', '')).toBe(false);
	});

	it('簽出來的 cookie 驗得過，別把金鑰換掉', async () => {
		const cookie = await signDemoCookie(dKey);
		await expect(isDemoSession(cookie, dKey)).resolves.toBe(true);
		await expect(isDemoSession(cookie, deriveDemoKey(OTHER_SECRET))).resolves.toBe(false);
	});

	it('沒有 cookie、亂編的 cookie 都不算展示模式', async () => {
		await expect(isDemoSession(null, dKey)).resolves.toBe(false);
		await expect(isDemoSession('偽造的', dKey)).resolves.toBe(false);
	});

	it('在場憑證不能當展示模式的通行證用', async () => {
		const token = await signPresenceToken({ playerId: PLAYER, siteId: SITE, mode: 'demo' }, pKey);
		await expect(isDemoSession(token, dKey)).resolves.toBe(false);
	});
});
