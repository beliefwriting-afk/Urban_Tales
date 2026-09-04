/**
 * 進入 L2 的判準 —— SDD §8.1 相遇卡那一列。
 *
 * ★★★ 這個檔案是純函式，不碰資料庫、不讀環境變數、不 import 任何路由。★★★
 *
 *   路由本身測不到：它要一個活著的資料庫、一張真的 cookie、一個跑著的
 *   dev server。所以**所有會拒絕玩家的判斷都收在這裡**，路由只負責
 *   「取材料 → 呼叫這一支 → 照結果寫資料庫」。
 *
 *   這是 §13.4 ② 那條教訓的直接套用：判準的選擇要把「這條規則將來怎麼被
 *   驗證」算進去。上一輪 `needsIdentity` 就是這樣從 hooks 裡搬出來的。
 *
 * ★ 為什麼順序是這個順序（identity → 有沒有這站 → 草稿 → 在場憑證）
 *
 *   由「最不需要祕密的判準」往「最需要的」排，讓不合格的請求盡早離開，
 *   而且每一層洩漏的資訊都不超過 `/api/sites` 已經公開的東西：
 *
 *     1. 沒有身分       401 —— 跟這一站無關
 *     2. 沒有這一站     404 —— 景點清單本來就公開
 *     3. 這站是草稿     403 —— `status` 本來就在 /api/sites 的回應裡
 *     4. 在場憑證不合格 403 —— 到這裡才需要祕密（金鑰）
 *
 *   ⚠️ 反過來排（先驗憑證）不會比較安全，只會讓每個「戳草稿站」的請求
 *      都白做一次 JWT 驗證。而且 3 和 4 都回 403，攻擊者分辨得出來也拿不到
 *      任何新東西——他早就從地圖上看到哪幾站是草稿了。
 *
 * ★ 為什麼「查不到相遇卡」是 500 而不是安靜跳過
 *
 *   那是內容層與程式碼不一致的狀態，content:check #7b 本來就該擋下來。
 *   安靜降級的話玩家會進得去、聊得動、但永遠少一張卡，而**沒有任何人
 *   會發現**——這正是前身專案「表建好了但沒人生產內容」的形狀。
 *   讓它大聲壞掉，是為了不讓它安靜地存在。
 */
import type { PresenceClaims, PresenceMode } from '$lib/server/auth/presence';

/** 拒絕的理由。★ 前端只拿 code 決定要顯示哪一句話，不解析 message */
export type EnterDenialCode =
	'no_identity' | 'unknown_site' | 'site_not_playable' | 'no_presence' | 'card_undefined';

export type EnterDecision =
	| { ok: true; playerId: string; siteId: string; mode: PresenceMode; cardId: string }
	| { ok: false; status: number; code: EnterDenialCode; message: string };

export type EnterInput = {
	/** hooks 填的 locals.playerId。子資源不走身分流程，所以型別上可以是 null */
	playerId: string | null;
	siteId: string;
	/** null ＝ 內容層沒有這一站 */
	siteStatus: 'draft' | 'playable' | null;
	/** 已經驗過簽章、也已經比對過 siteId 的憑證內容。null ＝ 沒有或不合格 */
	presence: PresenceClaims | null;
	/** 這一站的相遇卡 id。null ＝ cards.yaml 裡沒有 */
	encounterCardId: string | null;
};

export function decideEnter(input: EnterInput): EnterDecision {
	const { playerId, siteId, siteStatus, presence, encounterCardId } = input;

	if (!playerId) {
		return {
			ok: false,
			status: 401,
			code: 'no_identity',
			message: '沒有身分'
		};
	}

	if (siteStatus === null) {
		return {
			ok: false,
			status: 404,
			code: 'unknown_site',
			message: '沒有這個景點'
		};
	}

	if (siteStatus !== 'playable') {
		// 草稿站在地圖上看得到、算得出距離，但進不去——沒有靈魂可以召喚。
		// 這不是錯誤狀態，是內容還沒寫完的正常樣子（content/schema.ts 的 status）。
		return {
			ok: false,
			status: 403,
			code: 'site_not_playable',
			message: '這個景點還沒開放'
		};
	}

	if (!presence) {
		// 沒有在場憑證 ＝ 沒有走到現場（或憑證過期、或是別站的）。
		// ★ 不分辨是哪一種。呼叫端不需要知道，前端也不需要——
		//   三種情況玩家都得重新定位一次。少一個分支少一個洞。
		return {
			ok: false,
			status: 403,
			code: 'no_presence',
			message: '需要有效的在場憑證，請重新定位'
		};
	}

	// 憑證是別人的。理論上不會發生（憑證的 sub 就是發證時的 playerId），
	// 但「理論上不會發生」的事要明確擋掉而不是相信它——
	// 這一條擋的是「把別人的憑證撿來用」。
	if (presence.playerId !== playerId) {
		return {
			ok: false,
			status: 403,
			code: 'no_presence',
			message: '需要有效的在場憑證，請重新定位'
		};
	}

	if (!encounterCardId) {
		return {
			ok: false,
			status: 500,
			code: 'card_undefined',
			message: `${siteId} 宣告 playable 卻沒有相遇卡定義 —— content:check #7b 應該要擋下這件事`
		};
	}

	return { ok: true, playerId, siteId, mode: presence.mode, cardId: encounterCardId };
}
