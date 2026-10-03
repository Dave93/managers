CREATE TABLE "store_terminal_links" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"terminal_id" uuid NOT NULL,
	"orders_90d" integer NOT NULL,
	"last_order_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN "exord_filtered" boolean DEFAULT false NOT NULL;