/**
 * 介面展示用的狀態機 —— 三層介面的唯一真相來源。
 *
 * ★ 這一層刻意跟 UI 元件分開，因為它就是之後要被替換掉的東西：
 *   現在是假的（滑桿模擬位置、佔位回應），接後端時只換這個檔的內部實作，
 *   元件一行都不用改。這是「先確認介面、再做後端」能省到工的前提。
 *
 * 給 Python 背景的對照：
 *   $state(x) 宣告的欄位一被指派，用到它的畫面就自動重畫——
 *   不需要手動通知任何人。Python 沒有對應語法，最接近的是
 *   「屬性被 set 時自動觸發所有觀察者」，但這裡是編譯器做的，沒有執行期開銷。
 *   class 裡的 get 就是 Python 的 @property，用法一模一樣。
 */

import { MAP_WIDTH_M, PLACEHOLDER_REPLIES, SITES, WALK_PATH, type SiteId } from './data';

export type Mode = 'map' | 'chat' | 'camera';

export type Message = {
	id: number;
	from: 'me' | 'soul';
	text: string;
};

/** 每個景點當下的距離與可及狀態，由玩家位置即時算出 */
export type SiteState = {
	id: SiteId;
	name: string;
	x: number;
	y: number;
	distanceM: number;
	/** 進了感應範圍：畫漣漪，告訴玩家這裡有東西 */
	sensed: boolean;
	/** 進了召喚範圍：點得動。對應 SDD §5.5 的到場判定 */
	reachable: boolean;
	confirmed: boolean;
};

/** 沿 WALK_PATH 線性插值。t 為 0..1 */
function walkAt(t: number): { x: number; y: number } {
	const segs = WALK_PATH.length - 1;
	const pos = Math.min(Math.max(t, 0), 1) * segs;
	const i = Math.min(Math.floor(pos), segs - 1);
	const f = pos - i;
	const a = WALK_PATH[i];
	const b = WALK_PATH[i + 1];
	return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

class Session {
	/** 三層介面的當前狀態。相機是從 chat 切進去的，不是獨立的第四態 */
	mode = $state<Mode>('map');

	/** 0..100 的滑桿值，模擬「從西門紅樓走到剝皮寮」的那段路 */
	walk = $state(0);

	activeSiteId = $state<SiteId | null>(null);
	messages = $state<Message[]>([]);

	/** 對話窗是否展開。收起來才看得到底下的地圖 */
	panelOpen = $state(true);
	menuOpen = $state(false);
	openWindow = $state<'log' | 'cards' | 'settings' | null>(null);
	toast = $state<string | null>(null);

	/**
	 * 上一句還在等回覆。
	 * ⚠️ 這不是載入動畫的旗標，是**額度保護**——連按兩次 Enter 會送出兩個請求，
	 * 每一次都真的花錢。前身專案就是這樣設計的，照抄。
	 */
	pending = $state(false);

	/**
	 * 呼喚中 —— 只有這段期間召喚點才擴散漣漪。
	 *
	 * ★ 設計上的關鍵：漣漪是**動作的回饋**，不是持續的狀態指示。
	 *   如果走到哪都自己亮，「呼喚靈魂」就變成一顆確認你已經知道的事的按鈕。
	 *   （A.L. 2026-08-25 拍板，與前身專案的持續漣漪不同。）
	 */
	pulsing = $state(false);

	#nextId = 1;
	#toastTimer: ReturnType<typeof setTimeout> | null = null;
	#pulseTimer: ReturnType<typeof setTimeout> | null = null;

	get playerPos() {
		return walkAt(this.walk / 100);
	}

	/** 每個景點的即時狀態。地圖圖層直接畫這個陣列 */
	get sites(): SiteState[] {
		const p = this.playerPos;
		return SITES.map((s) => {
			const dx = (s.x - p.x) * MAP_WIDTH_M;
			const dy = (s.y - p.y) * MAP_WIDTH_M;
			const distanceM = Math.round(Math.hypot(dx, dy));
			return {
				id: s.id,
				name: s.name,
				x: s.x,
				y: s.y,
				distanceM,
				sensed: distanceM <= s.sensingM,
				reachable: distanceM <= s.summonM,
				confirmed: s.confirmed
			};
		});
	}

	get activeSite(): SiteState | null {
		return this.sites.find((s) => s.id === this.activeSiteId) ?? null;
	}

	/** 附近有沒有可召喚的靈魂。「查看附近靈魂」那顆按鈕用 */
	get nearby(): SiteState[] {
		return this.sites.filter((s) => s.reachable);
	}

	/**
	 * ≡ 的開關。
	 * ⚠️ 收起選單時要一併關掉浮空視窗——視窗是從選單開出來的，
	 * 選單收了視窗還留著，玩家會找不到怎麼關它。
	 */
	toggleMenu() {
		this.menuOpen = !this.menuOpen;
		if (!this.menuOpen) this.openWindow = null;
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

	enterSite(id: SiteId) {
		const site = this.sites.find((s) => s.id === id);
		if (!site) return;
		if (!site.reachable) {
			this.showToast(`還在 ${site.distanceM} 公尺外，再靠近一點`);
			return;
		}
		this.activeSiteId = id;
		this.mode = 'chat';
		this.panelOpen = true;
		this.menuOpen = false;
		this.openWindow = null;
		this.messages = [];
	}

	leave() {
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
			// 相機模式要把畫面留給實景（前身專案的決定，照抄）
			this.menuOpen = false;
			this.openWindow = null;
			return;
		}
		// 地圖狀態下按 ◎ 等於「查看附近靈魂」——前身專案的設計，照抄
		this.lookAround();
	}

	lookAround() {
		// 先讓漣漪擴散——不管有沒有靈魂，呼喚這個動作本身要有回應
		this.pulsing = true;
		if (this.#pulseTimer) clearTimeout(this.#pulseTimer);
		// 4.8 秒＝兩輪漣漪動畫（2.4s ×2），播完就安靜下來
		this.#pulseTimer = setTimeout(() => (this.pulsing = false), 4800);

		const sensed = this.sites.filter((s) => s.sensed);
		if (sensed.length === 0) {
			this.showToast('沒有回應。附近沒有靈魂。');
			return;
		}
		const near = this.nearby;
		if (near.length === 0) {
			const closest = sensed.reduce((a, b) => (a.distanceM <= b.distanceM ? a : b));
			this.showToast(`${closest.name}有回應，但還在 ${closest.distanceM} 公尺外`);
			return;
		}
		this.showToast(`${near.map((s) => s.name).join('、')}回應了你`);
	}

	send(text: string) {
		const body = text.trim();
		if (!body) return; // 空白訊息送不出去
		if (this.pending) return; // 上一句還在等回覆
		if (this.mode === 'map') return; // 還沒選定對象

		this.messages = [...this.messages, { id: this.#nextId++, from: 'me', text: body }];
		this.pending = true;

		// 假的「思考中」延遲。接上 speak() 之後這裡換成真的 await
		const pick = PLACEHOLDER_REPLIES[this.messages.length % PLACEHOLDER_REPLIES.length];
		setTimeout(() => {
			this.messages = [...this.messages, { id: this.#nextId++, from: 'soul', text: pick }];
			this.pending = false;
		}, 900);
	}
}

/** 單例。整個展示共用同一份狀態 */
export const session = new Session();
