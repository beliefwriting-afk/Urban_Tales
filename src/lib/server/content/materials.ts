/**
 * 地方故事素材庫載入器 —— SDD §6.3。
 *
 * ★ 載入方式與 souls.ts 完全一樣（建置期 import.meta.glob），理由見那個檔案。
 *
 * ★★★ 這是靈魂「知道的事」的全部來源。★★★
 *   `facts` 與 `legends` 整段逐字進 system prompt（§6.2 的 [2]），
 *   **不做向量檢索**——每站約 3,000 tokens，RAG 會漏，而玩家問的往往正是
 *   冷門的那一條（§6.3 的三個理由）。
 *
 * ⚠️ `sources` **不進 prompt，也不給玩家看**。它存在的理由只有一個：
 *   讓審內容的人查得到每一句話是從哪來的（content/schema.ts 的說明）。
 *   組 prompt 的地方（soul/prompt.ts）因此逐欄位取用，不整包 JSON.stringify。
 */
import { parse as parseYaml } from 'yaml';
import { MaterialSchema, type Material } from '../../../../content/schema';

const RAW = import.meta.glob('/content/sites/*/materials.yaml', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

function dirOf(path: string): string {
	return path.split('/').at(-2) ?? '';
}

function load(): Map<string, Material> {
	const out = new Map<string, Material>();

	for (const [path, raw] of Object.entries(RAW)) {
		const dir = dirOf(path);
		const m = MaterialSchema.parse(parseYaml(raw));

		if (m.siteId !== dir) {
			throw new Error(
				`content/sites/${dir}/materials.yaml 的 siteId 是 "${m.siteId}"，與目錄名不符`
			);
		}
		out.set(m.siteId, m);
	}

	return out;
}

const MATERIALS = load();

/** 查一站的素材庫。查不到回 null（草稿站只要 site.yaml） */
export function getMaterials(siteId: string): Material | null {
	return MATERIALS.get(siteId) ?? null;
}

/** 有幾站寫好了素材庫。診斷用 */
export function materialSiteIds(): string[] {
	return [...MATERIALS.keys()].sort();
}
