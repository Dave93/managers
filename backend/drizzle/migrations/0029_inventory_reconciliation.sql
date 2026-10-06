CREATE TABLE "inventory_reconciliation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"user_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_reconciliation_iiko_lines" (
	"reconciliation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"qty" numeric(14, 4) NOT NULL,
	"sum" numeric(18, 2) NOT NULL,
	CONSTRAINT "inventory_reconciliation_iiko_lines_reconciliation_id_product_id_pk" PRIMARY KEY("reconciliation_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_reconciliation_lines" (
	"reconciliation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"unit_name" varchar(255),
	"group_name" varchar(512) NOT NULL,
	"admin_state" varchar(16) NOT NULL,
	"admin_qty" numeric(14, 4),
	"admin_counts_n" integer DEFAULT 0 NOT NULL,
	"book_qty" numeric(14, 4) DEFAULT '0' NOT NULL,
	"book_sum" numeric(18, 2) DEFAULT '0' NOT NULL,
	"iiko_correction_qty" numeric(14, 4) DEFAULT '0' NOT NULL,
	"iiko_correction_sum" numeric(18, 2) DEFAULT '0' NOT NULL,
	"iiko_fact_qty" numeric(14, 4),
	"unit_cost" numeric(18, 4),
	"cost_source" varchar(16),
	"diff_ab_qty" numeric(14, 4),
	"diff_ab_sum" numeric(18, 2),
	"diff_ac_sum" numeric(18, 2),
	CONSTRAINT "inventory_reconciliation_lines_reconciliation_id_product_id_pk" PRIMARY KEY("reconciliation_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"organization_id" uuid,
	"period" date NOT NULL,
	"status" varchar(32) DEFAULT 'waiting_iiko' NOT NULL,
	"iiko_document_id" uuid,
	"iiko_document_num" varchar(64),
	"iiko_document_comment" varchar(1024),
	"iiko_document_at" timestamp,
	"iiko_doc_state" varchar(32),
	"iiko_candidates" jsonb,
	"book_at" timestamp,
	"admin_state" varchar(16) DEFAULT 'none' NOT NULL,
	"lines_total" integer DEFAULT 0 NOT NULL,
	"mismatch_ab_count" integer DEFAULT 0 NOT NULL,
	"diff_ab_sum" numeric(18, 2),
	"diff_ac_sum" numeric(18, 2),
	"diff_bc_sum" numeric(18, 2),
	"fetched_at" timestamp with time zone,
	"fetched_by" uuid,
	"calculated_at" timestamp with time zone,
	"review_comment" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"accepted_totals" jsonb,
	"changed_after_accept" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN "unlocked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_events" ADD CONSTRAINT "inventory_reconciliation_events_reconciliation_id_inventory_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."inventory_reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_iiko_lines" ADD CONSTRAINT "inventory_reconciliation_iiko_lines_reconciliation_id_inventory_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."inventory_reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_lines" ADD CONSTRAINT "inventory_reconciliation_lines_reconciliation_id_inventory_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."inventory_reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_reconciliation_events_recon_idx" ON "inventory_reconciliation_events" USING btree ("reconciliation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_reconciliations_store_period_uq" ON "inventory_reconciliations" USING btree ("store_id","period");--> statement-breakpoint
CREATE INDEX "inventory_reconciliations_period_idx" ON "inventory_reconciliations" USING btree ("period");