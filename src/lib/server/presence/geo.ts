/**
 * 到場判定的幾何運算 —— SDD §5.2。
 *
 * ★ 這裡是純函式，不碰資料庫、不碰網路、不留下任何座標。
 *   呼叫端（/api/presence）拿到結果後，座標就只存在於那個函式的區域變數，
 *   用完即丟：不寫 DB、不寫 log（企劃書 §7、§8.8）。
 *
 * 給 Python 背景的對照：這一份就像你會放進 utils.py 的東西，
 * 邏輯密集、錯了很難從畫面看出來 —— 所以它有單元測試（geo.spec.ts）。
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

export type SiteGeo = {
	id: string;
	lat: number;
	lng: number;
	radiusM: number;
	/** 長條形場域（如剝皮寮）的額外判定圓心，任一命中即算到場 */
	extraCenters: LatLng[];
};

export type PresenceInput = {
	position: LatLng;
	/** navigator.geolocation 回報的水平精度（公尺） */
	accuracyM: number;
};

export type PresenceHit = {
	siteId: string;
	/** 到最近判定圓心的距離（公尺），僅供除錯與實地量測用 */
	distanceM: number;
};

/**
 * 判定玩家目前在哪一個景點的範圍內。
 *
 * 有效半徑 = 景點半徑 + 定位精度誤差，但誤差有上限：
 * 精度太差時（例如室內定位回報 500 公尺）不能無限放寬，
 * 否則玩家在家裡也能觸發 —— 那會直接推翻核心設計第 1 條「硬到場」。
 *
 * @param accuracyBudgetM 允許納入的最大定位誤差，超過的部分不放寬
 */
export function resolvePresence(
	input: PresenceInput,
	sites: SiteGeo[],
	accuracyBudgetM = 30
): PresenceHit | null {
	const slack = Math.min(Math.max(input.accuracyM, 0), accuracyBudgetM);

	let best: PresenceHit | null = null;

	for (const site of sites) {
		const centers: LatLng[] = [{ lat: site.lat, lng: site.lng }, ...site.extraCenters];

		for (const c of centers) {
			const d = haversine(input.position, c);
			if (d > site.radiusM + slack) continue;
			if (best === null || d < best.distanceM) {
				best = { siteId: site.id, distanceM: d };
			}
		}
	}

	return best;
}
