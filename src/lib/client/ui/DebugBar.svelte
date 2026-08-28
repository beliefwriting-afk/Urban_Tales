<script lang="ts">
	/**
	 * 距離模擬滑桿 —— 直接繼承前身專案的 debug slider。
	 *
	 * ★ 桌機沒有 GPS。沒有這一條，到場判定在電腦上根本測不到，
	 *   而到場判定是整個玩法的地基（CONTEXT 核心設計第 1 條「硬到場」）。
	 *   正式版把它拿掉即可，介面其餘部分不依賴它。
	 */
	import { session } from '$lib/client/mock/session.svelte';
</script>

<div class="bar">
	<label for="walk">你的位置</label>
	<input id="walk" type="range" min="0" max="100" step="1" bind:value={session.walk} />
	<span class="read">
		{#each session.sites.filter((s) => s.sensed) as s (s.id)}
			<b>{s.name}</b> {s.distanceM}m{s.reachable ? '（可召喚）' : ''}&nbsp;
		{:else}
			附近沒有靈魂
		{/each}
	</span>
</div>

<style>
	.bar {
		display: flex;
		gap: 10px;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		font-size: 12px;
		color: var(--ut-ink-2);
		padding: 12px 16px 0;
	}
	input[type='range'] {
		width: min(260px, 60vw);
		accent-color: var(--ut-accent);
	}
	.read b {
		font-weight: 500;
		color: var(--ut-ink);
	}
</style>
