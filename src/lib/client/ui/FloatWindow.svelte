<script lang="ts">
	/**
	 * 浮空視窗外框 —— 三個視窗共用，內容由子元件負責。
	 *
	 * ⚠️ z 序高於底下的按鈕。前身專案在 UI Toolkit 上沒有 z-index，
	 *    踩過「開著收藏還按得到底下的按鈕」的坑（2026-08-18 實機發現）。
	 *    瀏覽器有 z-index，這裡直接用 tokens.css 的 --ut-z-window。
	 *
	 * ⚠️ 返回鍵只有「聊天」會出現——它是唯一有兩層的視窗。
	 */
	import { session } from '$lib/client/mock/session.svelte';
	import WinCards from './WinCards.svelte';
	import WinChat from './WinChat.svelte';
	import WinSettings from './WinSettings.svelte';

	const TITLES = { log: '聊天', cards: '收藏', settings: '設定' } as const;
	const showBack = $derived(session.openWindow === 'log' && session.openThread !== null);
</script>

{#if session.openWindow}
	<section class="win ut-px-frame--win">
		<header>
			<div class="left">
				{#if showBack}
					<button class="back" onclick={() => (session.openThread = null)} aria-label="回到清單">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>
				{/if}
				<span class="title ut-txt">{TITLES[session.openWindow]}</span>
			</div>
			<button class="close" onclick={() => session.closeWindow()} aria-label="關閉">✕</button>
		</header>

		<div class="body">
			{#if session.openWindow === 'log'}
				<WinChat />
			{:else if session.openWindow === 'cards'}
				<WinCards />
			{:else}
				<WinSettings />
			{/if}
		</div>
	</section>
{/if}

<style>
	.win {
		position: absolute;
		left: 14px;
		right: 54px;
		top: calc(env(safe-area-inset-top, 0px) + 62px);
		bottom: calc(env(safe-area-inset-bottom, 0px) + 68px);
		/* 蓋掉框變體的 flex 置中——視窗是上下堆疊的 */
		display: flex;
		flex-direction: column;
		align-items: stretch;
		z-index: var(--ut-z-window);
		overflow: hidden;
	}
	header {
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 16px;
		border-bottom: 2px solid var(--ut-line-soft);
		flex: none;
	}
	.left {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.title {
		font-size: 14px;
		line-height: 1;
	}
	.back,
	.close {
		border: none;
		background: none;
		cursor: pointer;
		font: inherit;
		font-size: 14px;
		line-height: 1;
		color: var(--ut-ink-2);
		padding: 0;
		display: flex;
		align-items: center;
		flex: none;
	}
	.back svg {
		width: 14px;
		height: 14px;
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: 14px 16px 18px;
	}
</style>
