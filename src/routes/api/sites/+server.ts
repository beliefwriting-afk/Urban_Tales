/**
 * GET /api/sites —— 景點清單（SDD 附錄 D）。
 *
 * 地圖圖層要它來畫圖釘與算距離。**不需要認證**：這裡沒有任何屬於某個玩家的資料。
 * （身分還是會被建立，因為 `/api/*` 一律走身分流程——見 hooks.server.ts 的
 *   needsIdentity。那是刻意的：下一個請求多半就是 /api/presence 了。）
 *
 * ★ 回應內容由 `toPublicSite` 的白名單決定，這個檔案不自己組資料。
 *   端點是薄的，判斷在 $lib/server/content/sites.ts——那裡才有測試釘著。
 *
 * 給 Python 背景的對照：
 *   `+server.ts` 匯出的 GET / POST ≈ FastAPI 的 @app.get / @app.post，
 *   檔案所在的資料夾路徑就是 URL 路徑（檔案系統即路由）。
 *   `json(x)` ≈ FastAPI 直接 return dict（自動序列化並設 content-type）。
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPublicSites } from '$lib/server/content/sites';

export const GET: RequestHandler = () => {
	// 內容在建置期就固定了，同一份建置的回應永遠一樣，所以可以放心讓瀏覽器快取。
	// 五分鐘是保守值：改內容一定要重新部署，而部署會換 URL 以外的一切。
	return json(
		{ sites: listPublicSites() },
		{ headers: { 'cache-control': 'public, max-age=300' } }
	);
};
