<script lang="ts">
	/**
	 * 介面展示 —— 三層介面的組裝處。
	 *
	 * 這是**正式路由**，不是 /preview。理由：它本來就是產品的介面，
	 * 現在只是資料層還是假的。做成兩份「原型」與「正式版」會產生同步負擔，
	 * 而那正是企劃書 §4.2 記錄的前身專案失敗模式。
	 *
	 * 接後端時要改的只有 src/lib/client/mock/ —— 這一層元件一行都不用動。
	 *
	 * 桌機上包一層手機外框方便對照設計；手機上外框會自動讓開，直接滿版。
	 */
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
</script>

<svelte:head>
	<title>城市物語 Urban Tales</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500&display=swap"
	/>
</svelte:head>

<div class="stage">
	<div class="phone">
		<div class="screen">
			<!-- 相機狀態換掉背景；地圖仍在底下，退出相機就回來 -->
			{#if session.mode === 'camera'}
				<div class="cambg">
					<p>相機畫面（P0-3 才接 getUserMedia）</p>
				</div>
			{:else}
				<MapLayer />
			{/if}

			<SoulLayer />
			<TopBar />
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
		拖滑桿走近景點 → 圖釘出現漣漪 → 點它進入相遇 → 按相機鈕切到 L3，靈魂可拖曳縮放。
	</p>
</div>

<style>
	:global(body) {
		margin: 0;
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
	.cambg {
		position: absolute;
		inset: 0;
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
