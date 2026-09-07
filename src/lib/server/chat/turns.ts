/**
 * 對話歷史 —— SDD §3.2 的 `chat_turns`。
 *
 * ★★★ 這不是「聊天記錄」功能。★★★
 *   它存在的唯一理由是讓 AI 有上下文（§6.3 的變動段）。玩家沒有介面可以翻閱，
 *   保留 30 天由排程清掉（§11.3）。**別把它當成產品功能來擴充。**
 *
 * ★ 這個檔案刻意**不** import `ai/client`——它在 ESLint 圍籬的預設區塊裡，
 *   import 了會建置失敗。所以這裡用自己的 `Turn` 型別，
 *   轉成 AI 供應商的 message 格式是 `speak.ts` 的事（那是唯一該知道供應商長相的地方）。
 *
 * 給 Python 背景的對照：
 *   `and(eq(a, b), eq(c, d))` ≈ SQLAlchemy 的 `.filter(A == b, C == d)`
 *   `desc(x)`                 ≈ `.order_by(X.desc())`
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { chatTurns } from '$lib/server/db/schema';

/** ★ 資料庫用 'soul'，AI 供應商用 'assistant'。翻譯只在 speak.ts 做一次 */
export type Turn = { role: 'user' | 'soul'; content: string };

/**
 * 最近幾輪對話，**時間由舊到新**（模型要照時序讀）。
 *
 * ★ 一輪 ＝ 玩家一則 ＋ 靈魂一則，所以取 `maxTurns * 2` 則。
 *   超出的直接丟棄最舊的（§6.3）——不做摘要、不做壓縮。
 *   理由跟不做 RAG 一樣：量太小，多一套機制就多一個會失效的地方。
 *
 * ⚠️ 排序要加上 `id` 當第二鍵。同一秒內插入的兩則（玩家那則與靈魂那則
 *   本來就是同一次 `now()`）光看 `created_at` 分不出先後，
 *   而順序錯了會變成「靈魂先回答、玩家才發問」——模型讀到的是一段錯亂的對話，
 *   但畫面上完全正常。`id` 是 bigserial，單調遞增。
 */
export async function recentTurns(
	playerId: string,
	siteId: string,
	maxTurns = 10
): Promise<Turn[]> {
	const rows = await db
		.select({ role: chatTurns.role, content: chatTurns.content })
		.from(chatTurns)
		.where(and(eq(chatTurns.playerId, playerId), eq(chatTurns.siteId, siteId)))
		.orderBy(desc(chatTurns.createdAt), desc(chatTurns.id))
		.limit(maxTurns * 2);

	// schema 有 check constraint 擋住其他值，所以這裡的斷言是安全的；
	// 但仍然逐列過濾一次，避免將來加了第三種 role 時安靜地混進 prompt。
	return rows.filter((r): r is Turn => r.role === 'user' || r.role === 'soul').reverse();
}

/**
 * 記下這一輪的兩則。
 *
 * ★ 一次 insert 兩列，不是兩次往返——玩家那則與靈魂那則要嘛都在、要嘛都不在。
 *   （只寫進去一半的話，下一輪的上下文會出現沒有回應的提問，
 *   模型會以為自己上次沒答，然後重複回答同一件事。）
 *
 * ★ `isFallback` 只標在靈魂那則。上線後 `is_fallback` 的比例就是「AI 可用率」，
 *   那是本專案唯一需要的營運指標（SDD §6.5）。
 */
export async function saveTurn(
	playerId: string,
	siteId: string,
	userText: string,
	soulText: string,
	isFallback: boolean
): Promise<void> {
	await db.insert(chatTurns).values([
		{ playerId, siteId, role: 'user', content: userText, isFallback: false, createdAt: sql`now()` },
		{ playerId, siteId, role: 'soul', content: soulText, isFallback, createdAt: sql`now()` }
	]);
}
