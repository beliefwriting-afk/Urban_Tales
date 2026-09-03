CREATE TABLE "chat_turns" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"site_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_turns_role_check" CHECK ("chat_turns"."role" IN ('user', 'soul'))
);
--> statement-breakpoint
CREATE TABLE "player_cards" (
	"player_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_cards_player_id_card_id_pk" PRIMARY KEY("player_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "player_site_state" (
	"player_id" uuid NOT NULL,
	"site_id" text NOT NULL,
	"first_met_at" timestamp with time zone,
	"photo_task_at" timestamp with time zone,
	"story_stage" text DEFAULT 'none' NOT NULL,
	"story_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "player_site_state_player_id_site_id_pk" PRIMARY KEY("player_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"google_sub" text,
	"bound_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "players_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "rate_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" real NOT NULL,
	"refilled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_global_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"est_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_player_daily" (
	"player_id" uuid NOT NULL,
	"day" date NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_player_daily_player_id_day_pk" PRIMARY KEY("player_id","day")
);
--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_cards" ADD CONSTRAINT "player_cards_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_site_state" ADD CONSTRAINT "player_site_state_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_player_daily" ADD CONSTRAINT "usage_player_daily_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_turns_lookup" ON "chat_turns" USING btree ("player_id","site_id","created_at" DESC NULLS LAST);