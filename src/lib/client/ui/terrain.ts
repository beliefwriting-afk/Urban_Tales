/**
 * 像素地形生成 —— 純函式，沒有 DOM 依賴以外的狀態。
 *
 * 為什麼是程序生成而不是一張圖：
 *   企劃書附錄 B #2「地圖方案 A/B」還沒拍板（隨兩個景點連動）。
 *   在拍板之前用程序生成的佔位地形，可以先把介面、互動、像素質感全部確認完，
 *   之後換成手繪圖磚時只換這個檔，其餘一行不動。
 *
 * 像素感從哪裡來：
 *   canvas 本身只有幾十乘幾十像素，靠 CSS 放大到滿版，
 *   配合 image-rendering: pixelated 就得到硬邊的像素塊。
 *   ★ 不是「畫很多小方格」——那樣既慢又會在縮放時糊掉。
 *
 * 給 Python 背景的對照：
 *   TypeScript 沒有 random.seed()，要自己帶一個 PRNG 才能每次畫出一樣的地形。
 *   下面的 mulberry32 就是一個 32 位元的小型 PRNG，等同 random.Random(seed)。
 */

export type TerrainColors = {
	grass: string;
	grass2: string;
	block: string;
	block2: string;
	water: string;
	road: string;
};

/** 固定種子的 PRNG。同一個 seed 永遠畫出同一張地圖 */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * 把地形畫進 ctx。w/h 是**像素格數**，不是 CSS 尺寸——
 * 呼叫端負責把 canvas 的 width/height 設成這個值，再用 CSS 放大。
 */
export function drawTerrain(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	c: TerrainColors,
	seed = 20260825
): void {
	const rnd = mulberry32(seed);

	// ── 1. 草地底，兩階深淺做出雜色 ──────────────────
	ctx.fillStyle = c.grass;
	ctx.fillRect(0, 0, w, h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (rnd() < 0.18) {
				ctx.fillStyle = c.grass2;
				ctx.fillRect(x, y, 1, 1);
			}
		}
	}

	// ── 2. 河流：一條沿 y 軸蜿蜒的帶狀 ────────────────
	const riverPhase = rnd() * Math.PI * 2;
	ctx.fillStyle = c.water;
	for (let y = 0; y < h; y++) {
		const cx = w * 0.62 + Math.sin(y / 11 + riverPhase) * w * 0.16;
		const half = 1.6 + Math.sin(y / 7) * 0.6;
		ctx.fillRect(Math.round(cx - half), y, Math.max(2, Math.round(half * 2)), 1);
	}

	// ── 3. 街廓：格狀矩形，落在水上就跳過 ─────────────
	const isWater = (px: number, py: number) => {
		const cx = w * 0.62 + Math.sin(py / 11 + riverPhase) * w * 0.16;
		return Math.abs(px - cx) < 4;
	};
	const cell = 9;
	for (let gy = 2; gy < h - 4; gy += cell) {
		for (let gx = 2; gx < w - 4; gx += cell) {
			if (rnd() < 0.42) continue;
			const bw = 3 + Math.floor(rnd() * 4);
			const bh = 3 + Math.floor(rnd() * 4);
			if (isWater(gx + bw / 2, gy + bh / 2)) continue;
			ctx.fillStyle = rnd() < 0.5 ? c.block : c.block2;
			ctx.fillRect(gx, gy, bw, bh);
		}
	}

	// ── 4. 道路：兩條橫、兩條斜 ──────────────────────
	ctx.fillStyle = c.road;
	for (const ry of [Math.round(h * 0.3), Math.round(h * 0.66)]) {
		for (let x = 0; x < w; x++) {
			ctx.fillRect(x, ry + Math.round(Math.sin(x / 13) * 1.5), 1, 1);
		}
	}
	for (let i = 0; i < 2; i++) {
		const x0 = w * (0.15 + i * 0.5);
		for (let y = 0; y < h; y++) {
			ctx.fillRect(Math.round(x0 + y * 0.35), y, 1, 1);
		}
	}
}

/**
 * 像素小人（玩家）。8 寬 × 14 高的點陣圖，用字串陣列描述。
 *
 * 每個字元是一個像素：
 *   . 透明   h 頭髮   s 膚色   c 衣服   b 褲子   o 描邊
 */
const AVATAR: readonly string[] = [
	'..oooo..',
	'.ohhhho.',
	'.ohhhho.',
	'.osssso.',
	'.os.s.so',
	'.osssso.',
	'..oooo..',
	'.occcco.',
	'occcccco',
	'occcccco',
	'.occcco.',
	'.ob..bo.',
	'.ob..bo.',
	'.oo..oo.'
];

const AVATAR_PALETTE: Record<string, string> = {
	h: '#8a5a2b',
	s: '#e8b98d',
	c: '#9c2b22',
	b: '#3a3630',
	o: '#2b2620'
};

/** 把小人畫進 ctx，左上角對齊 (0,0)，一格一像素 */
export function drawAvatar(ctx: CanvasRenderingContext2D): void {
	for (let y = 0; y < AVATAR.length; y++) {
		const row = AVATAR[y];
		for (let x = 0; x < row.length; x++) {
			const fill = AVATAR_PALETTE[row[x]];
			if (!fill) continue;
			ctx.fillStyle = fill;
			ctx.fillRect(x, y, 1, 1);
		}
	}
}

export const AVATAR_W = 8;
export const AVATAR_H = AVATAR.length;
