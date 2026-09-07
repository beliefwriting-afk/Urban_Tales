/**
 * POST /api/site/:id/photo-task —— 回報快門，發任務卡（SDD §8.1）。
 *
 * ★ 這個檔案刻意很薄，同 enter：取材料 → 問純函式 → 照結果寫資料庫。
 *
 * ★★★ 這支端點收到的只是「按下快門了」這個事件。★★★
 *   沒有照片、沒有縮圖、沒有任何影像資料——企劃書 §5.6：不使用玩家的照片。
 *   判定時機是按下快門，不等存檔（SDD §7.3、企劃書 §5.4「拍了就過，無審核」）：
 *   玩家有沒有把照片存進相簿是他自己的事，而且網頁根本拿不到可靠的訊號。
 *
 * ★ 在場憑證同樣走 `X-Presence-Token`，理由見 enter/+server.ts 檔頭。
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

import { derivePresenceKey, verifyPresenceToken, PRESENCE_HEADER } from '$lib/server/auth/presence';
import { getSite } from '$lib/server/content/sites';
import { getTaskCard, toPublicCard } from '$lib/server/content/cards';
import { decidePhotoTask } from '$lib/server/site/photo-task';
import { awardCard, markPhotoTask } from '$lib/server/progress/award';

let presenceKey: Uint8Array | null = null;

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const siteId = params.id;
	const site = getSite(siteId);

	presenceKey ??= derivePresenceKey(env.SESSION_SECRET);
	const presence = await verifyPresenceToken(
		request.headers.get(PRESENCE_HEADER),
		presenceKey,
		siteId
	);

	const task = getTaskCard(siteId);

	const decision = decidePhotoTask({
		playerId: locals.playerId,
		siteId,
		siteStatus: site?.status ?? null,
		presence,
		taskCardId: task?.id ?? null
	});

	if (!decision.ok) {
		return json({ code: decision.code, message: decision.message }, { status: decision.status });
	}

	// ★ 兩步都冪等，而且 awardCard 無條件呼叫（不是「first 才發」）。
	//   理由同 enter：兩個寫入之間斷線的話，玩家會停在「任務記錄了、卡沒發出去」
	//   而且再也回不去。無條件呼叫讓下一次請求自己把卡補上。
	//   **能自癒的順序，勝過一個交易。**
	const first = await markPhotoTask(decision.playerId, decision.siteId);
	const awarded = await awardCard(decision.playerId, decision.cardId);

	return json({
		siteId,
		mode: decision.mode,
		/** 這一次才是第一次完成 */
		first,
		/** 這一次才發出去的卡。前端據此決定要不要播發卡動畫 */
		awarded,
		card: awarded && task ? toPublicCard(task) : null
	});
};
