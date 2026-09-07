/**
 * 保底台詞載入器 —— SDD §6.5。
 *
 * ★ 載入方式與 souls.ts 完全一樣（建置期 import.meta.glob），理由見那個檔案。
 *
 * ★ 這一份**沒有 toPublicXXX**。理由：保底台詞就是靈魂說出口的話，
 *   它本來就會回給玩家——沒有「內部欄位」要削掉。
 *   （對照 souls.ts 要削 persona、sites.ts 要削 radiusM。）
 *
 * ⚠️ 但整份 fallbacks 也**不該一次送到前端**：前端一次拿到十四句，
 *   等於知道這個靈魂在什麼情況下會說什麼，AI 失效就變得看得出來——
 *   而企劃書 §8.7 要的正是「視為正常回應，不呈現為錯誤」。
 *   所以取用的方式只有一個：speak() 挑一句，回一句。
 */
import { parse as parseYaml } from 'yaml';
import { FallbackSchema, type FallbackFile } from '../../../../content/schema';

const RAW = import.meta.glob('/content/sites/*/fallbacks.yaml', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

function dirOf(path: string): string {
	return path.split('/').at(-2) ?? '';
}

function load(): Map<string, FallbackFile> {
	const out = new Map<string, FallbackFile>();

	for (const [path, raw] of Object.entries(RAW)) {
		const dir = dirOf(path);
		// 同 souls.ts：用 parse 不用 safeParse。台詞壞掉要在建置／啟動時炸開——
		// 安靜地少一組台詞，會變成「AI 失效時回一句空字串」，那比錯誤畫面更糟。
		const f = FallbackSchema.parse(parseYaml(raw));

		if (f.siteId !== dir) {
			throw new Error(
				`content/sites/${dir}/fallbacks.yaml 的 siteId 是 "${f.siteId}"，與目錄名不符`
			);
		}
		out.set(f.siteId, f);
	}

	return out;
}

const FALLBACKS = load();

/**
 * 查一站的保底台詞。
 *
 * ⚠️ 查不到回 null，不 throw——草稿站只要 site.yaml（content:check #2）。
 *   但 speak() 只會被 playable 的站叫到，那時它一定在。
 */
export function getFallbacks(siteId: string): FallbackFile | null {
	return FALLBACKS.get(siteId) ?? null;
}

/** 有幾站寫好了保底台詞。診斷用 */
export function fallbackSiteIds(): string[] {
	return [...FALLBACKS.keys()].sort();
}
