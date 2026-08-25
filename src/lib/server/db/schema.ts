/**
 * 執行期資料模型（PostgreSQL）—— SDD §3.2。
 *
 * 設計原則（§3.1）：
 *   資料庫只存三種東西 —— 玩家是誰、玩家做過什麼、用掉多少額度。
 *   其餘（景點、角色、文字、卡片定義）全在內容層 content/。
 *
 * ★★★ 隱私硬約束（企劃書 §7、§8.8）★★★
 *   這份 schema 裡不存在任何經緯度欄位。
 *   不是慣例，是硬約束。CI 有一條檢查會掃 lat / lng / geography /
 *   geometry 關鍵字，出現即建置失敗（見 scripts/content-check.ts）。
 *
 * 給 Python 背景的對照：Drizzle ≈ SQLAlchemy 的 declarative 寫法。
 *   pgTable('players', {...})  ≈ class Player(Base): __tablename__ = 'players'
 *   .notNull()                 ≈ nullable=False
 *   .references(() => x.id)    ≈ ForeignKey
 */
import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	integer,
	bigint,
	bigserial,
	boolean,
	date,
	numeric,
	real,
	primaryKey,
	index,
	check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── 玩家 ────────────────────────────────────────────────────
// ★ 沒有 email、沒有姓名、沒有頭像 URL、沒有 IP。
//   Google 綁定只需要 sub 這個不可逆識別碼。

export const players = pgTable('players', {
	id: uuid('id').primaryKey().defaultRandom(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
	/** Google 綁定（P4）。未綁定為 null */
	googleSub: text('google_sub').unique(),
	boundAt: timestamp('bound_at', { withTimezone: true }),
	/** 玩家偏好（音效、動畫降級…） */
	settings: jsonb('settings')
		.notNull()
		.default(sql`'{}'::jsonb`)
});

// ─── 每站進度 ────────────────────────────────────────────────

export const playerSiteState = pgTable(
	'player_site_state',
	{
		playerId: uuid('player_id')
			.notNull()
			.references(() => players.id, { onDelete: 'cascade' }),
		/** 對應內容層的 site.id。刻意不做外鍵 —— 景點定義在 Git 不在 DB */
		siteId: text('site_id').notNull(),
		/** 首次進入 L2 → 發相遇卡 */
		firstMetAt: timestamp('first_met_at', { withTimezone: true }),
		/** 完成拍照任務 → 發任務卡 */
		photoTaskAt: timestamp('photo_task_at', { withTimezone: true }),
		/** P3: none | in_progress | done */
		storyStage: text('story_stage').notNull().default('none'),
		/** P3: 劇情分支狀態 */
		storyState: jsonb('story_state')
			.notNull()
			.default(sql`'{}'::jsonb`)
	},
	(t) => [primaryKey({ columns: [t.playerId, t.siteId] })]
);

// ─── 成就卡 ──────────────────────────────────────────────────
// 卡片是 player_site_state 的衍生資料，但獨立成表：
// 圖鑑頁只查這一張表，且未來新增卡種不必改進度表。

export const playerCards = pgTable(
	'player_cards',
	{
		playerId: uuid('player_id')
			.notNull()
			.references(() => players.id, { onDelete: 'cascade' }),
		cardId: text('card_id').notNull(),
		earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.playerId, t.cardId] })]
);

// ─── 對話歷史 ────────────────────────────────────────────────
// ★ 這不是「聊天記錄」功能，只是為了讓 AI 有上下文。
//   保留 30 天，由排程清理（SDD §11.3）。

export const chatTurns = pgTable(
	'chat_turns',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		playerId: uuid('player_id')
			.notNull()
			.references(() => players.id, { onDelete: 'cascade' }),
		siteId: text('site_id').notNull(),
		role: text('role').notNull(),
		content: text('content').notNull(),
		/** 這則是不是保底台詞。上線後可算「AI 可用率」—— 唯一需要的營運指標 */
		isFallback: boolean('is_fallback').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('chat_turns_lookup').on(t.playerId, t.siteId, t.createdAt.desc()),
		check('chat_turns_role_check', sql`${t.role} IN ('user', 'soul')`)
	]
);

// ─── 用量：每玩家每日 ────────────────────────────────────────

export const usagePlayerDaily = pgTable(
	'usage_player_daily',
	{
		playerId: uuid('player_id')
			.notNull()
			.references(() => players.id, { onDelete: 'cascade' }),
		day: date('day').notNull(),
		messageCount: integer('message_count').notNull().default(0),
		inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
		outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.playerId, t.day] })]
);

// ─── 用量：全域每日 ──────────────────────────────────────────
// 企劃書 §8.6 的落實：全域每日預算上限。

export const usageGlobalDaily = pgTable('usage_global_daily', {
	day: date('day').primaryKey(),
	messageCount: integer('message_count').notNull().default(0),
	inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
	outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
	estCostUsd: numeric('est_cost_usd', { precision: 10, scale: 6 }).notNull().default('0')
});

// ─── 速率限制（token bucket）─────────────────────────────────

export const rateBuckets = pgTable('rate_buckets', {
	/** 'chat:{player_id}' */
	key: text('key').primaryKey(),
	tokens: real('tokens').notNull(),
	refilledAt: timestamp('refilled_at', { withTimezone: true }).notNull().defaultNow()
});
