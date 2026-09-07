/**
 * 用量控制的判準 —— SDD §10.1 的四層防線。
 *
 * ★★★ 這個檔案是純函式：不碰資料庫、不讀時鐘、不讀環境變數。★★★
 *   同 `site/enter.ts` 的理由——會拒絕玩家的判斷都要測得到。
 *   讀環境變數與寫資料庫在隔壁的 `consume.ts`。
 *
 * 四層防線（L0 在場憑證不在這裡，它在 presence.ts）：
 *
 *   L1 輸入長度   200 字      ★ 在扣額度之前檢查（企劃書 §8.6）
 *   L2 每玩家速率 10 則／分，burst 15
 *   L3 每玩家每日 field 120 則／demo 40 則
 *   L4 全域每日   US$2.00     ★ 唯一的帳單防線（Gemini 超額不會自己停）
 *
 * 給 Python 背景的對照：`Math.max/min` ≈ `max()/min()`；
 * 這裡沒有 class，一組函式加一組型別就是全部。
 */
import type { PresenceMode } from '$lib/server/auth/presence';

export type LimitDecision =
	{ ok: true } | { ok: false; reason: 'input_too_long' | 'rate_limit' | 'quota' | 'global_cap' };

const PASS: LimitDecision = { ok: true };

// ─── L1：輸入長度 ────────────────────────────────────────────

/**
 * ★ 這一步必須在扣除任何額度之前（企劃書 §8.6）。
 *
 * 理由不只是省錢：先扣額度再擋，玩家會因為一段根本沒送出去的輸入而少一則額度，
 * 而他完全看不出來為什麼。
 *
 * ⚠️ 用 `[...text].length` 而不是 `text.length`——後者算的是 UTF-16 碼元，
 *   一個 emoji 會被算成 2。玩家看到的是「字」，判準也該按字。
 */
export function checkInputLength(text: string, maxChars: number): LimitDecision {
	return [...text].length > maxChars ? { ok: false, reason: 'input_too_long' } : PASS;
}

// ─── L2：每玩家速率（token bucket）───────────────────────────

export type BucketConfig = {
	/** 每分鐘補充幾則 */
	perMinute: number;
	/** 桶子的上限（可以攢多少則） */
	burst: number;
};

/**
 * 補充後的桶子存量。
 *
 * ★★★ ⚠️ 這個公式在系統裡存在**兩份**：這裡一份，`consume.ts` 的 SQL 一份。★★★
 *
 *   本專案的通則是「常數不要在兩個地方各寫一次，兩份會漂移」（HANDOFF §13.4）。
 *   這裡是**刻意的例外**，因為兩個要求互相衝突：
 *
 *     · 檢查與扣除必須是同一句原子 SQL（後端拍板第 3 條）——先查再寫的話，
 *       兩個併發請求會同時查到還有額度然後雙雙通過。
 *     · 時間一律走資料庫的時鐘（HANDOFF §13.4 ①）——所以「距離上次補充過了多久」
 *       只能在 SQL 裡算。
 *
 *   兩件事合起來，補充的算式就非在 SQL 裡不可。而它又是**唯一會算錯的地方**，
 *   所以這裡留一份可測的版本把數學釘住。
 *
 * ⚠️ 這代表：**改動任何一邊都要同時改另一邊**，而且單元測試抓不到不同步——
 *   它只證明「這個公式是對的」，不證明「SQL 寫的是這個公式」。
 *   後者要靠 `smoke:api`（第四批補），以及兩邊互相指路的註解。
 */
export function bucketAfterRefill(
	tokens: number,
	elapsedSeconds: number,
	cfg: BucketConfig
): number {
	const refilled = tokens + (elapsedSeconds * cfg.perMinute) / 60;
	// 上限是 burst：離開很久再回來，也只攢到滿桶，不會無限累積。
	return Math.min(cfg.burst, refilled);
}

/** 桶子裡至少要有一整則的量才放行 */
export function decideRate(tokensAfterRefill: number): LimitDecision {
	return tokensAfterRefill >= 1 ? PASS : { ok: false, reason: 'rate_limit' };
}

// ─── L3：每玩家每日 ──────────────────────────────────────────

export type DailyLimits = {
	field: number;
	demo: number;
};

/**
 * ★【暫定 T10】展示模式的額度較嚴。
 *
 * 密語若外流，展示模式是**唯一不需要到現場就能燒錢的路徑**（L0 在場憑證是
 * 成本與真實到訪掛鉤的那一層，展示模式正是繞過它的合法出口），所以額度必須更緊。
 */
export function dailyLimitFor(mode: PresenceMode, limits: DailyLimits): number {
	return mode === 'demo' ? limits.demo : limits.field;
}

/** `used` 是**今天已經用掉的則數**（還沒算這一則） */
export function decideDailyQuota(used: number, limit: number): LimitDecision {
	return used < limit ? PASS : { ok: false, reason: 'quota' };
}

// ─── L4：全域每日成本上限 ────────────────────────────────────

/**
 * ★★★ 這是唯一的帳單防線。★★★
 *
 * AI Hub 時代靠預付點數當天花板，搬到 Gemini 之後那道保險沒有了——
 * 免費層超額會計費，不會自己停（SDD §10.2）。
 *
 * ⚠️ **事前檢查、事後累加**（SDD §10.1），所以會有小幅超支：
 *   並發時最多超出「並發數 × 單次成本」，大約幾美分。
 *   用悲觀鎖換這幾美分不划算。
 *
 * ★ 觸頂後對玩家的表現與 AI 失效**完全相同**（§6.5 第 5 階＝第 3 階），
 *   不顯示任何營運訊息——全域沒錢是我們的問題，不是玩家做錯事。
 */
export function decideGlobalCap(spentUsd: number, budgetUsd: number): LimitDecision {
	return spentUsd < budgetUsd ? PASS : { ok: false, reason: 'global_cap' };
}

// ─── 成本估算 ────────────────────────────────────────────────

export type Prices = {
	/** 輸入每百萬 token 的美元價 */
	inputPerMillionUsd: number;
	/** 輸出每百萬 token 的美元價 */
	outputPerMillionUsd: number;
};

/**
 * 一次呼叫的成本。
 *
 * ★★★ 一律按「無快取」算。★★★
 *   `TokenUsage.cachedTokens` 存在，但**不可拿它折價**（SDD §6.3）：
 *   AI Hub 實測不回報這個欄位，換 Gemini 之後也還沒重測。
 *   「有快取」是一個會讓成本估算變樂觀的假設，而 L4 是唯一的帳單防線——
 *   它底下的數字不能建立在樂觀假設上。
 *
 * ⚠️ 所以這個函式的參數裡沒有 cachedTokens，**連傳都傳不進來**。
 *   這跟 `getGuardrails()` 沒有 siteId 參數是同一個手法：讓介面本身擋住那件事。
 */
export function estimateCostUsd(
	usage: { inputTokens: number; outputTokens: number },
	prices: Prices
): number {
	const input = (usage.inputTokens / 1_000_000) * prices.inputPerMillionUsd;
	const output = (usage.outputTokens / 1_000_000) * prices.outputPerMillionUsd;
	return input + output;
}
