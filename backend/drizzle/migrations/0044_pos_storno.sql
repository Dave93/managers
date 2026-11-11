CREATE TABLE "pos_storno_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_number" integer,
	"cash_register_number" integer NOT NULL,
	"payment_type_id" uuid NOT NULL,
	"removal_type_id" uuid,
	"amount" numeric,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"finished_by" varchar(8),
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"message" text,
	"storno_order_id" uuid,
	"plugin_version" varchar(32),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"cancelled_by" uuid
);
--> statement-breakpoint
CREATE TABLE "pos_storno_terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"iiko_terminal_id" varchar(64),
	"iiko_terminal_name" text,
	"cash_register_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"plugin_version" varchar(32),
	"last_seen_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_storno_commands_order_uq" ON "pos_storno_commands" USING btree ("organization_id","order_id") WHERE "pos_storno_commands"."status" not in ('rejected', 'expired', 'dry_run_ok', 'cancelled');--> statement-breakpoint
CREATE INDEX "pos_storno_commands_claim_idx" ON "pos_storno_commands" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_storno_terminals_token_uq" ON "pos_storno_terminals" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pos_storno_terminals_org_idx" ON "pos_storno_terminals" USING btree ("organization_id");