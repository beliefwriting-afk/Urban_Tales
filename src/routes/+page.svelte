<script lang="ts">
	/**
	 * 介面展示 —— 三層介面的組裝處。
	 *
	 * 這是**正式路由**，不是 /preview。理由：它本來就是產品的介面，
	 * 現在只是資料層還是假的。做成兩份「原型」與「正式版」會產生同步負擔，
	 * 而那正是企劃書 §4.2 要避免的失敗模式。
	 *
	 * 接後端時要改的只有 src/lib/client/mock/ —— 這一層元件一行都不用動。
	 *
	 * 桌機上包一層手機外框方便對照設計；手機上外框會自動讓開，直接滿版。
	 */
	import { onMount } from 'svelte';
	import '$lib/styles/tokens.css';
	import { session } from '$lib/client/mock/session.svelte';
	import ChatLayer from '$lib/client/ui/ChatLayer.svelte';
	import DebugBar from '$lib/client/ui/DebugBar.svelte';
	import FloatWindow from '$lib/client/ui/FloatWindow.svelte';
	import InputRow from '$lib/client/ui/InputRow.svelte';
	import MapLayer from '$lib/client/ui/MapLayer.svelte';
	import SoulLayer from '$lib/client/ui/SoulLayer.svelte';
	import Toast from '$lib/client/ui/Toast.svelte';
	import TopBar from '$lib/client/ui/TopBar.svelte';
	import { music, trackFor } from '$lib/client/ui/music.svelte';

	/**
	 * ★ 切片 7：啟動時跟伺服器要景點、身分、圖鑑。
	 *
	 *   放 onMount 而不是 SvelteKit 的 `load`：這三份資料都跟「這個瀏覽器是誰」
	 *   有關（`/api/me` 讀的是 cookie），而且地圖是純前端狀態機——
	 *   走 SSR 的 load 只會讓伺服器多渲染一份馬上就被前端狀態蓋掉的畫面。
	 *
	 *   ⚠️ 沒接上之前畫面是空的（沒有景點就沒有圖釘），所以 session.ready
	 *   與 session.loadError 要顯示出來，不能靜靜地留一片空白。
	 */
	onMount(() => {
		void session.load();

		/**
		 * ★ 瀏覽器不准網頁在使用者動手之前出聲。
		 *
		 *   所以音樂不是「載入就播」，是「玩家第一次碰畫面才播」。
		 *   用 `once: true` 是因為解鎖只需要一次；掛在 window 上是因為
		 *   第一個動作可能發生在任何地方（拖地圖、開選單、按呼喚）。
		 *
		 *   ⚠️ 不要改成只掛在某顆按鈕上——那會變成「玩家不按那顆就永遠沒有音樂」。
		 */
		const unlock = () => music.unlock();
		window.addEventListener('pointerdown', unlock, { once: true });
		window.addEventListener('keydown', unlock, { once: true });

		return () => {
			window.removeEventListener('pointerdown', unlock);
			window.removeEventListener('keydown', unlock);
		};
	});

	/**
	 * 音樂跟著畫面走：地圖層放預設曲，進了某一站換成那一站的。
	 *
	 * ★ 用 $effect 而不是在 enterSite() 裡呼叫播放器：狀態變化的來源有好幾個
	 *   （進站、離開、切相機、開關音樂、拉音量），一個個去記得呼叫遲早會漏。
	 *   讓它跟著狀態自己走，就不會有「某條路徑忘了換歌」這種 bug。
	 */
	$effect(() => {
		music.setEnabled(session.musicOn);
		music.setVolume(session.musicVolume);
		music.play(trackFor(session.mode === 'map' ? null : session.activeSiteId));
	});
</script>

<svelte:head>
	<title>城市物語 Urban Tales</title>
	<!--
		★ 關掉整頁縮放。這個介面全部是固定定位、沒有可捲動的長文，
		  整頁縮放只會把版面弄亂（2026-08-28 實機確認）。縮放交給地圖自己處理，
		  地圖層有離散的五階縮放，見 MapLayer.svelte。
		⚠️ 取捨：這也擋掉了「放大看小字」這個無障礙手段。
		  對這種全螢幕固定版面的應用是業界常態，但它確實是個取捨，不是白吃的午餐。
	-->
	<meta
		name="viewport"
		content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
	/>
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500&display=swap"
	/>
</svelte:head>

<div class="stage">
	<div class="phone">
		<div class="screen">
			<!--
				相機狀態換掉背景；地圖**仍然掛著**，只是被蓋住，退出相機就回來。
				★ 2026-08-28 改成「蓋住」而不是「換掉」：原本用 {:else} 會讓 MapLayer
				  在每次進出相機時整個卸載重掛，圖磚要重新解碼、狀態要重建。
				  註解本來就寫著「地圖仍在底下」，但程式其實是換掉的——現在名實相符了。
			-->
			<MapLayer />
			{#if session.mode === 'camera'}
				<div class="cambg">
					<p>相機畫面（P0-3 才接 getUserMedia）</p>
				</div>
			{/if}

			<SoulLayer />
			<TopBar />

			<!--
				★ 展示模式的標示條（SDD §5.4 要求全程顯示）。
				  ⚠️ 它讀的是 /api/me 回的值，不是前端自己的開關——
				  前端已經沒有那個開關了（切片 7 刪掉的第 2 項）。
			-->
			{#if session.demoMode}
				<div class="demobar ut-txt">展示模式</div>
			{/if}

			{#if session.loadError}
				<div class="loaderr ut-txt">
					{session.loadError}
					<button onclick={() => session.load()}>重試</button>
				</div>
			{:else if !session.ready}
				<div class="loaderr ut-txt">載入中⋯⋯</div>
			{/if}
			{#if session.mode !== 'map'}
				<ChatLayer />
			{/if}
			<FloatWindow />
			<InputRow />
			<Toast />
		</div>
	</div>

	<DebugBar />
	<p class="note">
		拖滑桿走近景點 → 按「呼喚靈魂」問伺服器 → 拿到在場憑證才點得進去 → 按相機鈕切到 L3。
	</p>
</div>

<style>
	:global(body) {
		margin: 0;
		/* 擋掉下拉重新整理與橡皮筋回彈，否則往下拖地圖會變成刷新頁面 */
		overscroll-behavior: none;
		background: #f4f1ea;
		font-family: var(--ut-font);
		color: var(--ut-ink);
		-webkit-text-size-adjust: 100%;
	}
	.stage {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 16px;
		gap: 4px;
	}
	.phone {
		border: 8px solid #2b2b2b;
		border-radius: 36px;
		overflow: hidden;
		background: #2b2b2b;
		flex: none;
	}
	.screen {
		position: relative;
		width: 300px;
		height: 620px;
		overflow: hidden;
		background: var(--ut-bg-map);
	}
	/* 展示模式標示條：SDD §5.4 要求全程顯示，所以它蓋在所有層之上 */
	.demobar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 99;
		text-align: center;
		font-size: 10px;
		line-height: 18px;
		background: rgba(43, 38, 32, 0.82);
		color: #f4f1ea;
		letter-spacing: 2px;
		pointer-events: none;
	}
	.loaderr {
		position: absolute;
		left: 16px;
		right: 16px;
		bottom: 96px;
		z-index: 98;
		padding: 8px 10px;
		font-size: 11px;
		line-height: 1.7;
		text-align: center;
		background: rgba(43, 38, 32, 0.86);
		color: #f4f1ea;
		border-radius: 4px;
	}
	.loaderr button {
		margin-left: 8px;
		font: inherit;
		color: inherit;
		background: none;
		border: 1px solid currentColor;
		border-radius: 3px;
		padding: 1px 8px;
		cursor: pointer;
	}
	.cambg {
		position: absolute;
		inset: 0;
		/* 蓋在地圖之上、靈魂立繪之下。地圖是 --ut-z-map: 1，立繪是 2 */
		z-index: 1;
		background: var(--ut-bg-cam);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 96px;
	}
	.cambg p {
		margin: 0;
		font-size: 12px;
		color: rgba(255, 255, 255, 0.85);
	}
	.note {
		margin: 4px 0 0;
		font-size: 11.5px;
		line-height: 1.8;
		color: var(--ut-ink-3);
		text-align: center;
		max-width: 32rem;
	}

	/* 手機上不需要假外框，直接滿版 */
	@media (max-width: 480px) {
		.stage {
			padding: 0;
			justify-content: flex-start;
		}
		.phone {
			border: none;
			border-radius: 0;
			width: 100%;
		}
		.screen {
			width: 100vw;
			height: 100dvh;
		}
		.note {
			display: none;
		}
	}
</style>
