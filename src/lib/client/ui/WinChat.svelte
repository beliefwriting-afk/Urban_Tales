<script lang="ts">
	/**
	 * 聊天視窗 —— 兩層：靈魂清單 → 完整對話。
	 *
	 * 2026-08-16 拍板：用清單，不用下拉選單。
	 * 理由是下拉選單看不到「最後說了什麼」，玩家要一個一個切才找得到想看的那段。
	 */
	import { session } from '$lib/client/mock/session.svelte';

	const thread = $derived(session.openThread ? (session.history[session.openThread] ?? []) : []);
	const threadName = $derived(session.threads.find((t) => t.id === session.openThread)?.name ?? '');
</script>

{#if session.openThread === null}
	{#each session.threads as t (t.id)}
		<button class="row ut-px-frame" onclick={() => (session.openThread = t.id)}>
			<span class="name ut-txt">{t.name}</span>
			<span class="last">{t.last}</span>
			<span class="count ut-txt">{t.count} 則</span>
		</button>
	{:else}
		<p class="empty">還沒跟任何靈魂說過話。</p>
	{/each}
{:else}
	<p class="head ut-txt">{threadName}</p>
	<div class="log">
		{#each thread as m (m.id)}
			<p class={m.from === 'me' ? 'bub me ut-px-frame--me' : 'bub soul ut-px-frame'}>
				{m.text}
			</p>
		{/each}
	</div>
{/if}

<style>
	.row {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		padding: 10px 14px;
		margin-bottom: 8px;
		cursor: pointer;
		font: inherit;
		text-align: left;
	}
	.name {
		font-size: 13px;
	}
	.last {
		font-size: 11px;
		color: var(--ut-ink-3);
		line-height: 1.6;
		display: -webkit-box;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.count {
		font-size: 10px;
		color: var(--ut-ink-4);
	}
	.head {
		margin: 0 0 10px;
		font-size: 13px;
		color: var(--ut-ink-2);
	}
	.log {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.bub {
		margin: 0;
		max-width: 82%;
		min-width: 34px;
		display: block;
		padding: 8px 14px;
		font-size: 12.5px;
		line-height: 1.7;
	}
	.me {
		align-self: flex-end;
	}
	.soul {
		align-self: flex-start;
	}
	.empty {
		margin: 24px 0;
		text-align: center;
		font-size: 12px;
		color: var(--ut-ink-3);
	}
</style>
