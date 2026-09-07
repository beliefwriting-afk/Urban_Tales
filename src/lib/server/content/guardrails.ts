/**
 * 全域安全界線載入器 —— SDD §2.2、§6.2。
 *
 * ★★★ 全站唯一一份。這個檔案刻意**沒有 siteId 參數**。★★★
 *
 *   SDD §2.2：「沒有第二個地方可以放護欄，也就沒有第二套護欄。」
 *   如果這裡提供 `getGuardrails(siteId)`，那就等於承認護欄可以有
 *   「某一站的版本」——而企劃書 §4.2 記錄的失敗模式正是這個：
 *   規則只掛在主要路徑上，其他路徑用了別的版本。
 *
 *   **介面本身就是那條規則。** 沒有參數可以傳，就沒有「這一站不一樣」這件事。
 *
 * ⚠️ 這一份載入失敗要直接炸開，不能回 null 讓呼叫端「有就用、沒有就算了」——
 *   那會變成「護欄檔壞掉時，靈魂在沒有護欄的情況下照常說話」。
 *   啟動就失敗遠好過安靜地少一層。
 */
import { parse as parseYaml } from 'yaml';
import { GuardrailsSchema, type Guardrails } from '../../../../content/schema';

const RAW = import.meta.glob('/content/guardrails.yaml', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

function load(): Guardrails {
	const raw = RAW['/content/guardrails.yaml'];
	if (!raw) {
		throw new Error('content/guardrails.yaml 不存在 —— 這是全站唯一的安全界線來源');
	}
	// 用 parse 不用 safeParse：護欄壞掉必須在建置／啟動時就炸開。
	return GuardrailsSchema.parse(parseYaml(raw));
}

const GUARDRAILS = load();

/** 取全域護欄。★ 沒有 siteId 參數，這是刻意的 */
export function getGuardrails(): Guardrails {
	return GUARDRAILS;
}
