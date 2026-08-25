import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

// ─────────────────────────────────────────────────────────────
// ★★★ SDD §6.1 唯一出口 speak() 的機械化落實 ★★★
//
// 企劃書 §4.2 記錄的前身專案失敗原因：
//   「規則只掛在主要對話路徑上，其餘生成路徑繞過了它。」
//
// 對策是兩道圍籬，各自只開一個洞：
//   ① 只有 ai/client.ts 可以 import 'openai'
//   ② 只有 soul/speak.ts 可以 import ai/client
//
// 於是所有會產出「靈魂說出口的文字」的路徑，
// 在型別與模組層級上都被迫收斂到 speak() 這一個函式。
// CI 跑 `eslint --max-warnings 0`，違反即建置失敗。
//
// ⚠️ 改動下面兩個區塊之前，先讀 SDD §6.1 與企劃書 §4.2。
//    這不是風格設定，是安全界線。
// ─────────────────────────────────────────────────────────────

// ⚠️ 為什麼下面要這樣寫（踩過的坑，別重構回去）：
//
// ESLint flat config 裡，後面的設定物件若指定了同一條規則，
// 會【整個覆蓋】前面的選項，不是合併。
// 所以「一個區塊擋 openai、另一個區塊擋 ai/client」的直覺寫法會失效——
// 後者把前者整個蓋掉，openai 就這樣被放行了。
//
// 正確做法是：一條規則、一次列完所有限制，
// 再用「豁免區塊」對特定檔案重新宣告【剩下的】限制。
//
// npm run test:guard 就是在防這種安靜失效。

const BLOCK_AI_SDK = {
	name: 'openai',
	message:
		'❌ 只有 src/lib/server/ai/client.ts 可以匯入 openai。所有 AI 呼叫必須經過 speak()。見 SDD §6.1。'
};

const BLOCK_AI_CLIENT_PATH = {
	name: '$lib/server/ai/client',
	message:
		'❌ 只有 src/lib/server/soul/speak.ts 可以匯入 AI client。任何繞過 speak() 的生成路徑都會繞過安全界線。見 SDD §6.1。'
};

const BLOCK_AI_SDK_PATTERN = {
	group: ['openai/*'],
	message: '❌ 只有 src/lib/server/ai/client.ts 可以匯入 openai。見 SDD §6.1。'
};

const BLOCK_AI_CLIENT_PATTERN = {
	group: ['**/server/ai/client', '**/server/ai/client.*', '**/ai/client'],
	message: '❌ 只有 src/lib/server/soul/speak.ts 可以匯入 AI client。見 SDD §6.1。'
};

const FENCED_FILES = ['src/**/*.{ts,js,svelte}', 'scripts/**/*.{ts,js}', 'content/**/*.ts'];

/** 預設：兩道圍籬都套用 */
const FENCE_DEFAULT = {
	name: 'urban-tales/ai-fence',
	files: FENCED_FILES,
	rules: {
		'no-restricted-imports': [
			'error',
			{
				paths: [BLOCK_AI_SDK, BLOCK_AI_CLIENT_PATH],
				patterns: [BLOCK_AI_SDK_PATTERN, BLOCK_AI_CLIENT_PATTERN]
			}
		]
	}
};

/** 豁免 ①：AI client 可以匯入 openai（它就是那個唯一出口） */
const FENCE_EXEMPT_AI_CLIENT = {
	name: 'urban-tales/ai-fence-exempt-client',
	files: ['src/lib/server/ai/client.ts'],
	rules: {
		'no-restricted-imports': ['error', { paths: [], patterns: [] }]
	}
};

/** 豁免 ②：speak() 可以匯入 AI client，但仍然不准直接碰 openai */
const FENCE_EXEMPT_SPEAK = {
	name: 'urban-tales/ai-fence-exempt-speak',
	files: ['src/lib/server/soul/speak.ts'],
	rules: {
		'no-restricted-imports': ['error', { paths: [BLOCK_AI_SDK], patterns: [BLOCK_AI_SDK_PATTERN] }]
	}
};

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint 建議 TS 專案不要開 no-undef
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},

	// ★ 順序有意義：先套預設，再讓豁免區塊覆蓋特定檔案。不要調換。
	FENCE_DEFAULT,
	FENCE_EXEMPT_AI_CLIENT,
	FENCE_EXEMPT_SPEAK
);
