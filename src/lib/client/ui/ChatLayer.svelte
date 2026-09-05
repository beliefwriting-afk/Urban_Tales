<script lang="ts">
	/**
	 * L2 相遇 —— 名牌／返回／收合 ＋ 對話窗。
	 *
	 * 對話窗可以用 v／^ 收起來看地圖。
	 * 氣泡：玩家靠右無邊框、靈魂靠左有邊框——兩邊材質不同，一眼分得出誰在說話。
	 */
	import { session } from '$lib/client/mock/session.svelte';

	let boxEl: HTMLDivElement | undefined = $state();

	// 新訊息進來時捲到底。$effect ≈ 「這些值一變就重跑這段」
	$effect(() => {
		// 讀一下長度，$effect 才知道要追蹤它（Svelte 的依賴是靠實際存取收集的）
		const count = session.messages.length;
		if (boxEl && count >= 0) boxEl.scrollTop = boxEl.scrollHeight;
	});
</script>

<div class="bar" class:hidden={session.mode === 'camera'} class:down={!session.panelOpen}>
	<span class="chip ut-px-frame--win"
		><span class="ut-txt">{session.activeSite?.name ?? ''}</span></span
	>
	<span class="spacer"></span>
	<!--
		兩顆按鈕的箭頭共用同一組 SVG 參數（14×14、viewBox 24、stroke-width 2），
		文字符號（‹ v ^）在不同字型下大小與基線都不一樣，對不齊。
	-->
	<button class="ut-px-frame back" onclick={() => session.leave()}>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
		<span class="ut-txt">返回</span>
	</button>
	<button
		class="ut-px-frame sm"
		onclick={() => (session.panelOpen = !session.panelOpen)}
		aria-label={session.panelOpen ? '收合對話' : '展開對話'}
	>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			class:flip={!session.panelOpen}
		>
			<path d="M5 9l7 7 7-7" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	</button>
</div>

{#if session.panelOpen && session.mode !== 'camera'}
	<div class="panel" bind:this={boxEl}>
		{#each session.messages as m (m.id)}
			<p class={m.from === 'me' ? 'bub me ut-px-frame--me' : 'bub soul ut-px-frame'}>
				{m.text}
			</p>
		{:else}
			<p class="empty">說點什麼，或先看看四周。</p>
		{/each}
		{#if session.pending}
			<p class="bub soul thinking ut-px-frame">靈魂正在思考⋯⋯</p>
		{/if}
	</div>
{/if}

<style>
	.bar {
		position: absolute;
		left: 16px;
		right: 16px;
		top: 46%;
		display: flex;
		align-items: center;
		gap: var(--ut-gap);
		z-index: var(--ut-z-chrome);
		/* 收合／展開時整條列要滑過去，不是瞬間跳 */
		transition: top 0.22s ease;
	}
	/*
		對話窗收起來時，這一列掉到輸入框上方——不然它會孤零零地浮在畫面中間，
		底下卻是空的地圖。用 top 而不是切換 top/bottom，切換不同屬性沒辦法過渡。
	*/
	.bar.down {
		top: calc(100% - 104px);
	}
	.bar.hidden {
		display: none;
	}
	.spacer {
		flex: 1;
	}
	.chip {
		height: var(--ut-h-sm);
		padding: 0 18px;
		font-size: 14px;
		/*
			⚠️ 一定要寫死 line-height。預設 normal 由字型的 metrics 決定，
			Cubic 11 的 normal 行高偏大，行框比內容框高，align-items:center
			置中的是行框，字就浮上去了（2026-08-25 實機發現）。
		*/
		line-height: 1;
		justify-content: center;
	}
	.sm {
		width: var(--ut-h-sm);
		height: var(--ut-h-sm);
		justify-content: center;
		flex: none;
		cursor: pointer;
		padding: 0;
	}
	.back {
		height: var(--ut-h-sm);
		padding: 0 14px 0 10px;
		gap: 4px;
		flex: none;
		cursor: pointer;
		font: inherit;
		font-size: 13px;
		line-height: 1;
		justify-content: center;
	}
	.sm svg,
	.back svg {
		width: 14px;
		height: 14px;
		flex: none;
	}
	.flip {
		transform: rotate(180deg);
	}
	.panel {
		position: absolute;
		left: var(--ut-pad);
		right: var(--ut-pad);
		top: calc(46% + 40px);
		bottom: calc(env(safe-area-inset-bottom, 0px) + 68px);
		background: var(--ut-surface);
		border-radius: var(--ut-r-card);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 9px;
		overflow-y: auto;
		z-index: var(--ut-z-chrome);
	}
	.bub {
		margin: 0;
		max-width: 78%;
		/* 氣泡是多行文字，要蓋掉框變體的 flex 置中 */
		display: block;
		padding: 8px 14px;
		/* 圓角半徑 15，太窄的氣泡角會擠在一起 */
		min-width: 34px;
		font-size: 12.5px;
		line-height: 1.7;
	}
	.me {
		align-self: flex-end;
	}
	.soul {
		align-self: flex-start;
	}
	.thinking {
		color: var(--ut-ink-3);
	}
	.empty {
		margin: auto;
		font-size: 12px;
		color: var(--ut-ink-3);
	}
</style>
