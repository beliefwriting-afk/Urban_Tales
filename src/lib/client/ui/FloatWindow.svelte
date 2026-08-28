<script lang="ts">
	/**
	 * 浮空視窗外框 —— 三個視窗共用。
	 *
	 * ⚠️ z 序高於底下的按鈕。前身專案在 UI Toolkit 上沒有 z-index，
	 *    踩過「開著收藏還按得到底下的按鈕」的坑（2026-08-18 實機發現）。
	 *    瀏覽器有 z-index，這裡直接用 tokens.css 的 --ut-z-window。
	 *
	 * 成就卡方陣**不分區**：相遇卡 5 ＋ 任務卡 5 ＋ 劇情卡 3 排在一起，
	 * 順序照類別自然落位（前身 2026-08-18 的決定，在本專案仍然成立）。
	 * 空格不畫剪影——不劇透。
	 */
	import { session } from '$lib/client/mock/session.svelte';

	const TITLES = { log: '聊天', cards: '收藏', settings: '設定' } as const;

	// 13 張：相遇 ×5、任務 ×5、劇情 ×3。第一階段全部鎖著，只看排版
	const CARDS = [
		...Array.from({ length: 5 }, (_, i) => ({ kind: '相遇', n: i + 1 })),
		...Array.from({ length: 5 }, (_, i) => ({ kind: '任務', n: i + 1 })),
		...Array.from({ length: 3 }, (_, i) => ({ kind: '劇情', n: i + 1 }))
	];
</script>

{#if session.openWindow}
	<section class="win ut-px-frame--win">
		<header>
			<span class="title ut-txt">{TITLES[session.openWindow]}</span>
			<button onclick={() => (session.openWindow = null)} aria-label="關閉">✕</button>
		</header>

		<div class="body">
			{#if session.openWindow === 'cards'}
				<p class="hint">13 張：相遇 5 ／ 任務 5 ／ 劇情 3。空格是還沒解鎖，刻意不畫剪影。</p>
				<div class="grid">
					{#each CARDS as c, i (i)}
						<div class="card">
							<span class="kind">{c.kind}</span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="hint">這個視窗的內容排在第二階段。外框、開關、層序已經可以用了。</p>
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
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 16px;
		border-bottom: 1px solid var(--ut-line-soft);
		flex: none;
	}
	.title {
		font-size: 14px;
	}
	header button {
		border: none;
		background: none;
		cursor: pointer;
		font: inherit;
		font-size: 14px;
		color: var(--ut-ink-2);
		padding: 0;
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: 12px 16px 16px;
	}
	.hint {
		margin: 0 0 12px;
		font-size: 11.5px;
		line-height: 1.8;
		color: var(--ut-ink-3);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--ut-gap);
	}
	.card {
		aspect-ratio: 3 / 4;
		border: 2px dashed var(--ut-line);
		background: rgba(0, 0, 0, 0.02);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.kind {
		font-size: 10px;
		color: var(--ut-ink-4);
	}
</style>
