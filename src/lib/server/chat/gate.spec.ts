/**
 * /api/chat 前置判準的測試。
 *
 * ★ 這一支要守的界線：**什麼是 4xx、什麼是「200 ＋ 保底台詞」**。
 *   把「輸入太長」誤放到這裡會讓玩家看到一個沒有設計過的錯誤畫面，
 *   而那正是企劃書 §8.7 要避免的事。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { decideChat, type ChatInput } from './gate';
import type { PresenceClaims } from '$lib/server/auth/presence';

const PLAYER = '11111111-1111-4111-8111-111111111111';

function claims(over: Partial<PresenceClaims> = {}): PresenceClaims {
	return {
		playerId: PLAYER,
		siteId: 'longshan-temple',
		mode: 'field',
		expiresAt: Math.floor(Date.now() / 1000) + 900,
		...over
	};
}

/** 一切正常的那一組。每條測試只改它的一個欄位 */
function base(over: Partial<ChatInput> = {}): ChatInput {
	return {
		playerId: PLAYER,
		siteId: 'longshan-temple',
		text: '這裡以前是什麼樣子？',
		siteStatus: 'playable',
		presence: claims(),
		...over
	};
}

describe('decideChat —— 放行', () => {
	it('可遊玩的站 ＋ 有效憑證 → 進得去，帶回 mode', () => {
		const d = decideChat(base());
		expect(d.ok).toBe(true);
		if (d.ok) {
			expect(d.playerId).toBe(PLAYER);
			expect(d.siteId).toBe('longshan-temple');
			expect(d.mode).toBe('field');
		}
	});

	it('展示模式一樣放行，mode 帶回 demo（額度由 speak() 依 mode 決定）', () => {
		const d = decideChat(base({ presence: claims({ mode: 'demo' }) }));
		expect(d.ok && d.mode).toBe('demo');
	});

	it('前後空白會被 trim 掉', () => {
		const d = decideChat(base({ text: '  你好  ' }));
		expect(d.ok && d.text).toBe('你好');
	});
});

describe('decideChat —— 拒絕', () => {
	it('沒有身分 → 401', () => {
		const d = decideChat(base({ playerId: null }));
		expect(d.ok).toBe(false);
		if (!d.ok) expect([d.status, d.code]).toEqual([401, 'no_identity']);
	});

	it('沒有這一站 → 404', () => {
		const d = decideChat(base({ siteStatus: null }));
		if (!d.ok) expect([d.status, d.code]).toEqual([404, 'unknown_site']);
	});

	it('草稿站 → 403', () => {
		const d = decideChat(base({ siteStatus: 'draft' }));
		if (!d.ok) expect([d.status, d.code]).toEqual([403, 'site_not_playable']);
	});

	it('沒有在場憑證 → 403', () => {
		const d = decideChat(base({ presence: null }));
		if (!d.ok) expect([d.status, d.code]).toEqual([403, 'no_presence']);
	});
});

describe('decideChat —— body 不合格一律 400', () => {
	// 這些是前端的錯或攻擊，不是玩家做錯事——玩家的畫面上本來就不該出現。
	it.each([
		['siteId 不是字串', { siteId: 123 }],
		['siteId 是空字串', { siteId: '' }],
		['沒有 text', { text: undefined }],
		['text 不是字串', { text: { a: 1 } }],
		['text 只有空白', { text: '   ' }]
	])('%s → 400', (_label, over) => {
		const d = decideChat(base(over as Partial<ChatInput>));
		expect(d.ok).toBe(false);
		if (!d.ok) expect([d.status, d.code]).toEqual([400, 'bad_request']);
	});
});

describe('★ 長度不在這裡擋', () => {
	// L1 的結果是保底台詞（200 ＋ slowDown），不是 400。
	// 在這裡順手擋掉會讓玩家收到一個沒有設計過的錯誤畫面（企劃書 §8.7）。
	it('超長輸入照樣放行，交給 speak() 的 L1 處理', () => {
		const d = decideChat(base({ text: '字'.repeat(5000) }));
		expect(d.ok).toBe(true);
	});
});
