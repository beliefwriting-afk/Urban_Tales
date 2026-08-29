/**
 * 圖磚載入器 —— 把 `static/map/` 的像素圖磚接到畫面上。
 *
 * 這些圖磚是 `tools/map/` 離線產生的：OpenStreetMap 的台北市資料，
 * 用本專案自己的色盤光柵化成像素風，切成 256×256。
 *
 * ★ 為什麼是圖磚不是單張圖：
 *   整個台北市在 4 公尺/像素下是 5369 × 7069 像素。壓縮後的檔案只有 2.9 MB，
 *   **但檔案大小不等於解碼後的記憶體**——瀏覽器要把它展開成
 *   5369 × 7069 × 4 位元組 = 152 MB 的貼圖，iOS Safari 會直接砍掉分頁。
 *   切成圖磚後，手機一次只解碼視野內的六到十二張，約 53 KB。
 *
 * ★ 為什麼用 <img> 不用 canvas 的 drawImage：
 *   瀏覽器本來就會做解碼、快取與記憶體回收，自己用 canvas 管理載入狀態
 *   要多寫一百多行，而且不會比較快。像素質感靠 CSS 的 image-rendering: pixelated
 *   （已經包在 tokens.css 的 .ut-pixel 裡）。
 *
 * ── 三套座標，不要搞混 ──────────────────────────────
 *   經緯度      真實世界的座標，資料與定位用
 *   世界像素    整張台北地圖的像素座標，(0,0) 在西北角，near 層級是 5369 × 7069
 *   螢幕像素    世界像素 × 放大倍率，再減掉相機位移
 *
 * 給 Python 背景的對照：
 *   `type X = {...}` 就是 TypedDict，只在編譯期存在，執行期完全不見。
 *   `async function` 加 `await` 跟 Python 的 asyncio 幾乎一樣。
 *   ⚠️ `fetch` 回傳的 Response 要再 `await res.json()` 一次——
 *      第一個 await 只等到「標頭到了」，不是「整包內容到了」。
 */

/** `static/map/meta.json` 的形狀。由 tools/map/config.py 的 write_meta() 產生 */
export type LevelMeta = {
	groundMetresPerPixel: number;
	mercMetresPerPixel: number;
	widthPx: number;
	heightPx: number;
	tilesX: number;
	tilesY: number;
};

export type MapMeta = {
	bbox: { west: number; east: number; south: number; north: number };
	merc: { west: number; east: number; south: number; north: number };
	earthRadius: number;
	centerLat: number;
	tileSize: number;
	levels: Record<string, LevelMeta>;
	landmarks: Record<string, { lon: number; lat: number }>;
	attribution: string;
	license: string;
};

export type LevelName = 'near' | 'far';

export type WorldPoint = { x: number; y: number };

export type Tile = {
	/** #each 的 key。Svelte 靠它決定哪些 <img> 可以重用，換了就會重新載入 */
	key: string;
	url: string;
	/** 這張磚左上角的世界像素座標 */
	x: number;
	y: number;
};

/**
 * meta.json 只讀一次。
 *
 * ★ 存的是 Promise 不是結果：如果兩個元件同時呼叫，第二個會拿到同一個
 *   還沒完成的 Promise 一起等，而不是各發一次請求。
 *   （Python 那邊等價的做法是 functools.lru_cache 包一個 coroutine。）
 */
let metaPromise: Promise<MapMeta> | null = null;

export function loadMapMeta(): Promise<MapMeta> {
	if (metaPromise === null) {
		metaPromise = fetch('/map/meta.json').then((res) => {
			if (!res.ok) {
				throw new Error(`讀不到 /map/meta.json（HTTP ${res.status}）。圖磚產好了嗎？`);
			}
			return res.json() as Promise<MapMeta>;
		});
	}
	return metaPromise;
}

/**
 * 經緯度 → 世界像素。
 *
 * ⚠️ 這裡的公式必須跟 `tools/map/config.py` 的 `lonlat_to_merc` / `lonlat_to_px`
 *    **一模一樣**，否則圖磚跟圖釘會對不上。所有常數都從 meta.json 讀，
 *    不在這裡寫死任何數字——工具改了範圍，前端跟著就對了。
 */
export function lonLatToWorld(
	meta: MapMeta,
	level: LevelName,
	lng: number,
	lat: number
): WorldPoint {
	const R = meta.earthRadius;
	const mx = ((lng * Math.PI) / 180) * R;
	const my = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2)) * R;
	const mpp = meta.levels[level].mercMetresPerPixel;
	return { x: (mx - meta.merc.west) / mpp, y: (meta.merc.north - my) / mpp };
}

/**
 * 世界像素 → 經緯度。`lonLatToWorld` 的反函式。
 *
 * 拖曳平移與「長按把自己放到這裡」都需要它：手指在螢幕上的位置是像素，
 * 但相機與玩家位置都用經緯度存（換縮放層級時才不會跑掉）。
 */
export function worldToLonLat(meta: MapMeta, level: LevelName, x: number, y: number): LonLat {
	const R = meta.earthRadius;
	const mpp = meta.levels[level].mercMetresPerPixel;
	const mx = x * mpp + meta.merc.west;
	const my = meta.merc.north - y * mpp;
	return {
		lng: (mx / R) * (180 / Math.PI),
		// Mercator 的反投影：緯度不是線性的，要走 atan(exp(...))
		lat: (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * (180 / Math.PI)
	};
}

export type LonLat = { lat: number; lng: number };

/** 把座標夾在地圖範圍內。沒有這個，相機拖得出去就會看到一片空白 */
export function clampToBbox(meta: MapMeta, p: LonLat): LonLat {
	const b = meta.bbox;
	return {
		lat: Math.max(b.south, Math.min(b.north, p.lat)),
		lng: Math.max(b.west, Math.min(b.east, p.lng))
	};
}

/** 一個世界像素在這個層級代表幾公尺地面距離。除錯與比例尺用 */
export function groundMetresPerPixel(meta: MapMeta, level: LevelName): number {
	return meta.levels[level].groundMetresPerPixel;
}

/**
 * 算出視野內要掛哪幾張磚。
 *
 * @param center 相機中心的世界像素座標（通常就是玩家位置）
 * @param viewW  地圖區的 CSS 寬度
 * @param viewH  地圖區的 CSS 高度
 * @param scale  放大倍率。★ 必須是整數，非整數會讓像素糊掉
 * @param bearingDeg 地圖轉了幾度。轉了之後同一塊螢幕會蓋到更大的地圖範圍
 * @param margin 視野外多掛幾圈，讓玩家移動時磚已經在了、不會閃
 */
export function visibleTiles(
	meta: MapMeta,
	level: LevelName,
	center: WorldPoint,
	viewW: number,
	viewH: number,
	scale: number,
	bearingDeg = 0,
	margin = 1
): Tile[] {
	const lv = meta.levels[level];
	const size = meta.tileSize;

	// 畫面在「世界像素」裡有多大：螢幕尺寸除以放大倍率。
	// ★ 轉過角度之後要撐開：一個 w×h 的矩形轉 θ 度之後，它的外接框是
	//   (w·|cosθ| + h·|sinθ|) × (w·|sinθ| + h·|cosθ|)。
	//   不撐開的話轉到一半畫面四角會露出空白。
	const rad = (bearingDeg * Math.PI) / 180;
	const c = Math.abs(Math.cos(rad));
	const s = Math.abs(Math.sin(rad));
	const halfW = (viewW * c + viewH * s) / scale / 2;
	const halfH = (viewW * s + viewH * c) / scale / 2;

	const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
	const gx0 = clamp(Math.floor((center.x - halfW) / size) - margin, lv.tilesX - 1);
	const gx1 = clamp(Math.floor((center.x + halfW) / size) + margin, lv.tilesX - 1);
	const gy0 = clamp(Math.floor((center.y - halfH) / size) - margin, lv.tilesY - 1);
	const gy1 = clamp(Math.floor((center.y + halfH) / size) + margin, lv.tilesY - 1);

	const tiles: Tile[] = [];
	for (let gy = gy0; gy <= gy1; gy++) {
		for (let gx = gx0; gx <= gx1; gx++) {
			tiles.push({
				key: `${level}/${gx}/${gy}`,
				url: `/map/${level}/${gx}_${gy}.png`,
				x: gx * size,
				y: gy * size
			});
		}
	}
	return tiles;
}

/**
 * 把位移對齊到實體像素。
 *
 * ⚠️ 沒有這個，相鄰的圖磚之間會出現一條 1 像素的縫。
 *   原因是瀏覽器把每張磚的位置各自四捨五入到實體像素，
 *   帶小數的位移會讓相鄰兩張磚一個進位、一個捨去，中間就露出底色。
 *   在高 DPR 的手機上特別明顯（那正是這個專案的主要平台）。
 *
 *   注意除數是 devicePixelRatio 不是 1：DPR 2.75 的螢幕上，
 *   CSS 的整數位移不見得落在實體像素上。
 */
export function snapToDevicePixel(value: number, dpr: number): number {
	const r = dpr > 0 ? dpr : 1;
	return Math.round(value * r) / r;
}
