CREATE TABLE "exord_store_overrides" (
	"exord_user_id" integer PRIMARY KEY NOT NULL,
	"terminal_id" uuid NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exord_stores" (
	"exord_user_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"terminal_iiko_id" uuid,
	"product_count" integer NOT NULL,
	"terminal_id" uuid,
	"source" varchar(16),
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_links_meta" ADD COLUMN "mapping_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "exord_store_overrides_terminal_uq" ON "exord_store_overrides" USING btree ("terminal_id");