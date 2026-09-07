/**
 * 背景音樂 —— 每站一首，地圖時放預設曲。
 *
 * ★ 這是**純畫面狀態**，所以放在 ui/ 而不是 mock/session。
 *   同 `mapView.svelte.ts` 的理由：那一層是接後端時要被換掉的資料層，
 *   而「現在音量開多大」跟伺服器一點關係都沒有。
 *
 * ★★★ 三個瀏覽器現實，每一個都會讓「照直覺寫」的版本壞掉：★★★
 *
 *   ① **不准自動播放。** 使用者沒有動過手之前，`play()` 會被拒絕
 *      （Chrome/Safari 都是），而且是回一個 rejected Promise ——
 *      不處理的話 console 會噴 `NotAllowedError`，而音樂只是安靜地沒響。
 *      → 所以有 `unlock()`：第一次互動時才真的開始播。
 *
 *   ② **每首 1.5–3.6 MB，玩家在戶外用行動網路。** 一次載七首是不可能的。
 *      → `preload = 'none'`，切到哪一首才載哪一首。最壞情況只載兩首。
 *
 *   ③ **切歌不能硬切。** 直接換 `src` 會「啪」一聲斷掉，很難聽。
 *      → 淡出舊的、換源、淡入新的。用 setInterval 調 volume 就夠了，
 *        不值得為此引入 Web Audio API 的整套 AudioContext。
 *
 * 給 Python 背景的對照：這個 class 沒有 $state 欄位——它包的是一個
 * 瀏覽器物件（HTMLAudioElement），畫面不需要跟著它重畫。
 */

/** 淡入淡出的時間（毫秒）。夠短不拖沓，夠長不突兀 */
const FADE_MS = 400;
/** 淡出的更新間隔。25ms ≈ 40fps，音量變化聽不出階梯 */
const FADE_STEP_MS = 25;

class Music {
	#audio: HTMLAudioElement | null = null;
	/** 目前這首的路徑。相同就不重播——切回同一站不該從頭開始 */
	#track: string | null = null;
	/** 玩家有沒有動過手。沒有的話瀏覽器不准出聲 */
	#unlocked = false;
	#enabled = true;
	/** 0..1 */
	#volume = 0.7;
	#fadeTimer: ReturnType<typeof setInterval> | null = null;
	/** 想播但還沒解鎖的那一首 */
	#pending: string | null = null;

	/**
	 * 玩家第一次互動時呼叫。
	 *
	 * ★ 在那之前所有 play() 都會被拒絕，所以先把想播的記在 #pending，
	 *   解鎖的那一刻補播。這樣「開啟網頁 → 點任何東西 → 音樂進來」，
	 *   而不是「點了播放鍵才有音樂」。
	 */
	unlock() {
		if (this.#unlocked) return;
		this.#unlocked = true;
		if (this.#pending) {
			const t = this.#pending;
			this.#pending = null;
			this.play(t);
		}
	}

	/** 切到某一首。傳同一首等於什麼都不做 */
	play(track: string) {
		if (!this.#unlocked) {
			this.#pending = track;
			return;
		}
		if (this.#track === track && this.#audio) {
			// 同一首但被停掉了（例如剛開啟音樂開關）→ 接著播
			if (this.#enabled && this.#audio.paused) void this.#start();
			return;
		}

		this.#track = track;
		if (!this.#enabled) return;

		// 已經在播別的 → 淡出再換
		if (this.#audio && !this.#audio.paused) {
			this.#fadeTo(0, () => this.#swap(track));
			return;
		}
		this.#swap(track);
	}

	setEnabled(on: boolean) {
		if (this.#enabled === on) return;
		this.#enabled = on;

		if (!on) {
			this.#fadeTo(0, () => this.#audio?.pause());
			return;
		}
		if (this.#track) this.play(this.#track);
	}

	/** 0..100（介面用的刻度） */
	setVolume(percent: number) {
		this.#volume = Math.min(100, Math.max(0, percent)) / 100;
		// 淡入淡出進行中就別插手，讓它自己收尾到正確的值
		if (this.#audio && !this.#fadeTimer) this.#audio.volume = this.#volume;
	}

	// ── 內部 ──────────────────────────────────────────────────

	#swap(track: string) {
		this.#stopFade();

		if (!this.#audio) {
			this.#audio = new Audio();
			this.#audio.loop = true;
			// ★ 不預載。要播哪一首才載哪一首（見檔頭 ②）
			this.#audio.preload = 'none';
		}

		this.#audio.src = track;
		this.#audio.volume = 0;
		void this.#start();
		this.#fadeTo(this.#volume);
	}

	async #start() {
		if (!this.#audio) return;
		try {
			await this.#audio.play();
		} catch {
			// ★ 被瀏覽器拒絕（多半是還沒有使用者手勢）。不是錯誤，也不該吵——
			//   等下一次 unlock() 補播就好。音樂沒響不該讓 console 出現紅字。
			this.#unlocked = false;
			this.#pending = this.#track;
		}
	}

	#fadeTo(target: number, done?: () => void) {
		const audio = this.#audio;
		if (!audio) {
			done?.();
			return;
		}
		this.#stopFade();

		const from = audio.volume;
		const steps = Math.max(1, Math.round(FADE_MS / FADE_STEP_MS));
		let i = 0;

		this.#fadeTimer = setInterval(() => {
			i += 1;
			audio.volume = Math.min(1, Math.max(0, from + ((target - from) * i) / steps));
			if (i >= steps) {
				this.#stopFade();
				done?.();
			}
		}, FADE_STEP_MS);
	}

	#stopFade() {
		if (this.#fadeTimer) {
			clearInterval(this.#fadeTimer);
			this.#fadeTimer = null;
		}
	}
}

/** 單例。整個介面共用一個播放器——兩個會疊在一起同時響 */
export const music = new Music();

/**
 * 現在該播哪一首。
 *
 * ★ 地圖層放預設曲，進了某一站就換成那一站的。
 * ⚠️ 音檔以 siteId 命名，所以新增景點時只要把檔案放進 static/audio/ 就會自動接上；
 *   沒有那個檔案的話瀏覽器會 404，而 `<audio>` 的行為是安靜地不播——
 *   不會有錯誤畫面，但也不會有聲音。**新增景點時記得補音檔。**
 */
export function trackFor(siteId: string | null): string {
	return siteId ? `/audio/${siteId}.mp3` : '/audio/default.mp3';
}
