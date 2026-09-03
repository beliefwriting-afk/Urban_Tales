/**
 * GET /demo?key=<通關密語> —— 開啟展示模式（SDD §5.4）。
 *
 * 密語對了就發一張兩小時的 cookie，然後把人導回首頁。
 * 密語錯了、或沒設定 DEMO_PASSPHRASE，一律導回首頁**不給任何提示**——
 * 錯誤訊息會告訴嘗試的人「這裡確實有一道門」，而那正是不需要說的事。
 *
 * ⚠️ 這一支不是 /api/*，所以 hooks 的身分流程要靠 Accept 判斷。
 *   瀏覽器點連結進來會帶 text/html，所以身分照常建立。
 */
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import {
	deriveDemoKey,
	passphraseMatches,
	signDemoCookie,
	DEMO_COOKIE,
	DEMO_TTL_SECONDS
} from '$lib/server/auth/demo';
import { dev } from '$app/environment';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const key = url.searchParams.get('key') ?? '';

	if (passphraseMatches(key, env.DEMO_PASSPHRASE)) {
		cookies.set(DEMO_COOKIE, await signDemoCookie(deriveDemoKey(env.SESSION_SECRET)), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: !dev,
			maxAge: DEMO_TTL_SECONDS
		});
	}

	// ★ 成功與失敗導向同一個地方。差別只在有沒有拿到 cookie。
	redirect(303, '/');
};
