<script lang="ts">
	/**
	 * 畫面下方的短暫提示。
	 * 會自己消失，等不及的話點它一下就收掉（前身專案的行為，照抄）。
	 * z 序最高——從浮空視窗裡觸發的提示不能被視窗自己蓋住。
	 */
	import { session } from '$lib/client/mock/session.svelte';
</script>

{#if session.toast}
	<button class="toast" onclick={() => session.dismissToast()}>{session.toast}</button>
{/if}

<style>
	.toast {
		position: absolute;
		left: 26px;
		right: 26px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 118px);
		z-index: var(--ut-z-toast);
		background: var(--ut-toast);
		color: var(--ut-toast-ink);
		border: none;
		border-radius: 14px;
		padding: 12px 16px;
		font: inherit;
		font-size: 13px;
		line-height: 1.6;
		text-align: center;
		cursor: pointer;
		animation: fade 0.3s ease-out;
	}
	@keyframes fade {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
</style>
