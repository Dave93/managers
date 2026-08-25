CREATE TABLE "stoplist_events" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"brand" text NOT NULL,
	"terminal_id" integer NOT NULL,
	"terminal_name" text,
	"product_id" integer NOT NULL,
	"product_name" text,
	"action" text NOT NULL,
	"balance" double precision,
	"date_add" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stoplist_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand" text NOT NULL,
	"terminal_id" integer NOT NULL,
	"terminal_name" text,
	"product_id" integer NOT NULL,
	"product_name" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"last_balance" double precision
);
--> statement-breakpoint
CREATE INDEX "idx_stoplist_events_brand_term_prod_event_at" ON "stoplist_events" USING btree ("brand","terminal_id","product_id","event_at");--> statement-breakpoint
CREATE INDEX "idx_stoplist_events_event_at" ON "stoplist_events" USING btree ("event_at");--> statement-breakpoint
CREATE INDEX "idx_stoplist_intervals_open_lookup" ON "stoplist_intervals" USING btree ("brand","terminal_id","product_id","ended_at");--> statement-breakpoint
CREATE INDEX "idx_stoplist_intervals_started_at" ON "stoplist_intervals" USING btree ("started_at");