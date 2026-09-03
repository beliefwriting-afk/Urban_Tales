/**
 * API 的煙霧測試（身分 ＋ 到場判定） —— 對「正在跑的 dev server」發真的 HTTP 請求。
 *
 * ★ 為什麼需要它，而不是只靠單元測試：
 *   `session.spec.ts` 測的是簽章邏輯本身（純函式）。這支測的是**接線**——
 *   hooks.server.ts 有沒有真的去驗、閘門有沒有真的擋住圖磚、cookie 屬性
 *   有沒有設對。這些在單元測試裡看不到，在瀏覽器裡要開 DevTools 手動戳，
 *   而手動戳的東西下次改壞了不會有人發現。
 *
 * ★ 為什麼可以用程式偽造 cookie，瀏覽器卻不行：
 *   `Cookie` 是瀏覽器的 forbidden header，網頁的 JavaScript 改不了它
 *   （HttpOnly 更是連讀都不行）。Node 沒有這個限制，所以「拿一張被竄改的
 *   憑證去敲門」這種測試只能在這裡做。
 *
 * ⚠️ 這支**不進 `npm run verify`**：它需要 dev server 正在跑，而 CI 沒有。
 *    把需要外部服務的測試混進 verify，會讓 verify 變成一個時好時壞的東西，
 *    然後大家開始忽略它——那比沒有 verify 更糟。
 *
 * 跑法：先 `npm run dev`，另開一個終端機 `npm run smoke:api`
 *
 * 給 Python 背景的對照：
 *   這支等同你會用 requests 寫的整合測試腳本。
 *   `??` 是「左邊是 null/undefined 才取右邊」，≈ Python 的 `x if x is not None else y`
 *   （注意不是 `or`——`0` 和 `''` 在這裡會被保留，`or` 會把它們當假值換掉）。
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:5173';

/** 對正式站跑時，有幾條檢查的預期是相反的（Secure、除錯 header） */
const isProd = BASE.startsWith('https://');
const COOKIE = 'ut_player';

/**
 * 撈一個設定值：先看行程的環境變數，再退回 `.env`。
 *
 * ★ 兩層是為了讓這支腳本在兩個地方都跑得動：
 *     本機開發 —— 值在 `.env` 裡
 *     正式 VM —— 沒有 `.env`，值在 /etc/urban-tales/urban-tales.env，
 *                 由使用者 `source` 進環境變數後執行
 *
 * 刻意自己解析而不裝 dotenv —— 只為了一行設定不值得多一個依賴。
 */
function readEnv(key: string): string | null {
	if (process.env[key]) return process.env[key];
	try {
		const line = readFileSync('.env', 'utf8')
			.split(/\r?\n/)
			.find((l) => l.trimStart().startsWith(`${key}=`));
		return line ? line.slice(line.indexOf('=') + 1).trim() : null;
	} catch {
		// 沒有 .env 不是錯誤（正式環境本來就沒有）
		return null;
	}
}

/** 從一堆 Set-Cookie 裡找出我們那一張，回傳整段（含屬性） */
function setCookieOf(res: Response): string | null {
	return res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`)) ?? null;
}

function valueOf(setCookie: string): string {
	return setCookie.slice(`${COOKIE}=`.length).split(';')[0];
}

/**
 * 從一張 token 讀出玩家 id，**不驗簽章**。
 *
 * ★ 這在正式程式碼裡是嚴重錯誤，在這裡是刻意的：測試腳本沒有金鑰，
 *   它要的只是「剛剛那張 cookie 指向誰」好在結束時把測試資料清掉。
 *   任何會影響玩家的判斷都必須走 verifyPlayerToken。
 */
function subOf(token: string): string | null {
	try {
		const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
		return typeof payload.sub === 'string' ? payload.sub : null;
	} catch {
		return null;
	}
}

/** 這一輪跑測試時建立出來的玩家，結束時要自己收拾掉 */
const createdIds = new Set<string>();

function remember(setCookie: string | null) {
	if (!setCookie) return;
	const id = subOf(valueOf(setCookie));
	if (id) createdIds.add(id);
}

/**
 * 一個「導覽請求」該長什麼樣。
 *
 * ⚠️ 踩過的坑：本來只送 `sec-fetch-mode: navigate`，結果 Node 的 fetch 會把
 *    `Sec-` 開頭的 header 整個丟掉——那是瀏覽器專屬的 forbidden header，
 *    undici 照規格不讓程式偽造。於是請求變成「沒有 sec-fetch-mode」，
 *    hooks 退回去看 Accept，而 Node 預設送的是萬用 Accept（不含 text/html），
 *    就被判成子資源了。
 *
 *    所以這裡靠 `Accept: text/html` 這條退路——它剛好也證明了那條退路是活的
 *    （很舊的瀏覽器、curl 走的就是它）。
 */
const NAV_HEADERS = { accept: 'text/html,application/xhtml+xml' };

/** 子資源（圖磚）該長什麼樣：不要 text/html，才會走到「不需要身分」那條 */
const SUB_HEADERS = { accept: 'image/png,image/*' };

let failures = 0;

function check(label: string, ok: boolean, detail = '') {
	console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `  —— ${detail}` : ''}`);
	if (!ok) failures++;
}

async function main() {
	console.log(`對 ${BASE} 做 API 檢查\n`);
	console.log('── 身分 ──');

	// ── 1. 沒有 cookie → 應該發一張新的 ─────────────────────────
	const first = await fetch(BASE, { headers: NAV_HEADERS });
	const firstSet = setCookieOf(first);

	// hooks 自己回報它走了哪一條路（dev 專用 header）。
	// 沒有這個 header ＝ 請求根本沒經過 hooks.server.ts。
	// ★ x-ut-identity 是 dev 專用的除錯 header，正式環境刻意不發
	//   （回應 header 是公開資訊，沒必要把內部流程講給所有人聽）。
	//   所以它「不存在」在正式站是正確行為，不是失敗。
	const how = first.headers.get('x-ut-identity');
	if (isProd) {
		console.log('   （正式環境不發 x-ut-identity 除錯 header，這一項跳過）');
	} else {
		check(
			'請求有經過 hooks.server.ts',
			how !== null,
			how
				? `走的是 ${how}`
				: '★ 沒有 x-ut-identity —— hooks 沒被載入，或 dev server 是舊的，重開 npm run dev'
		);
	}
	const dbg = first.headers.get('x-ut-debug');
	if (dbg) console.log(`   hooks 當時看到的：${dbg}`);
	if (how !== null && how !== 'created') {
		check('第一次應該走 created', false, `實際是 ${how}`);
	}
	check(
		'沒有 cookie 時會發身分',
		firstSet !== null,
		firstSet ? '' : `完全沒有 Set-Cookie（HTTP ${first.status}）`
	);
	if (!firstSet) {
		// 診斷用：失敗時把伺服器實際回了什麼印出來，省一輪來回
		console.log('\n   回應 headers：');
		for (const [k, v] of first.headers) console.log(`     ${k}: ${v}`);
		console.log(`\n   回應開頭：${(await first.text()).slice(0, 300)}`);
		process.exitCode = 1;
		return;
	}

	remember(firstSet);
	const token = valueOf(firstSet);

	// cookie 屬性。HttpOnly 少了就等於 XSS 可以直接把身分偷走
	check('HttpOnly 有設', /HttpOnly/i.test(firstSet));
	check('SameSite=Lax 有設', /SameSite=Lax/i.test(firstSet));
	check('Path=/ 有設', /Path=\//i.test(firstSet));
	// ★ 同一條規則，兩個環境的預期相反：
	//     http（本機）—— 不能有 Secure，否則瀏覽器會直接把 cookie 丟掉
	//     https（正式）—— 必須有 Secure，否則 cookie 會在明文連線裡裸奔
	//   程式碼裡是 `secure: !dev` 一行，這裡就要跟著協定翻轉，不能寫死。
	const hasSecure = /;\s*Secure/i.test(firstSet);
	check(
		isProd ? '正式站有設 Secure' : '本機不設 Secure（http 下設了會被瀏覽器丟掉）',
		hasSecure === isProd,
		hasSecure === isProd ? '' : isProd ? '★ https 卻沒有 Secure' : '★ http 卻設了 Secure'
	);

	// ── 2. 帶著同一張 cookie → 不該重發 ─────────────────────────
	const second = await fetch(BASE, {
		headers: { ...NAV_HEADERS, cookie: `${COOKIE}=${token}` }
	});
	check(
		'合法 cookie 會被接受，不重發新身分',
		setCookieOf(second) === null,
		setCookieOf(second) ? '又發了一張，表示驗證沒過或每次都重建玩家' : ''
	);

	// ── 3. 竄改內容 → 必須重發 ──────────────────────────────────
	//
	// 動 payload 的最後一個字元，簽章就對不上。這一條若失敗，
	// 任何人都可以自己編一張 cookie 冒充別的玩家。
	const [h, p, s] = token.split('.');
	const tampered = `${h}.${p.slice(0, -1)}${p.slice(-1) === 'A' ? 'B' : 'A'}.${s}`;
	const third = await fetch(BASE, {
		headers: { ...NAV_HEADERS, cookie: `${COOKIE}=${tampered}` }
	});
	const thirdSet = setCookieOf(third);
	remember(thirdSet);
	check(
		'被竄改的 cookie 會被拒絕並重發',
		thirdSet !== null && valueOf(thirdSet) !== tampered,
		thirdSet === null ? '★ 嚴重：竄改過的憑證被接受了' : ''
	);

	// ── 4. 亂編的字串 → 不能變成 500 ────────────────────────────
	//
	// ⚠️ 假 token 必須是純 ASCII。HTTP header 的值是 ByteString，
	//    塞中文字進去會在送出前就被 Node 擋下（踩過一次）。
	const garbage = await fetch(BASE, {
		headers: { ...NAV_HEADERS, cookie: `${COOKIE}=not-a-token-at-all` }
	});
	remember(setCookieOf(garbage));
	check('亂編的 cookie 不會讓伺服器爆掉', garbage.status === 200, `HTTP ${garbage.status}`);

	// ── 4b. 不存在的路徑不該建立身分 ────────────────────────────
	//
	// ★ 這條擋的是掃描器。公開 IP 每天都會被戳 /about、/login.action、/.env……
	//   那些請求帶著 Accept: text/html，若照收就會在 players 表留下一列。
	//   2026-09-03 上線十一分鐘實測被建了 18 列，全是掃描器。
	const ghost = await fetch(`${BASE}/this-route-does-not-exist`, { headers: NAV_HEADERS });
	check(
		'★ 不存在的路徑不會建立玩家',
		setCookieOf(ghost) === null,
		setCookieOf(ghost) ? '★ 掃描器每戳一次就多一列玩家' : `HTTP ${ghost.status}`
	);

	// ── 5. 圖磚不走身分流程 ─────────────────────────────────────
	//
	// 這道閘門若失效，玩家第一次開頁時十幾個並行請求會各自建立一個玩家。
	const tile = await fetch(`${BASE}/map/far/0_0.png`, { headers: SUB_HEADERS });
	check(
		'圖磚不會觸發身分建立',
		setCookieOf(tile) === null,
		setCookieOf(tile) ? '★ 閘門失效：每張圖磚都會建立一個玩家' : `HTTP ${tile.status}`
	);

	// ══ 到場判定 ══════════════════════════════════════════════
	console.log('\n── 到場判定 ──');

	const auth = { ...NAV_HEADERS, cookie: `${COOKIE}=${token}` };
	const post = (body: unknown, extra: Record<string, string> = {}) =>
		fetch(`${BASE}/api/presence`, {
			method: 'POST',
			headers: { ...auth, ...extra, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});

	// 龍山寺門口。判定半徑 50 公尺，站在正中心一定進得去
	const inside = await post({ lat: 25.0372, lng: 121.4997, accuracy: 10 });
	const insideBody = await inside.json();
	check(
		'站在龍山寺 → 拿得到在場憑證',
		insideBody.status === 'inside' && insideBody.siteId === 'longshan-temple' && !!insideBody.token,
		`回了 ${JSON.stringify(insideBody).slice(0, 120)}`
	);

	if (insideBody.token) {
		// ★ 憑證裡不能有座標（企劃書 §7）
		const payload = JSON.parse(
			Buffer.from(String(insideBody.token).split('.')[1], 'base64url').toString()
		);
		check(
			'★ 在場憑證裡沒有座標',
			!/lat|lng|accuracy|coord/i.test(JSON.stringify(payload)),
			`payload 欄位：${Object.keys(payload).join(', ')}`
		);
		check('憑證的 mode 是 field', payload.mode === 'field', `實際是 ${payload.mode}`);
	}

	// 台北車站。離最近的景點好幾公里
	const outside = await post({ lat: 25.0478, lng: 121.517, accuracy: 10 });
	const outsideBody = await outside.json();
	check(
		'站在台北車站 → 拿不到憑證',
		outsideBody.status === 'outside' && !outsideBody.token,
		`最近的是 ${outsideBody.nearestSiteId}，${outsideBody.distanceM} 公尺`
	);

	// 精度爛到 500 公尺：不判定，也不說「你在附近」——那句話也是猜的
	const fuzzy = await post({ lat: 25.0372, lng: 121.4997, accuracy: 500 });
	const fuzzyBody = await fuzzy.json();
	check(
		'定位精度太差 → 不判定',
		fuzzyBody.status === 'unreliable',
		`回了 status=${fuzzyBody.status}`
	);

	// ★ 沒有展示模式卻想直接指定景點 —— 這正是「硬到場」要擋的
	const sneak = await post({ siteId: 'longshan-temple' });
	check(
		'★ 沒開展示模式就指定景點 → 被拒絕',
		sneak.status === 403,
		`HTTP ${sneak.status}（應該是 403）`
	);

	// ══ 展示模式 ══════════════════════════════════════════════
	console.log('\n── 展示模式 ──');

	const wrongKey = await fetch(`${BASE}/demo?key=definitely-wrong`, {
		headers: auth,
		redirect: 'manual'
	});
	check(
		'密語錯 → 拿不到展示模式 cookie',
		!wrongKey.headers.getSetCookie().some((c) => c.startsWith('ut_demo=')),
		'而且不該有任何錯誤提示 —— 錯誤訊息會告訴人「這裡確實有一道門」'
	);

	const passphrase = readEnv('DEMO_PASSPHRASE');
	if (!passphrase || passphrase.length < 4) {
		console.log('⏭️  .env 的 DEMO_PASSPHRASE 還是佔位值，跳過展示模式的其餘檢查');
	} else {
		const right = await fetch(`${BASE}/demo?key=${encodeURIComponent(passphrase)}`, {
			headers: auth,
			redirect: 'manual'
		});
		const demoCookie = right.headers.getSetCookie().find((c) => c.startsWith('ut_demo='));
		check('密語對 → 拿到展示模式 cookie', !!demoCookie, `HTTP ${right.status}`);

		if (demoCookie) {
			const demoValue = demoCookie.slice('ut_demo='.length).split(';')[0];
			const demoPresence = await post(
				{ siteId: 'bopiliao' },
				{ cookie: `${COOKIE}=${token}; ut_demo=${demoValue}` }
			);
			const demoBody = await demoPresence.json();
			check(
				'展示模式 → 不用座標也進得去',
				demoBody.status === 'inside' && demoBody.mode === 'demo',
				`回了 ${JSON.stringify(demoBody).slice(0, 100)}`
			);

			const nowhere = await post(
				{ siteId: '不存在的景點' },
				{ cookie: `${COOKIE}=${token}; ut_demo=${demoValue}` }
			);
			check('展示模式也不能指定不存在的景點', nowhere.status === 404, `HTTP ${nowhere.status}`);
		}
	}

	console.log('');

	// ── 6. 資料庫實際狀況 ───────────────────────────────────────
	const url = readEnv('DATABASE_URL');
	if (!url) {
		console.log('\n（.env 沒有 DATABASE_URL，跳過資料庫檢查）');
	} else {
		const postgres = (await import('postgres')).default;
		const sql = postgres(url);
		try {
			const rows = await sql<
				{ id: string; created_at: Date; last_seen_at: Date }[]
			>`SELECT id, created_at, last_seen_at FROM players ORDER BY created_at`;
			console.log(`\n players 共 ${rows.length} 列：`);
			for (const r of rows) {
				const mine = createdIds.has(r.id) ? '  ← 這輪測試建的' : '';
				console.log(
					`   ${r.id}  建立 ${r.created_at.toISOString()}  最後出現 ${r.last_seen_at.toISOString()}${mine}`
				);
			}

			// ★ 自己清自己。測試腳本每跑一次就在正式資料表留下三個假玩家的話，
			//   跑不到十次就沒人分得出哪一列是真的玩過遊戲的人。
			const ids = [...createdIds];
			if (ids.length > 0) {
				await sql`DELETE FROM players WHERE id = ANY(${ids}::uuid[])`;
				console.log(`\n 已清掉這輪測試建立的 ${ids.length} 個玩家。`);
			}

			// ── 一次性大掃除（要明確加旗標才會執行）─────────────────
			//
			// ★ 安全閘門：清空玩家表是破壞性操作，不能因為「跑個測試」就順手做掉。
			//   之前幾輪測試留下的殘骸用這個清；正式環境永遠不該跑到這裡
			//   （它連的是 .env 的 DATABASE_URL，上線後那是正式資料庫）。
			if (process.argv.includes('--purge')) {
				const rest = rows.length - ids.length;
				if (rest > 0) {
					await sql`DELETE FROM players`;
					console.log(` --purge：連同先前殘留的 ${rest} 個玩家一起清空了。`);
				} else {
					console.log(' --purge：沒有其他殘留，不用清。');
				}
			} else if (rows.length - ids.length > 0) {
				console.log(
					` 還有 ${rows.length - ids.length} 個先前殘留的玩家。要一起清掉就跑 npm run smoke:auth -- --purge`
				);
			}
		} finally {
			await sql.end();
		}
	}

	console.log(failures === 0 ? '\n全部通過。' : `\n有 ${failures} 條沒過。`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
	console.error('\n❌ 跑不起來：', e instanceof Error ? e.message : e);
	console.error('   dev server 有在跑嗎？（npm run dev）');
	process.exitCode = 1;
});
