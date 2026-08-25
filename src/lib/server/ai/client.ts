/**
 * AI 供應商抽象層 —— SDD §6.6。
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
	 * ⚠️ 2026-08-25 實測：**Zeabur AI Hub 不回報這個欄位**，因此此值恆為 0。
	 * 回傳的 usage 只有 `prompt_tokens_details.text_tokens`。
	 * 欄位保留是為了換供應商時不必改介面，但**不可拿它推算成本**——
	 * §10.1 的用量控制一律按無快取單價計算。詳見 SDD §6.3【已驗 V1】。
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
 * AIHUB_API_KEY 未設定時直接回傳固定字串，不呼叫真的 API。
 * 理由：開發期會反覆重整頁面，每次都真的呼叫 AI 是在燒點數換除錯。
 */
const MOCK_REPLY =
	'（AI mock）我在這裡看了很久了。你想聽哪一段？—— 這是本機開發的固定回應，AIHUB_API_KEY 未設定。';

let cached: OpenAI | null = null;

function getClient(): OpenAI {
	if (cached) return cached;
	cached = new OpenAI({
		apiKey: env.AIHUB_API_KEY,
		baseURL: env.AIHUB_BASE_URL,
		timeout: 8_000,
		// 重試由 speak() 控制，因為重試時要換模型（§6.5 第 2 階）
		maxRetries: 0
	});
	return cached;
}

export function isMockMode(): boolean {
	return !env.AIHUB_API_KEY;
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
			// OpenAI 相容欄位。AI Hub 實測不回報（2026-08-25），所以這裡恆為 0。
			// 不要把它當成本依據，理由見上面 TokenUsage 的註解與 SDD §6.3。
			cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0
		}
	};
}
