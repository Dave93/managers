CREATE TABLE "asrabox_stock_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"iiko_id" text NOT NULL,
	"composition_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"laravel_response" jsonb
);
--> statement-breakpoint
ALTER TABLE "corporation_store" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_asrabox_stock_history_terminal_composition_set_at" ON "asrabox_stock_history" USING btree ("terminal_id","composition_id","set_at");