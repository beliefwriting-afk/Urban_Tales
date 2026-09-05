/**
 * 景點內容載入器 —— SDD §2.1「內容進 Git 不進 CMS」的執行期那一半。
 *
 * ★ 內容在**建置期**就被打包進來，執行期不讀檔。
 *
 *   `import.meta.glob` 是 Vite 的功能：建置時把符合樣式的檔案全部抓進 bundle。
 *   這樣做有三個好處，都不是小事：
 *     1. 部署時不必額外把 `content/` 目錄搬到伺服器上——它已經在程式裡了
 *     2. 內容壞掉是**建置失敗**，不是半夜的 500
 *     3. 執行期沒有檔案 I/O，也就沒有「檔案不見了」這種狀態要處理
 *
 *   代價是改內容要重新建置。對一個內容進 Git 的專案來說，這正是我們要的——
 *   內容本來就該跟程式碼一起走 CI。
 *
 * 給 Python 背景的對照：
 *   `import.meta.glob(...)` ≈ 在打包時執行的 `glob.glob()`，但結果被寫死進成品。
 *   Python 沒有對應的東西，最接近的是把資料檔內容 codegen 成 .py 常數。
 */
import { parse as parseYaml } from 'yaml';
import { SiteSchema, type Site } from '../../../../content/schema';

/**
 * ★★★ 給前端的景點資料。★★★
 *
 * 這個型別的**欄位清單本身就是一道安全界線**（SDD 附錄 C 的改寫說明）：
 *
 *   給：經緯度、感應半徑 —— 「景點在哪」本來就藏不住（地圖上畫著龍山寺），
 *       感應半徑只影響漣漪，猜到也換不到任何能力。
 *   不給：`radiusM`、`extraCenters` —— 「要走多近才算到」。偽造座標的人
 *       真正需要的正是它：他知道去哪，但不知道要多近，只能猜。
 *
 * ⚠️ 要往這裡加欄位之前先想一次：**這個值被知道之後，有人能拿它做什麼？**
 *    `sites.spec.ts` 有一條測試把欄位清單釘死，加欄位會讓測試失敗——
 *    那個失敗不是要擋你，是要你在那一刻回答上面那個問題。
 */
export type PublicSite = {
	id: string;
	/** 已經選好語言的字串。語言選擇是伺服器的事，前端不必知道有幾種語言 */
	name: string;
	tagline: string;
	lat: number;
	lng: number;
	/** 感應半徑（公尺）。前端畫漣漪用 */
	sensingM: number;
	/** draft 的站在地圖上看得到，但進不去 */
	status: 'draft' | 'playable';
	hasStory: boolean;
	storyOrder: number | null;
};

/** 到場判定用的幾何資料。★ 只在伺服器端流動，不會出現在任何回應裡 */
export type SiteGeo = {
	id: string;
	lat: number;
	lng: number;
	radiusM: number;
	extraCenters: { lat: number; lng: number }[];
};

// ─── 建置期載入 ──────────────────────────────────────────────

const RAW = import.meta.glob('/content/sites/*/site.yaml', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** 從 `/content/sites/<dir>/site.yaml` 取出 `<dir>` */
function dirOf(path: string): string {
	return path.split('/').at(-2) ?? '';
}

function load(): Map<string, Site> {
	const out = new Map<string, Site>();

	for (const [path, raw] of Object.entries(RAW)) {
		const dir = dirOf(path);
		// ★ 這裡用 parse 不用 safeParse：內容壞掉要在建置／啟動時就炸開。
		//   content:check 已經在 CI 擋過一次，能走到這裡表示前面漏了，
		//   那更不該安靜地跳過一站——玩家會看到地圖上少一個圖釘卻沒有任何線索。
		const site = SiteSchema.parse(parseYaml(raw));

		if (site.id !== dir) {
			throw new Error(`content/sites/${dir}/site.yaml 的 id 是 "${site.id}"，與目錄名不符`);
		}
		out.set(site.id, site);
	}

	return out;
}

/** 模組載入時跑一次。內容是靜態的，沒有重讀的必要 */
const SITES = load();

// ─── 對外 ────────────────────────────────────────────────────

/**
 * 把內部資料削成給前端的形狀。
 *
 * ★ 刻意用**逐欄位列舉**而不是展開後 delete：
 *   `const { geo, ...rest } = site` 這種寫法在 Site 多一個欄位時會自動把新欄位
 *   帶到前端去，而且沒有任何地方會提醒你。列舉是白名單，白名單才擋得住「不小心」。
 */
export function toPublicSite(site: Site): PublicSite {
	return {
		id: site.id,
		name: site.name.zhHant,
		tagline: site.tagline.zhHant,
		lat: site.geo.lat,
		lng: site.geo.lng,
		sensingM: site.geo.sensingM,
		status: site.status,
		hasStory: site.hasStory,
		storyOrder: site.storyOrder
	};
}

/** 地圖要的景點清單。順序固定（照 id），讓回應可快取也好比對 */
export function listPublicSites(): PublicSite[] {
	return [...SITES.values()].map(toPublicSite).sort((a, b) => a.id.localeCompare(b.id));
}

/** 伺服器端查單一景點（含判定半徑）。★ 回傳值不可直接丟進任何回應 */
export function getSite(id: string): Site | null {
	return SITES.get(id) ?? null;
}

/** 到場判定用。`resolvePresence` 吃這個形狀 */
export function allSiteGeo(): SiteGeo[] {
	return [...SITES.values()].map((s) => ({
		id: s.id,
		lat: s.geo.lat,
		lng: s.geo.lng,
		radiusM: s.geo.radiusM,
		extraCenters: s.geo.extraCenters
	}));
}

/**
 * 這一站可不可以進去。
 *
 * 草稿站只有地理資料，沒有靈魂可以召喚——進去只會看到一個空的角色。
 * `/api/site/:id/enter` 會用這個判斷，見 SDD §2.3 的 `status` 說明。
 */
export function isPlayable(id: string): boolean {
	return SITES.get(id)?.status === 'playable';
}
