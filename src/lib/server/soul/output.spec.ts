/**
 * 輸出端檢查的測試 —— speak() 第 8 步。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { checkOutput, OUTPUT_MAX_CHARS } from './output';
import { FORBIDDEN_PERSONA_PHRASES } from '../../../../content/schema';

describe('checkOutput', () => {
	it('正常回應會被 trim 之後放行', () => {
		expect(checkOutput('  我在這裡看了很久了。  ')).toEqual({
			ok: true,
			text: '我在這裡看了很久了。'
		});
	});

	// 回一句空白給玩家比回保底台詞糟得多——那是一個我們沒有設計過的畫面狀態。
	it('空的或只有空白 → empty', () => {
		expect(checkOutput('')).toEqual({ ok: false, why: 'empty' });
		expect(checkOutput('   \n  ')).toEqual({ ok: false, why: 'empty' });
	});

	// ★ 護欄第 2 條（企劃書 §4.2）的執行期攔截。清單與 content:check #9 共用。
	it('★ 十個禁語每一個都擋得下來', () => {
		for (const phrase of FORBIDDEN_PERSONA_PHRASES) {
			expect(checkOutput(`那時候${phrase}些什麼，我記不清了。`), phrase).toEqual({
				ok: false,
				why: 'forbidden_phrase'
			});
		}
	});

	it('沒有禁語的宗教相關回答照樣放行', () => {
		// 這一句在講廟裡的事但沒有替神明說話——它應該過。
		const ok = checkOutput('停香之後殿裡安靜了不少。少了煙，倒是看得清楚了些。');
		expect(ok.ok).toBe(true);
	});

	it('超過硬上限 → too_long，剛好在線上放行', () => {
		expect(checkOutput('字'.repeat(OUTPUT_MAX_CHARS)).ok).toBe(true);
		expect(checkOutput('字'.repeat(OUTPUT_MAX_CHARS + 1))).toEqual({
			ok: false,
			why: 'too_long'
		});
	});

	// 120 是給模型的期望值，300 是失控的界線——多寫兩句不該讓玩家收到保底台詞。
	it('★ 略超過格式要求的 120 字不會被擋', () => {
		expect(checkOutput('字'.repeat(150)).ok).toBe(true);
	});
});
