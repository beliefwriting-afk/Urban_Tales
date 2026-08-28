<script lang="ts">
	/**
	 * 收藏 —— 13 格方陣 ＋ 放大檢視。
	 *
	 * 前身專案 2026-08-18 拍板的三條規則，本專案照樣成立：
	 *   1. 方陣**不分區**，相遇／任務／劇情排在一起，照類別自然落位
	 *   2. 空格**不畫剪影**——不劇透
	 *   3. 放大檢視時圖與說明**整包一起捲**，長文字才讀得完
	 */
	import { session } from '$lib/client/mock/session.svelte';
	import { kindLabel } from '$lib/client/mock/data';

	let bigId = $state<string | null>(null);
	const big = $derived(session.cards.find((c) => c.id === bigId) ?? null);
	const unlockedCount = $derived(session.cards.filter((c) => c.unlocked).length);
</script>

<p class="hint">
	{unlockedCount} / {session.cards.length}&#12288;空格是還沒解鎖的，刻意不畫剪影。
</p>

<div class="grid">
	{#each session.cards as c (c.id)}
		{#if c.unlocked}
			<button class="card got ut-px-frame" onclick={() => (bigId = c.id)}>
				<span class="face" aria-hidden="true"></span>
				<span class="kind ut-txt">{kindLabel(c.kind)}</span>
			</button>
		{:else}
			<div class="card locked" aria-label="尚未解鎖"></div>
		{/if}
	{/each}
</div>

{#if big}
	<!-- 沒有關閉鈕：點卡片以外的地方就關掉（前身 2026-08-18 的規則） -->
	<div
		class="ov"
		role="button"
		tabindex="0"
		onclick={() => (bigId = null)}
		onkeydown={(e) => e.key === 'Escape' && (bigId = null)}
	>
		<div class="modal ut-px-frame--win">
			<div class="scroll">
				<div class="bigface" aria-hidden="true"></div>
				<p class="bigname ut-txt">{big.name}</p>
				<p class="cap">{big.caption}</p>
			</div>
		</div>
	</div>
{/if}

<style>
	.hint {
		margin: 0 0 12px;
		font-size: 11px;
		line-height: 1.9;
		color: var(--ut-ink-3);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.card {
		aspect-ratio: 3 / 4;
		padding: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
	}
	.got {
		cursor: pointer;
		font: inherit;
	}
	.locked {
		border: 2px dashed var(--ut-line);
		background: rgba(0, 0, 0, 0.02);
	}
	/* 卡面＝立繪角色 ＋ 像素卡框（CONTEXT 第 6 條）。這裡先用色塊佔位 */
	.face {
		width: 54%;
		aspect-ratio: 1;
		border-radius: 50%;
		background: linear-gradient(#f3ece0, #cdbfa8);
	}
	.kind {
		font-size: 10px;
		color: var(--ut-ink-3);
	}
	.ov {
		position: fixed;
		inset: 0;
		background: var(--ut-overlay);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 22px;
		z-index: var(--ut-z-overlay);
		border: none;
	}
	.modal {
		width: 100%;
		max-height: 74%;
		display: block;
		padding: 16px;
	}
	.scroll {
		max-height: 100%;
		overflow-y: auto;
	}
	.bigface {
		width: 100%;
		aspect-ratio: 3 / 4;
		background: linear-gradient(#f3ece0, #cdbfa8);
	}
	.bigname {
		margin: 12px 0 6px;
		font-size: 14px;
	}
	.cap {
		margin: 0;
		font-size: 11.5px;
		line-height: 1.9;
		color: var(--ut-ink-3);
	}
</style>
