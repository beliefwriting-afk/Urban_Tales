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
	 * L2 置中偏大、L3 縮到右下角可拖曳可縮放——這是 SDD §9.1（三層狀態機）＋ §7.2（合成管線）的設計，
	 * **不是**「固定方位、要轉手機才看得到」的陀螺儀方案——本專案不做真 AR。
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
		<!--
			縮放滑桿放在快門正下方，直的。
			★ 為什麼在右側而不是左下：單手持機時大拇指在右邊，
			  滑桿跟快門在同一條垂直線上，調完大小就能直接按快門，手不用換位置。
			  這跟「快門放右側中央」是同一條理由的延伸（A.L. 2026-08-28）。
			外面包一層 .zoom-slot 是因為 transform: rotate 不會改變版面盒——
			直接旋轉 input 的話它的定位會很難算。包一層固定尺寸的槽再置中旋轉，
			幾何就單純了。
		-->
		<div class="zoom-slot">
			<input
				class="zoom"
				type="range"
				min="0.5"
				max="1.6"
				step="0.01"
				bind:value={scale}
				aria-label="靈魂大小"
			/>
		</div>
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
	.zoom-slot {
		position: absolute;
		/* 跟快門同一條右邊界、同寬，槽置中之後滑桿就跟快門同一條垂直線 */
		right: 18px;
		/* 快門中心在 40%、半徑 29px，再留 12px 間距 */
		top: calc(40% + 41px);
		width: 58px;
		height: 150px;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--ut-z-chrome);
		/* 只有滑桿本身收事件，槽的空白處讓點擊穿過去給底下的立繪 */
		pointer-events: none;
	}
	.zoom {
		/* 旋轉前的長度，旋轉後變成高度 */
		width: 150px;
		/* -90 度：min 轉到下面、max 轉到上面，「往上＝變大」符合直覺 */
		transform: rotate(-90deg);
		accent-color: var(--ut-accent);
		pointer-events: auto;
		/* 地圖層設了 touch-action: none，這裡也要，否則拖滑桿會被當成捲動 */
		touch-action: none;
	}
</style>
