/**
 * 玩家拿到哪幾張卡 —— `player_cards`。
 *
 * ★ 這裡只做查詢。發卡在 `award.ts`，組裝圖鑑在 `collection.ts`（純函式）。
 *   三件事分開的理由跟其他地方一樣：中間那一段是「錯了畫面完全正常」的邏輯，
 *   要測得到。
 */
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { playerCards } from '$lib/server/db/schema';

/** card_id → 取得時間 */
export async function listOwnedCards(playerId: string): Promise<Map<string, Date>> {
	const rows = await db
		.select({ cardId: playerCards.cardId, earnedAt: playerCards.earnedAt })
		.from(playerCards)
		.where(eq(playerCards.playerId, playerId));

	return new Map(rows.map((r) => [r.cardId, r.earnedAt]));
}
