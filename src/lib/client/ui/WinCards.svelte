<script lang="ts">
	/**
	 * 收藏 —— 13 格方陣 ＋ 放大檢視。
	 *
	 * 2026-08-18 實機拍板的三條規則：
	 *   1. 方陣**不分區**，相遇／任務／劇情排在一起，照類別自然落位
	 *   2. 空格**不畫剪影**——不劇透
	 *   3. 放大檢視時圖與說明**整包一起捲**，長文字才讀得完
	 */
	import { session } from '$lib/client/mock/session.svelte';

	/**
	 * ★ 切片 7：卡片改由 `/api/collection` 給。
	 *
	 *   ⚠️ 未獲得的卡**拿不到標題與卡背文字**——伺服器端的型別讓那兩個欄位
	 *   在「未獲得」的分支裡根本不存在（見 progress/collection.ts）。
	 *   所以下面的 `{#if c.owned}` 不只是顯示邏輯，它也是型別收窄：
	 *   在 else 那一支裡，TypeScript 不會讓你寫 `c.title`。
	 */
	const KIND_LABEL: Record<string, string> = {
		encounter: '相遇',
		task: '任務',
		story: '劇情'
	};

	let bigId = $state<string | null>(null);
	// ★ 收窄放在這裡而不是 template：放大檢視只對已獲得的卡有意義，
	//   而在 script 裡收窄，TypeScript 才保證得了下面讀 title / flavor 是安全的。
	const big = $derived(session.cards.find((c) => c.id === bigId && c.owned) ?? null) as {
		owned: true;
		title: string;
		flavor: string;
		siteName: string;
	} | null;
</script>

<p class="hint">
	{session.cardsOwned} / {session.cards.length}&#12288;空格是還沒解鎖的，刻意不畫剪影。
</p>

{#if session.cards.length === 0}
	<!--
		⚠️ 目前 content/cards.yaml 是空的（卡面要等 P0-1 的立繪），所以這裡會是空的。
		   那是正確的現況，不是壞掉——所以要說出來，不要留一片空白讓人以為是 bug。
	-->
	<p class="hint">卡片還沒有定義。立繪做好之後就會出現在這裡。</p>
{/if}

<div class="grid">
	{#each session.cards as c (c.id)}
		{#if c.owned}
			<button class="card got ut-px-frame" onclick={() => (bigId = c.id)}>
				<span class="face" aria-hidden="true"></span>
				<span class="kind ut-txt">{KIND_LABEL[c.kind] ?? c.kind}</span>
			</button>
		{:else}
			<div class="card locked" aria-label="尚未解鎖"></div>
		{/if}
	{/each}
</div>

{#if big}
	<!-- 沒有關閉鈕：點卡片以外的地方就關掉（2026-08-18 拍板） -->
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
				<p class="bigname ut-txt">{big.title}</p>
				<p class="cap">{big.flavor}</p>
				<p class="cap">{big.siteName}</p>
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
