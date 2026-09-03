/**
 * POST /api/presence —— 到場判定，發在場憑證（SDD §5.3）。
 *
 * ★★★ 隱私硬約束：座標用完即丟。★★★
 *
 *   企劃書 §7、§8.8：「座標用於判定後即丟棄，不建立任何位置軌跡類的資料。」
 *
 *   在這個檔案裡，座標只活在 `POST` 這個函式的區域變數中：
 *     · 不寫資料庫（schema 裡根本沒有經緯度欄位，content:check 會擋）
 *     · 不寫 log（連 console.log 都不要——log 會被平台收集、保存、可搜尋）
 *     · 不進在場憑證的 payload（見 presence.ts 的說明）
 *     · 錯誤訊息裡也不放（錯誤訊息會進 Sentry 那類服務）
 *
 *   ⚠️ 之後要加除錯 log 的時候，記得這一段。「暫時印出來看一下」是這條約束
 *      最常見的破口，而暫時的東西經常會留下來。
 *
 * 給 Python 背景的對照：
 *   `error(400, '...')` ≈ `raise HTTPException(400, '...')`，SvelteKit 會攔下來
 *   轉成回應。`json(x)` ≈ FastAPI 直接 return dict。
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { env } from '$env/dynamic/private';

import { resolvePresence } from '$lib/server/presence/geo';
import { haversine } from '$lib/shared/geo';
import { allSiteGeo, getSite } from '$lib/server/content/sites';
import {
	derivePresenceKey,
	signPresenceToken,
	PRESENCE_TTL_SECONDS
} from '$lib/server/auth/presence';
import { deriveDemoKey, isDemoSession, DEMO_COOKIE } from '$lib/server/auth/demo';

/**
 * 定位精度差到這個程度就不判定，回 'unreliable'。
 *
 * ★ 為什麼要有上限：室內定位有時會回報幾百公尺的精度。若照單全收地放寬半徑，
 *   玩家在家裡也能觸發——那會直接推翻核心設計第 1 條。
 *   （`resolvePresence` 自己還有一層 30 公尺的誤差預算上限，這裡是更前面的一道：
 *     精度爛到這個地步時，連「你在附近」都不該說，因為那句話也是猜的。）
 */
const UNRELIABLE_ACCURACY_M = 100;

const FieldBody = z.object({
	lat: z.number().min(-90).max(90),
	lng: z.number().min(-180).max(180),
	/** navigator.geolocation 回報的水平精度（公尺） */
	accuracy: z.number().min(0)
});

const DemoBody = z.object({ siteId: z.string().min(1) });

let presenceKey: Uint8Array | null = null;
let demoKey: Uint8Array | null = null;

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	if (!locals.playerId) {
		// 走到這裡表示 hooks 沒有建立身分。理論上不會發生（/api/* 一定走身分流程），
		// 但型別上 playerId 可以是 null，所以要明確處理而不是用 ! 蓋過去。
		error(401, '沒有身分');
	}

	presenceKey ??= derivePresenceKey(env.SESSION_SECRET);
	demoKey ??= deriveDemoKey(env.SESSION_SECRET);

	const body: unknown = await request.json().catch(() => null);
	if (body === null) error(400, '請求內容不是合法的 JSON');

	// ── 展示模式：直接指定景點，不送座標（SDD §5.4）──────────────
	//
	// ★ 判準是伺服器簽的 cookie，不是前端那個開關。前端開關只是 UI 狀態，
	//   玩家改得動；這張 cookie 要有正確的密語才拿得到。
	const demo = await isDemoSession(cookies.get(DEMO_COOKIE), demoKey);
	const asDemo = DemoBody.safeParse(body);

	if (asDemo.success) {
		if (!demo) {
			// 沒有展示模式卻想直接指定景點 —— 這正是「硬到場」要擋的事
			error(403, '要先在作品集頁面用通關密語開啟展示模式');
		}
		if (!getSite(asDemo.data.siteId)) error(404, '沒有這個景點');

		return json({
			status: 'inside' as const,
			siteId: asDemo.data.siteId,
			mode: 'demo' as const,
			token: await signPresenceToken(
				{ playerId: locals.playerId, siteId: asDemo.data.siteId, mode: 'demo' },
				presenceKey
			),
			expiresIn: PRESENCE_TTL_SECONDS
		});
	}

	// ── 實地模式 ────────────────────────────────────────────────
	const parsed = FieldBody.safeParse(body);
	if (!parsed.success) error(400, '需要 lat / lng / accuracy，或展示模式的 siteId');

	const { lat, lng, accuracy } = parsed.data;

	// 精度爛到這個地步時什麼都不說。「你在附近」也是一句猜的話。
	if (accuracy > UNRELIABLE_ACCURACY_M) {
		return json({ status: 'unreliable' as const, accuracyM: Math.round(accuracy) });
	}

	const position = { lat, lng };
	const sites = allSiteGeo();
	const hit = resolvePresence({ position, accuracyM: accuracy }, sites);

	if (hit) {
		return json({
			status: 'inside' as const,
			siteId: hit.siteId,
			mode: 'field' as const,
			token: await signPresenceToken(
				{ playerId: locals.playerId, siteId: hit.siteId, mode: 'field' },
				presenceKey
			),
			expiresIn: PRESENCE_TTL_SECONDS
		});
	}

	// ── 不在範圍內：給一個有用的提示 ────────────────────────────
	//
	// 回報「最近的景點還有多遠」而不是沉默。玩家需要知道往哪走。
	// ★ 這不算洩漏判定半徑：距離本來就是前端自己算得出來的
	//   （景點座標是公開的，玩家的座標在他自己手機裡）。
	//   真正沒說出口的仍然是「多近才算到」。
	let nearestId: string | null = null;
	let nearestM = Infinity;
	for (const s of sites) {
		for (const c of [{ lat: s.lat, lng: s.lng }, ...s.extraCenters]) {
			const d = haversine(position, c);
			if (d < nearestM) {
				nearestM = d;
				nearestId = s.id;
			}
		}
	}

	return json({
		status: 'outside' as const,
		nearestSiteId: nearestId,
		distanceM: Number.isFinite(nearestM) ? Math.round(nearestM) : null
	});

	// ★ 到這裡為止，lat / lng 只出現在上面這些區域變數裡。
	//   函式回傳之後它們就不存在了 —— 沒有寫進任何地方。
};
