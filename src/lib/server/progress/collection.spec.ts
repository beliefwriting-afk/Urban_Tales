/**
 * 圖鑑組裝的測試 —— SDD §8.2。
 *
 * ★ 這一支守的是一條「錯了畫面完全正常」的界線：
 *   **未獲得的卡不能洩漏卡面內容**。多回一個 flavor，圖鑑看起來一模一樣
 *   （前端本來就不會畫它），但那句卡背文字已經送到玩家手上了。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { buildCollection, collectionSummary } from './collection';
import type { Card, LocalizedText } from '../../../../content/schema';

const loc = (s: string): LocalizedText => ({ zhHant: s, en: null, ja: null });

function card(id: string, kind: Card['kind'], siteId: string): Card {
	return {
		id,
		kind,
		siteId,
		title: loc(`${id} 的標題`),
		// ★ 用可辨識的哨兵字串，才驗得出「未獲得時它有沒有漏出去」
		flavor: loc(`FLAVOR-SENTINEL-${id}`),
		art: { portrait: `/art/${siteId}/portrait.png`, frame: '/art/frames/encounter.png' }
	};
}

const CARDS: Card[] = [
	card('encounter-longshan', 'encounter', 'longshan-temple'),
	card('task-longshan', 'task', 'longshan-temple'),
	card('story-bopiliao', 'story', 'bopiliao')
];

const NAMES: Record<string, string> = {
	'longshan-temple': '艋舺龍山寺',
	bopiliao: '剝皮寮歷史街區'
};
const nameOf = (id: string) => NAMES[id] ?? null;

const EARNED = new Date('2026-09-07T03:00:00.000Z');

describe('已獲得的卡', () => {
	const { entries } = buildCollection(CARDS, new Map([['task-longshan', EARNED]]), nameOf);
	const got = entries.find((e) => e.id === 'task-longshan');

	it('帶完整卡面與取得時間', () => {
		expect(got?.owned).toBe(true);
		if (got?.owned) {
			expect(got.title).toBe('task-longshan 的標題');
			expect(got.flavor).toBe('FLAVOR-SENTINEL-task-longshan');
			expect(got.art.portrait).toBe('/art/longshan-temple/portrait.png');
			expect(got.earnedAt).toBe(EARNED.toISOString());
		}
	});
});

describe('★ 未獲得的卡不洩漏卡面', () => {
	const { entries } = buildCollection(CARDS, new Map(), nameOf);

	it('每一張都是未獲得', () => {
		expect(entries.every((e) => !e.owned)).toBe(true);
		expect(entries).toHaveLength(3);
	});

	// ★★★ 這一條是本檔案的重點。整包序列化之後掃哨兵字串——
	//     比逐欄位檢查更難繞過，因為它連「被塞在某個新欄位裡」也抓得到。
	it('★ 卡背文字一個字都沒送出去', () => {
		const blob = JSON.stringify(entries);
		expect(blob).not.toContain('FLAVOR-SENTINEL');
		expect(blob).not.toContain('的標題');
		expect(blob).not.toContain('portrait.png');
	});

	it('但仍然給得出「還有東西可以拿」與「在哪裡拿」', () => {
		const e = entries[0];
		expect(e.owned).toBe(false);
		if (!e.owned) {
			expect(e.siteName).toBe('艋舺龍山寺');
			expect(e.kind).toBe('encounter');
			expect(e.frame).toBe('/art/frames/encounter.png');
		}
	});
});

describe('順序與站名', () => {
	it('★ 順序就是 cards.yaml 的順序，不重新排', () => {
		const { entries } = buildCollection(CARDS, new Map(), nameOf);
		expect(entries.map((e) => e.id)).toEqual([
			'encounter-longshan',
			'task-longshan',
			'story-bopiliao'
		]);
	});

	it('站名查不到時退回 siteId，不會變成空字串', () => {
		const { entries } = buildCollection(CARDS, new Map(), () => null);
		expect(entries[0].siteName).toBe('longshan-temple');
	});
});

describe('孤兒卡', () => {
	// 「內容層刪了一張卡，但玩家早就拿到了」。圖鑑畫不出它，但不能安靜地當作沒發生。
	it('持有一張已經不存在的卡 → 進 orphans，不進 entries', () => {
		const { entries, orphans } = buildCollection(
			CARDS,
			new Map([
				['task-longshan', EARNED],
				['card-that-no-longer-exists', EARNED]
			]),
			nameOf
		);
		expect(entries).toHaveLength(3);
		expect(orphans).toEqual(['card-that-no-longer-exists']);
	});
});

describe('collectionSummary', () => {
	it('數得出 1 / 3', () => {
		const { entries } = buildCollection(CARDS, new Map([['task-longshan', EARNED]]), nameOf);
		expect(collectionSummary(entries)).toEqual({ owned: 1, total: 3 });
	});
});
