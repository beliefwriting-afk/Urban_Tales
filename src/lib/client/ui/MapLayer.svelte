<script lang="ts">
	/**
	 * L1 地圖層 —— 真實地圖圖磚 ＋ 召喚點 ＋ 玩家 ＋ 平移、縮放、旋轉。
	 *
	 * 圖磚是 tools/map/ 離線產生的：OpenStreetMap 的台北市資料，
	 * 用本專案的色盤光柵化成像素風，切成 256×256。
	 *
	 * 座標怎麼跑（換算全在 tiles.ts）：
	 *   經緯度 → 世界像素（整張台北圖的座標）→ 螢幕位置（世界像素 × 倍率 − 相機位移）
	 *
	 * ★ 相機狀態住在 `mapView.svelte.ts`，不在這個元件裡——
	 *   「回到我的位置」那顆按鈕排在 InputRow 的那一列，兩邊要讀寫同一份狀態。
	 *
	 * ★ 三層 transform 各司其職，不要合併：
	 *     .zoom-wrap  旋轉 ＋ 捏合預覽縮放（原點＝畫面中心＝相機中心）
	 *     .world      相機平移
	 *     圖釘／小人  反向旋轉，讓它們永遠是正的
	 *   分開之後，拖曳只改一個 translate、轉動只改一個 rotate，
	 *   瀏覽器可以各自合成，不用重排版面。
	 *
	 * ⚠️ 旋轉會讓像素格子不再對齊螢幕，斜邊會變成階梯狀。
	 *   這是任意角度旋轉點陣圖的必然結果，不是 bug。
	 *   靠 `image-rendering: pixelated` 保住硬邊（糊掉才是真的破格），
	 *   並在接近正北時吸附成 0，讓最常用的角度是完美銳利的。
	 */
	import { onMount } from 'svelte';
	import { session } from '$lib/client/mock/session.svelte';
	import { AVATAR_H, AVATAR_W, drawAvatar } from './terrain';
	import { ZOOM_LADDER, mapView, normalizeDeg } from './mapView.svelte';
	import {
		clampToBbox,
		loadMapMeta,
		lonLatToWorld,
		snapToDevicePixel,
		visibleTiles,
		worldToLonLat,
		type LonLat,
		type MapMeta
	} from './tiles';

	/** 捏合過程中允許的預覽倍率範圍。放開手才吸附到階梯 */
	const PINCH_MIN = 0.25;
	const PINCH_MAX = 4;
	/** 移動超過這麼多 CSS 像素才算「拖曳」，否則算點擊 */
	const DRAG_SLOP = 8;
	/** 長按要按這麼久（毫秒） */
	const LONG_PRESS_MS = 550;

	let mapEl: HTMLDivElement;

	/**
	 * ⚠️ 這一個一定要宣告成 `$state`，`mapEl` 卻不用——差別在誰去讀它。
	 *
	 * `bind:this` 綁的普通變數**不是反應式的**：Svelte 會賦值給它，但不通知任何人。
	 * `mapEl` 只在事件處理函式裡讀（那時候它早就有值了），所以沒差；
	 * `avatarEl` 卻是給 `$effect` 讀的，而且它在 `{#if meta}` 裡面、meta 是非同步載入的。
	 * 用普通變數的話 `$effect` 第一次跑時它還不存在就 return，之後賦值不會觸發重跑，
	 * 結果是「元素在、但初始化程式從來沒跑過」——小人是一張空白畫布（2026-08-28 踩過）。
	 */
	let avatarEl = $state<HTMLCanvasElement | null>(null);

	let meta = $state<MapMeta | null>(null);
	let loadError = $state<string | null>(null);
	let viewW = $state(0);
	let viewH = $state(0);
	let dpr = $state(1);

	/**
	 * 捏合過程中的**預覽**倍率，放開手就歸 1。
	 *
	 * ★ 第一版讓捏合一跨過門檻就直接跳一階，手指還在動就又跳一階，
	 *   縮放變成一格一格的階梯，很不順（2026-08-28 實機發現）。
	 *   改成手指在動時用連續倍率預覽，**放開手才吸附到最近的一階**。
	 */
	let pinchScale = $state(1);

	const camLatLng = $derived<LonLat>(mapView.camAnchor ?? session.playerPos);

	const camWorld = $derived(
		meta ? lonLatToWorld(meta, mapView.level, camLatLng.lng, camLatLng.lat) : null
	);

	/**
	 * 相機位移。★ 一定要對齊實體像素，否則相鄰圖磚之間會出現 1 像素的縫——
	 * 瀏覽器把每張磚各自四捨五入到實體像素，帶小數的位移會讓相鄰兩張
	 * 一個進位一個捨去，中間就露出底色。高 DPR 的手機上特別明顯。
	 */
	const camX = $derived(
		camWorld ? snapToDevicePixel(camWorld.x * mapView.scale - viewW / 2, dpr) : 0
	);
	const camY = $derived(
		camWorld ? snapToDevicePixel(camWorld.y * mapView.scale - viewH / 2, dpr) : 0
	);

	const tiles = $derived(
		meta && camWorld && viewW > 0
			? visibleTiles(meta, mapView.level, camWorld, viewW, viewH, mapView.scale, mapView.bearing)
			: []
	);
	const tilePx = $derived(meta ? meta.tileSize * mapView.scale : 0);

	/** 玩家在世界像素裡的位置。相機被拖開後他就不在畫面正中央了 */
	const playerWorld = $derived(
		meta ? lonLatToWorld(meta, mapView.level, session.playerPos.lng, session.playerPos.lat) : null
	);

	// ── 手勢 ────────────────────────────────────────────────────
	// 這些是手勢過程中的暫存，不需要觸發重繪，所以不是 $state
	let pointers: { id: number; x: number; y: number }[] = [];
	let dragFrom: { x: number; y: number; cam: LonLat } | null = null;
	let dragMoved = false;
	let pinchBase = 0;
	let angleBase = 0;
	let bearingBase = 0;
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let lastWheel = 0;

	function cancelPress() {
		if (pressTimer !== null) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
	}

	/**
	 * 放開手時把預覽倍率吸附到最近的一階。
	 *
	 * 用 log 比值當距離而不是相減：階梯是幾何級數（8 / 4 / 2 / 1.33 / 1），
	 * 直接相減會偏袒間隔大的那幾階，取 log 之後每一階的「感覺距離」才一致。
	 */
	function snapZoom(factor: number) {
		// ★ 先把值釘進一個 const 再用。
		//   `if (!meta) return` 的縮小推論**不會穿進下面那個閉包**——meta 是
		//   $state（可變），TS 不敢假設閉包執行時它還是非 null。
		//   執行期其實安全（mpp 只在同一個同步流程裡被呼叫），但這個寫法
		//   讓型別與事實一致，而不是靠讀的人自己推。
		//   （對照 screenToLonLat：它直接用 meta、沒有閉包，所以不需要這一步。）
		const m = meta;
		if (!m) return;
		const mpp = (s: (typeof ZOOM_LADDER)[number]) =>
			m.levels[s.level].groundMetresPerPixel / s.scale;
		const target = mpp(mapView.stop) / factor;
		let best = mapView.zoomStep;
		let bestDiff = Infinity;
		for (let i = 0; i < ZOOM_LADDER.length; i++) {
			const diff = Math.abs(Math.log(mpp(ZOOM_LADDER[i]) / target));
			if (diff < bestDiff) {
				bestDiff = diff;
				best = i;
			}
		}
		mapView.zoomStep = best;
	}

	/** 螢幕座標（clientX/Y）→ 經緯度。長按移動要用 */
	function screenToLonLat(clientX: number, clientY: number): LonLat | null {
		if (!meta) return null;
		const r = mapEl.getBoundingClientRect();
		// ★ 要先把旋轉「解掉」：畫面轉了 bearing 度，所以螢幕上的偏移量
		//   要反向轉 bearing 度才會回到地圖的座標系。
		const sx = clientX - r.left - viewW / 2;
		const sy = clientY - r.top - viewH / 2;
		const rad = (-mapView.bearing * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const ux = sx * cos - sy * sin;
		const uy = sx * sin + sy * cos;
		const wx = (camX + viewW / 2 + ux) / mapView.scale;
		const wy = (camY + viewH / 2 + uy) / mapView.scale;
		return worldToLonLat(meta, mapView.level, wx, wy);
	}

	function pointerDistance(): number {
		if (pointers.length < 2) return 0;
		return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
	}

	/** 兩指連線的角度（度）。轉動手勢就是看這個角度變了多少 */
	function pointerAngle(): number {
		if (pointers.length < 2) return 0;
		const dx = pointers[1].x - pointers[0].x;
		const dy = pointers[1].y - pointers[0].y;
		return (Math.atan2(dy, dx) * 180) / Math.PI;
	}

	function onPointerDown(e: PointerEvent) {
		mapEl.setPointerCapture(e.pointerId);
		pointers.push({ id: e.pointerId, x: e.clientX, y: e.clientY });

		if (pointers.length === 1) {
			dragMoved = false;
			dragFrom = { x: e.clientX, y: e.clientY, cam: { ...camLatLng } };
			const cx = e.clientX;
			const cy = e.clientY;
			pressTimer = setTimeout(() => {
				pressTimer = null;
				if (dragMoved) return;
				const p = screenToLonLat(cx, cy);
				if (p) session.placeAt(p);
			}, LONG_PRESS_MS);
		} else {
			// 第二根手指下來就不是長按也不是拖曳了，是捏合＋轉動
			cancelPress();
			dragFrom = null;
			pinchBase = pointerDistance();
			angleBase = pointerAngle();
			bearingBase = mapView.bearing;
		}
	}

	function onPointerMove(e: PointerEvent) {
		const p = pointers.find((q) => q.id === e.pointerId);
		if (!p) return;
		p.x = e.clientX;
		p.y = e.clientY;

		if (pointers.length >= 2) {
			const d = pointerDistance();
			if (pinchBase > 0 && d > 0) {
				// 只做連續預覽，不在這裡跳階——跳階留到放開手（見 onPointerUp）
				pinchScale = Math.max(PINCH_MIN, Math.min(PINCH_MAX, d / pinchBase));
			}
			// ★ 從手勢起點的角度算，不是每次累加：累加會把每一步的誤差疊起來，
			//   轉久了角度會慢慢漂走。位移那邊用的是同一個道理。
			mapView.setBearingByGesture(bearingBase + normalizeDeg(pointerAngle() - angleBase));
			return;
		}

		if (!dragFrom || !meta) return;
		const dx = e.clientX - dragFrom.x;
		const dy = e.clientY - dragFrom.y;
		if (!dragMoved && Math.hypot(dx, dy) < DRAG_SLOP) return;

		dragMoved = true;
		cancelPress();

		// 手指在螢幕上的位移要反向轉回地圖座標系，否則地圖轉過之後
		// 往上滑會變成往斜的走。
		const rad = (-mapView.bearing * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const ux = dx * cos - dy * sin;
		const uy = dx * sin + dy * cos;

		// 從「按下去那一刻的相機位置」重新算，而不是每次累加
		const from = lonLatToWorld(meta, mapView.level, dragFrom.cam.lng, dragFrom.cam.lat);
		const next = worldToLonLat(
			meta,
			mapView.level,
			from.x - ux / mapView.scale,
			from.y - uy / mapView.scale
		);
		mapView.camAnchor = clampToBbox(meta, next);
	}

	function onPointerUp(e: PointerEvent) {
		pointers = pointers.filter((q) => q.id !== e.pointerId);
		if (pointers.length < 2) {
			pinchBase = 0;
			if (pinchScale !== 1) {
				snapZoom(pinchScale);
				pinchScale = 1;
			}
			mapView.snapNorthIfClose();
		}
		if (pointers.length === 0) {
			cancelPress();
			dragFrom = null;
		}
	}

	function onWheel(e: WheelEvent) {
		// 桌機上用滾輪縮放。手機沒有滾輪，這一條只是為了讓你在電腦上也能試
		e.preventDefault();
		const now = performance.now();
		if (now - lastWheel < 160) return; // 節流，否則一捲就跳到底
		lastWheel = now;
		mapView.zoomBy(e.deltaY < 0 ? 1 : -1);
	}

	async function onCompass() {
		if (mapView.follow) {
			mapView.resetNorth();
			return;
		}
		const r = await mapView.startCompass();
		if (!r.ok) {
			session.showToast(`羅盤跟隨開不起來：${r.reason}`);
			mapView.bearing = 0;
		}
	}

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

	onMount(() => {
		dpr = window.devicePixelRatio || 1;
		loadMapMeta()
			.then((m) => (meta = m))
			.catch((e: unknown) => (loadError = e instanceof Error ? e.message : String(e)));
		return () => mapView.stopCompass();
	});

	/**
	 * 小人的點陣圖。用 $effect 而不是 onMount，因為這個 canvas 在 {#if meta} 裡面——
	 * 圖磚資料還沒到的時候它根本不存在，onMount 那一刻抓不到它。
	 */
	$effect(() => {
		if (!avatarEl) return;
		const ctx = avatarEl.getContext('2d');
		if (ctx) drawAvatar(ctx);
	});
</script>

<div
	class="map"
	bind:this={mapEl}
	bind:clientWidth={viewW}
	bind:clientHeight={viewH}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onwheel={onWheel}
>
	{#if meta}
		<!--
			旋轉 ＋ 捏合預覽。原點是畫面中心，而 .world 已經把相機中心平移到那裡，
			所以這一層轉的就是「繞著相機中心轉」。
		-->
		<div class="zoom-wrap" style="transform: rotate({mapView.bearing}deg) scale({pinchScale})">
			<!--
				會移動的那一層。--rot 是給圖釘與小人反向轉回來用的，
				讓它們不管地圖轉幾度都保持是正的（Google Maps 的標記也是這樣）。
			-->
			<div
				class="world"
				style="transform: translate3d({-camX}px, {-camY}px, 0); --rot: {-mapView.bearing}deg"
			>
				{#each tiles as t (t.key)}
					<img
						class="tile ut-pixel"
						src={t.url}
						alt=""
						draggable="false"
						decoding="async"
						style="left:{t.x * mapView.scale}px; top:{t.y *
							mapView.scale}px; width:{tilePx}px; height:{tilePx}px"
					/>
				{/each}

				{#each session.sites as site (site.id)}
					{@const p = lonLatToWorld(meta, mapView.level, site.lng, site.lat)}
					<div class="pin-slot" style="left:{p.x * mapView.scale}px; top:{p.y * mapView.scale}px">
						{#if session.pulsing && site.sensed}
							<!--
								漣漪只在「呼喚靈魂」按下後擴散，不隨玩家移動自己亮。
								圖釘也不再依遠近變暗——那跟持續漣漪犯同一個毛病：
								先把答案告訴玩家，呼喚這個動作就沒意義了。
							-->
							<span class="ripple" aria-hidden="true"></span>
							<span class="ripple delay" aria-hidden="true"></span>
						{/if}
						<button
							class="pin"
							onclick={() => {
								// 拖曳結束時也會觸發 click，要擋掉，否則拖過圖釘就誤入相遇
								if (dragMoved) return;
								session.enterSite(site.id);
							}}
							aria-label={site.name}
						>
							<svg viewBox="0 0 8 11" width="26" height="36" shape-rendering="crispEdges">
								{#each PIN_CELLS as c (`${c.x}-${c.y}`)}
									<rect x={c.x} y={c.y} width="1" height="1" fill={c.fill} />
								{/each}
							</svg>
						</button>
					</div>
				{/each}

				{#if playerWorld}
					<canvas
						bind:this={avatarEl}
						class="avatar ut-pixel"
						width={AVATAR_W}
						height={AVATAR_H}
						style="left:{playerWorld.x * mapView.scale}px; top:{playerWorld.y * mapView.scale}px"
						aria-label="你的位置"
					></canvas>
				{/if}
			</div>
		</div>
	{/if}

	<!--
		羅盤：指針永遠指向真正的北方，所以它要跟著地圖一起轉。
		點一下＝開啟／關閉方位跟隨；關閉時順手轉回正北。
	-->
	{#if session.mode === 'map'}
		<button
			class="compass ut-px-frame"
			class:on={mapView.follow}
			onclick={onCompass}
			aria-label={mapView.follow ? '關閉方位跟隨並回到正北' : '開啟方位跟隨'}
			aria-pressed={mapView.follow}
		>
			<svg
				width="18"
				height="18"
				viewBox="0 0 16 16"
				shape-rendering="crispEdges"
				style="transform: rotate({mapView.bearing}deg)"
			>
				<!-- 上半指北（紅），下半指南（深色）。像素風就用兩個三角形 -->
				<path d="M8 2 L11 9 L8 7.5 L5 9 Z" fill="var(--ut-accent)" />
				<path d="M8 14 L5 9 L8 10.5 L11 9 Z" fill="#2b2620" />
			</svg>
		</button>
	{/if}

	<!--
		ODbL 1.0 要求：由 OpenStreetMap 資料產生的地圖屬於 Produced Work，
		畫面上必須標示出處。這不是裝飾，是授權條件。
	-->
	<span class="attrib ut-txt">© OpenStreetMap contributors</span>

	{#if loadError}
		<span class="err ut-txt">地圖圖磚讀不到：{loadError}</span>
	{/if}
</div>

<style>
	.map {
		position: absolute;
		inset: 0;
		overflow: hidden;
		/* 圖磚還沒載到時看到的就是這個色，不會閃白 */
		background: var(--ut-bg-map);
		/*
			★ 關鍵：把觸控手勢從瀏覽器手上接過來。
			  沒有這一條，捏合會被當成整頁縮放、單指拖曳會變成捲動頁面，
			  地圖自己的 pointer 事件根本收不到完整的手勢。
		*/
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}
	.zoom-wrap {
		position: absolute;
		inset: 0;
		/* 從畫面中心轉，視線焦點才不會被甩開 */
		transform-origin: 50% 50%;
		will-change: transform;
	}
	.world {
		position: absolute;
		left: 0;
		top: 0;
		will-change: transform;
	}
	.tile {
		position: absolute;
		display: block;
		border: none;
		pointer-events: none;
	}
	.pin-slot {
		position: absolute;
		/* 反向轉回來，讓圖釘永遠是正的。原點在針尖，轉的時候尖端才不會離開地點 */
		transform-origin: 50% 100%;
		transform: translate(-50%, -100%) rotate(var(--rot, 0deg));
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
		/* 跟圖釘一樣反向轉回來，原點在腳下 */
		transform-origin: 50% 85%;
		transform: translate(-50%, -85%) rotate(var(--rot, 0deg));
		z-index: 1;
		/* 玩家不需要點自己，讓點擊直接穿過去落在召喚點上 */
		pointer-events: none;
	}
	.compass {
		position: absolute;
		/* 跟「呼喚靈魂」同一條右邊界，疊在它上方。
		   66 是那一列的 bottom、36 是它的高度、8 是間距 */
		right: 16px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 110px);
		width: var(--ut-h-sm);
		height: var(--ut-h-sm);
		justify-content: center;
		cursor: pointer;
		z-index: 3;
	}
	.compass.on {
		/* 跟隨開啟時給一點提示，不然玩家不知道自己在哪個模式 */
		filter: drop-shadow(0 0 0 var(--ut-accent)) saturate(1.2);
		outline: 2px solid var(--ut-accent);
		outline-offset: -1px;
	}
	.attrib {
		position: absolute;
		left: 4px;
		bottom: 3px;
		font-size: 9px;
		color: var(--ut-ink-3);
		background: rgba(255, 255, 255, 0.72);
		padding: 0 3px;
		white-space: nowrap;
		pointer-events: none;
		z-index: 3;
	}
	.err {
		position: absolute;
		left: 8px;
		top: 8px;
		max-width: 80%;
		font-size: 10px;
		color: var(--ut-accent);
		background: rgba(255, 255, 255, 0.9);
		padding: 2px 4px;
		z-index: 3;
	}
</style>
