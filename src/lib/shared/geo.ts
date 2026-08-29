/**
 * 前後端共用的幾何運算。
 *
 * ★ 為什麼要有這個檔：`haversine` 原本住在 `src/lib/server/presence/geo.ts`，
 *   但前端的地圖也要算距離，而 **SvelteKit 會在建置時擋掉前端 import `$lib/server/*`**
 *   ——那是框架自己的規則（防止伺服器機密被打包進前端 bundle），不該繞過。
 *
 *   複製一份到前端更糟：兩份會漂移，最後變成「前端顯示還有 47 公尺，
 *   後端判定卻說不在範圍內」這種最難查的 bug。所以搬到共用位置，兩邊都指過來。
 *
 *   `resolvePresence` 沒有搬——它是伺服器的判定邏輯，前端不該有能力自己說「我到了」。
 *
 * 給 Python 背景的對照：
 *   這一份就是你會放進 `utils.py` 的東西。TypeScript 沒有 `__init__.py`，
 *   一個檔案就是一個模組，`export` 出去的東西才看得到，其餘都是私有的。
 */

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export type LatLng = { lat: number; lng: number };

/**
 * 兩點間的大圓距離（公尺）。
 *
 * 用 haversine 而不是平面近似：台北的緯度下平面近似誤差雖小，
 * 但判定半徑最小到 20 公尺，不值得為了省幾個三角函式引入誤差來源。
 */
export function haversine(a: LatLng, b: LatLng): number {
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);

	const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
