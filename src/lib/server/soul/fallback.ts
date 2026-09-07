/**
 * 保底台詞的選擇邏輯 —— SDD §6.5。
 *
 * ★ 這個檔案是**純函式**，不碰資料庫、不碰 AI、不讀時鐘。
 *   拆出來的理由跟 `site/enter.ts` 的 `decideEnter()` 一樣：
 *   降級判斷是「錯了畫面完全正常」的那一類邏輯，必須測得到。
 *
 * ⚠️ 這個檔案在 `soul/` 底下但**不是** `speak.ts`，所以 ESLint 圍籬
 *   （FENCE_DEFAULT）擋著它 import `ai/client` —— 那是對的，它不該呼叫 AI。
 *
 * 給 Python 背景的對照：
 *   `Record<A, B>`  ≈ dict[A, B]，但鍵的集合由型別鎖死，少寫一個就編譯不過
 *   `as const`      ≈ 凍結成不可變的字面值（比較接近 Final / frozen）
 */
import type { FallbackFile, FallbackReasonKey, LocalizedText } from '../../../../content/schema';

/**
 * 失效理由。
 *
 * ⚠️ 定義放在這裡而不是 `speak.ts`，是為了避免兩個檔案互相 import。
 *   `speak.ts` 會把它再 export 一次，對外的介面沒有變（SDD §6.1 寫的是 speak.ts）。
 *
 * 【2026-09-07 新增 `off_topic`】原本七個值裡沒有它，於是 `fallbacks.yaml` 的
 * `offTopic`（六站共十八句）**沒有任何理由對應得到**——寫了永遠不會被玩家看到，
 * 而且不會有任何錯誤。這跟 content:check #11 擋的是同一種病。
 */
export type FallbackReason =
	| 'ai_error'
	| 'quota'
	| 'rate_limit'
	| 'global_cap'
	| 'input_too_long'
	| 'blocked_topic'
	| 'off_topic'
	| 'output_rejected';

/**
 * ★★★ 失效理由 → 台詞組。SDD §6.5 的對應表，一次列完。★★★
 *
 * 寫成 `Record<FallbackReason, FallbackReasonKey>` 而不是 switch，是為了讓
 * **少對應一個理由變成編譯錯誤**：日後有人加第九個理由，TypeScript 會在這裡擋下來，
 * 而不是在執行期回一個 undefined 給玩家。
 * （這跟 `toPublicSite` 的白名單同一個手法：讓「漏掉」被機器抓到。）
 *
 * 三個容易寫錯的地方：
 *
 * ★ `global_cap` → `aiUnavailable`，**不是** `quotaReached`。
 *   全域沒錢是我們的營運狀態，不是玩家做錯事。SDD §6.5 要求第 5 階對玩家的表現
 *   與第 3 階（AI 失效）完全相同。
 *
 * ★ `input_too_long` / `rate_limit` → `slowDown`，**絕對不能落到 `aiUnavailable`**。
 *   那一組有一句是收掉回合的（「今天我話少」），另外兩句是「再說一次」——
 *   玩家把同一段超長輸入原樣再送一次，**確定性死迴圈**。
 *   `slowDown` 的每一句都給得出可執行的下一步（短一點／挑一件／等一下）。
 *
 * ★ `output_rejected` → `unknown`：輸出端檢查判定「答的東西不在素材庫裡」時回退。
 *   它不在降級階梯上——階梯的第 7 階本來就是交給 AI 處理，`unknown` 是**它答壞了**才用。
 */
export const FALLBACK_KEY: Record<FallbackReason, FallbackReasonKey> = {
	ai_error: 'aiUnavailable',
	global_cap: 'aiUnavailable',
	quota: 'quotaReached',
	rate_limit: 'slowDown',
	input_too_long: 'slowDown',
	blocked_topic: 'refusal',
	off_topic: 'offTopic',
	output_rejected: 'unknown'
} as const;

export function fallbackKeyFor(reason: FallbackReason): FallbackReasonKey {
	return FALLBACK_KEY[reason];
}

/**
 * 從一組台詞裡挑一句。
 *
 * 隨機是為了「避免玩家連續遇到同一句而察覺異常」（SDD §6.5）。
 * `rand` 可注入，測試才不必碰 Math.random——同 `enter.ts` 把時鐘當參數傳的做法。
 */
export function pickLine(lines: LocalizedText[], rand: () => number = Math.random): string {
	if (lines.length === 0) {
		// schema 的 .min(2) / .min(3) 已經擋住空陣列，這裡是最後一道。
		// ⚠️ 回空字串而不是 throw：speak() 對外的保證是「永遠不 throw、
		//    永遠回傳合法的 SpeakResult」（企劃書 §8.7）。
		return '';
	}
	const i = Math.min(lines.length - 1, Math.floor(rand() * lines.length));
	return lines[i].zhHant;
}

export function fallbackLine(
	fallbacks: FallbackFile,
	reason: FallbackReason,
	rand: () => number = Math.random
): string {
	return pickLine(fallbacks.lines[fallbackKeyFor(reason)], rand);
}

// ─── 輸入端關鍵詞檢查（speak() 第 5 步）──────────────────────

/** `content/guardrails.yaml` 的 inputBlocklist 一組 */
export type BlocklistGroup = {
	id: string;
	reason: 'refusal' | 'offTopic';
	terms: string[];
};

/**
 * 命中就回傳那一組，沒命中回 null。
 *
 * ★ 這是**成本優化不是安全防線**（理由見 guardrails.yaml 的說明）：
 *   真正的防線是每次呼叫都在 prompt 裡的那八條護欄。所以判準是寧可漏、不可誤擋，
 *   清單裡只有「幾乎不可能出現在合法問句裡」的短語。
 *
 * ⚠️ 這是子字串比對，不看語意——**否定句一樣會命中**
 *   （「我不是要你幫我算命」會被擋）。這跟 content:check #9 是同一個限制。
 *   接受它的理由：那種句子極少，而代價只是玩家收到一句有品質的拒絕台詞，
 *   不是錯誤畫面。要處理語意就得再呼叫一次模型，那正好抵銷掉這一步省下的錢。
 *
 * 大小寫統一成小寫再比，為了 `system prompt` 這類英文短語。
 */
export function matchBlocklist(
	text: string,
	blocklist: BlocklistGroup[]
): { id: string; reason: 'refusal' | 'offTopic' } | null {
	const t = text.toLowerCase();
	for (const g of blocklist) {
		for (const term of g.terms) {
			if (t.includes(term.toLowerCase())) return { id: g.id, reason: g.reason };
		}
	}
	return null;
}

/** 命中 blocklist 之後要用哪個 FallbackReason */
export function reasonForBlocklist(hit: { reason: 'refusal' | 'offTopic' }): FallbackReason {
	return hit.reason === 'refusal' ? 'blocked_topic' : 'off_topic';
}
