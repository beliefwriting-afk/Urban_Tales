<script lang="ts">
	/**
	 * L1 地圖層 —— 像素地形 ＋ 召喚點 ＋ 玩家。
	 *
	 * 像素質感的來源：canvas 本身只有 96×170 個像素，由 CSS 放大到滿版，
	 * 配合 image-rendering: pixelated 得到硬邊。不是畫很多小方格。
	 *
	 * 色彩全部從 tokens.css 的 CSS 變數讀出來再交給 canvas——
	 * canvas 不認得 var()，但這樣色票仍然只有一份。
	 */
	import { onMount } from 'svelte';
	import { session } from '$lib/client/mock/session.svelte';
	import { AVATAR_H, AVATAR_W, drawAvatar, drawTerrain } from './terrain';

	const MAP_W = 96;
	const MAP_H = 170;

	let terrainEl: HTMLCanvasElement;
	let avatarEl: HTMLCanvasElement;

	/**
	 * 像素圖釘。每個字元一像素：R 紅／W 白心／o 描邊／. 透明
	 * 用 SVG rect 拼而不是 path，因為 path 的曲線在放大時不會變成像素階梯。
	 */
	const PIN = [
		'..oooo..',
		'.oRRRRo.',
		'oRRRRRRo',
		'oRRWWRRo',
		'oRRWWRRo',
		'oRRRRRRo',
		'.oRRRRo.',
		'.oRRRRo.',
		'..oRRo..',
		'...oo...',
		'....o...'
	];
	const PIN_FILL: Record<string, string> = {
		R: 'var(--ut-accent)',
		W: '#ffffff',
		o: '#2b2620'
	};
	const PIN_CELLS = PIN.flatMap((row, y) =>
		[...row].map((ch, x) => ({ x, y, fill: PIN_FILL[ch] })).filter((c) => c.fill)
	);

	function readColors() {
		const s = getComputedStyle(document.documentElement);
		const v = (n: string) => s.getPropertyValue(n).trim();
		return {
			grass: v('--ut-px-grass'),
			grass2: v('--ut-px-grass-2'),
			block: v('--ut-px-block'),
			block2: v('--ut-px-block-2'),
			water: v('--ut-px-water'),
			road: v('--ut-px-road')
		};
	}

	onMount(() => {
		const tctx = terrainEl.getContext('2d');
		if (tctx) drawTerrain(tctx, MAP_W, MAP_H, readColors());
		const actx = avatarEl.getContext('2d');
		if (actx) drawAvatar(actx);
	});
</script>

<div class="map">
	<canvas
		bind:this={terrainEl}
		class="terrain ut-pixel"
		width={MAP_W}
		height={MAP_H}
		aria-hidden="true"
	></canvas>

	{#each session.sites as site (site.id)}
		<div class="pin-slot" style="left:{site.x * 100}%; top:{site.y * 100}%">
			{#if session.pulsing && site.sensed}
				<!--
					漣漪只在「呼喚靈魂」按下後擴散，不隨玩家移動自己亮。
					圖釘也不再依遠近變暗——那跟持續漣漪犯同一個毛病：
					先把答案告訴玩家，呼喚這個動作就沒意義了。
				-->
				<span class="ripple" aria-hidden="true"></span>
				<span class="ripple delay" aria-hidden="true"></span>
			{/if}
			<button class="pin" onclick={() => session.enterSite(site.id)} aria-label={site.name}>
				<svg viewBox="0 0 8 11" width="26" height="36" shape-rendering="crispEdges">
					{#each PIN_CELLS as c (`${c.x}-${c.y}`)}
						<rect x={c.x} y={c.y} width="1" height="1" fill={c.fill} />
					{/each}
				</svg>
			</button>
			{#if !site.confirmed}
				<!-- 企劃書附錄 B #1 還沒拍板的兩站，畫面上標出來免得被當定案 -->
				<span class="tentative">未拍板</span>
			{/if}
		</div>
	{/each}

	<canvas
		bind:this={avatarEl}
		class="avatar ut-pixel"
		width={AVATAR_W}
		height={AVATAR_H}
		style="left:{session.playerPos.x * 100}%; top:{session.playerPos.y * 100}%"
		aria-label="你的位置"
	></canvas>
</div>

<style>
	.map {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: var(--ut-bg-map);
	}
	.terrain {
		width: 100%;
		height: 100%;
		display: block;
	}
	.pin-slot {
		position: absolute;
		transform: translate(-50%, -100%);
		display: flex;
		flex-direction: column;
		align-items: center;
		/* 圖釘一定要在小人之上，否則站在點上時會擋住、也點不到 */
		z-index: 2;
	}
	.pin {
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		line-height: 0;
		filter: drop-shadow(0 2px 0 rgba(0, 0, 0, 0.18));
	}
	.tentative {
		margin-top: 2px;
		font-size: 9px;
		color: var(--ut-ink-3);
		background: rgba(255, 255, 255, 0.82);
		padding: 0 3px;
		white-space: nowrap;
	}
	.ripple {
		position: absolute;
		left: 50%;
		bottom: 0;
		width: 120px;
		height: 120px;
		margin: 0 0 -60px -60px;
		border: 2px solid var(--ut-accent);
		border-radius: 50%;
		animation: rip 2.4s ease-out 2;
		pointer-events: none;
	}
	.ripple.delay {
		animation-delay: 1.2s;
	}
	@keyframes rip {
		0% {
			transform: scale(0.3);
			opacity: 0.85;
		}
		100% {
			transform: scale(1);
			opacity: 0;
		}
	}
	.avatar {
		position: absolute;
		width: 24px;
		height: 42px;
		transform: translate(-50%, -85%);
		z-index: 1;
		/* 玩家不需要點自己，讓點擊直接穿過去落在召喚點上 */
		pointer-events: none;
		transition:
			left 0.12s linear,
			top 0.12s linear;
	}
	@media (prefers-reduced-motion: reduce) {
		.ripple {
			animation-duration: 4.8s;
		}
		.avatar {
			transition: none;
		}
	}
</style>
