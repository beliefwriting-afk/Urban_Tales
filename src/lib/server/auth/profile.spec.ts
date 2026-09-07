/**
 * 玩家稱呼的測試。
 *
 * ★ 這是玩家會看到、而且會記住的字串（設定頁上那一行）。
 *   格式改了他會覺得自己「換了編號」，所以釘住。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { guestLabel } from './profile';

describe('guestLabel', () => {
	it('取 uuid 前四個十六進位字元，大寫', () => {
		expect(guestLabel('c44042c4-6d86-4c60-8e27-46d147264812')).toBe('旅人 #C440');
		expect(guestLabel('8f2c1234-0000-4000-8000-000000000000')).toBe('旅人 #8F2C');
	});

	it('同一個玩家永遠是同一個稱呼', () => {
		const id = 'de8d91e6-0b4e-431e-b6a1-e258a146b9ea';
		expect(guestLabel(id)).toBe(guestLabel(id));
	});

	// ★ 只露出 16 bits。這支端點只回給本人，但即使被看到也推不回 uuid。
	it('★ 只用到前四個字元，其餘一個字都不露', () => {
		const label = guestLabel('c44042c4-6d86-4c60-8e27-46d147264812');
		expect(label).not.toContain('6d86');
		expect(label).not.toContain('46d147264812');
		// ★ 驗格式而不是驗長度：長度只證明「沒有變長」，格式連
		//   「改成小寫」「換了前綴」「多了一碼」都抓得到。
		expect(label).toMatch(/^旅人 #[0-9A-F]{4}$/);
	});
});
