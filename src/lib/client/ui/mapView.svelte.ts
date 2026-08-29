/**
 * 地圖的「相機」狀態 —— 位置、縮放、方位、羅盤跟隨。
 *
 * ★ 為什麼要獨立成一個檔，不放在 MapLayer 裡面：
 *   「回到我的位置」那顆按鈕要跟「呼喚靈魂」排在同一列，而那一列在 InputRow。
 *   兩個元件要讀寫同一份相機狀態，就不能讓它住在其中一邊。
 *
 * ★ 為什麼不放進 `mock/session.svelte.ts`：
 *   那一層是「接後端時要被換掉」的資料層。相機位置、縮放倍率、地圖轉了幾度
 *   全都是純畫面狀態，後端不會也不該知道。混進去會讓那一層變得換不掉。
 *
 * 給 Python 背景的對照：
 *   這就是一個模組級的單例，等同你在 Python 寫一個 class 然後在檔案結尾
 *   `state = MapState()`。差別只在欄位用 `$state` 宣告，改了畫面會自己重畫。
 */

import type { LevelName, LonLat } from './tiles';

/**
 * 縮放階梯。
 *
 * ★ 為什麼是離散的：像素風不能用連續縮放，非整數倍會被瀏覽器內插、硬邊糊掉。
 *   捏合手勢只負責預覽，放開手才吸附到這裡面最近的一階。
 */
export type ZoomStop = { level: LevelName; scale: number };

export const ZOOM_LADDER: readonly ZoomStop[] = [
	{ level: 'far', scale: 2 }, // 8.0 公尺/CSS px —— 一屏約 3.1 km
	{ level: 'far', scale: 4 }, // 4.0 —— 約 1.6 km
	{ level: 'near', scale: 2 }, // 2.0 —— 約 780 m
	{ level: 'near', scale: 3 }, // 1.33 —— 約 520 m（預設）
	{ level: 'near', scale: 4 } // 1.0 —— 約 390 m
] as const;

export const DEFAULT_ZOOM = 3;

/** 方位角接近正北時直接吸附成 0，讓最常用的角度是完美銳利的 */
const NORTH_SNAP_DEG = 5;

/** 把角度收進 (-180, 180]。轉過頭之後的差值計算全靠它 */
export function normalizeDeg(deg: number): number {
	let d = ((deg + 180) % 360) - 180;
	if (d <= -180) d += 360;
	return d;
}

class MapView {
	/** 相機錨點。null ＝ 跟著玩家；非 null ＝ 玩家已經把地圖拖開了 */
	camAnchor = $state<LonLat | null>(null);

	/** 地圖轉了幾度，順時針為正。0 ＝ 正北朝上 */
	bearing = $state(0);

	zoomStep = $state(DEFAULT_ZOOM);

	/** 羅盤跟隨：地圖自動轉到手機面對的方向 */
	follow = $state(false);

	/** 裝置回報的方位角還沒到過（用來分辨「不支援」與「還沒動」） */
	compassSeen = $state(false);

	#handler: ((e: DeviceOrientationEvent) => void) | null = null;
	#eventName: 'deviceorientationabsolute' | 'deviceorientation' = 'deviceorientation';

	get stop(): ZoomStop {
		return ZOOM_LADDER[this.zoomStep];
	}

	get level(): LevelName {
		return this.stop.level;
	}

	get scale(): number {
		return this.stop.scale;
	}

	/** 這一階的「一個 CSS 像素代表幾公尺地面」。階梯之間的比較都用這個量 */
	metresPerCssPx(s: ZoomStop, groundMpp: number): number {
		return groundMpp / s.scale;
	}

	zoomBy(delta: number) {
		this.zoomStep = Math.max(0, Math.min(ZOOM_LADDER.length - 1, this.zoomStep + delta));
	}

	recenter() {
		this.camAnchor = null;
	}

	/** 轉回正北，並關掉跟隨（不然下一個事件又把它轉走了） */
	resetNorth() {
		this.follow = false;
		this.stopCompass();
		this.bearing = 0;
	}

	/** 手勢轉動時呼叫。使用者自己轉了，就代表他不要跟隨了 */
	setBearingByGesture(deg: number) {
		if (this.follow) {
			this.follow = false;
			this.stopCompass();
		}
		this.bearing = normalizeDeg(deg);
	}

	/** 手勢結束時吸附回正北 */
	snapNorthIfClose() {
		if (Math.abs(normalizeDeg(this.bearing)) < NORTH_SNAP_DEG) this.bearing = 0;
	}

	/**
	 * 開啟羅盤跟隨。
	 *
	 * ⚠️ 兩個平台差很多：
	 *   iOS 走 `webkitCompassHeading`，而且**必須先呼叫 requestPermission()**，
	 *     那個呼叫只能在使用者手勢裡發生（所以這個函式只從按鈕的 onclick 呼叫）。
	 *   Android 走 `deviceorientationabsolute` 的 alpha，需要換算成方位角。
	 *
	 * ⚠️ 而且**兩邊都要求安全情境**。區網的 http 位址不算，事件不會觸發——
	 *   本機測試會看起來像程式壞了。上線到 https 就正常。
	 */
	async startCompass(): Promise<{ ok: boolean; reason?: string }> {
		if (typeof window === 'undefined') return { ok: false, reason: '不在瀏覽器裡' };
		if (!('DeviceOrientationEvent' in window)) {
			return { ok: false, reason: '這台裝置沒有方位感測器' };
		}

		// iOS 13+ 的權限詢問。型別定義裡沒有這個靜態方法，要自己描述形狀
		const Ctor = window.DeviceOrientationEvent as unknown as {
			requestPermission?: () => Promise<PermissionState | 'granted' | 'denied'>;
		};
		if (typeof Ctor.requestPermission === 'function') {
			try {
				const res = await Ctor.requestPermission();
				if (res !== 'granted') return { ok: false, reason: '沒有取得方位權限' };
			} catch {
				return { ok: false, reason: '方位權限詢問失敗' };
			}
		}

		this.stopCompass();
		this.#eventName =
			'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';

		this.#handler = (e: DeviceOrientationEvent) => {
			const heading = readHeading(e);
			if (heading === null) return;
			this.compassSeen = true;
			// 玩家朝向要「朝上」，所以地圖要往反方向轉
			this.bearing = smoothTowards(this.bearing, normalizeDeg(-heading), 0.18);
		};
		window.addEventListener(this.#eventName, this.#handler, true);
		this.follow = true;
		this.compassSeen = false;
		return { ok: true };
	}

	stopCompass() {
		if (this.#handler) {
			window.removeEventListener(this.#eventName, this.#handler, true);
			this.#handler = null;
		}
		this.follow = false;
	}
}

/** 從事件取出「相對正北的方位角」，取不到就回 null */
function readHeading(e: DeviceOrientationEvent): number | null {
	// iOS：直接給方位角，而且已經是相對正北的
	const wk = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
	if (typeof wk === 'number' && !Number.isNaN(wk)) return wk;

	// 其他平台：alpha 是繞 z 軸的旋轉，方位角要反過來算
	if (e.absolute && typeof e.alpha === 'number') return 360 - e.alpha;
	return null;
}

/**
 * 往目標角度靠近一點點（低通濾波）。
 *
 * ★ 羅盤讀數很吵，直接照抄會讓地圖一直抖。
 *   ⚠️ 一定要走「最短路徑」：359 度到 1 度的差是 +2 度不是 −358 度，
 *     不處理的話每次跨過正北地圖就會整圈甩過去。
 */
function smoothTowards(current: number, target: number, k: number): number {
	const delta = normalizeDeg(target - current);
	return normalizeDeg(current + delta * k);
}

/** 單例。地圖層與輸入列共用同一份相機狀態 */
export const mapView = new MapView();
