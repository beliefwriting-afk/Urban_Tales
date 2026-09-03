/**
 * AI 供應商抽象層 —— SDD §6.6。
 *
 * ★ 環境變數刻意叫 `AI_*` 而不是某家供應商的名字。
 *   第一版寫成 `AIHUB_*`（Zeabur AI Hub），2026-09-03 搬到 GCP 時就得改一輪——
 *   而程式邏輯一行都沒變，改的全是名字。**供應商名字不該進變數名。**
 *
 * ★★★ 這是全系統唯一可以 import 'openai' 的檔案。★★★
 * ★★★ 而這個檔案只能被 src/lib/server/soul/speak.ts 匯入。★★★
 *
 * 這兩條由 eslint.config.js 的 AI_SDK_FENCE / AI_CLIENT_FENCE 強制，
 * CI 跑 `eslint --max-warnings 0`，違反即建置失敗。改動前先讀 SDD §6.1。
 *
 * 模型與端點全部走環境變數，換模型不需要改程式碼、不需要重新建置。
 */
import OpenAI from 'openai';
import { env } from '$env/dynamic/private';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type TokenUsage = {
	inputTokens: number;
	outputTokens: number;
	/**
	 * 快取命中的 token 數。
	 *
	 * ⚠️ 2026-08-25 對 Zeabur AI Hub 實測：**不回報這個欄位**，此值恆為 0。
	 *
	 * 2026-09-03 搬到 Gemini 直連之後**這個結論要重測**（P0-5 重跑）。
	 * 在重測完成之前，§10.1 的用量控制一律按**無快取**單價計算——
	 * 那個成本模型不依賴任何樂觀假設，是它最重要的性質。
	 * 欄位保留是為了換供應商時不必改介面，但**不可拿它推算成本**。
	 */
	cachedTokens: number;
};

export type CompleteOptions = {
	model: string;
	system: string;
	messages: ChatMessage[];
	/** 【暫定 T6】第一版不做串流，介面先預留 */
	stream?: false;
};

export type CompleteResult = { text: string; usage: TokenUsage };

/**
 * 本機開發的 AI mock（SDD §13.2）。
 *
 * AI_API_KEY 未設定時直接回傳固定字串，不呼叫真的 API。
 * 理由：開發期會反覆重整頁面，每次都真的呼叫 AI 是在燒點數換除錯。
 */
const MOCK_REPLY =
	'（AI mock）我在這裡看了很久了。你想聽哪一段？—— 這是本機開發的固定回應，AI_API_KEY 未設定。';

let cached: OpenAI | null = null;

function getClient(): OpenAI {
	if (cached) return cached;
	cached = new OpenAI({
		apiKey: env.AI_API_KEY,
		baseURL: env.AI_BASE_URL,
		timeout: 8_000,
		// 重試由 speak() 控制，因為重試時要換模型（§6.5 第 2 階）
		maxRetries: 0
	});
	return cached;
}

export function isMockMode(): boolean {
	return !env.AI_API_KEY;
}

export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
	if (isMockMode()) {
		return {
			text: MOCK_REPLY,
			usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }
		};
	}

	const res = await getClient().chat.completions.create({
		model: opts.model,
		messages: [{ role: 'system', content: opts.system }, ...opts.messages],
		stream: false
	});

	const text = res.choices[0]?.message?.content ?? '';
	const u = res.usage;

	return {
		text,
		usage: {
			inputTokens: u?.prompt_tokens ?? 0,
			outputTokens: u?.completion_tokens ?? 0,
			// OpenAI 相容欄位。Zeabur AI Hub 實測不回報（2026-08-25）；換 Gemini 後未重測。
			// 不要把它當成本依據，理由見上面 TokenUsage 的註解與 SDD §6.3。
			cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0
		}
	};
}
