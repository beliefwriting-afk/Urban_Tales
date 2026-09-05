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

export type FallbackReason =
	| 'ai_error'
	| 'quota'
	| 'rate_limit'
	| 'global_cap'
	| 'input_too_long'
	| 'blocked_topic'
	| 'output_rejected';

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
 * ★ 這個函式永遠不 throw、永遠回傳合法的 SpeakResult。
 *   （⚠️ 目前是 stub，**會 throw**；切片 5 實作之後這條保證才成立。）
 *   企劃書 §8.7：AI 失效一律回退預寫台詞，且視為正常回應，不呈現為錯誤。
 *   呼叫端的 HTTP 狀態一律 200 —— 前端不存在「對話錯誤」這個 UI 狀態。
 *
 * 降級階梯見 SDD §6.5。
 */
export async function speak(ctx: SpeakContext): Promise<SpeakResult> {
	// TODO(P1) 依 SDD §6.1 的九個步驟實作，順序不可調換：
	//
	//  1. 輸入長度檢查        ★ 在扣除額度之前（企劃書 §8.6）
	//                            → 超過 MAX_INPUT_CHARS：fallback 'input_too_long'
	//  2. 速率限制（token bucket，rate_buckets 表）
	//                            → fallback 'rate_limit'
	//  3. 每玩家每日額度（usage_player_daily）
	//                            → fallback 'quota' → fallbacks.quotaReached
	//  4. 全域每日額度（usage_global_daily）
	//                            → fallback 'global_cap'
	//                            ★ 對玩家的表現必須與 SDD §6.5 的**第 3 階（AI 失效）**
	//                              完全相同——注意那是 §6.5 的「階」，不是這裡的「步」
	//                              走 fallbacks.aiUnavailable，不是 quotaReached
	//  5. 輸入端主題檢查（明確禁忌關鍵詞）
	//                            → fallback 'blocked_topic' → fallbacks.refusal
	//                            ★ 在這裡擋掉是為了不燒 token
	//  6. 組裝 prompt            ★ 護欄最後注入（§6.2），順序：
	//                              [1] 人格卡 [2] 素材庫 [3] 格式要求 [4] 全域護欄
	//  7. 呼叫 AI                逾時 8s → 重試 1 次並換模型（primary → fallback）
	//                            → 仍失敗：fallback 'ai_error'
	//  8. 輸出端檢查             → 不合格：fallback 'output_rejected'
	//  9. 記錄用量與對話         chat_turns（含 is_fallback）、usage_* 兩張表
	//
	// 實作時 AI 呼叫只能透過：
	//   import { complete } from '$lib/server/ai/client';
	// 這個 import 在其他任何檔案都會被 ESLint 擋下來。

	void ctx;
	throw new Error('speak() 尚未實作 —— 見 SDD §6.1');
}
