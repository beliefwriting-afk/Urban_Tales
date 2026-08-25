/**
 * 角色動畫抽象層 —— SDD §9.4。
 *
 * ★ 這是讓 P0 的未定案不擋 P1 開工的關鍵。
 *
 * 企劃書附錄 B #3（Live2D vs 分層 PNG）要到 P0 才定案，
 * 但 P1 的垂直切片需要角色能動。這個介面把兩件事解耦：
 *
 *   - P1 先用 LayeredPngRenderer 把整條體驗打通（半天到一天）
 *   - 每隻角色在 soul.yaml 裡自己宣告用哪種，混用是免費的
 *   - Live2D 若最終不採用，刪掉一個 class 與一個依賴即可，其餘一行不動
 *
 * 給 Python 背景的對照：
 *   interface ≈ Protocol / ABC。TypeScript 的 interface 是「結構化型別」——
 *   不需要顯式繼承，只要形狀符合就算實作了（跟 Python 的 Protocol 一樣）。
 */

export type SoulPose = 'idle' | 'talking' | 'thinking' | 'happy' | 'somber';

/** 顯示座標的位置與縮放。L3 讓玩家拖曳縮放角色時用 */
export type SoulTransform = { x: number; y: number; scale: number };

export interface SoulRenderer {
	/** 掛載到指定 canvas */
	mount(canvas: HTMLCanvasElement): Promise<void>;

	/** 情緒／姿態切換。兩種實作都必須支援這組最小集合 */
	setPose(pose: SoulPose): void;

	/** L3 的位置與縮放 */
	setTransform(t: SoulTransform): void;

	/**
	 * ★ 擷取用：把當前畫面畫進任意 context（SDD §7.2 的合成管線）。
	 *
	 * 快門按下時，相機影格與角色會在 offscreen canvas 上合成，
	 * 所以 renderer 必須能對「不是自己掛載的那個 canvas」繪圖。
	 */
	renderToCanvas(
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		t: SoulTransform
	): void;

	dispose(): void;
}

/** soul.yaml 的 art.renderer 決定要建哪一種 */
export type RendererSpec =
	{ kind: 'layered-png'; layersDir: string } | { kind: 'live2d'; modelPath: string };

/**
 * 工廠：依 soul.yaml 的宣告建立對應的 renderer。
 *
 * TODO(P0-1) 兩種實作各做一版同一角色並記錄實際工時，
 *            用工時決定 §9.4 的最終路線（SDD §15 P0-1 的完成判準）。
 * TODO(P0-4) 動手畫第一隻角色之前，先驗 Cubism FREE 能否匯出 .moc3
 *            —— 五分鐘的事，驗晚了很痛（SDD §15 P0-4）。
 */
export async function createSoulRenderer(spec: RendererSpec): Promise<SoulRenderer> {
	switch (spec.kind) {
		case 'layered-png':
			throw new Error('LayeredPngRenderer 尚未實作 —— 見 SDD §9.4 / P0-1');
		case 'live2d':
			throw new Error('Live2DRenderer 尚未實作 —— 見 SDD §9.4 / P0-1');
	}
}
