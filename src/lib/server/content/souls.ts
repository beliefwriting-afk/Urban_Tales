/**
 * 城市靈魂載入器 —— 對應 sites.ts，但守的是另一條界線。
 *
 * ★★★ persona 永遠不進 API 回應。★★★
 *
 *   sites.ts 守的是「要走多近才算到」（radiusM）。這裡守的是「靈魂的設定稿」。
 *   persona 整段會逐字注入 system prompt（SDD §6.2 的 [1]），所以它外洩等於
 *   把 system prompt 交出去——對方馬上知道護欄怎麼寫、角色被禁止說什麼，
 *   越獄從「試探」變成「照著繞」。
 *
 *   ⚠️ 這是「錯了畫面完全正常」的那一類錯，跟 radiusM 同一類：
 *      多回一個 persona 欄位，前端不會壞、UI 不會變、沒有人會發現。
 *      所以它必須被機械化釘住，不能靠寫程式的人記得——
 *      `souls.spec.ts` 有一條把欄位清單釘死的測試。
 *
 * ★ 載入方式與 sites.ts 完全一樣（建置期 import.meta.glob），理由見那個檔案。
 *   差別只有一個：**soul.yaml 可以不存在**。草稿站只要 site.yaml
 *   （content:check #2），所以這裡查不到要回 null，不能 throw。
 */
import { parse as parseYaml } from 'yaml';
import { SoulSchema, type Soul } from '../../../../content/schema';
import type { RendererSpec } from '$lib/client/soul/renderer';

/**
 * ★★★ 給前端的靈魂資料。★★★
 *
 * 只有「畫出這個角色所需要的東西」。
 *
 *   給：名字、立繪路徑、渲染方式 —— 前端不知道這些就畫不出角色。
 *   不給：`persona`（identity / voice / knows / isNot / taboos）—— 那是
 *        system prompt 的原料。玩家看得到的是靈魂**說出口的話**，
 *        不是它的設定稿。
 *
 * ⚠️ 要往這裡加欄位之前先想一次：**這個值被知道之後，有人能拿它做什麼？**
 *    `souls.spec.ts` 有一條測試把欄位清單釘死，加欄位會讓測試失敗——
 *    那個失敗不是要擋你，是要你在那一刻回答上面那個問題。
 */
export type PublicSoul = {
	siteId: string;
	/** 已經選好語言的字串，同 PublicSite */
	name: string;
	/**
	 * 立繪與渲染方式。**可以是 null**——草稿站的立繪要等 P0-1。
	 * 但 enter 只對 playable 的站成功，而 content:check #8 強制
	 * 「playable 的站 art 不得為 null」，所以實際流到前端時不會是 null。
	 */
	art: { portrait: string; renderer: RendererSpec } | null;
};

// ─── 建置期載入 ──────────────────────────────────────────────

const RAW = import.meta.glob('/content/sites/*/soul.yaml', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** 從 `/content/sites/<dir>/soul.yaml` 取出 `<dir>` */
function dirOf(path: string): string {
	return path.split('/').at(-2) ?? '';
}

function load(): Map<string, Soul> {
	const out = new Map<string, Soul>();

	for (const [path, raw] of Object.entries(RAW)) {
		const dir = dirOf(path);
		// 同 sites.ts：用 parse 不用 safeParse。內容壞掉要在建置／啟動時就炸開，
		// 不能安靜地少一個靈魂——那會變成「進得去但角色是空的」。
		const soul = SoulSchema.parse(parseYaml(raw));

		if (soul.siteId !== dir) {
			throw new Error(`content/sites/${dir}/soul.yaml 的 siteId 是 "${soul.siteId}"，與目錄名不符`);
		}
		out.set(soul.siteId, soul);
	}

	return out;
}

const SOULS = load();

// ─── 對外 ────────────────────────────────────────────────────

/**
 * 伺服器端查靈魂（含 persona）。
 *
 * ★ 回傳值不可直接丟進任何回應。要送給前端請走 toPublicSoul()。
 *   之後 speak() 組 prompt 用的就是這一支。
 */
export function getSoul(siteId: string): Soul | null {
	return SOULS.get(siteId) ?? null;
}

/**
 * 把內部資料削成給前端的形狀。
 *
 * ★ 逐欄位列舉，不用 `const { persona, ...rest } = soul`：
 *   那種寫法在 Soul 多一個欄位時會自動把新欄位帶到前端去，而且沒有任何
 *   地方會提醒你。列舉是白名單，白名單才擋得住「不小心」。
 */
export function toPublicSoul(soul: Soul): PublicSoul {
	return {
		siteId: soul.siteId,
		name: soul.name.zhHant,
		art: soul.art ? { portrait: soul.art.portrait, renderer: soul.art.renderer } : null
	};
}

/** 有幾站寫好了人格卡。診斷用（content:check 之外的第二個眼睛） */
export function soulSiteIds(): string[] {
	return [...SOULS.keys()].sort();
}
