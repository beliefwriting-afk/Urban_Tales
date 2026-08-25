#!/usr/bin/env node
/**
 * 護欄機制本身的測試 —— SDD §14「Lint 規則測試」。
 *
 * ★ 這一條最容易被忽略，卻是最重要的一條。★
 *
 * 我們花很大力氣建立「唯一出口 speak()」這道圍籬，但如果 ESLint 規則
 * 寫錯了、被誤刪了、或被某次重構的 ignores 蓋掉了，圍籬會安靜地失效，
 * 而且沒有任何人會發現 —— 因為「沒有錯誤」看起來就跟「規則有效」一樣。
 *
 * 所以這個腳本故意寫違規的 import，確認 ESLint 真的擋得下來。
 * 它驗的不是程式碼，是護欄。
 *
 * 跑法：npm run test:guard
 */
import { ESLint } from 'eslint';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: ROOT });

type Case = {
	name: string;
	/** 假裝這段程式碼放在哪個路徑（決定 ESLint 套用哪些規則） */
	filePath: string;
	code: string;
	/** true = 這段應該被擋下來 */
	shouldBlock: boolean;
};

const CASES: Case[] = [
	{
		name: '一般 server route 匯入 openai',
		filePath: 'src/routes/api/chat/+server.ts',
		code: `import OpenAI from 'openai';\nexport const x = OpenAI;\n`,
		shouldBlock: true
	},
	{
		name: '前端元件匯入 openai',
		filePath: 'src/lib/client/chat/box.ts',
		code: `import OpenAI from 'openai';\nexport const x = OpenAI;\n`,
		shouldBlock: true
	},
	{
		name: 'soul/ 底下但不是 speak.ts 的檔案匯入 AI client（別名路徑）',
		filePath: 'src/lib/server/soul/story.ts',
		code: `import { complete } from '$lib/server/ai/client';\nexport const x = complete;\n`,
		shouldBlock: true
	},
	{
		name: 'soul/ 底下但不是 speak.ts 的檔案匯入 AI client（相對路徑）',
		filePath: 'src/lib/server/soul/story.ts',
		code: `import { complete } from '../ai/client';\nexport const x = complete;\n`,
		shouldBlock: true
	},
	{
		name: '★ ai/client.ts 匯入 openai —— 這是唯一的合法出口，必須放行',
		filePath: 'src/lib/server/ai/client.ts',
		code: `import OpenAI from 'openai';\nexport const x = OpenAI;\n`,
		shouldBlock: false
	},
	{
		name: '★ speak.ts 匯入 AI client —— 這是唯一的合法呼叫者，必須放行',
		filePath: 'src/lib/server/soul/speak.ts',
		code: `import { complete } from '$lib/server/ai/client';\nexport const x = complete;\n`,
		shouldBlock: false
	}
];

const RULE = 'no-restricted-imports';

let failed = 0;
const line = '─'.repeat(64);

console.log(line);
console.log('護欄機制測試 —— SDD §6.1 唯一出口 speak()');
console.log(line);

for (const c of CASES) {
	const results = await eslint.lintText(c.code, { filePath: resolve(ROOT, c.filePath) });
	const blocked = results.some((r) =>
		r.messages.some((m) => m.ruleId === RULE && m.severity === 2)
	);

	const ok = blocked === c.shouldBlock;
	if (!ok) failed++;

	const mark = ok ? '✅' : '❌';
	const verb = c.shouldBlock ? '應該被擋' : '應該放行';
	const got = blocked ? '被擋下' : '放行了';
	console.log(`${mark} ${c.name}`);
	console.log(`      ${verb} → 實際${got}`);
}

console.log(line);

if (failed > 0) {
	console.error(`❌ 護欄失效：${failed} 個案例不符預期。`);
	console.error('');
	console.error('這代表 eslint.config.js 的 AI_SDK_FENCE / AI_CLIENT_FENCE 沒有正常運作。');
	console.error('在修好之前，任何人都可以繞過 speak() 直接呼叫 AI —— 也就繞過全部的內容治理規則。');
	console.error('這正是企劃書 §4.2 記錄的前身專案失敗原因。');
	console.error(line);
	process.exit(1);
}

console.log('✅ 護欄有效：違規的 AI import 會被擋下，合法出口正常放行。');
console.log(line);
