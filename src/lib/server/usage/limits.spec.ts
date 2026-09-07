/**
 * 用量控制判準的測試 —— SDD §10.1。
 *
 * ★ 這一支測的是四層防線的**算式與邊界**。實際的扣除是原子 SQL，
 *   單元測試碰不到（沒有測試資料庫）——那一半靠 `smoke:api` 與 code review。
 *   ⚠️ 所以這裡通過**不代表** consume.ts 的 SQL 寫對了，只代表公式是對的。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import {
	bucketAfterRefill,
	checkInputLength,
	dailyLimitFor,
	decideDailyQuota,
	decideGlobalCap,
	decideRate,
	estimateCostUsd,
	type BucketConfig
} from './limits';

const CFG: BucketConfig = { perMinute: 10, burst: 15 };

describe('L1 輸入長度', () => {
	it('剛好等於上限放行，多一個字擋下', () => {
		expect(checkInputLength('a'.repeat(200), 200).ok).toBe(true);
		expect(checkInputLength('a'.repeat(201), 200)).toEqual({
			ok: false,
			reason: 'input_too_long'
		});
	});

	// ⚠️ text.length 算的是 UTF-16 碼元，一個 emoji 會被算成 2。
	//    玩家看到的是「字」，判準也該按字。
	it('★ emoji 算一個字，不是兩個', () => {
		const text = '🏮'.repeat(100);
		expect(text.length).toBe(200); // UTF-16 碼元
		expect(checkInputLength(text, 100).ok).toBe(true); // 但只有 100 個字
	});

	it('中文按字算', () => {
		expect(checkInputLength('龍山寺'.repeat(50), 150).ok).toBe(true);
		expect(checkInputLength('龍山寺'.repeat(51), 150).ok).toBe(false);
	});
});

describe('L2 token bucket', () => {
	it('六秒補一則（每分鐘 10 則）', () => {
		expect(bucketAfterRefill(0, 6, CFG)).toBeCloseTo(1);
		expect(bucketAfterRefill(0, 60, CFG)).toBeCloseTo(10);
	});

	it('★ 補充有上限：離開很久也只攢到滿桶，不會無限累積', () => {
		expect(bucketAfterRefill(0, 3600, CFG)).toBe(15);
		expect(bucketAfterRefill(15, 3600, CFG)).toBe(15);
	});

	it('不足一則就擋下', () => {
		expect(decideRate(bucketAfterRefill(0, 5, CFG))).toEqual({ ok: false, reason: 'rate_limit' });
		expect(decideRate(bucketAfterRefill(0, 6, CFG)).ok).toBe(true);
	});

	it('剛好一則放行（邊界是 >= 1）', () => {
		expect(decideRate(1).ok).toBe(true);
		expect(decideRate(0.999).ok).toBe(false);
	});
});

describe('L3 每玩家每日', () => {
	const LIMITS = { field: 120, demo: 40 };

	// 【暫定 T10】密語外流的話，展示模式是唯一不用到現場就能燒錢的路徑。
	it('★ 展示模式的額度比實地嚴', () => {
		expect(dailyLimitFor('demo', LIMITS)).toBe(40);
		expect(dailyLimitFor('field', LIMITS)).toBe(120);
		expect(dailyLimitFor('demo', LIMITS)).toBeLessThan(dailyLimitFor('field', LIMITS));
	});

	it('用滿了才擋（used 是「還沒算這一則」）', () => {
		expect(decideDailyQuota(119, 120).ok).toBe(true);
		expect(decideDailyQuota(120, 120)).toEqual({ ok: false, reason: 'quota' });
	});
});

describe('L4 全域每日成本上限', () => {
	it('沒到預算放行，到了就擋', () => {
		expect(decideGlobalCap(1.99, 2).ok).toBe(true);
		expect(decideGlobalCap(2, 2)).toEqual({ ok: false, reason: 'global_cap' });
		expect(decideGlobalCap(2.01, 2).ok).toBe(false);
	});
});

describe('成本估算', () => {
	const PRICES = { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 };

	// SDD §10.2 的單輪估算：固定前綴 5,100 ＋ 變動 1,600 ＝ 6,700 輸入、250 輸出。
	it('對得上 SDD §10.2 的 $0.00077／輪', () => {
		const cost = estimateCostUsd({ inputTokens: 6700, outputTokens: 250 }, PRICES);
		expect(cost).toBeCloseTo(0.00077, 5);
	});

	it('全域上限 $2 對應約 2,600 則', () => {
		const perTurn = estimateCostUsd({ inputTokens: 6700, outputTokens: 250 }, PRICES);
		expect(Math.floor(2 / perTurn)).toBeGreaterThan(2500);
		expect(Math.floor(2 / perTurn)).toBeLessThan(2700);
	});

	// ★ cachedTokens 連傳都傳不進來——介面本身擋住「用快取折價」這件事。
	//   （AI Hub 實測不回報這個欄位，換 Gemini 後也還沒重測。SDD §6.3）
	it('★ 只吃 input／output 兩個數字', () => {
		expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0 }, PRICES)).toBe(0);
		expect(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0 }, PRICES)).toBeCloseTo(0.1);
		expect(estimateCostUsd({ inputTokens: 0, outputTokens: 1_000_000 }, PRICES)).toBeCloseTo(0.4);
	});
});
