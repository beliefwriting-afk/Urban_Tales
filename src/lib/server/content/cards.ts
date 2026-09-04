/**
 * 成就卡載入器 —— SDD §8.1／§8.2。
 *
 * 卡片定義住在 `content/cards.yaml`（全站一份），玩家拿到哪幾張住在
 * `player_cards` 表。這條分界跟景點一樣：**定義在 Git，事件在資料庫。**
 *
 * ★ 為什麼發卡時要「查」卡片 id，而不是用 `encounter-<siteId>` 這種約定：
 *
 *   約定看起來省事，但它是一份沒有寫下來的規格。哪天有人在 cards.yaml
 *   把卡命名成 `ximen-encounter`，程式碼會照樣寫進一個不存在的 card_id，
 *   而且**不會有任何錯誤**——玩家的圖鑑永遠缺一張，資料表裡卻有一列。
 *   查表則是：查不到就是查不到，當場知道。
 *
 *   代價是「playable 的站必須有一張 encounter 卡」變成一條要維護的規則。
 *   那條規則已經機械化在 content:check #7b，跟「playable 的站 art 不得為
 *   null」（#8）同一個形狀。
 *
 * ★ 卡片內容**整份都是要給玩家看的**（卡面、卡背文字、圖），所以這裡
 *   沒有 souls.ts 那種白名單問題。仍然做語言選擇，理由同 PublicSite：
 *   語言是伺服器的事。
 */
import { parse as parseYaml } from 'yaml';
import { CardsFileSchema, type Card, type CardKind } from '../../../../content/schema';

/** 給前端的卡片。多語言已選好，其餘原樣 */
export type PublicCard = {
	id: string;
	kind: CardKind;
	siteId: string;
	title: string;
	flavor: string;
	art: { portrait: string; frame: string };
};

// ─── 建置期載入 ──────────────────────────────────────────────

const RAW = import.meta.glob('/content/cards.yaml', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

function load(): Map<string, Card> {
	const out = new Map<string, Card>();
	const raw = Object.values(RAW)[0];

	// cards.yaml 不存在是建置設定壞掉，不是內容還沒寫（空清單才是「還沒寫」）。
	if (raw === undefined) throw new Error('找不到 content/cards.yaml');

	const file = CardsFileSchema.parse(parseYaml(raw));
	for (const c of file.cards) {
		if (out.has(c.id)) throw new Error(`cards.yaml 有重複的卡片 id："${c.id}"`);
		out.set(c.id, c);
	}
	return out;
}

const CARDS = load();

// ─── 對外 ────────────────────────────────────────────────────

export function getCard(id: string): Card | null {
	return CARDS.get(id) ?? null;
}

/**
 * 某一站的相遇卡。
 *
 * ★ 回 null 有兩種可能：這一站還沒定義卡（草稿階段的正常狀態），
 *   或者定義了但 kind 寫錯。呼叫端不需要分辨——兩種情況都不該發卡。
 *   真正該分辨的地方是 content:check，它會在建置時把話講明白。
 */
export function getEncounterCard(siteId: string): Card | null {
	for (const c of CARDS.values()) {
		if (c.kind === 'encounter' && c.siteId === siteId) return c;
	}
	return null;
}

export function toPublicCard(card: Card): PublicCard {
	return {
		id: card.id,
		kind: card.kind,
		siteId: card.siteId,
		title: card.title.zhHant,
		flavor: card.flavor.zhHant,
		art: { portrait: card.art.portrait, frame: card.art.frame }
	};
}

/** 全部卡片定義。圖鑑（切片 6）要用它畫未獲得卡的剪影 */
export function listCards(): Card[] {
	return [...CARDS.values()];
}
