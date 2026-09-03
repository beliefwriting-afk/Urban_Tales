/**
 * 每個請求的第一站 —— SDD §4.1「訪客身分」。
 *
 * 給 Python 背景的對照：
 *   這個檔案等同 FastAPI 的 middleware，或 Django 的 MIDDLEWARE。
 *   `resolve(event)` 就是「呼叫下一層」，跟 Starlette 的 `call_next(request)`
 *   一模一樣。`event.locals` ≈ `request.state`：掛在這一次請求上的暫存區，
 *   下游的 +page.server.ts 與 API 端點都讀得到。
 *
 * ★★★ 這是全站唯一讀 SESSION_SECRET 的地方。★★★
 *   簽發與驗證的邏輯在 $lib/server/auth/session，那個檔案是純的（不讀環境變數），
 *   所以測試不必架環境。金鑰只在這裡被取出來一次。
 */
import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { eq, sql } from 'drizzle-orm';

import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema';
import {
	PLAYER_COOKIE,
	COOKIE_MAX_AGE_SECONDS,
	signPlayerToken,
	verifyPlayerToken,
	toKey,
	needsIdentity
} from '$lib/server/auth/session';

/**
 * 金鑰只換算一次。
 *
 * ★ 不在模組頂層就換算，是為了讓「密鑰沒設好」在第一個請求時才炸——
 *   頂層 throw 會讓整個模組載入失敗，錯誤訊息會被包在一層看不懂的
 *   模組解析錯誤裡，很難查。
 *
 * `??=` ≈ Python 的 `if x is None: x = ...`
 */
let cachedKey: Uint8Array | null = null;
function sessionKey(): Uint8Array {
	cachedKey ??= toKey(env.SESSION_SECRET);
	return cachedKey;
}

/**
 * 開發時的除錯標記：這個請求走了身分流程的哪一條路。
 *
 * ★ 只在 dev 開，正式環境不會出現——回應 header 是公開資訊，
 *   把內部流程講給所有人聽沒有必要。
 *
 * 值的意思：
 *   skipped  ＝ 判定為子資源（圖磚、CSS），沒碰資料庫
 *   existing ＝ 帶著合法 cookie 進來，認得出是誰
 *   created  ＝ 沒有身分或憑證不合格，剛剛發了一張新的
 */
function stamp(response: Response, how: 'skipped' | 'existing' | 'created'): Response {
	if (dev) response.headers.set('x-ut-identity', how);
	return response;
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.playerId = null;

	// ★★★ 沒有對應路由的請求不建立身分。★★★
	//
	// ⚠️ 2026-09-03 上線後實測：十一分鐘內 `players` 多了 18 列，全是掃描器建的。
	//    公開 IP 每天都會被掃 `/about`、`/login.action`、`/.env`、`/.git/config`……
	//    這些路徑不存在、回的是 404，但只要帶著 `Accept: text/html`
	//    就會通過 needsIdentity 拿到一張 cookie 與一列玩家。
	//
	// `event.route.id` 在 handle 裡就可以讀，比對不到任何路由時是 null——
	// 也就是「這個請求最後會是 404」。那種請求不該在資料庫留下任何東西。
	//
	// ★ 這個判斷刻意不寫進 needsIdentity：那是一個純函式，只看得到路徑與 header，
	//   看不到路由表。硬要塞進去就得把路由清單複製一份給它維護，那才是真的會漂移。
	if (event.route.id === null) {
		return stamp(await resolve(event), 'skipped');
	}

	if (!needsIdentity(event.url.pathname, event.request.headers)) {
		const skipped = stamp(await resolve(event), 'skipped');
		if (dev) {
			// 診斷用：判定成子資源時，把當初依據的兩個值原樣吐出來
			skipped.headers.set(
				'x-ut-debug',
				`path=${event.url.pathname} accept=${event.request.headers.get('accept')}`
			);
		}
		return skipped;
	}

	const raw = event.cookies.get(PLAYER_COOKIE);
	let playerId = raw ? await verifyPlayerToken(raw, sessionKey()) : null;

	if (playerId) {
		// ★ 一次查詢做兩件事：確認這個玩家真的還在，順便更新 last_seen_at。
		//
		//   為什麼要確認「還在」：開發期把資料庫清掉之後，瀏覽器裡的 cookie
		//   會變成孤兒——驗章通過、但指向一個不存在的玩家。之後任何寫入都會
		//   撞外鍵錯誤，而且錯誤訊息完全看不出根因。這裡讓它退化成「沒有身分」，
		//   自然重新建立一個。
		//
		//   為什麼不需要節流：上面的閘門已經把圖磚擋掉了，會走到這裡的只有
		//   開頁與 API 呼叫，一次遊玩不過幾十次。為了省這幾次寫入而多一套
		//   節流邏輯，是拿複雜度換不存在的效能問題。
		//   ★ 時間一律取資料庫的 now()，不要用 new Date()。
		//     `new Date()` 是**這台伺服器**的時鐘，而 created_at 的預設值是
		//     **資料庫**的時鐘。兩者只要差幾毫秒，就會出現「最後出現時間早於
		//     建立時間」這種看起來像鬧鬼的資料（實測差了 174ms）。
		//     之後每日額度重置與憑證效期都要比時間，混用兩個時鐘會變成
		//     「額度沒到隔天卻重置了」這類查不出根因的 bug。全站只認一個時鐘。
		const [row] = await db
			.update(players)
			.set({ lastSeenAt: sql`now()` })
			.where(eq(players.id, playerId))
			.returning({ id: players.id });

		if (!row) playerId = null;
	}

	let created = false;

	if (!playerId) {
		created = true;
		const [row] = await db.insert(players).values({}).returning({ id: players.id });
		playerId = row.id;

		event.cookies.set(PLAYER_COOKIE, await signPlayerToken(playerId, sessionKey()), {
			path: '/',
			httpOnly: true, // JavaScript 讀不到，XSS 也偷不走
			sameSite: 'lax', // 別的網站發過來的請求不帶這張 cookie（擋 CSRF）
			// ★ 本機是 http://localhost，secure cookie 不會被瀏覽器保存。
			//   上線走 https 時一定要是 true，否則 cookie 會在明文連線裡裸奔。
			secure: !dev,
			maxAge: COOKIE_MAX_AGE_SECONDS
		});
	}

	event.locals.playerId = playerId;
	return stamp(await resolve(event), created ? 'created' : 'existing');
};
