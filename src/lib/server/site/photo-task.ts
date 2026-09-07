/**
 * 拍照任務的判準 —— SDD §8.1 任務卡那一列。
 *
 * ★★★ 純函式，不碰資料庫、不讀環境變數。★★★ 同 `enter.ts` 與 `chat/gate.ts`。
 *
 * ★★★ ⚠️ 刻意**不**跟 `decideEnter()` 共用實作。★★★
 *   兩者的拒絕條件現在幾乎一樣（連順序都一樣），抽成共用函式很誘人。
 *   但後端拍板的第 1 條就是這個：**不同情境的驗證邏輯不共用**——
 *   共用之後，某天為了某一支端點放寬其中一項，三支會一起被放寬，
 *   而 code review 只看到一個看起來無害的參數變更。
 *
 * ★ 判定時機是**按下快門**，不是照片存檔成功（SDD §7.3、企劃書 §5.4「拍了就過，
 *   無審核」）。所以這裡沒有任何「照片」的概念——這支端點收到的只是一個事件。
 *
 * ⚠️ **這條路徑完全不碰照片，也不該碰。** 企劃書 §5.6：不使用玩家的照片。
 *   `player_site_state` 與 `player_cards` 都沒有圖片欄位，架構上不可能存。
 *   將來若有人提議「存一張縮圖當紀念」，那不是加一個欄位的事，是推翻一條產品邊界。
 */
import type { PresenceClaims, PresenceMode } from '$lib/server/auth/presence';

/** 拒絕的理由。★ 前端只拿 code 決定顯示哪一句話，不解析 message */
export type PhotoTaskDenialCode =
	'no_identity' | 'unknown_site' | 'site_not_playable' | 'no_presence' | 'card_undefined';

export type PhotoTaskDecision =
	| { ok: true; playerId: string; siteId: string; mode: PresenceMode; cardId: string }
	| { ok: false; status: number; code: PhotoTaskDenialCode; message: string };

export type PhotoTaskInput = {
	playerId: string | null;
	siteId: string;
	siteStatus: 'draft' | 'playable' | null;
	presence: PresenceClaims | null;
	/** 這一站的任務卡 id。null ＝ cards.yaml 裡沒有 */
	taskCardId: string | null;
};

export function decidePhotoTask(input: PhotoTaskInput): PhotoTaskDecision {
	const { playerId, siteId, siteStatus, presence, taskCardId } = input;

	// ★ 順序同 enter：由「最不需要祕密的判準」往「最需要的」排。
	if (!playerId) {
		return { ok: false, status: 401, code: 'no_identity', message: '沒有身分' };
	}

	if (siteStatus === null) {
		return { ok: false, status: 404, code: 'unknown_site', message: '沒有這個景點' };
	}

	if (siteStatus !== 'playable') {
		return { ok: false, status: 403, code: 'site_not_playable', message: '這一站還不能進去' };
	}

	if (!presence) {
		return { ok: false, status: 403, code: 'no_presence', message: '需要有效的在場憑證' };
	}

	// ★ 為什麼這是 500 而不是安靜跳過（同 decideEnter 的 card_undefined）：
	//   那是內容層與程式碼不一致的狀態，content:check #7c 本來就該擋下來。
	//   安靜降級的話玩家會拍完、看到成功、但圖鑑永遠少一張，**而沒有任何人會發現**。
	//   讓它大聲壞掉，是為了不讓它安靜地存在。
	if (!taskCardId) {
		return {
			ok: false,
			status: 500,
			code: 'card_undefined',
			message: `${siteId} 沒有定義任務卡 —— content:check #7c 應該擋下這件事`
		};
	}

	return { ok: true, playerId, siteId, mode: presence.mode, cardId: taskCardId };
}
