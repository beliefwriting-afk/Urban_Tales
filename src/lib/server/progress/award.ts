/**
 * 進度與發卡 —— SDD §8.1。
 *
 * ★★★ 企劃書 §7：進度不由 AI 判定。★★★
 *   這個檔案裡沒有任何模型參與，全是確定性規則。AI 只負責把結果講得像
 *   那個角色會說的話，而「拿到了沒有」是這裡算出來的。
 *
 * ★★★ 兩支函式都必須冪等。★★★
 *
 *   行動網路下重送很常見——玩家站在廟口，訊號斷一下、按鈕多按一次，
 *   請求就會到兩次。他不該因此看到兩次發卡動畫，也不該因為第二次請求
 *   而收到錯誤。所以「這次是不是第一次」由**資料庫**回答，不由程式碼
 *   先查再寫（先查再寫在兩個請求同時進來時會兩個都判成第一次）。
 *
 * ★ 時間一律走資料庫的 now()，不用 new Date()。
 *   HANDOFF §13.4 ① 的教訓：應用伺服器與資料庫是兩個時鐘，混用會產生
 *   「最後出現時間早於建立時間」這種看起來像鬧鬼的資料。全站只認一個時鐘。
 */
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { playerCards, playerSiteState } from '$lib/server/db/schema';

/**
 * 發一張卡。回 true 表示**這一次才發出去的**（前端播發卡動畫）。
 *
 * `onConflictDoNothing().returning()` ≈ SQL 的
 *   `INSERT ... ON CONFLICT DO NOTHING RETURNING *`
 * 撞主鍵時 PostgreSQL 不回傳任何列，所以「有沒有回傳」就是「是不是新的」。
 * 一次往返、沒有競態、不需要交易。
 */
export async function awardCard(playerId: string, cardId: string): Promise<boolean> {
	const rows = await db
		.insert(playerCards)
		.values({ playerId, cardId, earnedAt: sql`now()` })
		.onConflictDoNothing()
		.returning({ cardId: playerCards.cardId });

	return rows.length > 0;
}

/**
 * 記下「這個玩家第一次進了這一站」。回 true 表示這一次才是第一次。
 *
 * ★ 為什麼不是 onConflictDoNothing：
 *   `player_site_state` 這一列可能已經因為別的原因存在（未來的劇情進度、
 *   拍照任務），但 `first_met_at` 仍然是 null。單純 DoNothing 會把
 *   「列已存在」誤判成「已經來過了」，玩家就永遠拿不到相遇卡。
 *
 * ★ `setWhere` 是關鍵：撞到既有列時**只在 first_met_at 還是 null 時才更新**。
 *   條件不成立的話 PostgreSQL 不回傳該列——於是「有沒有回傳」同樣等於
 *   「這次是不是第一次」，語意跟 awardCard 一致。
 *
 * 給 Python 背景的對照：整段是一句
 *   INSERT INTO player_site_state (...) VALUES (...)
 *   ON CONFLICT (player_id, site_id) DO UPDATE SET first_met_at = now()
 *   WHERE player_site_state.first_met_at IS NULL
 *   RETURNING first_met_at;
 */
export async function markFirstMet(playerId: string, siteId: string): Promise<boolean> {
	const rows = await db
		.insert(playerSiteState)
		.values({ playerId, siteId, firstMetAt: sql`now()` })
		.onConflictDoUpdate({
			target: [playerSiteState.playerId, playerSiteState.siteId],
			set: { firstMetAt: sql`now()` },
			setWhere: sql`${playerSiteState.firstMetAt} is null`
		})
		.returning({ firstMetAt: playerSiteState.firstMetAt });

	return rows.length > 0;
}
