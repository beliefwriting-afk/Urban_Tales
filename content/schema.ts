/**
 * 內容層的 Zod schema —— 型別與驗證的單一事實來源。
 *
 * SDD §2.3。這一份同時被兩個地方用：
 *   1. 建置期：scripts/content-check.ts 掃過所有 YAML（npm run content:check）
 *   2. 執行期：伺服器載入內容時驗證
 *
 * ⚠️ 不要為了工具方便另外寫第二份 schema（例如 Python 的 pydantic）。
 *    兩份會漂移的定義正是內容治理最不該發生的事。
 *
 * 給 Python 背景的對照：Zod ≈ pydantic。
 *   z.object({...})     ≈ class X(BaseModel)
 *   z.string()          ≈ str
 *   .nullable()         ≈ Optional[...]
 *   .default(x)         ≈ 欄位預設值
 *   z.infer<typeof X>   ≈ 由 model 反推型別（TS 特有，Python 不需要）
 */
import { z } from 'zod';

/**
 * 多語言文字。企劃書 §6.2：第一天分欄，第一版只填 zhHant。
 * 架構預留多語言，但不做多語言 —— 這是刻意的。
 */
export const LocalizedText = z.object({
	zhHant: z.string().min(1),
	en: z.string().nullable().default(null),
	ja: z.string().nullable().default(null)
});
export type LocalizedText = z.infer<typeof LocalizedText>;

// ─── 景點 ────────────────────────────────────────────────────

export const SiteSchema = z.object({
	id: z.string().regex(/^[a-z0-9-]+$/),
	name: LocalizedText,
	/** 一句話介紹，顯示在地圖標記上 */
	tagline: LocalizedText,

	geo: z.object({
		lat: z.number(),
		lng: z.number(),
		/**
		 * 到場判定基礎半徑（公尺）。P0 實地量測後定案，見 SDD §5.5。
		 * ★★★ 這個值**永遠不進 API 回應**。★★★ 它是「要走多近才算到」，
		 *     是偽造座標的人唯一猜不到的東西（SDD 附錄 C 的改寫說明）。
		 */
		radiusM: z.number().min(20).max(150),

		/**
		 * 感應半徑（公尺）——進來才畫漣漪，告訴玩家「這裡有東西」。
		 *
		 * 這個值**可以**給前端：它不參與到場判定，猜到也換不到任何能力。
		 * 必須大於 radiusM，否則會出現「點得動但沒有漣漪」的矛盾狀態。
		 */
		sensingM: z.number().min(50).max(500).default(150),
		/**
		 * 長條形場域（如剝皮寮）可設多個判定圓心，任一命中即算到場。
		 * 留空則只用上面的 lat/lng。
		 */
		extraCenters: z.array(z.object({ lat: z.number(), lng: z.number() })).default([])
	}),

	/**
	 * 完成度。**明確宣告，不從「檔案缺不缺」推斷。**
	 *
	 *   draft    ＝ 只有 site.yaml。提供地圖圖釘與距離判定要用的地理資料，
	 *              但**進不去**——沒有靈魂可以召喚，`/api/site/:id/enter` 一律拒絕。
	 *   playable ＝ 五份齊全、立繪就位，可遊玩。
	 *
	 * ★ 為什麼要這個欄位，而不是看「五個檔案齊不齊」：
	 *   資料夾少一個檔可能是手滑，寫著 `status: draft` 是一句聲明。
	 *   而且 content:check 會把草稿站列出來，「還沒寫完」因此變成一個
	 *   系統知道、而且每次建置都會講出來的狀態——不是靜靜地通過。
	 *
	 * ⚠️ 預設是 draft。要讓一站上線必須主動把它改成 playable，
	 *   那一刻所有內容規則才會對它生效。**新增景點的預設狀態是「不可遊玩」**，
	 *   這個方向是刻意的：漏掉宣告的後果是玩家進不去，不是進去看到半成品。
	 */
	status: z.enum(['draft', 'playable']).default('draft'),

	/** 是否有劇情層（P3） */
	hasStory: z.boolean().default(false),
	/** 劇情線的順序，無劇情則為 null */
	storyOrder: z.number().nullable().default(null)
});
export type Site = z.infer<typeof SiteSchema>;

// ─── 城市靈魂（人格卡）────────────────────────────────────────

export const SoulSchema = z.object({
	siteId: z.string(),
	name: LocalizedText,

	/** 人格卡。整段會被注入 system prompt（SDD §6.2 的 [1]） */
	persona: z.object({
		/** 「我是誰」：地標的擬人化集體意識，不是人 */
		identity: LocalizedText,
		/** 語氣、說話習慣、口頭禪 */
		voice: LocalizedText,
		/** ★ 它憑什麼知道這些事 —— 一律用自己的觀察力，不得歸因於神明 */
		knows: LocalizedText,
		/** ★ 企劃書 §4.3：「不是誰」 */
		isNot: z.array(LocalizedText).min(1),
		/** ★ 此角色專屬的禁忌主題，全域護欄之外的追加（不得用來豁免全域護欄） */
		taboos: z.array(LocalizedText).default([])
	}),

	/**
	 * 立繪與渲染方式。
	 *
	 * ⚠️ **可以是 null，但只有草稿站可以。** 角色美術是 P0-1 的產出，
	 *   在那之前人格卡就該先寫好——文字與圖是兩條可以平行的軌道，
	 *   不該互相擋路。content:check 會強制「playable 的站 art 不得為 null」，
	 *   所以這個 null 逃不到正式環境去。
	 */
	art: z
		.object({
			/** L2 / L3 / 卡面共用的立繪（非像素） */
			portrait: z.string(),
			/** 分層 PNG 路線填圖層目錄；Live2D 路線填 model 路徑。見 SDD §9.4 */
			renderer: z.discriminatedUnion('kind', [
				z.object({ kind: z.literal('layered-png'), layersDir: z.string() }),
				z.object({ kind: z.literal('live2d'), modelPath: z.string() })
			])
		})
		.nullable()
		.default(null)
});
export type Soul = z.infer<typeof SoulSchema>;

// ─── 地方故事素材庫 ───────────────────────────────────────────

/**
 * ★★★ 這是靈魂「知道的事」的全部來源。★★★
 *
 * 【2026-09-04 改版】原本是一個 `items` 陣列，每條標 `kind`（已知史實／民間傳說／
 * 角色想像）＋ `topic`。改成現在的兩塊：**一段史實 ＋ 幾條傳說單列**。
 *
 * ★ 為什麼改：君和寫內容時是「一站寫一段」，不是「一站列十三條」。
 *   條目制逼他把一段連貫的敘述切碎成沒有上下文的句子，而 AI 拿到那些碎片
 *   反而更難講成一段像人說的話。
 *
 * ★ 為什麼**不**乾脆合成一整段就好——`legends` 必須分開：
 *
 *   企劃書 §4.2 第 5 條要求區分「已知史實／民間傳說」。那個區分不是分類癖，
 *   它決定靈魂**用什麼語氣講一句話**：
 *
 *     facts   → 可以講得斬釘截鐵（「一九〇八年落成，近藤十郎設計」）
 *     legends → 必須留活口（「有一種說法是⋯⋯，也有人說⋯⋯」）
 *
 *   混成一段的話，「八卦祈福、十字架鎮邪」跟「文化局的古蹟公告」在模型眼裡
 *   長得一樣，它會用同一種語氣講出來。**剝皮寮的「剝皮」由來是必踩的那一題。**
 *
 * ★ 「角色想像」那一類移出去了——它不是素材，是**權限**。
 *   「這個靈魂可以描述哪些沒被記錄下來的東西」定義在 `SoulSchema.persona.knows`
 *   與人格卡的想像權限，不在素材庫裡。素材庫只放「外面查得到的事」。
 */
export const MaterialSchema = z.object({
	siteId: z.string(),

	/**
	 * ★ 一段史實。**整段會逐字進 system prompt**（SDD §6.2）。
	 *
	 * 寫法建議：寫成連貫的敘述，不要寫成條列。模型比較會把連貫的段落
	 * 講成連貫的話；條列進去，出來也像條列。
	 */
	facts: LocalizedText,

	/**
	 * 上面那段史實的出處，至少一個。
	 *
	 * ★ 為什麼是陣列而不是單一字串：一段史實通常跨好幾個來源
	 *   （文化局公告 ＋ 建築研究 ＋ 電影資料庫）。逼成一個字串的話，
	 *   人會開始用頓號串起來，那就等於沒有結構。
	 *
	 * ⚠️ 出處**不會**進 prompt，也不會給玩家看。它存在的理由只有一個：
	 *   讓審這份內容的人（君和）查得到每一句話是從哪來的。
	 */
	sources: z.array(z.string().min(1)).min(1),

	/**
	 * 民間傳說、地名由來的各種說法、對形狀的象徵解釋⋯⋯
	 * **凡是「有人這樣說，但沒有定論」的，放這裡。**
	 *
	 * 可以是空的（不是每一站都有傳說），但空的要是刻意的——
	 * `content:check` 會把沒有 legends 的站列出來讓人再想一次。
	 */
	legends: z
		.array(
			z.object({
				id: z.string(),
				text: LocalizedText,
				/** 傳說可以沒有出處，那正是它是傳說的原因 */
				source: z.string().nullable().default(null)
			})
		)
		.default([])
});
export type Material = z.infer<typeof MaterialSchema>;

// ─── 引導提問 ────────────────────────────────────────────────

/**
 * ★★★ 每站**恰好 3 題**，寫死，不挑選、不輪替。★★★
 *
 * 【2026-09-04 改版】原本是「每站 ≥ 12 題，分 opening／followup／safety 三個 tier，
 * 每題對到一個 materials topic，由 pickPrompts() 依對話進度挑」。整套拿掉了。
 *
 * ★ 為什麼可以拿掉（企劃書 §5.3 原本要 12 題的理由是「重複感是『這是機器人』的主因」）：
 *
 *   那條理由成立的前提是**玩家會反覆看到這些提問**。但本專案：
 *     · 沒有回訪機制（CONTEXT 明文推翻），一趟就拿完一個景點的卡
 *     · 引導提問是「玩家卡住時的起手式」，不是主要互動——按下去之後就進自由對話了
 *     · 只做六站，一個玩家整趟總共看到 18 題
 *
 *   在這個形狀下，12 題的池子換來的不是「不重複」，是「九成的題目玩家永遠看不到」，
 *   而那九成一樣要逐字審（企劃書 §4.3：措辭即成品）。**成本全付，好處沒拿到。**
 *
 * ★ 為什麼是 `.length(3)` 而不是 `.min(3)`：
 *   L2 的版面是固定三個按鈕。允許多寫的話，前端就得決定「多出來的怎麼辦」
 *   （隨機抽三個？滾動？）——那就是把剛拿掉的挑題邏輯又請回來。
 *   **恰好三題讓「多寫了」在建置時就被擋下來，而不是上線才發現版面破了。**
 *
 * ⚠️ 這三題仍然是**內容**，要逐字審。點下去等同玩家自己打字送出，
 *   不繞過任何安全檢查與用量控制（企劃書 §5.3）。
 */
export const GuidedPromptSchema = z.object({
	siteId: z.string(),
	items: z
		.array(
			z.object({
				id: z.string(),
				/**
				 * ⚠️ 建議 15 字以內。
				 *
				 * 這不是美感問題：UI 上它是可直接點擊送出的按鈕，長了排不下。
				 * 這是踩出來的：先做長句、撞到版面之後才改成短提問。
				 * 沒有做成 schema 強制，因為中文全形與標點的「字數」不好定義，
				 * 而定不清楚的規則寫進 schema 只會製造假的安全感。
				 */
				text: LocalizedText
			})
		)
		.length(3)
});
export type GuidedPromptFile = z.infer<typeof GuidedPromptSchema>;
export type GuidedPrompt = GuidedPromptFile['items'][number];

// ─── 保底台詞 ────────────────────────────────────────────────

/**
 * 企劃書 §4.3：措辭即成品，需逐字審。
 * 必須寫成「這個角色會說的話」，不是「系統暫時無法回應」。
 */
export const FallbackSchema = z.object({
	siteId: z.string(),
	lines: z.object({
		/** AI 呼叫失敗／逾時 */
		aiUnavailable: z.array(LocalizedText).min(3),
		/** 玩家問到禁忌主題（解籤、吉凶、教義比較…） */
		refusal: z.array(LocalizedText).min(3),
		/** 玩家問的事素材庫沒有 */
		unknown: z.array(LocalizedText).min(3),
		/** 額度用盡 */
		quotaReached: z.array(LocalizedText).min(2),
		/** 玩家離題（問天氣、問你是不是 AI…） */
		offTopic: z.array(LocalizedText).min(3)
	})
});
export type FallbackFile = z.infer<typeof FallbackSchema>;
export type FallbackReasonKey = keyof FallbackFile['lines'];

// ─── 成就卡 ──────────────────────────────────────────────────

export const CardKind = z.enum(['encounter', 'task', 'story']); // 相遇 / 任務 / 劇情
export type CardKind = z.infer<typeof CardKind>;

export const CardSchema = z.object({
	id: z.string(),
	kind: CardKind,
	siteId: z.string(),
	title: LocalizedText,
	/** 卡背文字：這張卡想讓玩家記住的那句話 */
	flavor: LocalizedText,
	art: z.object({
		portrait: z.string(), // 立繪（非像素）
		frame: z.string() // 像素卡框
	})
});
export type Card = z.infer<typeof CardSchema>;

export const CardsFileSchema = z.object({
	cards: z.array(CardSchema)
});

// ─── 全域安全界線 ─────────────────────────────────────────────

/**
 * ★★★ 全站唯一一份。不允許任何景點覆寫或追加豁免。★★★
 *
 * SDD §2.2：「沒有第二個地方可以放護欄，也就沒有第二套護欄。」
 * 這個 schema 刻意不含 siteId —— 護欄沒有「某一站的版本」。
 */
export const GuardrailsSchema = z.object({
	/** 注入 system prompt 最前面的優先權宣告（SDD §6.2） */
	precedence: z.string().min(1),
	rules: z
		.array(
			z.object({
				id: z.number(),
				/** 人類可讀的規則名 */
				title: z.string().min(1),
				/** 給模型的可執行形式 —— 這一段會逐字進 prompt */
				instruction: z.string().min(1),
				/** 對應企劃書條文，供追溯 */
				source: z.string()
			})
		)
		.min(8)
});
export type Guardrails = z.infer<typeof GuardrailsSchema>;

// ─── 靜態檢查用的關鍵詞黑名單 ─────────────────────────────────

/**
 * content:check #9：persona 內不得出現「神明說」類字串。
 * 這是企劃書 §4.2 第 2 條的靜態檢查。
 *
 * 放在 schema.ts 而不是散在腳本裡，是為了讓「規則在哪」只有一個答案。
 */
export const FORBIDDEN_PERSONA_PHRASES = [
	'神明說',
	'神明告訴',
	'神明指示',
	'菩薩說',
	'菩薩告訴',
	'佛祖說',
	'媽祖說',
	'觀音說',
	'神諭',
	'託夢告訴我'
] as const;
