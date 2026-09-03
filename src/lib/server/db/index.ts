/**
 * 資料庫連線 —— Drizzle ＋ postgres-js。
 *
 * 給 Python 背景的對照：Drizzle ≈ SQLAlchemy 的 declarative 寫法，
 * 這個檔案相當於建立 engine 與 session factory 的那一段。
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = postgres(env.DATABASE_URL);

export const db = drizzle(client, { schema });

/**
 * ★★★ 關機時要把連線池收掉。★★★
 *
 * ⚠️ 2026-09-03 實際踩到：第一次部署後 `systemctl restart` 卡了 90 秒，
 *    最後被 SIGKILL 強制砍掉（`State 'stop-sigterm' timed out`）。
 *
 * 原因是 adapter-node 收到 SIGTERM 後只做兩件事：關掉 HTTP 伺服器、
 * 然後**讓行程自然結束**。但 postgres-js 的連線池是在模組載入時建立的，
 * 它一直掛在事件迴圈上——事件迴圈不空，node 就永遠不會「自然結束」。
 *
 * 症狀很容易被誤判成「伺服器關不掉」，但真正卡住的是資料庫連線。
 * 每次部署都要多等 90 秒，而且是被硬砍的：處理到一半的請求會被切斷。
 *
 * `sveltekit:shutdown` 是 adapter-node 提供的事件，在伺服器停止接受新連線
 * 之後、行程結束之前發出。在這裡收掉連線池，行程就會乾淨地退出。
 *
 * ★ 這個事件只有 adapter-node 的執行期會發出。開發模式與測試不會觸發，
 *   註冊了也沒有副作用——所以不需要用環境判斷把它包起來。
 */
process.on('sveltekit:shutdown', async () => {
	// timeout 5 秒：等進行中的查詢做完，逾時就強制關閉。
	// 比 systemd 的 TimeoutStopSec 短，才輪得到我們自己收尾。
	await client.end({ timeout: 5 });
});
