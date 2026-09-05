/**
 * 進入 L2 的判準測試。
 *
 * ★ 這一支是切片 4 唯一測得到「成功路徑」的地方：六站現在都是草稿，
 *   端到端跑不出 200。所以純函式這邊要把成功與失敗兩側都測滿，
 *   等第一站轉 playable 時再用 smoke:api 補接線那一段。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { decideEnter, type EnterInput } from './enter';
import type { PresenceClaims } from '$lib/server/auth/presence';

const PLAYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function claims(over: Partial<PresenceClaims> = {}): PresenceClaims {
	return {
		playerId: PLAYER,
		siteId: 'longshan-temple',
		mode: 'field',
		expiresAt: Math.floor(Date.now() / 1000) + 900,
		...over
	};
}

/** 一切正常的那一組。每條測試只改它的一個欄位，讓「差別是什麼」一眼看得到 */
function base(over: Partial<EnterInput> = {}): EnterInput {
	return {
		playerId: PLAYER,
		siteId: 'longshan-temple',
		siteStatus: 'playable',
		presence: claims(),
		encounterCardId: 'encounter-longshan',
		...over
	};
}

describe('decideEnter —— 放行', () => {
	it('可遊玩的站 ＋ 有效在場憑證 → 進得去，帶回卡片 id', () => {
		const d = decideEnter(base());
		expect(d).toEqual({
			ok: true,
			playerId: PLAYER,
			siteId: 'longshan-temple',
			mode: 'field',
			cardId: 'encounter-longshan'
		});
	});

	it('展示模式的憑證同樣進得去，mode 原樣帶出去', () => {
		// ★ mode 要帶出去，因為 SDD §5.4 要求成就卡標註「展示模式取得」。
		//   在這裡就分好，下游才不必再去翻憑證。
		const d = decideEnter(base({ presence: claims({ mode: 'demo' }) }));
		expect(d.ok && d.mode).toBe('demo');
	});
});

describe('decideEnter —— 拒絕', () => {
	it('沒有身分 → 401', () => {
		const d = decideEnter(base({ playerId: null }));
		expect(d).toMatchObject({ ok: false, status: 401, code: 'no_identity' });
	});

	it('沒有這一站 → 404', () => {
		const d = decideEnter(base({ siteStatus: null }));
		expect(d).toMatchObject({ ok: false, status: 404, code: 'unknown_site' });
	});

	it('★ 草稿站 → 403，即使憑證完全有效', () => {
		// 這是切片 4 的核心行為：草稿站在地圖上看得到、算得出距離，但進不去。
		const d = decideEnter(base({ siteStatus: 'draft' }));
		expect(d).toMatchObject({ ok: false, status: 403, code: 'site_not_playable' });
	});

	it('★ 草稿站的判斷排在憑證之前 —— 沒憑證也是回 site_not_playable', () => {
		// 順序本身是規格的一部分（見 enter.ts 檔頭）。這條把順序釘住：
		// 兩個條件同時不成立時，回的是先檢查的那一個。
		const d = decideEnter(base({ siteStatus: 'draft', presence: null }));
		expect(d.ok).toBe(false);
		expect(d.ok === false && d.code).toBe('site_not_playable');
	});

	it('沒有在場憑證 → 403', () => {
		const d = decideEnter(base({ presence: null }));
		expect(d).toMatchObject({ ok: false, status: 403, code: 'no_presence' });
	});

	it('★ 撿別人的憑證來用 → 403', () => {
		// 憑證的 sub 就是發證時的玩家，理論上不會不一致。
		// 但「理論上不會發生」的事要明確擋掉，不是相信它。
		const d = decideEnter(base({ presence: claims({ playerId: OTHER }) }));
		expect(d).toMatchObject({ ok: false, status: 403, code: 'no_presence' });
	});

	it('憑證無效與憑證是別人的 → 回一模一樣的東西', () => {
		// 不分辨是刻意的：兩種情況玩家都得重新定位一次。
		// 少一個分支少一個洞（同 verifyPresenceToken 對「別站的憑證」的處理）。
		const a = decideEnter(base({ presence: null }));
		const b = decideEnter(base({ presence: claims({ playerId: OTHER }) }));
		expect(a).toEqual(b);
	});

	it('★ playable 卻沒有相遇卡定義 → 500，而且訊息要指名 content:check', () => {
		// 這是內容層與程式碼不一致，不是玩家做錯事。安靜跳過的話玩家會
		// 永遠少一張卡而沒有人發現——那正是前身專案的失敗形狀。
		const d = decideEnter(base({ encounterCardId: null }));
		expect(d).toMatchObject({ ok: false, status: 500, code: 'card_undefined' });
		expect(d.ok === false && d.message).toContain('content:check');
	});

	it('草稿站沒有卡片定義是正常的 —— 回草稿，不回 500', () => {
		// 現在六站都是這個狀態。若順序寫反，每次戳草稿站都會噴 500。
		const d = decideEnter(base({ siteStatus: 'draft', encounterCardId: null }));
		expect(d.ok === false && d.code).toBe('site_not_playable');
	});
});
