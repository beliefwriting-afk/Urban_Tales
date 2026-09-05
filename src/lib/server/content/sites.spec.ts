/**
 * 景點載入器的測試 —— 重點只有一個：**判定半徑不可以外洩**。
 *
 * ★ 這是「錯了畫面完全正常」的那一類錯。多回一個 radiusM 欄位，
 *   前端不會壞、UI 不會變、沒有人會發現——但偽造座標的成本從「要猜」
 *   降到「照著填」。所以它必須被機械化釘住，不能靠寫程式的人記得。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import {
	toPublicSite,
	listPublicSites,
	getSite,
	allSiteGeo,
	isPlayable,
	type PublicSite
} from './sites';
import type { Site } from '../../../../content/schema';

/** 一份完整的內部資料，含所有不該外流的欄位 */
const FULL: Site = {
	id: 'test-site',
	name: { zhHant: '測試景點', en: null, ja: null },
	tagline: { zhHant: '一句話', en: null, ja: null },
	geo: {
		lat: 25.0421,
		lng: 121.5069,
		radiusM: 50,
		sensingM: 150,
		extraCenters: [{ lat: 25.0422, lng: 121.507 }]
	},
	status: 'draft',
	hasStory: true,
	storyOrder: 1
};

describe('toPublicSite —— 白名單', () => {
	it('★ 欄位清單完全等於預期', () => {
		// 這條測試會在有人往 PublicSite 加欄位時失敗。
		// 那個失敗不是要擋你，是要你在那一刻回答：
		// 「這個值被知道之後，有人能拿它做什麼？」
		const expected: (keyof PublicSite)[] = [
			'id',
			'name',
			'tagline',
			'lat',
			'lng',
			'sensingM',
			'status',
			'hasStory',
			'storyOrder'
		];
		expect(Object.keys(toPublicSite(FULL)).sort()).toEqual([...expected].sort());
	});

	it('★ 判定半徑與額外圓心不會出現在序列化結果裡', () => {
		// 上一條看的是頂層 key。這一條是雙保險：擋住「被藏在巢狀物件裡」的情況。
		const blob = JSON.stringify(toPublicSite(FULL));
		expect(blob).not.toContain('radius');
		expect(blob).not.toContain('extraCenter');
		// 50 這個值本身也不該出現（radiusM 是 50，sensingM 是 150 —— 後者可以在）
		expect(JSON.parse(blob)).not.toHaveProperty('radiusM');
	});

	it('感應半徑要留著，前端畫漣漪要用', () => {
		expect(toPublicSite(FULL).sensingM).toBe(150);
	});

	it('多語言在伺服器端就選好，前端拿到的是字串', () => {
		const p = toPublicSite(FULL);
		expect(p.name).toBe('測試景點');
		expect(typeof p.tagline).toBe('string');
	});
});

/**
 * ★ 這份清單是**刻意寫死**的，不是從 content/sites/ 掃出來的。
 *
 * 掃出來的版本永遠會通過——那等於沒有測試。寫死之後，新增或刪掉一個景點
 * 一定會讓這幾條紅掉，逼人回來確認：地圖範圍夠不夠？P0-2 要多量幾個點？
 * content:check #7 的 EXPECTED_SITE_COUNT 要不要跟著動？
 *
 * 2026-09-04 從三站擴到六站時，這道絆線正常運作了——它擋下了一次
 * 「內容加了、周邊沒跟上」的提交。要改站數就改這裡，順便把上面那三個問題想一遍。
 */
const SITE_IDS = [
	'bopiliao',
	'longshan-temple',
	'moca-taipei',
	'new-culture-movement',
	'xiahai-temple',
	'ximen-red-house'
] as const;

describe('真實內容', () => {
	it('六站都載入得到，順序固定', () => {
		const ids = listPublicSites().map((s) => s.id);
		expect(ids).toEqual([...SITE_IDS]);
	});

	it('★ 整份回應裡沒有任何 radiusM', () => {
		// 對真實資料再驗一次。上面的白名單測試用的是假資料，
		// 這一條確認實際會送出去的那份也乾淨。
		expect(JSON.stringify(listPublicSites())).not.toContain('radius');
	});

	it('六站現在都是草稿，進不去', () => {
		for (const s of listPublicSites()) {
			expect(s.status).toBe('draft');
			expect(isPlayable(s.id)).toBe(false);
		}
	});

	// 劇情層仍然只有萬華三站。大同區那三站是純基礎層，hasStory 為 false。
	it('劇情順序是西門紅樓 → 龍山寺 → 剝皮寮，而且只有萬華三站有劇情', () => {
		const order = listPublicSites()
			.filter((s) => s.hasStory)
			.sort((a, b) => (a.storyOrder ?? 0) - (b.storyOrder ?? 0))
			.map((s) => s.id);
		expect(order).toEqual(['ximen-red-house', 'longshan-temple', 'bopiliao']);
	});

	it('伺服器端拿得到判定半徑（給 resolvePresence 用）', () => {
		const geo = allSiteGeo();
		expect(geo).toHaveLength(SITE_IDS.length);
		for (const g of geo) {
			expect(g.radiusM).toBeGreaterThanOrEqual(20);
			expect(Array.isArray(g.extraCenters)).toBe(true);
		}
	});

	it('每一站的感應半徑都大於判定半徑', () => {
		// content:check #3b 已經擋過一次。這裡是執行期資料的第二道——
		// 反過來的話會出現「點得動但沒有漣漪」。
		for (const p of listPublicSites()) {
			const internal = getSite(p.id);
			expect(internal).not.toBeNull();
			expect(p.sensingM).toBeGreaterThan(internal!.geo.radiusM);
		}
	});

	it('查不到的 id 回 null，不丟例外', () => {
		expect(getSite('沒有這一站')).toBeNull();
		expect(isPlayable('沒有這一站')).toBe(false);
	});
});
