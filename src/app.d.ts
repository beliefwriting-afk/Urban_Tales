// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		/**
		 * 掛在單一請求上的暫存區，由 hooks.server.ts 填。
		 * 給 Python 背景的對照：≈ FastAPI 的 request.state。
		 */
		interface Locals {
			/**
			 * 目前玩家的 uuid。
			 *
			 * ★ 會是 null —— 圖磚、CSS 這類子資源不走身分流程（見 hooks.server.ts
			 *   的 needsIdentity），所以每個用到它的地方都必須先檢查。
			 *   型別上就逼你面對這件事，不要用 `!` 蓋過去。
			 */
			playerId: string | null;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
