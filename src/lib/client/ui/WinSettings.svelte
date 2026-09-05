<script lang="ts">
	/**
	 * 設定。
	 *
	 * 只有三類——語音、背景音樂、語言都沒有規劃（SDD 沒有這些）。
	 * 特有的兩個是展示模式與隱私說明。
	 */
	import { session } from '$lib/client/mock/session.svelte';

	let phrase = $state('');
	let showPrivacy = $state(false);

	/** 展示模式的通關密語（SDD §5.4／T3）。正式版由環境變數 DEMO_PASSPHRASE 提供 */
	const DEMO_PHRASE = 'wanhua';

	function tryDemo() {
		if (session.demoMode) {
			session.demoMode = false;
			session.showToast('展示模式已關閉');
			return;
		}
		if (phrase.trim().toLowerCase() !== DEMO_PHRASE) {
			session.showToast('密語不對');
			return;
		}
		session.demoMode = true;
		phrase = '';
		session.showToast('展示模式開啟：所有召喚點都進得去');
	}
</script>

<section>
	<h3 class="lbl ut-txt">帳號</h3>
	<div class="card ut-px-frame">
		<p class="id ut-txt">{session.guestId}</p>
		<p class="sub">{session.createdAt}&#12288;目前為訪客模式</p>
	</div>
	<button class="act ut-px-frame" onclick={() => session.showToast('Google 綁定還沒接上')}>
		<span class="ut-txt">綁定 Google 帳號</span>
	</button>
	<p class="note">綁定後換手機資料才帶得走。不綁也能玩，訪客模式不蒐集個人資料。</p>
</section>

<section>
	<h3 class="lbl ut-txt">音樂</h3>
	<button
		class="act ut-px-frame"
		onclick={() => (session.musicOn = !session.musicOn)}
		aria-pressed={session.musicOn}
	>
		<span class="ut-txt">背景音樂&#12288;{session.musicOn ? '開' : '關'}</span>
	</button>
	<div class="vol" class:off={!session.musicOn}>
		<input
			type="range"
			min="0"
			max="100"
			step="1"
			bind:value={session.musicVolume}
			disabled={!session.musicOn}
			aria-label="音量"
		/>
		<span class="volnum ut-txt">{session.musicVolume}</span>
	</div>
	<p class="note">音檔還沒放進來，這裡目前只是把開關與音量記住。</p>
</section>

<section>
	<h3 class="lbl ut-txt">展示模式</h3>
	<p class="note">開啟後略過距離判定，任何召喚點都進得去。給沒辦法親自到萬華的人看的。</p>
	{#if !session.demoMode}
		<input class="field ut-px-frame" bind:value={phrase} placeholder="輸入通關密語" />
	{/if}
	<button class="act ut-px-frame" onclick={tryDemo}>
		<span class="ut-txt">{session.demoMode ? '關閉展示模式' : '開啟展示模式'}</span>
	</button>
</section>

<section>
	<h3 class="lbl ut-txt">隱私</h3>
	<button class="act ut-px-frame" onclick={() => (showPrivacy = !showPrivacy)}>
		<span class="ut-txt">{showPrivacy ? '收起說明' : '這個遊戲怎麼處理你的資料'}</span>
	</button>
	{#if showPrivacy}
		<ul class="privacy">
			<li>不做背景定位追蹤，只在你主動使用時取得位置</li>
			<li>座標用於判定後即丟棄，不建立任何位置軌跡</li>
			<li>照片不上傳、不保存，只留在你自己的手機裡</li>
			<li>訪客模式不蒐集個人資料</li>
		</ul>
	{/if}
</section>

<p class="ver">城市物語 Urban Tales&#12288;介面展示版</p>

<style>
	section {
		margin-bottom: 20px;
	}
	.lbl {
		margin: 0 0 8px;
		font-size: 11px;
		font-weight: 400;
		color: var(--ut-ink-3);
	}
	.card {
		display: block;
		padding: 12px 14px;
		margin-bottom: 8px;
	}
	.id {
		margin: 0 0 4px;
		font-size: 14px;
	}
	.sub {
		margin: 0;
		font-size: 11px;
		color: var(--ut-ink-3);
	}
	.act {
		width: 100%;
		height: 40px;
		justify-content: center;
		font: inherit;
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
		margin-bottom: 8px;
	}
	.field {
		width: 100%;
		height: 40px;
		padding: 0 14px;
		font: inherit;
		font-size: 13px;
		color: var(--ut-ink);
		margin-bottom: 8px;
		outline: none;
		/* input 沒辦法套 .ut-txt（那是給 span 的），字型微調要自己寫一次 */
		transform: translateY(var(--ut-font-nudge));
	}
	.vol {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 8px;
	}
	.vol.off {
		opacity: 0.45;
	}
	.vol input {
		flex: 1;
		min-width: 0;
		accent-color: var(--ut-accent);
	}
	.volnum {
		font-size: 11px;
		color: var(--ut-ink-3);
		width: 26px;
		text-align: right;
	}
	.note {
		margin: 0 0 8px;
		font-size: 11px;
		line-height: 1.9;
		color: var(--ut-ink-3);
	}
	.privacy {
		margin: 0;
		padding-left: 18px;
		font-size: 11px;
		line-height: 2.1;
		color: var(--ut-ink-2);
	}
	.ver {
		margin: 4px 0 0;
		text-align: center;
		font-size: 10px;
		color: var(--ut-ink-4);
	}
</style>
