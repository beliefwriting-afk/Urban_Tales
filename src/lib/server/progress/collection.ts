/**
 * 圖鑑的組裝 —— SDD §8.2。
 *
 * ★★★ 純函式：卡片定義與「玩家拿到哪幾張」都由呼叫端傳進來。★★★
 *
 * ★★★ 這個檔案守的界線：**未獲得的卡不能洩漏卡面內容。** ★★★
 *
 *   SDD §8.2：未獲得顯示「像素剪影 ＋ 該站名稱」——讓玩家知道「還有東西可以拿」
 *   以及「在哪裡拿」，但**不知道那張卡長什麼樣、卡背寫了什麼**。
 *   那句卡背文字是拿到卡的那一刻才該讀到的東西；提前送出去，收集就沒有重量了。
 *
 *   ⚠️ 這跟 `toPublicSite` 的 radiusM、`toPublicSoul` 的 persona 是同一類錯：
 *      多回幾個欄位，畫面完全正常、沒有人會發現。
 *
 *   ★ 但這裡用的手法更強一層：**discriminated union**。
 *      未獲得的那一支型別裡**根本沒有 title / flavor / portrait 這幾個欄位**，
 *      所以「不小心把卡面帶出去」不是靠白名單擋，是 TypeScript 直接編不過。
 *      白名單擋得住「忘了刪」，型別擋得住「根本寫不出來」。
 *
 * 給 Python 背景的對照：discriminated union ≈ 用 Literal 欄位區分的 Union type，
 * `owned: true` / `owned: false` 就是那個判別欄位。
 */
import type { Card, CardKind } from '../../../../content/schema';

export type CollectionEntry =
	| {
			owned: true;
			id: string;
			kind: CardKind;
			siteId: string;
			siteName: string;
			title: string;
			flavor: string;
			art: { portrait: string; frame: string };
			earnedAt: string;
	  }
	| {
			owned: false;
			id: string;
			kind: CardKind;
			siteId: string;
			siteName: string;
			/**
			 * ★ 未獲得的卡只給卡框，不給立繪。
			 *   卡框是通用素材（每一種 kind 一張），立繪就是卡面本身。
			 */
			frame: string;
	  };

export type CollectionResult = {
	entries: CollectionEntry[];
	/**
	 * 玩家持有、但 `cards.yaml` 裡已經沒有的 card_id。
	 *
	 * ★ 這是「內容層刪了一張卡，但玩家早就拿到了」的狀態。圖鑑顯示不出它
	 *   （沒有定義就沒有卡面），但**不能安靜地當作沒發生**——
	 *   呼叫端會把它記進 log。同 content:check 對草稿站的態度：
	 *   對策不是禁止半成品存在，是不讓它安靜地存在。
	 */
	orphans: string[];
};

/**
 * @param cards      內容層的全部卡片定義（`listCards()`）
 * @param owned      玩家已獲得：card_id → 取得時間
 * @param siteNameOf 站 id → 顯示名稱。查不到回 null（那一站已經從內容層移除）
 */
export function buildCollection(
	cards: Card[],
	owned: Map<string, Date>,
	siteNameOf: (siteId: string) => string | null
): CollectionResult {
	// ★ 順序就是 cards.yaml 的順序，不在這裡排序。
	//   圖鑑的排列是**內容作者的決定**（哪張放前面、六站怎麼分組），
	//   不是程式的決定。要改順序就改 cards.yaml，那是逐字審過的檔案。
	const entries: CollectionEntry[] = cards.map((c) => {
		const siteName = siteNameOf(c.siteId) ?? c.siteId;
		const earned = owned.get(c.id);

		if (!earned) {
			return {
				owned: false,
				id: c.id,
				kind: c.kind,
				siteId: c.siteId,
				siteName,
				frame: c.art.frame
			};
		}

		return {
			owned: true,
			id: c.id,
			kind: c.kind,
			siteId: c.siteId,
			siteName,
			title: c.title.zhHant,
			flavor: c.flavor.zhHant,
			art: { portrait: c.art.portrait, frame: c.art.frame },
			earnedAt: earned.toISOString()
		};
	});

	const known = new Set(cards.map((c) => c.id));
	const orphans = [...owned.keys()].filter((id) => !known.has(id));

	return { entries, orphans };
}

/** 圖鑑摘要。前端顯示「12 / 15」用 */
export function collectionSummary(entries: CollectionEntry[]): { owned: number; total: number } {
	return { owned: entries.filter((e) => e.owned).length, total: entries.length };
}
