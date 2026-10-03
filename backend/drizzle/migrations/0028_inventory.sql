CREATE TABLE "inventory_count_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"count_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"qty" numeric(14, 4) NOT NULL,
	"created_by" uuid NOT NULL,
	"client_created_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "inventory_count_entries_qty_check" CHECK (qty >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_count_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"user_id" uuid NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"unit_id" uuid,
	"unit_name" varchar(255),
	"group_id" uuid,
	"group_name" varchar(512) NOT NULL,
	"source" varchar(16) NOT NULL,
	"added_by" uuid,
	"skipped" boolean DEFAULT false NOT NULL,
	"skipped_by" uuid,
	"fact_qty" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"organization_id" uuid,
	"template_id" uuid,
	"template_name" varchar(255) NOT NULL,
	"period" date NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"exord_filtered" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_count_entries" ADD CONSTRAINT "inventory_count_entries_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_entries" ADD CONSTRAINT "inventory_count_entries_line_id_inventory_count_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."inventory_count_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_events" ADD CONSTRAINT "inventory_count_events_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_template_id_inventory_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inventory_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_template_items" ADD CONSTRAINT "inventory_template_items_template_id_inventory_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inventory_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_count_entries_count_idx" ON "inventory_count_entries" USING btree ("count_id");--> statement-breakpoint
CREATE INDEX "inventory_count_entries_line_idx" ON "inventory_count_entries" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "inventory_count_events_count_idx" ON "inventory_count_events" USING btree ("count_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_count_lines_count_product_uq" ON "inventory_count_lines" USING btree ("count_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_counts_store_period_template_uq" ON "inventory_counts" USING btree ("store_id","period","template_id") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "inventory_counts_store_period_idx" ON "inventory_counts" USING btree ("store_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_counts_store_period_branch_uq" ON "inventory_counts" USING btree ("store_id","period") WHERE template_id is null and status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_template_items_template_product_uq" ON "inventory_template_items" USING btree ("template_id","product_id");