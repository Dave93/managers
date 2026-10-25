-- Догоняет schema.ts (hanging_orders, e7c6aa0/d7c6674): на проде объекты могли быть созданы вручную, поэтому всё IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS "managers_hanging_order_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hanging_order_id" uuid NOT NULL,
	"order_id" text,
	"action" text NOT NULL,
	"user_id" uuid,
	"user_login" text,
	"params" jsonb,
	"state" text NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "managers_hanging_orders" ADD COLUMN IF NOT EXISTS "when_printed" text;--> statement-breakpoint
ALTER TABLE "managers_hanging_orders" ADD COLUMN IF NOT EXISTS "when_cooking_completed" text;--> statement-breakpoint
ALTER TABLE "managers_hanging_orders" ADD COLUMN IF NOT EXISTS "when_sended" text;--> statement-breakpoint
ALTER TABLE "managers_hanging_orders" ADD COLUMN IF NOT EXISTS "when_delivered" text;--> statement-breakpoint
ALTER TABLE "managers_hanging_orders" ADD COLUMN IF NOT EXISTS "when_closed" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "managers_hoa_order_idx" ON "managers_hanging_order_actions" USING btree ("hanging_order_id");