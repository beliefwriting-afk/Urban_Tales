<script lang="ts">
	// Svelte 5 runes。給 Python 背景的對照：
	// $state(x) 包起來的變數一改，用到它的畫面就自動重畫，
	// 你不用手動更新 DOM。Python 沒有對應概念，但比 React hooks 單純。
	let ready = $state(true);
</script>

<svelte:head>
	<title>城市物語 Urban Tales</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<main>
	<h1>城市物語</h1>
	<p class="sub">Urban Tales</p>

	{#if ready}
		<p class="ok">✅ 骨架已就緒</p>
	{/if}

	<p class="note">走到台北的景點，召喚那個地方的城市靈魂，聽它說這裡的故事。</p>
</main>

<style>
	main {
		max-width: 32rem;
		margin: 0 auto;
		padding: 4rem 1.5rem;
		font-family: system-ui, sans-serif;
		text-align: center;
	}
	h1 {
		margin: 0;
		font-size: 2.5rem;
		letter-spacing: 0.15em;
	}
	.sub {
		margin: 0.25rem 0 2rem;
		opacity: 0.55;
		letter-spacing: 0.3em;
		font-size: 0.85rem;
		text-transform: uppercase;
	}
	.ok {
		font-weight: 600;
	}
	.note {
		margin-top: 2rem;
		opacity: 0.7;
		line-height: 1.9;
	}
</style>
