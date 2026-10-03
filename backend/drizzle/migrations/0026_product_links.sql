CREATE TABLE "product_links_meta" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"version" text NOT NULL,
	"generated_at" timestamp with time zone,
	"terminals_count" integer NOT NULL,
	"links_count" integer NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terminal_product_links" (
	"terminal_id" uuid PRIMARY KEY NOT NULL,
	"product_ids" uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
