/**
 * 拍照任務判準的測試 —— SDD §8.1。
 *
 * ★ 同 enter.spec.ts：六站都是草稿，端到端跑不出 200，
 *   所以成功路徑只能在這裡測滿。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { decidePhotoTask, type PhotoTaskInput } from './photo-task';
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

function base(over: Partial<PhotoTaskInput> = {}): PhotoTaskInput {
	return {
		playerId: PLAYER,
		siteId: 'longshan-temple',
		siteStatus: 'playable',
		presence: claims(),
		taskCardId: 'task-longshan',
		...over
	};
}

describe('decidePhotoTask —— 放行', () => {
	it('可遊玩的站 ＋ 有效憑證 → 過關，帶回任務卡 id', () => {
		const d = decidePhotoTask(base());
		expect(d.ok).toBe(true);
		if (d.ok) expect([d.playerId, d.cardId]).toEqual([PLAYER, 'task-longshan']);
	});

	it('展示模式一樣過關（拍了就過，無審核）', () => {
		const d = decidePhotoTask(base({ presence: claims({ mode: 'demo' }) }));
		expect(d.ok && d.mode).toBe('demo');
	});
});

describe('decidePhotoTask —— 拒絕', () => {
	it.each([
		['沒有身分', { playerId: null }, 401, 'no_identity'],
		['沒有這一站', { siteStatus: null }, 404, 'unknown_site'],
		['草稿站', { siteStatus: 'draft' }, 403, 'site_not_playable'],
		['沒有在場憑證', { presence: null }, 403, 'no_presence'],
		['內容層沒定義任務卡', { taskCardId: null }, 500, 'card_undefined']
	])('%s → %i', (_label, over, status, code) => {
		const d = decidePhotoTask(base(over as Partial<PhotoTaskInput>));
		expect(d.ok).toBe(false);
		if (!d.ok) expect([d.status, d.code]).toEqual([status, code]);
	});

	// 順序釘住：草稿站與缺憑證同時成立時，回的是先檢查的那一個。
	it('草稿站的判斷排在憑證之前', () => {
		const d = decidePhotoTask(base({ siteStatus: 'draft', presence: null }));
		if (!d.ok) expect(d.code).toBe('site_not_playable');
	});

	// ★ 卡片查不到是最後才檢查的：它是內容層的錯，不該蓋過玩家自己的問題。
	it('沒有身分又沒有任務卡 → 先回 401', () => {
		const d = decidePhotoTask(base({ playerId: null, taskCardId: null }));
		if (!d.ok) expect(d.code).toBe('no_identity');
	});
});
