/**
 * 三層介面的狀態機 —— 唯一真相來源。
 *
 * ★★★ 切片 7（2026-09-07）：景點、身分、到場判定、圖鑑改由伺服器回答。★★★
 *
 *   這一層原本是「假資料」，現在只剩兩樣還是假的：
 *     · `WALK_PATH` ＋ 滑桿 —— **開發用的位置來源**（桌機沒有 GPS）
 *     · `PLACEHOLDER_REPLIES` —— 對話還沒接（批 2）
 *
 *   ⚠️⚠️ **兩段程式碼被刪掉了，不是改成讀 API**（HANDOFF §14.8）：
 *
 *     ① 前端不再算 `reachable`。判定半徑永遠不進 API 回應，所以前端
 *        **沒有能力**回答「我到了沒」——那個結論只能向 `/api/presence` 要。
 *        現在的形狀是：按下呼喚 → 拿位置 → 問伺服器 → 伺服器發憑證 → 才進得去。
 *
 *     ② 前端不再有 `demoMode` 這個可寫的布林值。展示模式的唯一真相是伺服器簽的
 *        cookie，前端只從 `/api/me` **讀**它。密語也不在前端了（那等於沒有密語）。
 *
 *   兩者是同一種病：**前端有能力自己宣告一件該由伺服器決定的事。**
 *
 * ★ 開發時的位置來源是滑桿，但**判定仍然是真的**——滑桿的座標會原樣送給
 *   `/api/presence`，由伺服器用它不公開的半徑判定。假的是位置，不是判準。
 *
 * 給 Python 背景的對照：
 *   `$state(x)` 宣告的欄位一被指派，用到它的畫面就自動重畫。
 *   class 裡的 `get` 就是 `@property`。`#field` 是真正的私有欄位（Python 的 `_x` 只是約定）。
 */

import { dev } from '$app/environment';
import { haversine, type LatLng } from '$lib/shared/geo';
import { PLACEHOLDER_REPLIES, WALK_PATH } from './data';
import {
	ApiError,
	getCollection,
	getMe,
	getSites,
	postPresence,
	type CollectionCard
} from '$lib/client/api';
import type { MeResponse, PresenceMode, PublicSite } from '$lib/shared/api';

export type Mode = 'map' | 'chat' | 'camera';

export type Message = {
	id: number;
	from: 'me' | 'soul';
	text: string;
};

/** 每個景點當下的狀態 */
export type SiteState = {
	id: string;
	name: string;
	lat: number;
	lng: number;
	/** ★ 距離仍然由前端算（座標是公開的，haversine 前後端共用同一支） */
	distanceM: number;
	/** 進了感應範圍：畫漣漪。`sensingM` 有給前端，猜到也換不到能力 */
	sensed: boolean;
	/**
	 * ★★★ 伺服器發過這一站的在場憑證，而且還沒過期。★★★
	 *   這不是前端算出來的——它是 `/api/presence` 回答的結果。
	 */
	canEnter: boolean;
	status: 'draft' | 'playable';
};

/** 伺服器發的在場憑證。15 分鐘，綁一個景點 */
type Presence = {
	siteId: string;
	token: string;
	mode: PresenceMode;
	expiresAtMs: number;
};

/**
 * 沿 WALK_PATH 線性插值。t 為 0..1。
 *
 * ★ 開發用。桌機沒有 GPS，沒有這條路徑就沒辦法在電腦上測到場判定。
 *   正式建置走 `navigator.geolocation`（見 currentPosition）。
 */
function walkAt(t: number): LatLng {
	const segs = WALK_PATH.length - 1;
	const pos = Math.min(Math.max(t, 0), 1) * segs;
	const i = Math.min(Math.floor(pos), segs - 1);
	const f = pos - i;
	const a = WALK_PATH[i];
	const b = WALK_PATH[i + 1];
	return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

/**
 * 真正的定位。
 *
 * ⚠️ `enableHighAccuracy` 會開 GPS 晶片，比較耗電也比較慢——但這個遊戲的
 *   整個前提就是「你真的站在那裡」，用基地台級的精度去判定 50 公尺的圓
 *   等於讓判定變成擲骰子（而且 `/api/presence` 會回 unreliable 把它擋掉）。
 *
 * ⚠️ 逾時 12 秒：手機冷啟動 GPS 常要十秒以上。逾時太短會變成「站在門口卻一直失敗」。
 */
function currentPosition(): Promise<GeolocationPosition> {
	return new Promise((resolve, reject) => {
		if (!navigator.geolocation) {
			reject(new Error('這個瀏覽器不支援定位'));
			return;
		}
		navigator.geolocation.getCurrentPosition(resolve, reject, {
			enableHighAccuracy: true,
			timeout: 12_000,
			maximumAge: 0
		});
	});
}

class Session {
	/** 三層介面的當前狀態。相機是從 chat 切進去的，不是獨立的第四態 */
	mode = $state<Mode>('map');

	/** 0..100 的滑桿值。★ 開發用的位置來源，正式建置改走 GPS */
	walk = $state(0);

	activeSiteId = $state<string | null>(null);
	messages = $state<Message[]>([]);

	/**
	 * 各靈魂的對話歷史。離開時存進來，再進去時接著聊。
	 * ⚠️ 正式版這份資料在後端（`chat_turns`），批 2 接對話時換掉。
	 */
	history = $state<Record<string, Message[]>>({});

	/** 召喚過的靈魂。批 2 接 enter 之後改由伺服器的相遇卡決定 */
	visited = $state<string[]>([]);

	// ── 伺服器來的 ────────────────────────────────────────────

	#sites = $state<PublicSite[]>([]);
	#me = $state<MeResponse | null>(null);
	#cards = $state<CollectionCard[]>([]);
	#cardsOwned = $state(0);

	/** 載入狀態。地圖要等景點清單到齊才畫得出圖釘 */
	ready = $state(false);
	loadError = $state<string | null>(null);

	/**
	 * ★★★ 目前手上的在場憑證。這是「我到了」的唯一憑據。★★★
	 *   由 `/api/presence` 發，15 分鐘後過期，只對一個景點有效。
	 */
	presence = $state<Presence | null>(null);

	/**
	 * ★ 展示模式，**唯讀**。
	 *
	 *   真相是伺服器簽的 HttpOnly cookie，前端讀不到內容，只能問 `/api/me`。
	 *   ⚠️ 這裡刻意沒有 setter：切片 7 刪掉的就是那個「前端自己說了算」的布林值。
	 *     要開啟展示模式只有一條路——把密語送去 `/demo?key=`，由伺服器判斷。
	 */
	get demoMode(): boolean {
		return this.#me?.demoMode ?? false;
	}

	/** 訪客稱呼。★ 由伺服器給（原本是前端寫死的假編號） */
	get guestId(): string {
		return this.#me?.label ?? '旅人 #⋯⋯';
	}

	/** 「2026.09.07 起」。格式化是前端的事，伺服器只給 ISO 字串 */
	get createdAt(): string {
		const iso = this.#me?.createdAt;
		if (!iso) return '';
		const d = new Date(iso);
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} 起`;
	}

	/**
	 * 背景音樂。目前只有狀態沒有聲音——音檔還沒有，先讓介面就位。
	 * ⚠️ 這是**純畫面偏好**，不是資料層，所以留在前端是對的。
	 */
	musicOn = $state(true);
	musicVolume = $state(70);

	/** 對話窗是否展開。收起來才看得到底下的地圖 */
	panelOpen = $state(true);
	menuOpen = $state(false);
	openWindow = $state<'log' | 'cards' | 'settings' | null>(null);

	openThread = $state<string | null>(null);
	toast = $state<string | null>(null);

	/**
	 * 上一句還在等回覆。
	 * ⚠️ 這不是載入動畫的旗標，是**額度保護**——連按兩次 Enter 會送出兩個請求，
	 * 每一次都真的花錢。
	 */
	pending = $state(false);

	/** 呼喚中。★ 漣漪是動作的回饋，不是持續的狀態指示（2026-08-25 拍板） */
	pulsing = $state(false);

	/** 正在問伺服器「我到了沒」。避免連按送出兩次判定 */
	summoning = $state(false);

	#nextId = 1;
	#toastTimer: ReturnType<typeof setTimeout> | null = null;
	#pulseTimer: ReturnType<typeof setTimeout> | null = null;

	/** 展示模式的自訂位置（長按地圖）。null ＝ 沿 WALK_PATH 走，由滑桿決定 */
	posOverride = $state<LatLng | null>(null);

	get playerPos(): LatLng {
		return this.posOverride ?? walkAt(this.walk / 100);
	}

	// ── 載入 ──────────────────────────────────────────────────

	/**
	 * 啟動時抓景點、身分、圖鑑。
	 *
	 * ★ 三個一起抓（Promise.all），不是一個接一個——它們互不相依，
	 *   串起來只會讓開場多等兩個來回。
	 */
	async load(): Promise<void> {
		try {
			const [sites, me, collection] = await Promise.all([getSites(), getMe(), getCollection()]);
			this.#sites = sites;
			this.#me = me;
			this.#cards = collection.cards;
			this.#cardsOwned = collection.owned;
			this.loadError = null;
			this.ready = true;
		} catch (e) {
			// ⚠️ 地圖沒有景點清單就什麼都畫不出來，所以這個錯誤要留在畫面上，
			//   不能只丟一個會自己消失的 toast。
			this.loadError = e instanceof ApiError ? e.message : '連不上伺服器';
			this.ready = false;
		}
	}

	/** 展示模式開關之後要重抓（cookie 變了）。設定頁用 */
	async refreshMe(): Promise<void> {
		try {
			this.#me = await getMe();
		} catch {
			// 靜默：這只影響標示條，不值得打斷玩家
		}
	}

	// ── 景點狀態 ──────────────────────────────────────────────

	/**
	 * 每個景點的即時狀態。地圖圖層直接畫這個陣列。
	 *
	 * ⚠️⚠️ 這裡**沒有 reachable**。切片 7 之前它是
	 *   `distanceM <= s.summonM`——前端自己算出「我到了」。
	 *   判定半徑不進 API，所以那一段現在算不出來，也不該算得出來。
	 */
	get sites(): SiteState[] {
		const p = this.playerPos;
		const presence = this.validPresence;

		return this.#sites.map((s) => {
			// 距離仍由前端算：座標是公開的，而且 haversine 前後端共用同一支，
			// 所以畫面上的公尺數跟伺服器判定用的公尺數不會漂移。
			const distanceM = Math.round(haversine(p, { lat: s.lat, lng: s.lng }));
			return {
				id: s.id,
				name: s.name,
				lat: s.lat,
				lng: s.lng,
				distanceM,
				// 展示模式下感應範圍不限——SDD §5.4 的用意就是讓沒到現場的人也看得到
				sensed: this.demoMode || distanceM <= s.sensingM,
				canEnter: presence?.siteId === s.id,
				status: s.status
			};
		});
	}

	/** 還沒過期的在場憑證。過期的等於沒有 */
	get validPresence(): Presence | null {
		const p = this.presence;
		if (!p) return null;
		return p.expiresAtMs > Date.now() ? p : null;
	}

	get activeSite(): SiteState | null {
		return this.sites.find((s) => s.id === this.activeSiteId) ?? null;
	}

	/** 現在進得去的那一站（最多一個——在場憑證一次只綁一站） */
	get nearby(): SiteState[] {
		return this.sites.filter((s) => s.canEnter);
	}

	// ── 到場判定（★ 切片 7 的核心改動）──────────────────────────

	/**
	 * 呼喚靈魂 —— **問伺服器「我到了沒」**。
	 *
	 * ★★★ 這是整個切片 7 最重要的一段。★★★
	 *   切片 7 之前，「我到了」是前端用 `distanceM <= summonM` 算出來的。
	 *   現在前端沒有那個半徑，所以流程變成：
	 *
	 *     按下呼喚 → 拿位置 → POST /api/presence → 伺服器發憑證 → 才進得去
	 *
	 *   ⚠️ 這也讓「呼喚」這個動作有了真正的意義。原本它只是把一件玩家已經
	 *     看得到的事再說一次（圖釘早就亮了）；現在它是**去問**的那個動作。
	 *     跟 2026-08-25 拍板「漣漪是動作的回饋、不是持續的狀態指示」是同一件事。
	 *
	 * ★ 位置從哪來：
	 *     實地（正式建置）—— `navigator.geolocation`
	 *     開發（dev）    —— 滑桿模擬的座標，**原樣送給伺服器判定**
	 *   ⚠️ 假的是位置來源，不是判準。伺服器照樣用它不公開的半徑判定，
	 *     所以開發時驗到的是真的判定邏輯。
	 *
	 * ★ 展示模式送的是 `siteId` 不是座標（SDD §5.4）。伺服器會驗那張 cookie——
	 *   沒有 cookie 卻送 siteId 會被 403 擋下來，那正是「硬到場」要擋的事。
	 */
	async summon(): Promise<void> {
		if (this.summoning) return;
		this.summoning = true;

		// 先讓漣漪擴散——不管結果如何，呼喚這個動作本身要有回應
		this.pulsing = true;
		if (this.#pulseTimer) clearTimeout(this.#pulseTimer);
		// 4.8 秒＝兩輪漣漪動畫（2.4s ×2）
		this.#pulseTimer = setTimeout(() => (this.pulsing = false), 4800);

		try {
			const res = this.demoMode
				? await postPresence({ siteId: this.#closestSiteId() })
				: await postPresence(await this.#fieldPosition());

			if (res.status === 'inside') {
				this.presence = {
					siteId: res.siteId,
					token: res.token,
					mode: res.mode,
					expiresAtMs: Date.now() + res.expiresIn * 1000
				};
				const name = this.#sites.find((s) => s.id === res.siteId)?.name ?? res.siteId;
				this.showToast(`${name}回應了你`);
				return;
			}

			if (res.status === 'outside') {
				// ★ 距離用伺服器回的那個數字，不用前端自己算的。
				//   兩邊算出來會一樣（同一支 haversine），但「差多遠」這件事
				//   應該由做判定的那一方說——前端只是轉述。
				const name = this.#sites.find((s) => s.id === res.nearestSiteId)?.name ?? '最近的靈魂';
				this.showToast(
					res.distanceM === null
						? '沒有回應。附近沒有靈魂。'
						: `${name}有回應，但還在 ${res.distanceM} 公尺外`
				);
				return;
			}

			// unreliable：連「你在附近」都不說，那句話也是猜的
			this.showToast(`定位不夠準確（誤差約 ${res.accuracyM} 公尺），到空曠一點的地方再試一次`);
		} catch (e) {
			if (e instanceof ApiError && e.status === 403) {
				// 沒有展示模式卻送了 siteId
				this.showToast('要先在設定裡用通關密語開啟展示模式');
			} else if ((e as { code?: number } | null)?.code === 1) {
				// ⚠️ 不用 `instanceof GeolocationPositionError`：那在 TypeScript 的 DOM lib 裡
				//   是 interface 不是 class，寫了編譯不過。code 1 = PERMISSION_DENIED。
				this.showToast('沒有定位權限，沒辦法確認你在哪裡');
			} else {
				this.showToast('連不上伺服器，等一下再試');
			}
		} finally {
			this.summoning = false;
		}
	}

	/** 實地模式的位置。dev 走滑桿，正式建置走 GPS */
	async #fieldPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
		if (dev) {
			const p = this.playerPos;
			// 10 公尺：一個「好但不完美」的精度，足以通過伺服器的 unreliable 門檻，
			// 又不會讓誤差預算變成零——開發時就該踩到跟現場一樣的判定路徑。
			return { lat: p.lat, lng: p.lng, accuracy: 10 };
		}
		const pos = await currentPosition();
		return {
			lat: pos.coords.latitude,
			lng: pos.coords.longitude,
			accuracy: pos.coords.accuracy
		};
	}

	/** 展示模式：用畫面上的位置挑最近的一站送給伺服器 */
	#closestSiteId(): string {
		const p = this.playerPos;
		let bestId = this.#sites[0]?.id ?? '';
		let best = Infinity;
		for (const s of this.#sites) {
			const d = haversine(p, { lat: s.lat, lng: s.lng });
			if (d < best) {
				best = d;
				bestId = s.id;
			}
		}
		return bestId;
	}

	/**
	 * 把玩家放到指定座標（長按地圖）。**只有展示模式下有效**——
	 * 一般模式下讓玩家自己指定位置，等於推翻核心設計第 1 條「硬到場」。
	 *
	 * ⚠️ 就算前端這裡漏擋了也沒有後果：實地模式送的是座標，
	 *   而伺服器拿到座標一樣要判定。真正被擋住的是展示模式那條路（送 siteId 要 cookie）。
	 */
	placeAt(p: LatLng) {
		if (!this.demoMode) {
			this.showToast('要先在設定裡開啟展示模式，才能自訂位置');
			return;
		}
		this.posOverride = { lat: p.lat, lng: p.lng };
	}

	/** 回到沿 WALK_PATH 的模擬位置。拖動滑桿時要呼叫，否則滑桿會看起來壞掉 */
	clearPlacement() {
		this.posOverride = null;
	}

	// ── 視窗與提示 ────────────────────────────────────────────

	toggleMenu() {
		this.menuOpen = !this.menuOpen;
		if (!this.menuOpen) this.closeWindow();
	}

	closeWindow() {
		this.openWindow = null;
		this.openThread = null;
	}

	/** 聊過的靈魂（有訊息的才算），聊天視窗的第一層清單用 */
	get threads() {
		return this.#sites
			.filter((s) => (this.history[s.id]?.length ?? 0) > 0)
			.map((s) => {
				const msgs = this.history[s.id] ?? [];
				return {
					id: s.id,
					name: s.name,
					count: msgs.length,
					last: msgs[msgs.length - 1]?.text ?? ''
				};
			});
	}

	/**
	 * 圖鑑。★ 由 `/api/collection` 給，前端不再自己拼卡片。
	 *
	 * ⚠️ 未獲得的卡**沒有卡面內容**（伺服器端的型別擋住了），所以這裡也拿不到
	 *   標題與卡背文字——想畫也畫不出來。那是刻意的：那句話是拿到卡的那一刻
	 *   才該讀到的東西。
	 */
	get cards(): CollectionCard[] {
		return this.#cards;
	}

	get cardsOwned(): number {
		return this.#cardsOwned;
	}

	showToast(text: string) {
		this.toast = text;
		if (this.#toastTimer) clearTimeout(this.#toastTimer);
		this.#toastTimer = setTimeout(() => (this.toast = null), 2600);
	}

	dismissToast() {
		if (this.#toastTimer) clearTimeout(this.#toastTimer);
		this.toast = null;
	}

	// ── 進出景點 ──────────────────────────────────────────────

	/**
	 * 進入 L2。
	 *
	 * ⚠️ 判準是 `canEnter`（＝手上有這一站的在場憑證），不再是前端算的距離。
	 * ⚠️ 批 2 會在這裡接上 `POST /api/site/:id/enter`（發相遇卡）。
	 *   在那之前對話仍是佔位文字。
	 */
	enterSite(id: string) {
		const site = this.sites.find((s) => s.id === id);
		if (!site) return;

		if (!site.canEnter) {
			this.showToast(
				this.validPresence
					? '你手上的憑證是別的地方的。到這裡再呼喚一次。'
					: `還在 ${site.distanceM} 公尺外，先按「呼喚靈魂」問問看`
			);
			return;
		}

		this.activeSiteId = id;
		this.mode = 'chat';
		this.panelOpen = true;
		this.menuOpen = false;
		this.openWindow = null;
		this.messages = this.history[id] ?? [];
		if (!this.visited.includes(id)) this.visited = [...this.visited, id];
	}

	leave() {
		// 先存起來再清空，否則聊天紀錄永遠是空的
		if (this.activeSiteId && this.messages.length > 0) {
			this.history = { ...this.history, [this.activeSiteId]: this.messages };
		}
		this.mode = 'map';
		this.activeSiteId = null;
		this.messages = [];
		this.pending = false;
	}

	toggleCamera() {
		if (this.mode === 'camera') {
			this.mode = 'chat';
			return;
		}
		if (this.mode === 'chat') {
			this.mode = 'camera';
			this.menuOpen = false;
			this.openWindow = null;
			return;
		}
		// 地圖狀態下按 ◎ 等於呼喚靈魂
		void this.summon();
	}

	/**
	 * 送出一句話。
	 * ⚠️ 還沒接 `/api/chat`（批 2）。現在回的是標明過的佔位文字。
	 */
	send(text: string) {
		const body = text.trim();
		if (!body) return;
		if (this.pending) return;
		if (this.mode === 'map') return;

		this.messages = [...this.messages, { id: this.#nextId++, from: 'me', text: body }];
		this.pending = true;

		const pick = PLACEHOLDER_REPLIES[this.messages.length % PLACEHOLDER_REPLIES.length];
		setTimeout(() => {
			this.messages = [...this.messages, { id: this.#nextId++, from: 'soul', text: pick }];
			this.pending = false;
		}, 900);
	}
}

/** 單例。整個介面共用同一份狀態 */
export const session = new Session();
