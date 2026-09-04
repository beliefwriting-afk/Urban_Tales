/**
 * POST /api/site/:id/enter —— 進入 L2，首次進入發相遇卡（SDD §8.1）。
 *
 * ★ 這個檔案刻意很薄。所有會拒絕玩家的判斷都在 `decideEnter()` 那支純函式裡，
 *   這裡只做三件事：取材料 → 問它 → 照結果寫資料庫。
 *   理由見 enter.ts 檔頭（§13.4 ② 的教訓：判準要選測得到的）。
 *
 * ★★★ 在場憑證走 `X-Presence-Token` header，不走 Authorization。★★★
 *
 *   兩種憑證的語意不一樣：
 *     身分 cookie（一年）   ＝ 你是誰
 *     在場憑證（15 分鐘）   ＝ 你剛才真的站在那個景點的判定範圍內
 *
 *   Authorization 在所有人的直覺裡代表前者。把後者塞進去，將來讀程式碼的人
 *   會以為兩者可以互換——而那正是 presence.ts 檔頭花一整段在避免的事。
 *
 *   走 header 而不是 body 還有一個實務理由：`/api/chat` 與 `/api/site/:id/photo-task`
 *   都要帶同一張憑證。放 body 的話三支端點各自定義一次欄位，三份 schema 會漂移。
 *
 *   ⚠️ JWT 是純 ASCII，不會踩到 §13.4 ④ 的 ByteString 坑。
 *
 * 給 Python 背景的對照：
 *   `params.id` ≈ FastAPI 的路徑參數 `async def enter(id: str)`。
 *   資料夾名 `[id]` 就是 SvelteKit 宣告路徑參數的方式（≈ `/{id}` ）。
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

import { getSite } from '$lib/server/content/sites';
import { getSoul, toPublicSoul } from '$lib/server/content/souls';
import { getEncounterCard, toPublicCard } from '$lib/server/content/cards';
import { derivePresenceKey, verifyPresenceToken, PRESENCE_HEADER } from '$lib/server/auth/presence';
import { decideEnter } from '$lib/server/site/enter';
import { awardCard, markFirstMet } from '$lib/server/progress/award';

/** 金鑰只推導一次。不在模組頂層做，理由同 hooks.server.ts */
let presenceKey: Uint8Array | null = null;

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const siteId = params.id;
	const site = getSite(siteId);

	// ★ 憑證的驗證放在 decideEnter 之前，但它的**結果**才是判準。
	//   這裡不對驗證失敗做任何分支——verifyPresenceToken 永遠回 null 而不 throw，
	//   要不要因此拒絕是 decideEnter 的事。
	//
	//   ⚠️ 順序上的小代價：草稿站也會白驗一次 JWT。用一行短路換來
	//     「判準只有一個地方」，划算。
	presenceKey ??= derivePresenceKey(env.SESSION_SECRET);
	const presence = await verifyPresenceToken(
		request.headers.get(PRESENCE_HEADER),
		presenceKey,
		siteId
	);

	const encounter = getEncounterCard(siteId);

	const decision = decideEnter({
		playerId: locals.playerId,
		siteId,
		siteStatus: site?.status ?? null,
		presence,
		encounterCardId: encounter?.id ?? null
	});

	if (!decision.ok) {
		// ★ code 進回應本文，讓前端有東西可以分支；message 只給人看。
		//   `error()` 的第二個參數是物件時，SvelteKit 會把它整個放進 body.message
		//   ——所以這裡自己回 Response，才能同時帶結構化的 code。
		return json({ code: decision.code, message: decision.message }, { status: decision.status });
	}

	// ── 寫入。兩步，順序有意義 ──────────────────────────────────
	//
	// ★ 兩支都冪等，而且 awardCard 無條件呼叫（不是「firstMet 才發」）。
	//   理由：這兩個寫入之間如果斷線，玩家會停在「已記錄第一次相遇、
	//   但卡沒發出去」的狀態，而且再也回不去——下一次 markFirstMet 會回 false。
	//   無條件呼叫讓下一次請求自己把卡補上。**能自癒的順序，勝過一個交易。**
	const firstMet = await markFirstMet(decision.playerId, decision.siteId);
	const awarded = await awardCard(decision.playerId, decision.cardId);

	const soul = getSoul(siteId);

	return json({
		siteId,
		mode: decision.mode,
		/** 這一次才是第一次進來 */
		firstMet,
		/** 這一次才發出去的卡。前端據此決定要不要播發卡動畫 */
		awarded,
		// `awarded` 為真時 encounter 一定不是 null（decideEnter 保證了），
		// 但這裡照樣明寫出來——型別上不用 `!` 蓋過去，讀的人也不必自己推。
		card: awarded && encounter ? toPublicCard(encounter) : null,
		// ★ 白名單削過的靈魂資料。persona 不在裡面，見 souls.ts 檔頭。
		soul: soul ? toPublicSoul(soul) : null
	});
};
