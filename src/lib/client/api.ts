/**
 * 前端呼叫後端的唯一一層 —— 切片 7。
 *
 * ★ 元件與狀態層不自己 `fetch`，都走這裡。理由跟 `speak()` 是唯一 AI 出口一樣：
 *   收斂到一個地方，錯誤處理與型別標註才不會每個呼叫點各寫一套。
 *
 * ★ 回應型別全部來自 `$lib/shared/api`，那是前後端共用的**唯一一份**定義。
 *   前端自己再寫一份的話，兩邊會漂移而 TypeScript 不會發現。
 *
 * ⚠️ 這些函式失敗時**丟例外**，不回 null。呼叫端（session）用 try/catch 決定
 *   要顯示什麼——因為「網路斷了」與「伺服器說不行」對玩家是兩件不同的事，
 *   把它們都變成 null 就分不出來了。
 */
import type {
	MeResponse,
	PresenceRequest,
	PresenceResponse,
	PublicSite,
	SitesResponse
} from '$lib/shared/api';

/** 回應不是 2xx 時丟這個，帶著伺服器給的 code（前端據此分支） */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string | null;

	constructor(status: number, code: string | null, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		...init,
		headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers }
	});

	if (!res.ok) {
		// 錯誤本文不一定是 JSON（例如 SvelteKit 自己的錯誤頁）
		const body = await res.json().catch(() => null);
		throw new ApiError(
			res.status,
			typeof body?.code === 'string' ? body.code : null,
			typeof body?.message === 'string' ? body.message : `HTTP ${res.status}`
		);
	}

	return (await res.json()) as T;
}

export async function getSites(): Promise<PublicSite[]> {
	const { sites } = await request<SitesResponse>('/api/sites');
	return sites;
}

export function getMe(): Promise<MeResponse> {
	return request<MeResponse>('/api/me');
}

/**
 * 到場判定。
 *
 * ★★★ 這是全系統唯一能回答「我到了沒」的地方。★★★
 *   前端沒有判定半徑（`PublicSite` 裡沒有 radiusM，而且永遠不會有），
 *   所以這個問題**只能問伺服器**。切片 7 刪掉的那段前端判定就是這件事的落實。
 */
export function postPresence(body: PresenceRequest): Promise<PresenceResponse> {
	return request<PresenceResponse>('/api/presence', {
		method: 'POST',
		body: JSON.stringify(body)
	});
}

/** 圖鑑。未獲得的卡不會帶卡面內容——那是伺服器端的型別擋住的 */
export function getCollection(): Promise<CollectionResponse> {
	return request<CollectionResponse>('/api/collection');
}

/**
 * ⚠️ 圖鑑的型別暫時定義在這裡而不是 shared/api.ts。
 *
 *   理由：`CollectionEntry` 在伺服器端是 discriminated union，
 *   而那個型別的**價值就在於伺服器端寫不出「未獲得卻帶著 flavor」**。
 *   把它搬到 shared 要連 CardKind 一起搬，牽動 content/schema.ts。
 *   批 2 接對話時會一起處理——在那之前這裡是唯一的重複，且只是讀取端。
 */
export type CollectionCard =
	| {
			owned: true;
			id: string;
			kind: string;
			siteId: string;
			siteName: string;
			title: string;
			flavor: string;
			art: { portrait: string; frame: string };
			earnedAt: string;
	  }
	| { owned: false; id: string; kind: string; siteId: string; siteName: string; frame: string };

export type CollectionResponse = { owned: number; total: number; cards: CollectionCard[] };
