<script lang="ts">
	/**
	 * 設定。
	 *
	 * 只有三類——語音、背景音樂、語言都沒有規劃（SDD 沒有這些）。
	 * 特有的兩個是展示模式與隱私說明。
	 */
	import { session } from '$lib/client/mock/session.svelte';
	import { MUSIC_CREDITS, MUSIC_SOURCE } from './credits';

	let phrase = $state('');
	let showPrivacy = $state(false);
	let showCredits = $state(false);

	/**
	 * ★★★ 切片 7：密語不再由前端比對。★★★
	 *
	 *   這裡原本有一行 `const DEMO_PHRASE = 'wanhua'`，比對通過就直接把
	 *   `session.demoMode` 設成 true——**完全沒有碰伺服器**。
	 *   密語寫在前端等於寫在 JS bundle 裡，任何人打開 devtools 就讀得到，
	 *   **那等於密語不存在**（HANDOFF §14.8 第 2 項）。
	 *
	 *   現在的流程：把玩家輸入的字送去 `/demo?key=`，伺服器常數時間比對，
	 *   對了才發那張 HttpOnly cookie。**前端不知道、也不該知道正確答案。**
	 *
	 * ⚠️ 導向會讓整頁重新載入，狀態會重來一次——這是可以接受的：
	 *   開關展示模式本來就是一件「換一個身分重新開始」的事。
	 *   而且 303 之後密語就離開網址列了。
	 */
	function tryDemo() {
		if (session.demoMode) {
			// cookie 是 HttpOnly，前端刪不掉——關閉也只能請伺服器做
			window.location.href = '/demo?leave=1';
			return;
		}

		const key = phrase.trim();
		if (!key) {
			session.showToast('先輸入密語');
			return;
		}

		// ★ 這裡不判斷對不對，也判斷不了。對錯是伺服器的事，
		//   而且成功與失敗都會導回首頁——錯誤提示會告訴人「這裡確實有一道門」。
		window.location.href = `/demo?key=${encodeURIComponent(key)}`;
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
	<!--
		★ 音樂出處標在玩家看得到的地方。
		  DOVA-SYNDROME 的規約說標示「非必須但請盡量記載」，而 Cat life 的作者
		  GT-K 另外請求標示帳號——依規約，**作者的條件優先**。
		  NOTICES 那份是給看原始碼的人看的，玩家不會去讀 GitHub。
	-->
	<!--
		⚠️ 網址寫成字面值，不是從 MUSIC_SOURCE 取出來的變數。
		   `svelte/no-navigation-without-resolve` 對動態 href 一律報錯——它沒辦法
		   靜態判斷那是站外連結，而 CI 跑 `--max-warnings 0`。
		   寫死之後規則看得出這是外部 URL，就放行了。
		★ 一個固定的外部連結本來也不需要抽成常數，抽了反而多一份會漂移的東西。
	-->
	<p class="note">
		音樂：<a href="https://dova-s.jp/" target="_blank" rel="noopener noreferrer">
			{MUSIC_SOURCE.name}
		</a>
	</p>
	<button class="act ut-px-frame" onclick={() => (showCredits = !showCredits)}>
		<span class="ut-txt">{showCredits ? '收起曲目' : '曲目與作者'}</span>
	</button>
	{#if showCredits}
		<ul class="credits">
			{#each MUSIC_CREDITS as c (c.title)}
				<li><b>{c.title}</b>／{c.artist}<span class="where">{c.where}</span></li>
			{/each}
		</ul>
	{/if}
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
	.credits {
		margin: 8px 0 0;
		padding: 0;
		list-style: none;
		font-size: 10px;
		line-height: 1.9;
		color: var(--ut-ink-3);
	}
	.credits li {
		display: flex;
		gap: 4px;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.credits b {
		font-weight: 500;
		color: var(--ut-ink-2);
	}
	.credits .where {
		margin-left: auto;
		opacity: 0.7;
	}
	.note a {
		color: inherit;
	}
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
