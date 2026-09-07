/**
 * ★★★ 全系統唯一可以呼叫 AI 的地方 ★★★
 *
 * SDD §6.1。企劃書 §4.2 記錄的失敗模式：
 *   「規則只掛在主要對話路徑上，其餘生成路徑繞過了它。」
 *
 * 所有會產出「靈魂說出口的文字」的路徑 —— 對話、引導提問、任務台詞、
 * 劇情、保底台詞 —— 都必須經過這一個函式。全景點適用，不分景點。
 *
 * 這條規則由 eslint.config.js 機械化強制，不靠記憶力。
 *
 * ⚠️ 這是本專案最重要的一個檔案。動它之前先讀 SDD §6.1–§6.6。
 */
import { env } from '$env/dynamic/private';

// ★★★ 這一行是全系統唯一合法的 AI client 匯入。★★★
//   eslint.config.js 的 FENCE_EXEMPT_SPEAK 只對這個檔案開這個洞，
//   而且仍然擋著直接 import 'openai'。見 SDD §6.1。
import { complete, type ChatMessage, type CompleteResult } from '$lib/server/ai/client';

import { recentTurns, saveTurn } from '$lib/server/chat/turns';
import { getFallbacks } from '$lib/server/content/fallbacks';
import { getGuardrails } from '$lib/server/content/guardrails';
import { getMaterials } from '$lib/server/content/materials';
import { getSoul } from '$lib/server/content/souls';
import {
	addUsage,
	globalSpentTodayUsd,
	takeDailyQuota,
	takeRateToken
} from '$lib/server/usage/consume';
import {
	checkInputLength,
	dailyLimitFor,
	decideGlobalCap,
	estimateCostUsd,
	type BucketConfig,
	type DailyLimits,
	type Prices
} from '$lib/server/usage/limits';

import { fallbackLine, matchBlocklist, reasonForBlocklist, type FallbackReason } from './fallback';
import { checkOutput } from './output';
import { buildSystemPrompt } from './prompt';

export type PresenceMode = 'field' | 'demo';

export type SpeakContext = {
	playerId: string;
	siteId: string;
	presenceMode: PresenceMode;
	/** 玩家輸入。引導提問點選也走這裡，內容即該提問的文字 */
	userText: string;
	/** 來源，僅供分析，不影響檢查 */
	origin: 'freetext' | 'guided-prompt' | 'story-node';
};

/**
 * 失效理由。
 *
 * ⚠️ 定義本體在 `./fallback.ts`（跟「哪個理由回哪一組台詞」放在一起，
 *   免得兩個檔案互相 import）。這裡 re-export 是為了讓對外的介面維持
 *   SDD §6.1 寫的形狀：呼叫端只需要認識 speak.ts。
 *
 * 【2026-09-07】從七個值變成八個，新增 `off_topic`——原本 `fallbacks.yaml`
 * 的 `offTopic`（六站十八句）沒有任何理由對應得到它。
 */
export type { FallbackReason } from './fallback';

export type SpeakResult = {
	text: string;
	isFallback: boolean;
	fallbackReason?: FallbackReason;

	// ⚠️ 【2026-09-04 移除】原本這裡有 `nextPrompts: GuidedPrompt[]`——「下一批引導提問」。
	//
	//   引導提問改成**每站恰好三題、寫死**之後，沒有「下一批」這回事：
	//   前端在 `/api/site/:id/enter` 就拿到那三題，之後每一輪都是同樣三題，
	//   伺服器不必再回一次。
	//
	//   少回一個欄位 ＝ 少一份會跟內容層漂移的東西。
	//   理由與連帶移除的機制見 SDD §6.4（T5）與 content/schema.ts 的
	//   GuidedPromptSchema 說明。
};

/**
 * 靈魂說話。
 *
 * ★★★ 這個函式永遠不 throw，永遠回傳合法的 SpeakResult。★★★
 *   企劃書 §8.7：AI 失效一律回退預寫台詞，且視為正常回應，不呈現為錯誤。
 *   呼叫端的 HTTP 狀態一律 200 —— 前端不存在「對話錯誤」這個 UI 狀態。
 *   所以整段包在 try/catch 裡，任何沒預期到的例外都收斂成 `ai_error`。
 *
 * ★ 九步的順序（SDD §6.1，⚠️ 第 3、4 步與文件原本的順序對調）：
 *
 *    1. 輸入長度        ★ 在扣除額度之前（企劃書 §8.6）
 *    2. 速率（token bucket）
 *    3. 全域每日上限    ← 唯讀檢查
 *    4. 每玩家每日額度  ← 這一步會扣除
 *    5. 輸入端關鍵詞
 *    6. 組 prompt（護欄最後注入）
 *    7. 呼叫 AI（逾時 8 秒，失敗重試一次並換模型）
 *    8. 輸出端檢查
 *    9. 記錄用量與對話
 *
 *   ⚠️⚠️ **為什麼 3 和 4 跟 SDD 原本寫的順序相反**（2026-09-07 拍板）：
 *   這兩步的性質不一樣——L4 是唯讀檢查，L3 會扣除。照原順序，全域上限觸頂時
 *   玩家的每日額度**已經被扣掉一則**，而他拿到的是保底台詞；更糟的是依 §6.5
 *   第 5 階的要求，畫面上看不出任何營運訊息，所以他永遠不會知道為什麼少了一則。
 *   全域沒錢是我們的營運狀態，不該讓玩家付代價。對調不增加任何成本——
 *   兩者本來都要查一次資料庫。
 *
 * ★ 額度一律扣、不退（2026-09-07 拍板）。AI 失敗或被關鍵詞擋下都算一則。
 *   L3 是「單人整日消耗」的總量控制，不完全等於成本；不扣的話，
 *   用禁忌關鍵詞發請求就變成一條沒有上限的路徑。
 */
export async function speak(ctx: SpeakContext): Promise<SpeakResult> {
	const cfg = readConfig();
	const fallbacks = getFallbacks(ctx.siteId);

	// 內容層缺這一站的保底台詞 —— 這是 content:check #2 本來就該擋下來的狀態。
	// 但即使發生了也不能 throw（那會讓玩家看到錯誤畫面），只能記一行 log。
	if (!fallbacks) {
		console.error(`[speak] ${ctx.siteId} 沒有 fallbacks.yaml —— content:check #2 應該擋下這件事`);
		return { text: '……', isFallback: true, fallbackReason: 'ai_error' };
	}

	/** 回一句保底台詞。`record` 決定這一輪要不要進對話歷史 */
	const bail = async (reason: FallbackReason, record: boolean): Promise<SpeakResult> => {
		const text = fallbackLine(fallbacks, reason);
		if (record) await safely(() => saveTurn(ctx.playerId, ctx.siteId, ctx.userText, text, true));
		return { text, isFallback: true, fallbackReason: reason };
	};

	try {
		// ── 1. 輸入長度 ────────────────────────────────────────
		// ★ 不記進對話歷史：那段輸入從來沒有被處理過，寫進去只會讓下一輪的
		//   上下文塞滿無用文字，而模型會以為自己上次漏答了。
		const len = checkInputLength(ctx.userText, cfg.maxInputChars);
		if (!len.ok) return await bail('input_too_long', false);

		// ── 2. 速率 ────────────────────────────────────────────
		// ★ 同樣不記：rate_limit 的典型來源是腳本連發，記下來等於讓它灌爆資料表。
		const gotToken = await takeRateToken(ctx.playerId, cfg.bucket);
		if (!gotToken) return await bail('rate_limit', false);

		// ── 3. 全域每日上限（唯讀）─────────────────────────────
		const spent = await globalSpentTodayUsd();
		const global = decideGlobalCap(spent, cfg.budgetUsd);
		// ★ 記進歷史：對玩家而言這與 AI 失效完全相同（§6.5 第 5 階＝第 3 階），
		//   所以上下文也該長得一樣。
		if (!global.ok) return await bail('global_cap', true);

		// ── 4. 每玩家每日額度（扣除）───────────────────────────
		const limit = dailyLimitFor(ctx.presenceMode, cfg.daily);
		const gotQuota = await takeDailyQuota(ctx.playerId, limit);
		if (!gotQuota) return await bail('quota', true);

		// ── 5. 輸入端關鍵詞 ────────────────────────────────────
		// ★ 成本優化不是安全防線（guardrails.yaml 的說明），所以只擋最明顯的。
		const hit = matchBlocklist(ctx.userText, getGuardrails().inputBlocklist);
		if (hit) return await bail(reasonForBlocklist(hit), true);

		// ── 6. 組 prompt ───────────────────────────────────────
		const soul = getSoul(ctx.siteId);
		const materials = getMaterials(ctx.siteId);
		if (!soul || !materials) {
			console.error(`[speak] ${ctx.siteId} 缺 soul.yaml 或 materials.yaml`);
			return await bail('ai_error', false);
		}

		const system = buildSystemPrompt({ soul, materials, guardrails: getGuardrails() });
		const history = await recentTurns(ctx.playerId, ctx.siteId, cfg.historyTurns);

		// ★ 這裡是全系統唯一把資料庫的 'soul' 翻成供應商的 'assistant' 的地方。
		const messages: ChatMessage[] = [
			...history.map((t) => ({
				role: t.role === 'soul' ? ('assistant' as const) : ('user' as const),
				content: t.content
			})),
			{ role: 'user' as const, content: ctx.userText }
		];

		// ── 7. 呼叫 AI ─────────────────────────────────────────
		const result = await callWithRetry(system, messages, cfg);
		if (!result) return await bail('ai_error', true);

		// ── 8. 輸出端檢查 ──────────────────────────────────────
		const checked = checkOutput(result.text);
		if (!checked.ok) {
			console.warn(`[speak] 輸出被擋下（${checked.why}）：${ctx.siteId}`);
			// ⚠️ 這一輪已經花了 token，所以用量照樣要記——被擋下的是內容，不是帳單。
			await safely(() =>
				addUsage(ctx.playerId, result.usage, estimateCostUsd(result.usage, cfg.prices))
			);
			return await bail('output_rejected', true);
		}

		// ── 9. 記錄用量與對話 ──────────────────────────────────
		// ★ 用 safely 包起來：記錄失敗不該讓玩家收不到已經生成好的回應。
		await safely(() =>
			addUsage(ctx.playerId, result.usage, estimateCostUsd(result.usage, cfg.prices))
		);
		await safely(() => saveTurn(ctx.playerId, ctx.siteId, ctx.userText, checked.text, false));

		return { text: checked.text, isFallback: false };
	} catch (e) {
		// ★ 這裡是「永遠不 throw」那句保證的實作。
		console.error('[speak] 未預期的例外：', e instanceof Error ? e.message : e);
		return await bail('ai_error', false);
	}
}

// ─── 內部 ────────────────────────────────────────────────────

/**
 * 呼叫 AI，失敗時**換模型**重試一次（SDD §6.5 第 2 階）。
 *
 * ★ 重試要換模型，不是重打同一個。逾時 8 秒的典型原因是那個模型當下太慢
 *   （§6.3：medium 思考的中位數就是 8 秒），重打同一個很可能再逾時一次，
 *   而玩家要多等 8 秒才拿到保底台詞。
 *
 * ⚠️ 逾時本身由 `ai/client.ts` 的 `timeout: 8_000` 控制，`maxRetries: 0`
 *   也在那裡——重試必須由這裡控制，因為只有這裡知道要換成哪個模型。
 *
 * 兩次都失敗回 null，呼叫端走 `ai_error`。
 */
async function callWithRetry(
	system: string,
	messages: ChatMessage[],
	cfg: SpeakConfig
): Promise<CompleteResult | null> {
	try {
		return await complete({ model: cfg.models.primary, system, messages });
	} catch (e) {
		console.warn(`[speak] 主要模型失敗（${cfg.models.primary}），換備用模型重試：`, describe(e));
	}

	try {
		return await complete({ model: cfg.models.fallback, system, messages });
	} catch (e) {
		console.error(`[speak] 備用模型也失敗（${cfg.models.fallback}）：`, describe(e));
		return null;
	}
}

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 跑一個會寫資料庫的動作，失敗只記 log。
 *
 * ★ 用在「記錄」這一類動作上：用量寫不進去是我們的問題，
 *   不該變成玩家收不到已經生成好的回應。
 * ⚠️ **不要**拿它包住扣額度那幾步——那些失敗了就必須擋下請求，
 *   吞掉例外等於把防線關掉。
 */
async function safely(fn: () => Promise<unknown>): Promise<void> {
	try {
		await fn();
	} catch (e) {
		console.error('[speak] 記錄失敗（不影響玩家收到的回應）：', describe(e));
	}
}

type SpeakConfig = {
	maxInputChars: number;
	bucket: BucketConfig;
	daily: DailyLimits;
	budgetUsd: number;
	prices: Prices;
	models: { primary: string; fallback: string };
	historyTurns: number;
};

/** 環境變數壞掉或沒設時退回預設值——一個打錯的數字不該讓整個對話系統掛掉 */
function num(key: string, fallback: number): number {
	const v = Number(env[key]);
	return Number.isFinite(v) && v > 0 ? v : fallback;
}

function readConfig(): SpeakConfig {
	return {
		maxInputChars: num('MAX_INPUT_CHARS', 200),
		bucket: { perMinute: num('RATE_PER_MINUTE', 10), burst: num('RATE_BURST', 15) },
		daily: { field: num('PLAYER_DAILY_MESSAGES', 120), demo: num('DEMO_DAILY_MESSAGES', 40) },
		budgetUsd: num('GLOBAL_DAILY_BUDGET_USD', 2),
		prices: {
			inputPerMillionUsd: num('AI_PRICE_INPUT_PER_M', 0.1),
			outputPerMillionUsd: num('AI_PRICE_OUTPUT_PER_M', 0.4)
		},
		models: {
			primary: env.AI_MODEL_PRIMARY ?? 'gemini-3.5-flash-lite',
			fallback: env.AI_MODEL_FALLBACK ?? 'gemini-3.7-flash'
		},
		// SDD §6.3：最近 10 輪，超出丟棄最舊的。不做摘要、不做壓縮。
		historyTurns: 10
	};
}

// ⚠️⚠️ TODO(P3) 劇情層的 `afterStory` 還沒接。
//
//   `origin: 'story-node'` 目前只是一個標記，不影響任何行為。
//   要接的是：查 `player_site_state.story_stage`，該站 === 'done' 時，
//   把 `story.yaml` 的 `afterStory` 追加到人格段後面（HANDOFF §17.4 第 3 項）。
//
//   ★ 這一輪刻意不做：劇情層的介面（任務視窗、閱讀器）都還沒有，玩家走不到 done，
//     所以現在寫了也驗證不了。這跟切片 4 拍板 7「enter 不回開場白」是同一個判斷——
//     **驗證不了的東西先不寫，但要留下明確的落點。**
