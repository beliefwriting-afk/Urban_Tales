/**
 * 介面展示用的假資料 —— **不是內容，是佔位**。
 *
 * ⚠️ 這裡**沒有任何靈魂台詞**，而且刻意不寫。
 * HANDOFF §3 決策 7 與企劃書 §4.3：靈魂台詞要逐字審，不代寫、不預生成。
 * 展示用的回應一律標明是佔位文字，避免它哪天被當成真內容抄進 content/sites/。
 *
 * 正式資料之後會從 content/sites/ 讀，由 content:check 驗過才進得來。
 * 這一層存在的唯一理由是：讓介面可以先做完、先確認，後端再往上接。
 *
 * 給 Python 背景的對照：
 *   `as const` ≈ 把 list/dict 凍成不可變，且讓型別推斷推出「就是這幾個值」
 *   而不是寬鬆的 string。近似 typing.Literal 的效果。
 */

export type SiteId =
	'ximen-red-house' | 'longshan-temple' | 'bopiliao' | 'nishi-honganji' | 'xinfu-market';

export type Site = {
	id: SiteId;
	name: string;
	/** 地圖空間座標，0..1。第一階段沒有真的地理投影，先用相對位置 */
	x: number;
	y: number;
	/** 感應半徑（公尺）——進來才畫漣漪，告訴玩家「這裡有東西」 */
	sensingM: number;
	/** 召喚半徑（公尺）——進來才點得動。對應 SDD §5.5 的到場判定 */
	summonM: number;
	/** 是否已拍板。後兩站是 SDD 的建議，企劃書附錄 B #1 還沒確認 */
	confirmed: boolean;
};

/** 地圖可視範圍對應的實際寬度，用來把 0..1 的座標換算成公尺 */
export const MAP_WIDTH_M = 1200;

export const SITES: readonly Site[] = [
	{
		id: 'ximen-red-house',
		name: '西門紅樓',
		x: 0.24,
		y: 0.18,
		sensingM: 150,
		summonM: 50,
		confirmed: true
	},
	{
		id: 'longshan-temple',
		name: '龍山寺',
		x: 0.7,
		y: 0.42,
		sensingM: 150,
		summonM: 50,
		confirmed: true
	},
	{
		id: 'bopiliao',
		name: '剝皮寮',
		x: 0.52,
		y: 0.72,
		sensingM: 120,
		summonM: 40,
		confirmed: true
	},
	{
		id: 'nishi-honganji',
		name: '西本願寺廣場',
		x: 0.18,
		y: 0.55,
		sensingM: 130,
		summonM: 45,
		confirmed: false
	},
	{
		id: 'xinfu-market',
		name: '新富町文化市場',
		x: 0.82,
		y: 0.8,
		sensingM: 120,
		summonM: 40,
		confirmed: false
	}
] as const;

/**
 * 玩家走的那條路徑（地圖空間 0..1）。
 * 桌機上沒有 GPS，用一條路徑 ＋ 一個滑桿模擬「走過去」——
 * 這招直接繼承前身專案的 debug slider，沒有它就沒辦法在電腦上測到場判定。
 *
 * ★ 路徑節點就是景點座標本身，而且每個景點**重複一次**。
 *   重複的用意是讓滑桿在那個景點上「停一段」——不重複的話，
 *   50 公尺的召喚半徑換算成滑桿只有 2～3 格寬，滑過去就錯過了。
 *   （2026-08-25 第一版就是這樣，結果只有西門紅樓進得去。）
 */
export const WALK_PATH: readonly { x: number; y: number }[] = [
	{ x: 0.24, y: 0.06 }, // 起點：還沒靠近任何景點
	{ x: 0.24, y: 0.18 }, // 西門紅樓
	{ x: 0.24, y: 0.18 }, // ← 重複一次＝在這裡「停一下」
	{ x: 0.18, y: 0.55 }, // 西本願寺廣場
	{ x: 0.18, y: 0.55 },
	{ x: 0.52, y: 0.72 }, // 剝皮寮
	{ x: 0.52, y: 0.72 },
	{ x: 0.82, y: 0.8 }, // 新富町文化市場
	{ x: 0.82, y: 0.8 },
	{ x: 0.7, y: 0.42 }, // 龍山寺
	{ x: 0.7, y: 0.42 }
] as const;

/**
 * 成就卡 —— 13 張：相遇 5 ＋ 任務 5 ＋ 劇情 3（CONTEXT 核心設計第 6 條）。
 *
 * ⚠️ 方陣**不分區**，順序照類別自然落位（相遇→任務→劇情），劇情卡自然排在最後。
 *   這是前身專案 2026-08-18 拍板的，在本專案仍然成立。
 *
 * ⚠️ 名稱是結構性的（「相遇 · 西門紅樓」），caption 一律標明是佔位——
 *   卡面文案也算內容，要逐字審，這裡不代寫。
 */
export type CardKind = 'encounter' | 'task' | 'arc';

export type Card = {
	id: string;
	kind: CardKind;
	/** 劇情卡跨站，所以可以是 null */
	siteId: SiteId | null;
	name: string;
	caption: string;
};

const KIND_LABEL: Record<CardKind, string> = {
	encounter: '相遇',
	task: '任務',
	arc: '劇情'
};

export function kindLabel(k: CardKind): string {
	return KIND_LABEL[k];
}

export const CARDS: readonly Card[] = [
	...SITES.map((s): Card => ({
		id: `encounter-${s.id}`,
		kind: 'encounter',
		siteId: s.id,
		name: `相遇 · ${s.name}`,
		caption: '（佔位）第一次召喚出這個地方的靈魂時取得。正式文案要逐字審。'
	})),
	...SITES.map((s): Card => ({
		id: `task-${s.id}`,
		kind: 'task',
		siteId: s.id,
		name: `留影 · ${s.name}`,
		caption: '（佔位）在這裡拍下一張你覺得最美的照片時取得。照片不上傳、不入卡面。'
	})),
	...[1, 2, 3].map((n): Card => ({
		id: `arc-${n}`,
		kind: 'arc',
		siteId: null,
		name: `劇情 · 第 ${n} 章`,
		caption: '（佔位）萬華劇情線的章節卡。西門紅樓 → 龍山寺 → 剝皮寮，線性解鎖。'
	}))
] as const;

/**
 * ⚠️ 佔位回應，不是台詞。
 *
 * 每一則都標明自己是佔位，理由見檔頭。介面要看的是「氣泡長怎樣、
 * 換行怎麼斷、長訊息會不會撐破版面」，這些用佔位文字一樣看得出來。
 */
export const PLACEHOLDER_REPLIES: readonly string[] = [
	'（介面展示用佔位）這一格會放靈魂的回應。正式台詞要逐字審過才會寫進 content/sites/，這裡刻意不預寫。',
	'（介面展示用佔位）短的一句，用來看氣泡最小寬度。',
	'（介面展示用佔位）這一則刻意寫得長一點，用來確認文字換行、氣泡最大寬度、以及對話窗捲動的行為在手機寬度下是不是還讀得下去。真正的內容會由人逐字寫、逐字審。'
] as const;
