/**
 * POST /api/chat —— 跟靈魂說話（SDD §6）。
 *
 * ★ 這個檔案刻意很薄，同 `enter/+server.ts`：取材料 → 問純函式 → 交給 speak()。
 *   所有會拒絕玩家的判斷在 `chat/gate.ts`，所有降級判斷在 `soul/speak.ts`。
 *
 * ★★★ 兩種「拒絕」的界線（這是本端點最容易寫錯的地方）★★★
 *
 *     4xx  ＝ 請求本身不合格：沒有身分、沒有這一站、憑證過期、body 壞掉。
 *             那是前端的錯或攻擊，玩家的畫面上本來就不該出現。
 *
 *     200  ＝ **只要 speak() 有回一句話，就是 200**，即使那是保底台詞。
 *             輸入太長、額度用完、AI 掛了、全域上限觸頂——全部都是 200。
 *             企劃書 §8.7：AI 失效視為正常回應，不呈現為錯誤。
 *             ⚠️ 前端不存在「對話錯誤」這個 UI 狀態，這裡回 5xx 等於逼它發明一個。
 *
 * ★ 在場憑證走 `X-Presence-Token` header（同 enter），理由見 enter/+server.ts 檔頭。
 *   ⚠️ 憑證裡的 siteId 與 body 的 siteId 必須是同一站——這件事由
 *   `verifyPresenceToken(token, key, siteId)` 的第三個參數負責，不必在這裡再比一次。
 *
 * ⚠️ `+server.ts` 只能匯出 HTTP 方法（HANDOFF §13.4 ②）。要放常數請放 $lib。
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

import { derivePresenceKey, verifyPresenceToken, PRESENCE_HEADER } from '$lib/server/auth/presence';
import { decideChat } from '$lib/server/chat/gate';
import { getSite } from '$lib/server/content/sites';
import { speak, type SpeakContext } from '$lib/server/soul/speak';

/** 金鑰只推導一次。不在模組頂層做，理由同 hooks.server.ts */
let presenceKey: Uint8Array | null = null;

/** body 的 origin 只影響分析，值不對就當成一般輸入——不值得為它回 400 */
function originOf(v: unknown): SpeakContext['origin'] {
	return v === 'guided-prompt' || v === 'story-node' ? v : 'freetext';
}

export const POST: RequestHandler = async ({ request, locals }) => {
	// body 壞掉（不是 JSON）也走 decideChat 的 400，不要自己丟例外——
	// 例外會變成 SvelteKit 的 HTML 錯誤頁，前端拿不到結構化的 code。
	const body: unknown = await request.json().catch(() => null);
	const fields = (body ?? {}) as Record<string, unknown>;

	const siteId = fields.siteId;
	const site = typeof siteId === 'string' ? getSite(siteId) : null;

	presenceKey ??= derivePresenceKey(env.SESSION_SECRET);
	const presence =
		typeof siteId === 'string'
			? await verifyPresenceToken(request.headers.get(PRESENCE_HEADER), presenceKey, siteId)
			: null;

	const decision = decideChat({
		playerId: locals.playerId,
		siteId,
		text: fields.text,
		siteStatus: site?.status ?? null,
		presence
	});

	if (!decision.ok) {
		return json({ code: decision.code, message: decision.message }, { status: decision.status });
	}

	// ★ speak() 永遠不 throw、永遠回一句話，所以這裡沒有 try/catch，也沒有 5xx 分支。
	//   那個保證是它檔頭寫的第一句話，也是這個端點能一律回 200 的前提。
	const result = await speak({
		playerId: decision.playerId,
		siteId: decision.siteId,
		presenceMode: decision.mode,
		userText: decision.text,
		origin: originOf(fields.origin)
	});

	return json({
		text: result.text,
		/** 前端拿來決定要不要顯示「今天話少」之類的細微提示——目前只記錄，不影響畫面 */
		isFallback: result.isFallback,
		/**
		 * ⚠️ 保底的理由會回給前端，但**前端不該用它顯示不同的訊息**。
		 *   SDD §6.5 第 5 階要求全域上限的表現與 AI 失效完全相同；
		 *   前端若照 reason 分支，那個要求就從伺服器端漏掉了。
		 *   它在這裡是為了 smoke 測與除錯。
		 */
		fallbackReason: result.fallbackReason ?? null
	});
};
