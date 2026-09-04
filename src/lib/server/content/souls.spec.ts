/**
 * 靈魂載入器的測試 —— 重點只有一個：**persona 不可以外洩**。
 *
 * ★ 跟 sites.spec.ts 的 radiusM 同一類錯：多回一個欄位，前端不會壞、
 *   UI 不會變、沒有人會發現——但對方拿到的是 system prompt 的原料，
 *   越獄從「試探」變成「照著繞」。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { toPublicSoul, getSoul, soulSiteIds, type PublicSoul } from './souls';
import type { Soul } from '../../../../content/schema';

/** 一份完整的內部資料，含整段不該外流的 persona */
const FULL: Soul = {
	siteId: 'test-site',
	name: { zhHant: '測試靈魂', en: null, ja: null },
	persona: {
		identity: { zhHant: '我是這棟樓的記憶', en: null, ja: null },
		voice: { zhHant: '慢慢說，句尾常帶問句', en: null, ja: null },
		knows: { zhHant: '我看得到街上發生的事', en: null, ja: null },
		isNot: [{ zhHant: '不是導遊', en: null, ja: null }],
		taboos: [{ zhHant: '不談某件事', en: null, ja: null }]
	},
	art: {
		portrait: '/art/test/portrait.png',
		renderer: { kind: 'layered-png', layersDir: '/art/test/layers' }
	}
};

describe('toPublicSoul —— 白名單', () => {
	it('★ 欄位清單完全等於預期', () => {
		// 這條會在有人往 PublicSoul 加欄位時失敗。
		// 那個失敗不是要擋你，是要你在那一刻回答：
		// 「這個值被知道之後，有人能拿它做什麼？」
		const expected: (keyof PublicSoul)[] = ['siteId', 'name', 'art'];
		expect(Object.keys(toPublicSoul(FULL)).sort()).toEqual([...expected].sort());
	});

	it('★★ persona 的任何一段都不會出現在序列化結果裡', () => {
		// 上一條看的是頂層 key。這一條擋「被藏在巢狀物件裡」的情況，
		// 而且是逐字比對內容，不只是比對欄位名。
		const blob = JSON.stringify(toPublicSoul(FULL));
		expect(blob).not.toContain('persona');
		expect(blob).not.toContain('我是這棟樓的記憶');
		expect(blob).not.toContain('慢慢說');
		expect(blob).not.toContain('不是導遊');
		expect(blob).not.toContain('不談某件事');
	});

	it('立繪與渲染方式要留著，前端要用它畫角色', () => {
		const p = toPublicSoul(FULL);
		expect(p.art?.portrait).toBe('/art/test/portrait.png');
		expect(p.art?.renderer.kind).toBe('layered-png');
	});

	it('沒有立繪的站回 null，不丟例外', () => {
		// 草稿站的立繪要等 P0-1。文字與圖是兩條可以平行的軌道，不該互相擋路。
		expect(toPublicSoul({ ...FULL, art: null }).art).toBeNull();
	});

	it('多語言在伺服器端就選好，前端拿到的是字串', () => {
		expect(toPublicSoul(FULL).name).toBe('測試靈魂');
	});
});

describe('真實內容', () => {
	it('三站的人格卡都載入得到', () => {
		expect(soulSiteIds()).toEqual(['bopiliao', 'longshan-temple', 'ximen-red-house']);
	});

	it('★ 真實資料削過之後也不含 persona', () => {
		// 上面的白名單測試用的是假資料，這一條確認實際會送出去的那份也乾淨。
		for (const id of soulSiteIds()) {
			const soul = getSoul(id);
			expect(soul).not.toBeNull();
			expect(JSON.stringify(toPublicSoul(soul!))).not.toContain('persona');
		}
	});

	it('三站現在都還沒有立繪（P0-1 未完成）', () => {
		// 這條之後會失敗——那正是它的用處：立繪做好的那一刻，
		// 有人得回來把「playable 的站 art 不得為 null」這件事想一遍。
		for (const id of soulSiteIds()) {
			expect(getSoul(id)!.art).toBeNull();
		}
	});

	it('查不到的 id 回 null，不丟例外', () => {
		expect(getSoul('沒有這一站')).toBeNull();
	});
});
