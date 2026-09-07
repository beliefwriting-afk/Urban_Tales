/**
 * GET /api/me —— 這個玩家自己的一點點資料。
 *
 * ★ 為什麼需要這支（切片 7 加的）：
 *
 *   **展示模式的真相是一張 HttpOnly cookie，前端讀不到。**
 *   而 SDD §5.4 要求展示模式全程顯示標示條——前端必須知道自己在不在展示模式，
 *   否則那個標示條做不出來。
 *
 *   ⚠️ 這件事**不能靠前端自己記一個布林值**。切片 7 要刪掉的正是那個布林值
 *   （HANDOFF §14.8 第 2 項）：前端有能力自己宣告「我是展示模式」，
 *   等於那道門不存在。所以答案只能由伺服器給。
 *
 * ★ 為什麼不塞進 `GET /api/sites`：那支是完全公開、跟身分無關的回應，
 *   而且掛著五分鐘的瀏覽器快取。推一個「跟誰登入有關」的欄位進去，
 *   會讓那個快取變成一顆定時炸彈（A 的展示模式狀態被 B 讀到）。
 *
 * ⚠️ 這支端點**不可以快取**。
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

import { deriveDemoKey, isDemoSession, DEMO_COOKIE } from '$lib/server/auth/demo';
import { getPlayerCreatedAt, guestLabel } from '$lib/server/auth/profile';

let demoKey: Uint8Array | null = null;

export const GET: RequestHandler = async ({ locals, cookies }) => {
	if (!locals.playerId) {
		return json({ code: 'no_identity', message: '沒有身分' }, { status: 401 });
	}

	demoKey ??= deriveDemoKey(env.SESSION_SECRET);

	const [createdAt, demoMode] = await Promise.all([
		getPlayerCreatedAt(locals.playerId),
		isDemoSession(cookies.get(DEMO_COOKIE), demoKey)
	]);

	return json(
		{
			/** 顯示用的稱呼，不是識別碼 */
			label: guestLabel(locals.playerId),
			createdAt: createdAt?.toISOString() ?? null,
			/** ★ 展示模式的唯一真相。前端只讀不寫 */
			demoMode
		},
		// 這一份跟「是誰在問」有關，任何一層快取都不該留它。
		{ headers: { 'cache-control': 'no-store' } }
	);
};
