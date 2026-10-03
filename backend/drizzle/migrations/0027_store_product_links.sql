CREATE TABLE "store_product_links" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"product_ids" uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_links_meta" RENAME COLUMN "terminals_count" TO "stores_count";