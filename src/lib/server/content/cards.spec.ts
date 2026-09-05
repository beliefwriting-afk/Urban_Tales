/**
 * 成就卡載入器的測試。
 *
 * ★ 這裡沒有「不可外洩」的問題——卡片整份都是要給玩家看的。
 *   要釘住的是另一件事：**發卡時的 id 是查出來的，不是拼出來的。**
 *   拼出來的 id 一旦與 cards.yaml 不一致，玩家的圖鑑會永遠缺一張，
 *   而資料表裡卻有一列，沒有任何錯誤訊息。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { getCard, getEncounterCard, listCards, toPublicCard } from './cards';
import type { Card } from '../../../../content/schema';

const CARD: Card = {
	id: 'encounter-test',
	kind: 'encounter',
	siteId: 'test-site',
	title: { zhHant: '第一次見面', en: null, ja: null },
	flavor: { zhHant: '它記得比你久', en: null, ja: null },
	art: { portrait: '/art/test/portrait.png', frame: '/art/frames/encounter.png' }
};

describe('toPublicCard', () => {
	it('多語言選好，其餘原樣帶出去', () => {
		expect(toPublicCard(CARD)).toEqual({
			id: 'encounter-test',
			kind: 'encounter',
			siteId: 'test-site',
			title: '第一次見面',
			flavor: '它記得比你久',
			art: { portrait: '/art/test/portrait.png', frame: '/art/frames/encounter.png' }
		});
	});
});

describe('真實內容', () => {
	it('cards.yaml 現在是空的（六站都還沒有卡，見 cards.yaml 的說明）', () => {
		// 這條之後會失敗——那正是它的用處：第一張卡定義出來時，
		// 有人得回來確認 content:check #7b 有沒有跟著開始擋。
		expect(listCards()).toEqual([]);
	});

	it('★ 六站現在都查不到相遇卡 —— 所以它們也發不出卡', () => {
		// 這解釋了為什麼切片 4 的成功路徑現在端到端測不到，
		// 而不是「測了但沒發現壞掉」。
		//
		// ⚠️ 第一站轉 playable 的那一刻，content:check #7b 就會要求
		//    cards.yaml 有那一站的相遇卡（恰好一張）。撞到的會是 #7b，不是 #7。
		for (const id of [
			'bopiliao',
			'longshan-temple',
			'moca-taipei',
			'new-culture-movement',
			'xiahai-temple',
			'ximen-red-house'
		]) {
			expect(getEncounterCard(id)).toBeNull();
		}
	});

	it('查不到的 id 回 null，不丟例外', () => {
		expect(getCard('沒有這張卡')).toBeNull();
		expect(getEncounterCard('沒有這一站')).toBeNull();
	});
});
