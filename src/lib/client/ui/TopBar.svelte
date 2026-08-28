<script lang="ts">
	/**
	 * 頂列：地區與氣溫（純顯示）＋ ≡ 選單。
	 *
	 * 選單從前身專案的五項縮成三項——共鳴值與當日情境已被 CONTEXT 推翻，
	 * 任務簡化成「拍一張你覺得最美的照片」，不需要獨立視窗。
	 *
	 * ★ 視窗開著時選單縮成只剩圖示（前身 USS 的 #menu.icons，照抄）。
	 *   用意是把畫面讓給視窗，但仍然能直接切到別的視窗，不必先關再開。
	 */
	import { session } from '$lib/client/mock/session.svelte';

	// 圖示用 path 存著，才能跟標題一起放在同一份清單裡管理
	const ITEMS = [
		{
			key: 'log' as const,
			label: '聊天',
			/*
			 * 對話泡的視覺中心不等於外框中心：尾巴掛在下面，主體若照 viewBox
			 * 置中就會顯得偏低。這條 path 的實際垂直範圍是 3.8～20.2，
			 * 中心剛好落在 12，跟星星（3.5～20.4）與齒輪（3～21）對齊。
			 */
			d: 'M12 3.8c-5 0-9 3.2-9 7.2 0 2.3 1.3 4.3 3.4 5.6L6 20.2l4.2-2.2c.6.1 1.2.15 1.8.15 5 0 9-3.2 9-7.2s-4-7.2-9-7.2z'
		},
		{
			key: 'cards' as const,
			label: '收藏',
			d: 'M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9z'
		},
		{
			key: 'settings' as const,
			label: '設定',
			d: 'M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4zM19.4 12a7.4 7.4 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7.4 7.4 0 00-2.1-1.2L14.5 3h-4l-.4 2.7a7.4 7.4 0 00-2.1 1.2l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 000 2.4l-2 1.5 2 3.4 2.3-1a7.4 7.4 0 002.1 1.2l.4 2.7h4l.4-2.7a7.4 7.4 0 002.1-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z'
		}
	];

	const iconsOnly = $derived(session.openWindow !== null);
</script>

<div class="top" class:hidden={session.mode === 'camera'}>
	<div class="ut-px-frame loc">
		<span class="ut-txt">台北市，萬華區</span>
		<span class="ut-txt">34° C</span>
	</div>
	<button
		class="ut-px-frame round"
		onclick={() => session.toggleMenu()}
		aria-label="功能選單"
		aria-expanded={session.menuOpen}
	>
		<svg width="17" height="17" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round" />
		</svg>
	</button>
</div>

{#if session.menuOpen && session.mode !== 'camera'}
	<nav class="menu" class:icons={iconsOnly}>
		{#each ITEMS as item (item.key)}
			<button
				class="ut-px-frame mi"
				class:on={session.openWindow === item.key}
				onclick={() => (session.openWindow = session.openWindow === item.key ? null : item.key)}
				aria-label={item.label}
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
					<path d={item.d} stroke-linejoin="round" />
				</svg>
				<span class="ml ut-txt">{item.label}</span>
			</button>
		{/each}
	</nav>
{/if}

<style>
	.top {
		position: absolute;
		left: 16px;
		right: 16px;
		top: calc(env(safe-area-inset-top, 0px) + 14px);
		display: flex;
		gap: var(--ut-gap);
		align-items: center;
		z-index: var(--ut-z-chrome);
	}
	.top.hidden {
		display: none;
	}
	.loc {
		flex: 1;
		height: var(--ut-h-top);
		justify-content: space-between;
		padding: 0 16px;
		font-size: 13px;
		line-height: 1;
	}
	.round {
		width: var(--ut-h-top);
		height: var(--ut-h-top);
		justify-content: center;
		flex: none;
		cursor: pointer;
		color: var(--ut-ink);
		padding: 0;
	}
	.menu {
		position: absolute;
		right: 16px;
		top: calc(env(safe-area-inset-top, 0px) + 62px);
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 10px;
		z-index: var(--ut-z-chrome);
	}
	.mi {
		height: 36px;
		/* 圖示那一側短一點，視覺上才不會空一塊 */
		padding: 0 16px 0 12px;
		gap: 7px;
		font: inherit;
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
		justify-content: center;
	}
	.mi svg {
		width: 16px;
		height: 16px;
		flex: none;
	}
	/* 選中的視窗：像素框不能改 border-color（邊框是圖片），改用文字與圖示顏色 */
	.mi.on {
		color: var(--ut-accent);
	}
	/* 視窗開著：整顆按鈕縮成一個圖示的大小 */
	.menu.icons .mi {
		width: 36px;
		padding: 0;
		gap: 0;
	}
	.menu.icons .ml {
		display: none;
	}
</style>
