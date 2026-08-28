<script lang="ts">
	/**
	 * 靈魂立繪 —— 第一階段的佔位。
	 *
	 * ★ 這個佔位刻意畫成**平滑的**，不是像素。
	 *   CONTEXT 核心設計第 12 條：「城市是像素的，靈魂不是，因為靈魂不屬於
	 *   這個世界的材質。」把它跟像素地圖並置，就是在檢驗那個設計成不成立。
	 *
	 * 之後接上 SoulRenderer（src/lib/client/soul/renderer.ts）時換掉這個 svg 即可，
	 * 外框的定位、拖曳、縮放邏輯都留著。
	 *
	 * L2 置中偏大、L3 縮到右下角可拖曳可縮放——這是 SDD §7.2 的設計，
	 * 與前身專案的「固定方位、要轉手機才看得到」不同（那條用了陀螺儀，本專案不做真 AR）。
	 */
	import { session } from '$lib/client/mock/session.svelte';

	let pos = $state({ x: 0.62, y: 0.5 });
	let scale = $state(1);
	let dragging = false;

	const inCamera = $derived(session.mode === 'camera');

	function onPointerDown(e: PointerEvent) {
		if (!inCamera) return;
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		const host = (e.currentTarget as HTMLElement).parentElement;
		if (!host) return;
		const r = host.getBoundingClientRect();
		pos = {
			x: Math.min(Math.max((e.clientX - r.left) / r.width, 0.08), 0.92),
			y: Math.min(Math.max((e.clientY - r.top) / r.height, 0.12), 0.9)
		};
	}
	function onPointerUp(e: PointerEvent) {
		dragging = false;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
	}
</script>

{#if session.mode !== 'map'}
	<!--
		用 button 而不是 div：這東西在 L3 是可以抓著拖的，語意上就是互動元素。
		div ＋ pointer 事件會被 a11y 規則擋下，而且鍵盤與螢幕閱讀器也用不了。
		L2 時 disabled，剛好對應「這時候它不能拖」。
	-->
	<button
		type="button"
		class="soul"
		class:cam={inCamera}
		disabled={!inCamera}
		style={inCamera
			? `left:${pos.x * 100}%; top:${pos.y * 100}%; --s:${scale}`
			: 'left:50%; top:30%; --s:1'}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		aria-label={`${session.activeSite?.name ?? '靈魂'}的立繪佔位`}
	>
		<svg viewBox="0 0 120 250" width="120" height="250" aria-hidden="true">
			<defs>
				<linearGradient id="robe" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="#f3ece0" />
					<stop offset="1" stop-color="#cdbfa8" />
				</linearGradient>
			</defs>
			<ellipse cx="60" cy="243" rx="34" ry="7" fill="rgba(43,40,35,.18)" />
			<path d="M60 74c26 0 40 22 44 62l10 96H6l10-96c4-40 18-62 44-62z" fill="url(#robe)" />
			<circle cx="60" cy="48" r="30" fill="#f0e2cd" />
			<path d="M32 42c4-22 20-32 28-32s24 10 28 32c-10-8-20-11-28-11s-18 3-28 11z" fill="#4a4038" />
			<circle cx="50" cy="50" r="3.2" fill="#3a362f" />
			<circle cx="70" cy="50" r="3.2" fill="#3a362f" />
			<path
				d="M53 61q7 5 14 0"
				stroke="#3a362f"
				stroke-width="2"
				fill="none"
				stroke-linecap="round"
			/>
		</svg>
	</button>

	{#if inCamera}
		<input
			class="zoom"
			type="range"
			min="0.5"
			max="1.6"
			step="0.01"
			bind:value={scale}
			aria-label="靈魂大小"
		/>
	{/if}
{/if}

<style>
	.soul {
		position: absolute;
		border: none;
		background: none;
		padding: 0;
		transform: translate(-50%, -50%) scale(var(--s, 1));
		transform-origin: center;
		z-index: var(--ut-z-spirit);
		pointer-events: none;
		line-height: 0;
	}
	.soul.cam svg {
		width: 108px;
	}
	.soul.cam {
		pointer-events: auto;
		cursor: grab;
		touch-action: none;
	}
	.soul.cam:active {
		cursor: grabbing;
	}
	.soul svg {
		/*
			⚠️ 不能用 vw：桌機上外框只有 300px 寬，但 vw 算的是整個瀏覽器視窗，
			立繪會膨脹到蓋住整個畫面（2026-08-25 第一版就是這樣）。
			用固定 px，L3 再縮一級。
		*/
		width: 132px;
		height: auto;
		filter: drop-shadow(0 4px 10px rgba(43, 40, 35, 0.22));
	}
	.zoom {
		position: absolute;
		left: 16px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 74px);
		width: 42%;
		accent-color: var(--ut-accent);
		z-index: var(--ut-z-chrome);
	}
</style>
