/**
 * 用量控制的執行面 —— SDD §10.1。
 *
 * ★ 判準在隔壁的 `limits.ts`（純函式，測得到）。這裡只做一件事：
 *   **把「檢查」與「扣除」壓成同一句原子 SQL**。
 *
 * ★★★ 為什麼一定要原子（後端拍板第 3 條）★★★
 *   先查再寫的話，兩個同時進來的請求會**同時查到還有額度**，然後雙雙通過。
 *   額度就這樣被穿過去了，而且事後看資料庫完全正常——次數是對的，
 *   只是有一次不該發生。用 `UPDATE ... WHERE ... RETURNING` 讓資料庫自己判斷，
 *   「有沒有回傳」就是「這次准不准」。這跟 `progress/award.ts` 的冪等寫入同一個手法。
 *
 * ★★★ 時間一律走資料庫的時鐘 ★★★
 *   `new Date()` 是應用伺服器的時鐘，實測差 174 毫秒（HANDOFF §13.4 ①）。
 *   額度重置與桶子補充都要比時間，混用兩個時鐘會產生「額度沒到隔天卻重置了」
 *   這種查不出根因的 bug。
 *
 * 給 Python 背景的對照：
 *   `sql\`...\`` ≈ SQLAlchemy 的 `text("...")`，會安全地把參數綁進去
 *   `.returning(...)` ≈ `RETURNING`，PostgreSQL 才有，MySQL 沒有
 */
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { rateBuckets, usageGlobalDaily, usagePlayerDaily } from '$lib/server/db/schema';
import type { BucketConfig } from './limits';

/**
 * ★★★ 「今天」是台北的今天，不是 UTC 的今天。★★★
 *
 * SDD §10.1：全域上限「隔日 UTC+8 00:00 自動恢復」。
 * 直接用 `current_date` 的話，資料庫在 UTC 之下會等到**台北時間早上八點**才換日——
 * 玩家半夜十二點以為額度重置了，其實還要再等八小時，而畫面上完全看不出原因。
 *
 * ⚠️ 這個運算式在本檔案的三處都要用同一份，所以定義成常數：
 *   複製三次的話，哪天改時區只改到兩處，剩下那一處會安靜地用另一個日界線。
 */
const TAIPEI_TODAY = sql`(now() at time zone 'Asia/Taipei')::date`;

/**
 * L2 速率限制：拿一枚 token。回 true ＝ 放行。
 *
 * ★★★ ⚠️ 這句 SQL 裡的補充算式，與 `limits.ts` 的 `bucketAfterRefill()` 是同一個公式。★★★
 *   改一邊就要改另一邊——理由與代價寫在那個函式的註解裡（一句話：
 *   原子性與資料庫時鐘這兩個要求，逼得算式非在 SQL 裡不可）。
 *
 * 邏輯：
 *   第一次出現   → 建立桶子，存量 = burst - 1（這一則已經扣掉）
 *   已經有桶子   → 先按經過時間補充（上限 burst），夠一則就扣一則並回傳
 *                  不夠 → `setWhere` 不成立 → PostgreSQL 不回傳該列 → 擋下
 */
export async function takeRateToken(playerId: string, cfg: BucketConfig): Promise<boolean> {
	const key = `chat:${playerId}`;

	// 補充後的存量。寫成一個變數，是為了讓 set 與 setWhere 用的是同一段算式——
	// 兩處各寫一次的話，某天改了其中一個就會變成「判斷用 A、寫入用 B」。
	const afterRefill = sql`least(
		${cfg.burst}::real,
		${rateBuckets.tokens} + extract(epoch from (now() - ${rateBuckets.refilledAt})) * ${cfg.perMinute} / 60.0
	)`;

	const rows = await db
		.insert(rateBuckets)
		.values({ key, tokens: cfg.burst - 1, refilledAt: sql`now()` })
		.onConflictDoUpdate({
			target: rateBuckets.key,
			set: { tokens: sql`${afterRefill} - 1`, refilledAt: sql`now()` },
			setWhere: sql`${afterRefill} >= 1`
		})
		.returning({ tokens: rateBuckets.tokens });

	return rows.length > 0;
}

/**
 * L3 每玩家每日：扣一則。回 true ＝ 放行。
 *
 * `setWhere` 是那個「原子」的所在：只有在**今天還沒用滿**時才加一，
 * 條件不成立就不回傳列。跟 `markFirstMet()` 的形狀一模一樣。
 */
export async function takeDailyQuota(playerId: string, limit: number): Promise<boolean> {
	const rows = await db
		.insert(usagePlayerDaily)
		.values({ playerId, day: TAIPEI_TODAY, messageCount: 1 })
		.onConflictDoUpdate({
			target: [usagePlayerDaily.playerId, usagePlayerDaily.day],
			set: { messageCount: sql`${usagePlayerDaily.messageCount} + 1` },
			setWhere: sql`${usagePlayerDaily.messageCount} < ${limit}`
		})
		.returning({ messageCount: usagePlayerDaily.messageCount });

	return rows.length > 0;
}

/**
 * L4 全域每日：今天已經花了多少美元。
 *
 * ★ 這一支是**唯讀**的，因為 L4 是「事前檢查、事後累加」（SDD §10.1）——
 *   成本要等 AI 回應裡的 `usage` 才算得出來，不可能在呼叫之前就扣。
 *   代價是並發時最多超支「並發數 × 單次成本」，約幾美分；
 *   用悲觀鎖換那幾美分不划算。
 *
 * ⚠️ `est_cost_usd` 是 numeric，Drizzle 會回**字串**（JS 的 number 存不下
 *   任意精度的十進位）。這裡轉成 number 是因為只拿來跟預算比大小，
 *   誤差在美元的第十位以下——但**累加一定要在資料庫裡做**（見 addUsage），
 *   不能讀出來加完再寫回去。
 */
export async function globalSpentTodayUsd(): Promise<number> {
	const rows = await db
		.select({ spent: usageGlobalDaily.estCostUsd })
		.from(usageGlobalDaily)
		.where(sql`${usageGlobalDaily.day} = ${TAIPEI_TODAY}`);

	return rows.length > 0 ? Number(rows[0].spent) : 0;
}

/**
 * 呼叫成功之後，把實際用量記回兩張表。
 *
 * ★ 累加在資料庫裡做（`est_cost_usd + $x`），不是讀出來加完再寫回去——
 *   後者在並發時會互相覆蓋，而且**覆蓋掉的部分永遠找不回來**：
 *   L4 是唯一的帳單防線，它底下的數字少算了，防線就是虛的。
 *
 * ⚠️ 這一支不回報成功與否。用量記錄失敗不該讓玩家收不到已經生成好的回應——
 *   呼叫端（speak.ts）在 try/catch 裡叫它，記不下來就記一行 log。
 */
export async function addUsage(
	playerId: string,
	usage: { inputTokens: number; outputTokens: number },
	costUsd: number
): Promise<void> {
	// 玩家那一張：則數在 takeDailyQuota 已經加過了，這裡只補 token 數。
	await db
		.insert(usagePlayerDaily)
		.values({
			playerId,
			day: TAIPEI_TODAY,
			messageCount: 0,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens
		})
		.onConflictDoUpdate({
			target: [usagePlayerDaily.playerId, usagePlayerDaily.day],
			set: {
				inputTokens: sql`${usagePlayerDaily.inputTokens} + ${usage.inputTokens}`,
				outputTokens: sql`${usagePlayerDaily.outputTokens} + ${usage.outputTokens}`
			}
		});

	// 全域那一張：則數與成本都在這裡加。
	await db
		.insert(usageGlobalDaily)
		.values({
			day: TAIPEI_TODAY,
			messageCount: 1,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			estCostUsd: String(costUsd)
		})
		.onConflictDoUpdate({
			target: usageGlobalDaily.day,
			set: {
				messageCount: sql`${usageGlobalDaily.messageCount} + 1`,
				inputTokens: sql`${usageGlobalDaily.inputTokens} + ${usage.inputTokens}`,
				outputTokens: sql`${usageGlobalDaily.outputTokens} + ${usage.outputTokens}`,
				estCostUsd: sql`${usageGlobalDaily.estCostUsd} + ${String(costUsd)}::numeric`
			}
		});
}
