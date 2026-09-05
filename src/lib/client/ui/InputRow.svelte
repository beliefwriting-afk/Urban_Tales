<script lang="ts">
	/**
	 * 底部輸入列 —— 三種狀態都在，只是作用不同。
	 *
	 * ⚠️ 麥克風在輸入框**內側靠右**。這是 A.L. 2026-08-19 看實機後改的：
	 *    一開始放左邊，單手持機時拇指構不到。**不要搬回前面。**
	 *
	 * ⚠️ 快門在畫面**右側中央**，刻意不放進這一列：跟退出相機的 ◎ 靠太近會誤按，
	 *    而且三顆並排在手機上會把輸入框擠到打不了字。同樣是實機改出來的。
	 *
	 * 地圖狀態下輸入框是 readonly——還沒選定要跟誰說話，點它不該叫出鍵盤。
	 */
	import { session } from '$lib/client/mock/session.svelte';
	import { mapView } from './mapView.svelte';

	let draft = $state('');

	const placeholder = $derived(
		session.mode === 'map' ? '請輸入文字……' : `跟${session.activeSite?.name ?? '靈魂'}說點什麼……`
	);

	function submit() {
		if (session.pending) return;
		session.send(draft);
		draft = '';
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Enter' || e.isComposing) return;
		e.preventDefault();
		submit();
	}
</script>

{#if session.mode === 'map'}
	<div class="maprow">
		<!--
			★ 這顆放在 maprow 裡面，不是自己絕對定位：
			  maprow 已經是靠右的 flex 列，插在第一個就自動排在「呼喚靈魂」左邊，
			  不用去算「呼喚靈魂」有多寬。而且它跟著 maprow 一起只在地圖狀態出現。
			狀態住在 mapView（不是這個元件），因為地圖層也要讀寫同一份。
		-->
		{#if mapView.camAnchor}
			<button class="ut-px-frame flat" onclick={() => mapView.recenter()}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<circle cx="12" cy="12" r="3.5" />
					<path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke-linecap="round" />
				</svg>
				<span class="ut-txt">回到我的位置</span>
			</button>
		{/if}
		<button class="ut-px-frame flat" onclick={() => session.lookAround()}>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<circle cx="11" cy="11" r="7" />
				<path d="M20 20l-3.5-3.5" stroke-linecap="round" />
			</svg>
			<span class="ut-txt">呼喚靈魂</span>
		</button>
	</div>
{/if}

{#if session.mode === 'camera'}
	<button class="shot" onclick={() => session.showToast('快門還沒接上（P0-3）')} aria-label="快門">
		<span class="ring"></span>
	</button>
{/if}

<div class="row">
	<div class="ut-px-frame field">
		<input
			type="text"
			maxlength="500"
			{placeholder}
			bind:value={draft}
			readonly={session.mode === 'map'}
			onkeydown={onKey}
			aria-label="對靈魂說話"
		/>
		<button class="mic" onclick={() => session.showToast('語音輸入還沒接上')} aria-label="語音輸入">
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<rect x="9" y="2" width="6" height="11" rx="3" />
				<path d="M5 11a7 7 0 0014 0M12 18v4" stroke-linecap="round" />
			</svg>
		</button>
	</div>
	<button
		class="ut-px-frame cam"
		onclick={() => session.toggleCamera()}
		aria-label={session.mode === 'camera' ? '離開相機' : '相機'}
		aria-pressed={session.mode === 'camera'}
	>
		<svg
			width="19"
			height="19"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<rect x="2.5" y="6" width="19" height="14" rx="2" />
			<circle cx="12" cy="13" r="4" />
			<path d="M8 6l1.5-2h5L16 6" stroke-linejoin="round" />
		</svg>
	</button>
</div>

<style>
	.row {
		position: absolute;
		left: 16px;
		right: 16px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
		display: flex;
		gap: var(--ut-gap);
		align-items: center;
		z-index: var(--ut-z-chrome);
	}
	.field {
		flex: 1;
		height: var(--ut-h-pill);
		padding: 0 8px 0 16px;
		gap: 6px;
	}
	.field input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		font: inherit;
		font-size: 13px;
		color: var(--ut-ink);
		/* input 的文字也要跟著微調，否則跟旁邊的按鈕對不齊 */
		transform: translateY(var(--ut-font-nudge));
	}
	.field input::placeholder {
		color: var(--ut-ink-4);
	}
	/*
		⚠️ 只有 .mic 能清空邊框。.cam 用的是 .ut-px-frame，而 Svelte 的 scoped CSS
		會把這裡的 .cam 編譯成帶 scope 的選擇器，特異性高過全域的 .ut-px-frame——
		寫 border: none 會把像素框整個蓋掉（2026-08-25 相機框憑空消失就是這樣）。
	*/
	.mic {
		border: none;
		background: none;
		cursor: pointer;
		color: var(--ut-ink);
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
	.mic {
		width: 28px;
		height: 28px;
	}
	.cam {
		width: var(--ut-h-pill);
		height: var(--ut-h-pill);
		justify-content: center;
		cursor: pointer;
		color: var(--ut-ink);
		flex: none;
	}
	.maprow {
		position: absolute;
		left: 16px;
		right: 16px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 66px);
		display: flex;
		/* 靠右＝單手持機時大拇指構得到。靠左要伸很長（A.L. 2026-08-25 實機） */
		justify-content: flex-end;
		gap: var(--ut-gap);
		z-index: var(--ut-z-chrome);
	}
	.flat {
		height: 36px;
		justify-content: center;
		/* 圖示那一側的內距要比文字側短，否則視覺上會空一塊 */
		padding: 0 16px 0 12px;
		gap: 6px;
		font: inherit;
		font-size: 13px;
		/* 上下靠 align-items:center（.ut-px-frame）；左右靠 justify-content */
		line-height: 1;
		justify-content: center;
		cursor: pointer;
	}
	.flat svg {
		flex: none;
	}
	.shot {
		position: absolute;
		right: 18px;
		/* 單手持機時大拇指的自然落點。50% 偏低，A.L. 2026-08-25 在 Web 版調高 */
		top: 40%;
		transform: translateY(-50%);
		width: 58px;
		height: 58px;
		border-radius: 50%;
		border: 3px solid rgba(255, 255, 255, 0.9);
		background: rgba(255, 255, 255, 0.18);
		cursor: pointer;
		z-index: var(--ut-z-chrome);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.ring {
		width: 42px;
		height: 42px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.92);
	}
</style>
