/**
 * 資料庫連線診斷 —— `npm run db:ping`
 *
 * ★ 為什麼需要這支：drizzle 把底層錯誤包起來了。連線失敗時你在瀏覽器看到的是
 *
 *     Error: Failed query: insert into "players" (...) values (...)
 *
 *   ——完全看不出到底是「連不上」「密碼錯」還是「表不存在」。三種原因、
 *   三種完全不同的修法，而錯誤訊息一視同仁。每次都要重猜一輪。
 *
 *   這支直接用 postgres-js 連，把原始錯誤的 `code` 印出來並附上對照，
 *   然後列出資料表與筆數。**猜測換成一行指令。**
 *
 * ⚠️ 這支不進 `npm run verify`——它需要外部服務（同 smoke:api 的理由，見那個檔頭）。
 *
 * 給 Python 背景的對照：≈ 你會寫的 `psycopg.connect()` 然後 `SELECT 1` 那種確認腳本。
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/** 撈設定：先看行程環境變數，再退回 .env（同 smoke-api.ts） */
function readEnv(key: string): string | null {
	if (process.env[key]) return process.env[key];
	try {
		const line = readFileSync('.env', 'utf8')
			.split(/\r?\n/)
			.find((l) => l.trimStart().startsWith(`${key}=`));
		return line ? line.slice(line.indexOf('=') + 1).trim() : null;
	} catch {
		return null;
	}
}

/**
 * 常見錯誤碼 → 人話。
 *
 * ★ 每一條都要講「怎麼修」，不是只講「哪裡錯」。
 *   一個只說 ECONNREFUSED 的訊息，跟沒有訊息差不多。
 */
const HINTS: Record<string, string> = {
	ECONNREFUSED:
		'連不上 —— SSH 通道沒開（電腦睡過會安靜地斷掉，-N 的終端機不會噴訊息）。\n' +
		'    ssh -i C:\\Users\\erics\\.ssh\\gcp_larp -N -L 55432:127.0.0.1:5432 al06120001@34.41.151.184',
	ETIMEDOUT: '連得上但沒回應 —— 通道還在但另一端的 postgres 沒跑，或 VM 關機了。',
	'28P01':
		'密碼錯 —— 從 VM 重抄一次：\n' +
		'    ssh <金鑰> <帳號>@<IP> "grep \'^DATABASE_URL=\' /etc/urban-tales/urban-tales.env"',
	'3D000': '資料庫不存在 —— 連線字串最後那段的資料庫名打錯了。',
	'42P01': '連得上、也登入了，但**表不存在** —— 跑 npm run db:migrate 套用 migration。'
};

/** 連線字串裡的密碼絕不印出來 */
function redact(url: string): string {
	return url.replace(/:\/\/[^@]*@/, '://***@');
}

async function main() {
	const url = readEnv('DATABASE_URL');
	if (!url) {
		console.error('❌ 找不到 DATABASE_URL（環境變數與 .env 都沒有）');
		process.exitCode = 1;
		return;
	}

	console.log(`連線目標：${redact(url)}\n`);

	// connect_timeout 短一點：通道沒開時要「馬上」知道，不要等 30 秒
	const sql = postgres(url, { connect_timeout: 5, max: 1 });

	try {
		const [{ now, db, user }] = await sql<{ now: Date; db: string; user: string }[]>`
			SELECT now() AS now, current_database() AS db, current_user AS user
		`;
		console.log(`✅ 連上了`);
		console.log(`   資料庫 ${db}／使用者 ${user}`);
		// ★ 這是「資料庫的時鐘」。全站只認它，不要用 new Date()（見 HANDOFF §13.4 ①）
		console.log(`   資料庫時鐘 ${now.toISOString()}`);

		const tables = await sql<{ name: string }[]>`
			SELECT tablename AS name FROM pg_tables
			WHERE schemaname = 'public' ORDER BY tablename
		`;

		if (tables.length === 0) {
			console.log('\n⚠️  public schema 一張表都沒有 —— 還沒跑過 migration。');
			console.log('    npm run db:migrate');
			process.exitCode = 1;
			return;
		}

		console.log(`\n資料表 ${tables.length} 張：`);
		for (const t of tables) {
			// 資料表名不能用參數綁定，只能用識別字內插（sql(...) 會加引號跳脫）
			const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(t.name)}`;
			console.log(`   ${t.name.padEnd(22)} ${n} 列`);
		}

		// schema.ts 定義的七張表都在不在
		const EXPECTED = [
			'players',
			'player_site_state',
			'player_cards',
			'chat_turns',
			'usage_player_daily',
			'usage_global_daily',
			'rate_buckets'
		];
		const have = new Set(tables.map((t) => t.name));
		const missing = EXPECTED.filter((t) => !have.has(t));
		if (missing.length > 0) {
			console.log(`\n⚠️  schema.ts 有、資料庫沒有：${missing.join('、')}`);
			console.log('    npm run db:migrate');
			process.exitCode = 1;
		} else {
			console.log('\n✅ schema.ts 的七張表都在。');
		}
	} catch (e) {
		const err = e as { code?: string; message?: string };
		console.error(`❌ 連不上：${err.message ?? e}`);
		if (err.code) {
			console.error(`\n   錯誤碼 ${err.code}`);
			const hint = HINTS[err.code];
			if (hint) console.error(`   ${hint}`);
			else console.error('   （沒有對照，把這個碼查一下 PostgreSQL 文件）');
		}
		process.exitCode = 1;
	} finally {
		await sql.end();
	}
}

main();
