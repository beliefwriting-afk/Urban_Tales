/**
 * GET /api/collection —— 圖鑑（SDD §8.2）。
 *
 * ★ 只要 player cookie，**不要在場憑證**：看自己的圖鑑不需要人在現場。
 *   （對照 enter / chat / photo-task 三支都要 presence——那三支會產生新的進度，
 *   這一支只是讀。）
 *
 * ★★★ 未獲得的卡不洩漏卡面內容 ★★★
 *   界線與理由都在 `progress/collection.ts`，那裡用 discriminated union
 *   讓「不小心把 flavor 帶出去」變成編譯不過，而不是靠這裡記得刪。
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { listCards } from '$lib/server/content/cards';
import { getSite } from '$lib/server/content/sites';
import { buildCollection, collectionSummary } from '$lib/server/progress/collection';
import { listOwnedCards } from '$lib/server/progress/owned';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.playerId) {
		return json({ code: 'no_identity', message: '沒有身分' }, { status: 401 });
	}

	const owned = await listOwnedCards(locals.playerId);
	const { entries, orphans } = buildCollection(
		listCards(),
		owned,
		(siteId) => getSite(siteId)?.name.zhHant ?? null
	);

	// ★ 玩家持有一張內容層已經沒有的卡。圖鑑畫不出它，但不能安靜地當作沒發生——
	//   那代表某次改內容時刪掉了已經發出去的卡，而那件事應該被人看到。
	if (orphans.length > 0) {
		console.warn(`[collection] 玩家持有 cards.yaml 裡沒有的卡：${orphans.join('、')}`);
	}

	return json({ ...collectionSummary(entries), cards: entries });
};
