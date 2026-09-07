/**
 * `/api/chat` 的前置判準 —— 決定這個請求「能不能進到 speak()」。
 *
 * ★★★ 這個檔案是純函式，不碰資料庫、不讀環境變數。★★★
 *   同 `site/enter.ts`：路由本身測不到（要活的資料庫、真的 cookie、跑著的
 *   dev server），所以會拒絕玩家的判斷全部收在這裡。
 *
 * ★★★ ⚠️ 刻意**不**跟 `decideEnter()` 共用實作。★★★
 *   兩者的拒絕條件現在幾乎一樣，抽成共用函式很誘人。但後端拍板的三個做法
 *   第 1 條就是這個：**不同情境的驗證邏輯不共用**——一旦共用，某天有人為了
 *   某個情境放寬其中一項，兩邊會一起被放寬，而 code review 只看到一個
 *   看起來無害的參數變更。
 *   （而且它們本來就會分歧：enter 要查相遇卡，chat 要收玩家的輸入。）
 *
 * ★★★ 什麼是 4xx、什麼是「200 ＋ 保底台詞」，界線要清楚：★★★
 *
 *     這裡回 4xx 的是**請求本身不合格**——沒有身分、沒有這一站、憑證過期。
 *     那些是前端的錯或攻擊，玩家的畫面上本來就不該出現。
 *
 *     而「輸入太長」「額度用完」「AI 掛了」**不在這裡**，它們在 speak() 裡面，
 *     一律回 200 ＋ 一句靈魂說的話（企劃書 §8.7）。
 *     ⚠️ 所以這支函式**不檢查輸入長度**——那是 L1 的事，而 L1 的結果是保底台詞。
 *     在這裡順手擋掉會讓玩家收到一個沒有設計過的錯誤畫面。
 */
import type { PresenceClaims, PresenceMode } from '$lib/server/auth/presence';

export type ChatDenialCode =
	'no_identity' | 'bad_request' | 'unknown_site' | 'site_not_playable' | 'no_presence';

export type ChatDecision =
	| { ok: true; playerId: string; siteId: string; text: string; mode: PresenceMode }
	| { ok: false; status: number; code: ChatDenialCode; message: string };

export type ChatInput = {
	/** hooks 填的 locals.playerId */
	playerId: string | null;
	/** ★ 從 request body 來，所以型別是 unknown——它可能是數字、物件、或根本不存在 */
	siteId: unknown;
	text: unknown;
	/** null ＝ 內容層沒有這一站 */
	siteStatus: 'draft' | 'playable' | null;
	/** 已經驗過簽章、也已經比對過 siteId 的憑證內容 */
	presence: PresenceClaims | null;
};

export function decideChat(input: ChatInput): ChatDecision {
	const { playerId, siteId, text, siteStatus, presence } = input;

	// ★ 順序同 decideEnter：由「最不需要祕密的判準」往「最需要的」排，
	//   讓不合格的請求盡早離開，而且每一層洩漏的資訊都不超過 /api/sites 已經公開的東西。
	if (!playerId) {
		return { ok: false, status: 401, code: 'no_identity', message: '沒有身分' };
	}

	if (typeof siteId !== 'string' || siteId.length === 0) {
		return { ok: false, status: 400, code: 'bad_request', message: 'siteId 必須是非空字串' };
	}

	// ⚠️ 只檢查「是不是一段有內容的文字」，**不檢查長度上限**——見檔頭。
	if (typeof text !== 'string' || text.trim().length === 0) {
		return { ok: false, status: 400, code: 'bad_request', message: 'text 必須是非空字串' };
	}

	if (siteStatus === null) {
		return { ok: false, status: 404, code: 'unknown_site', message: '沒有這個景點' };
	}

	if (siteStatus !== 'playable') {
		return { ok: false, status: 403, code: 'site_not_playable', message: '這一站還不能進去' };
	}

	// ★ 到這裡才需要祕密（簽章金鑰）。憑證的 siteId 比對已經在 verifyPresenceToken 做過，
	//   所以這裡拿到的 presence 一定是「這一站的」——不必再比一次。
	if (!presence) {
		return { ok: false, status: 403, code: 'no_presence', message: '需要有效的在場憑證' };
	}

	return { ok: true, playerId, siteId, text: text.trim(), mode: presence.mode };
}
