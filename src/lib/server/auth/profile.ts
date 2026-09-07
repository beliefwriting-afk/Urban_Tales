/**
 * 玩家自己的那一點點資料 —— `GET /api/me` 用。
 *
 * ★★★ 這裡沒有「個人資料」可言，那是刻意的。★★★
 *   `players` 表沒有 email、沒有姓名、沒有頭像、沒有 IP（SDD §3.2）。
 *   所以這支端點回得出來的只有兩件事：一個看得懂的稱呼，與什麼時候開始玩的。
 *
 * ⚠️ 玩家編號是**顯示用的稱呼**，不是識別碼。前端拿它印在設定頁上，
 *   不拿它做任何判斷——真正的身分在 HttpOnly cookie 裡，前端讀不到也不需要讀。
 */
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema';

/**
 * 「旅人 #C440」這樣的稱呼。
 *
 * ★ 取 uuid 前四個十六進位字元（16 bits）。夠短好唸，而且**不足以反推 uuid**——
 *   何況這支端點只回給本人。
 *
 * ⚠️ 純函式，測得到。格式是玩家會看到的東西，改了他會發現自己「換了編號」。
 */
export function guestLabel(playerId: string): string {
	const hex = playerId.replace(/-/g, '').slice(0, 4).toUpperCase();
	return `旅人 #${hex}`;
}

/** 這個玩家是什麼時候被建立的。查不到回 null（理論上不會發生） */
export async function getPlayerCreatedAt(playerId: string): Promise<Date | null> {
	const rows = await db
		.select({ createdAt: players.createdAt })
		.from(players)
		.where(eq(players.id, playerId))
		.limit(1);

	return rows[0]?.createdAt ?? null;
}
