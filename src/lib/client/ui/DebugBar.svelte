<script lang="ts">
	/**
	 * 距離模擬滑桿。
	 *
	 * ★ 桌機沒有 GPS。沒有這一條，到場判定在電腦上根本測不到，
	 *   而到場判定是整個玩法的地基（CONTEXT 核心設計第 1 條「硬到場」）。
	 *
	 * ⚠️ 切片 7 之後這裡顯示的是**憑證在不在手上**，不是「算出來可不可以進」——
	 *   前端已經沒有判定半徑了。滑桿的座標會原樣送去 /api/presence，
	 *   由伺服器判定。**假的是位置，不是判準。**
	 *
	 * ★ 正式建置（dev === false）時 summon() 會改走真的 GPS，這條滑桿只是
	 *   開發時的位置來源。
	 */
	import { session } from '$lib/client/mock/session.svelte';
</script>

<div class="bar">
	<label for="walk">你的位置</label>
	<!-- oninput 清掉展示模式的自訂位置：不清的話拖滑桿會沒反應，看起來像壞了 -->
	<input
		id="walk"
		type="range"
		min="0"
		max="100"
		step="1"
		bind:value={session.walk}
		oninput={() => session.clearPlacement()}
	/>
	<span class="read">
		{#each session.sites.filter((s) => s.sensed) as s (s.id)}
			<b>{s.name}</b> {s.distanceM}m{s.canEnter ? '（憑證在手）' : ''}&nbsp;
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
