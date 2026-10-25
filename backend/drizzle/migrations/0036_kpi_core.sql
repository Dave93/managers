CREATE TABLE "kpi_card_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"title_ru" varchar(300) NOT NULL,
	"title_uz" varchar(300) NOT NULL,
	"hint_ru" text,
	"hint_uz" text,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"group_key" varchar(20) DEFAULT 'base' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"title_ru" varchar(300) NOT NULL,
	"title_uz" varchar(300) NOT NULL,
	"staff_role_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" varchar(20) NOT NULL,
	"subject_id" uuid NOT NULL,
	"employee_id" uuid,
	"period" date NOT NULL,
	"opened_via" varchar(16) NOT NULL,
	"opened_by_user_id" uuid,
	"reason" text NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"resolution_comment" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_employee_cards" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"card_id" uuid,
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "kpi_evaluator_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid,
	"terminal_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_kind" varchar(16) NOT NULL,
	"employee_id" uuid,
	"user_id" uuid,
	"kind" varchar(40) NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"tg_message_id" varchar(64),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_periods" (
	"period" date PRIMARY KEY NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"reopen_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_raise_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quarter_start" date NOT NULL,
	"employee_id" uuid NOT NULL,
	"terminal_id" uuid,
	"card_id" uuid,
	"months" jsonb NOT NULL,
	"months_scored" integer DEFAULT 0 NOT NULL,
	"avg_pct" numeric(5, 2),
	"suggested_amount" numeric(18, 2),
	"status" varchar(16) NOT NULL,
	"approved_amount" numeric(18, 2),
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_raise_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"min_pct" numeric(5, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"actor_kind" varchar(16) NOT NULL,
	"actor_user_id" uuid,
	"kind" varchar(24) NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"old_score_pct" numeric(5, 2),
	"new_score_pct" numeric(5, 2),
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"title_ru" varchar(300) NOT NULL,
	"title_uz" varchar(300) NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"score" smallint,
	"auto_value" jsonb,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "kpi_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" date NOT NULL,
	"employee_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"evaluator_user_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"score_pct" numeric(5, 2),
	"submitted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_violation_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"violation_id" uuid NOT NULL,
	"file_path" varchar(500) NOT NULL,
	"mime" varchar(40) NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"card_item_id" uuid,
	"item_title_ru" varchar(300),
	"period" date NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"comment" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kpi_card_items" ADD CONSTRAINT "kpi_card_items_card_id_kpi_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."kpi_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_review_items" ADD CONSTRAINT "kpi_review_items_review_id_kpi_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."kpi_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_violation_photos" ADD CONSTRAINT "kpi_violation_photos_violation_id_kpi_violations_id_fk" FOREIGN KEY ("violation_id") REFERENCES "public"."kpi_violations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kpi_card_items_card_idx" ON "kpi_card_items" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_cards_code_uq" ON "kpi_cards" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_disputes_open_uq" ON "kpi_disputes" USING btree ("subject_type","subject_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "kpi_disputes_period_idx" ON "kpi_disputes" USING btree ("period");--> statement-breakpoint
CREATE INDEX "kpi_evaluator_scopes_user_idx" ON "kpi_evaluator_scopes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_notifications_dedupe_uq" ON "kpi_notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "kpi_notifications_status_idx" ON "kpi_notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_raise_decisions_quarter_employee_uq" ON "kpi_raise_decisions" USING btree ("quarter_start","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_raise_tiers_min_pct_uq" ON "kpi_raise_tiers" USING btree ("min_pct");--> statement-breakpoint
CREATE INDEX "kpi_review_events_review_idx" ON "kpi_review_events" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_review_items_review_item_uq" ON "kpi_review_items" USING btree ("review_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_reviews_period_employee_uq" ON "kpi_reviews" USING btree ("period","employee_id");--> statement-breakpoint
CREATE INDEX "kpi_reviews_period_terminal_idx" ON "kpi_reviews" USING btree ("period","terminal_id");--> statement-breakpoint
CREATE INDEX "kpi_violation_photos_violation_idx" ON "kpi_violation_photos" USING btree ("violation_id");--> statement-breakpoint
CREATE INDEX "kpi_violations_period_terminal_idx" ON "kpi_violations" USING btree ("period","terminal_id");--> statement-breakpoint
CREATE INDEX "kpi_violations_employee_period_idx" ON "kpi_violations" USING btree ("employee_id","period");