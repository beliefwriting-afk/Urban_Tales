/**
 * 到場判定的幾何運算 —— SDD §5.2。
 *
 * ★ 這裡是純函式，不碰資料庫、不碰網路、不留下任何座標。
 *   呼叫端（/api/presence）拿到結果後，座標就只存在於那個函式的區域變數，
 *   用完即丟：不寫 DB、不寫 log（企劃書 §7、§8.8）。
 *
 * ★ 2026-08-28：`haversine` 與 `LatLng` 搬到 `$lib/shared/geo`，這裡改成轉出。
 *   原因是前端地圖也要算距離，而 SvelteKit 會擋掉前端 import `$lib/server/*`。
 *   複製一份到前端會讓兩邊漂移，那是最難查的一種 bug。
 *   **`resolvePresence` 刻意留在伺服器端**——前端不該有能力自己宣告「我到了」。
 *
 * 給 Python 背景的對照：
 *   下面那行 `export { haversine }` 等同 Python 的 `from .shared import haversine`
 *   之後再放進 `__all__`——原本 import 這個檔的人不必改。
 */

import { haversine, type LatLng } from '$lib/shared/geo';

export { haversine };
export type { LatLng };

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
