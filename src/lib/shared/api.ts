/**
 * API 回應的形狀 —— **前後端共用的唯一一份**。
 *
 * ★★★ 為什麼要有這個檔案（切片 7 加的）★★★
 *
 *   前端需要知道 `/api/sites` 回什麼，但它 import 不到 `$lib/server/*`
 *   （SvelteKit 會擋，那也是對的——那些檔案裡有 radiusM 與 persona）。
 *   於是最省事的做法是前端自己再寫一份型別。**那正是本專案最不能做的事**：
 *   兩份定義會漂移，而漂移的那天 TypeScript 會安靜地通過，
 *   因為它比對的是各自那一份（HANDOFF §13.4 ⑦）。
 *
 *   所以型別放這裡，伺服器端的 `toPublicX` 回傳它、前端 fetch 之後標註它。
 *   同 `shared/geo.ts` 的 haversine：**同一個定義只能有一個地方。**
 *
 * ⚠️ 這個檔案會被打包進前端，所以**只能放型別，不能放任何祕密或伺服器邏輯**。
 *   （型別在編譯後完全消失，不會進 bundle。）
 */

// ─── GET /api/sites ──────────────────────────────────────────

export type PublicSite = {
	id: string;
	name: string;
	tagline: string;
	lat: number;
	lng: number;
	/** 感應半徑（公尺）。前端畫漣漪用 */
	sensingM: number;
	/** draft 的站在地圖上看得到，但進不去 */
	status: 'draft' | 'playable';
	hasStory: boolean;
	storyOrder: number | null;
};

export type SitesResponse = { sites: PublicSite[] };

// ★★★ 這裡**沒有** radiusM，而且永遠不會有。★★★
//   「要走多近才算到」是伺服器唯一藏得住的東西（SDD 附錄 C）。
//   前端拿不到它，所以前端算不出「我到了」——那個結論只能向 /api/presence 要。

// ─── GET /api/me ─────────────────────────────────────────────

export type MeResponse = {
	/** 顯示用的稱呼（「旅人 #C440」），不是識別碼 */
	label: string;
	createdAt: string | null;
	/** ★ 展示模式的唯一真相。前端只讀不寫 */
	demoMode: boolean;
};

// ─── POST /api/presence ──────────────────────────────────────

export type PresenceMode = 'field' | 'demo';

export type PresenceResponse =
	| {
			status: 'inside';
			siteId: string;
			mode: PresenceMode;
			/** 在場憑證。後續 enter / chat / photo-task 都要帶它 */
			token: string;
			expiresIn: number;
	  }
	| { status: 'outside'; nearestSiteId: string | null; distanceM: number | null }
	/** 定位精度太差，連「你在附近」都不說——那句話也是猜的 */
	| { status: 'unreliable'; accuracyM: number };

/** 實地模式送座標；展示模式送景點 id（伺服器會驗那張 cookie） */
export type PresenceRequest = { lat: number; lng: number; accuracy: number } | { siteId: string };
