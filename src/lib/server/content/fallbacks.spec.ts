/**
 * 保底台詞載入器的測試 —— SDD §6.5。
 *
 * ★ 這一支不是在測 YAML 讀不讀得到（那是 content:check 的事），
 *   是在測**內容層與降級邏輯之間的那條縫**：六組台詞齊不齊、
 *   以及那個會造成死迴圈的重複。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { getFallbacks, fallbackSiteIds } from './fallbacks';
import { FALLBACK_KEY } from '$lib/server/soul/fallback';

function linesOf(siteId: string) {
	const f = getFallbacks(siteId);
	if (!f) throw new Error(`${siteId} 沒有 fallbacks.yaml`);
	return f.lines;
}

describe('六站的保底台詞都載得到', () => {
	it('六站都有，siteId 與目錄一致', () => {
		expect(fallbackSiteIds()).toHaveLength(6);
		for (const id of fallbackSiteIds()) {
			expect(getFallbacks(id)?.siteId).toBe(id);
		}
	});

	it('沒寫過的站回 null，不 throw', () => {
		expect(getFallbacks('not-a-site')).toBeNull();
	});

	// 對應表裡出現的每一組都必須真的有句子，否則 speak() 會回空字串給玩家
	it('★ 對應表用到的六組台詞，每一站都齊全', () => {
		const needed = [...new Set(Object.values(FALLBACK_KEY))];
		for (const id of fallbackSiteIds()) {
			const lines = linesOf(id);
			for (const key of needed) {
				expect(lines[key].length, `${id} 的 ${key} 是空的`).toBeGreaterThan(0);
			}
		}
	});
});

describe('★ slowDown 不能跟 aiUnavailable 撞句子', () => {
	// 撞句子等於把死迴圈換個地方復活：玩家輸入太長 → 收到「再說一次」→ 原樣再送一次。
	// slowDown 存在的唯一理由就是「每一句都給得出可執行的下一步」。
	it('六站的 slowDown 與 aiUnavailable 沒有任何一句相同', () => {
		for (const id of fallbackSiteIds()) {
			const lines = linesOf(id);
			const ai = new Set(lines.aiUnavailable.map((x) => x.zhHant));
			for (const s of lines.slowDown) {
				expect(ai.has(s.zhHant), `${id} 的「${s.zhHant}」同時出現在兩組`).toBe(false);
			}
		}
	});

	it('每站至少 2 句 slowDown', () => {
		for (const id of fallbackSiteIds()) {
			expect(linesOf(id).slowDown.length, id).toBeGreaterThanOrEqual(2);
		}
	});
});
