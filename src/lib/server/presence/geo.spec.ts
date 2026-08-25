/**
 * SDD §14：單元測試花在「純函式、邏輯密集、錯了很難從畫面看出來」的地方。
 * 到場判定正是這種 —— 你在桌機上看不出半徑算錯了 5 公尺。
 *
 * 給 Python 背景的對照：vitest ≈ pytest。
 *   describe(...)        ≈ class TestX / 一個測試群組
 *   it(...) / test(...)  ≈ def test_xxx()
 *   expect(x).toBe(y)    ≈ assert x == y
 *   expect(x).toBeCloseTo(y, n) ≈ pytest.approx
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { haversine, resolvePresence, type SiteGeo } from './geo';

// 龍山寺（大約）。P0 實地量測後會用真實座標取代，見 SDD §5.5。
const LONGSHAN = { lat: 25.0374, lng: 121.4998 };

describe('haversine', () => {
	it('同一點的距離是 0', () => {
		expect(haversine(LONGSHAN, LONGSHAN)).toBe(0);
	});

	it('緯度差 0.001 度約等於 111 公尺', () => {
		const d = haversine(LONGSHAN, { lat: LONGSHAN.lat + 0.001, lng: LONGSHAN.lng });
		expect(d).toBeGreaterThan(105);
		expect(d).toBeLessThan(117);
	});

	it('距離是對稱的', () => {
		const b = { lat: 25.04, lng: 121.51 };
		expect(haversine(LONGSHAN, b)).toBeCloseTo(haversine(b, LONGSHAN), 6);
	});
});

describe('resolvePresence', () => {
	const sites: SiteGeo[] = [
		{ id: 'longshan-temple', ...LONGSHAN, radiusM: 50, extraCenters: [] },
		{
			// 剝皮寮是長條形街區，用多個圓心覆蓋（SDD §5.2）
			id: 'bopiliao',
			lat: 25.0362,
			lng: 121.4993,
			radiusM: 40,
			extraCenters: [{ lat: 25.0362, lng: 121.4999 }]
		}
	];

	it('站在圓心上會命中', () => {
		const hit = resolvePresence({ position: LONGSHAN, accuracyM: 10 }, sites);
		expect(hit?.siteId).toBe('longshan-temple');
	});

	it('離很遠不會命中', () => {
		const hit = resolvePresence({ position: { lat: 25.08, lng: 121.56 }, accuracyM: 10 }, sites);
		expect(hit).toBeNull();
	});

	it('定位精度會放寬有效半徑，但有上限', () => {
		// 距離約 78 公尺，超出 50 公尺的基礎半徑
		const justOutside = { lat: LONGSHAN.lat + 0.0007, lng: LONGSHAN.lng };

		// 精度 10m → 有效半徑 60m → 不該命中
		expect(resolvePresence({ position: justOutside, accuracyM: 10 }, sites)).toBeNull();

		// 精度 30m → 有效半徑 80m → 命中
		expect(resolvePresence({ position: justOutside, accuracyM: 30 }, sites)?.siteId).toBe(
			'longshan-temple'
		);

		// ★ 精度 500m（室內定位）不能無限放寬，否則玩家在家也能觸發，
		//   那會直接推翻核心設計第 1 條「硬到場」
		const farAway = { lat: LONGSHAN.lat + 0.003, lng: LONGSHAN.lng };
		expect(resolvePresence({ position: farAway, accuracyM: 500 }, sites)).toBeNull();
	});

	it('額外圓心也算命中（長條形場域）', () => {
		const atExtraCenter = { lat: 25.0362, lng: 121.4999 };
		const hit = resolvePresence({ position: atExtraCenter, accuracyM: 5 }, sites);
		expect(hit?.siteId).toBe('bopiliao');
	});

	it('同時落在兩站範圍內時取較近的那一站', () => {
		// 兩站中間偏龍山寺
		const between = { lat: 25.0372, lng: 121.4997 };
		const hit = resolvePresence({ position: between, accuracyM: 5 }, sites);
		expect(hit?.siteId).toBe('longshan-temple');
	});
});
