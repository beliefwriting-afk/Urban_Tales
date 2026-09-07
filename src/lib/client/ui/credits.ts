/**
 * 畫面上顯示的音樂出處 —— 設定頁的「曲目與作者」。
 *
 * ★★★ 為什麼要在遊戲畫面裡標，而不是只寫在 THIRD-PARTY-NOTICES.md：★★★
 *
 *   DOVA-SYNDROME 的網站規約說標示「非必須，但可能な限り記載をお願いします」；
 *   而 `Cat life` 的作者 GT-K 另外請求標示 `BGM：GT-K（@gtkcatlife）`——
 *   依 DOVA 規約，**作者的條件優先於網站規約**。
 *
 *   NOTICES 那份是給看原始碼的人看的。**玩家不會去讀 GitHub。**
 *   作者請求的是「使用者看得到的地方」，所以標示要在畫面上。
 *
 * ⚠️ 這份清單與 `THIRD-PARTY-NOTICES.md` 的表格是**兩份**。
 *   受眾不同（玩家／開發者），內容因此不同：這裡不寫檔名、不寫授權條款細節。
 *   但**曲名與作者必須一致**——改音樂時兩邊都要改。
 *
 * ★ 七個檔案、七首曲子，一對一，沒有共用。
 */

export type Credit = {
	/** 曲名 */
	title: string;
	/** 作者。GT-K 請求連他的帳號一起標 */
	artist: string;
	/** 這首用在哪裡（玩家看得懂的說法） */
	where: string;
};

/**
 * ⚠️ 這裡只留名字，**網址寫在 `WinSettings.svelte` 裡當字面值**。
 *
 *   不是偷懶：`svelte/no-navigation-without-resolve` 對動態 `href` 一律報錯，
 *   因為它沒辦法靜態判斷那是不是站外連結，而 CI 跑 `--max-warnings 0`。
 *   把網址寫死在元件裡，規則看得出那是外部 URL 就放行。
 */
export const MUSIC_SOURCE = { name: 'DOVA-SYNDROME' } as const;

export const MUSIC_CREDITS: readonly Credit[] = [
	// ★ GT-K 明確請求標示帳號（@gtkcatlife），照他的寫法帶上
	{ title: 'Cat life', artist: 'GT-K（@gtkcatlife）', where: '地圖' },
	{ title: '少年達の夏休み的なBGM', artist: '鷹尾まさき(タカオマサキ)', where: '西門紅樓' },
	{ title: 'Morning', artist: 'しゃろう', where: '艋舺龍山寺' },
	{ title: '神隠しの真相', artist: 'しゃろう', where: '剝皮寮' },
	{ title: '昼下がり気分', artist: 'KK', where: '當代藝術館' },
	{ title: 'さみしいおばけと東京の月', artist: 'しゃろう', where: '新文化運動紀念館' },
	{ title: '極東の羊、テレキャスターと踊る', artist: 'しゃろう', where: '霞海城隍廟' }
] as const;
