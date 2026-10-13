CREATE TABLE "inventory_count_book" (
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"book_qty" numeric(14, 4) NOT NULL,
	"start_qty" numeric(14, 4) NOT NULL,
	"in_invoice" numeric(14, 4) NOT NULL,
	"out_sales" numeric(14, 4) NOT NULL,
	"transfer_in" numeric(14, 4) NOT NULL,
	"transfer_out" numeric(14, 4) NOT NULL,
	"out_writeoff" numeric(14, 4) NOT NULL,
	"other_net" numeric(14, 4) NOT NULL,
	"consistent" boolean NOT NULL,
	CONSTRAINT "inventory_count_book_count_id_product_id_pk" PRIMARY KEY("count_id","product_id")
);
--> statement-breakpoint
DROP INDEX "inventory_counts_store_period_template_uq";--> statement-breakpoint
DROP INDEX "inventory_counts_store_period_branch_uq";--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN "kind" varchar(16) DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN "count_date" date;--> statement-breakpoint
UPDATE "inventory_counts" SET "count_date" = "period" WHERE "count_date" IS NULL;--> statement-breakpoint
ALTER TABLE "inventory_counts" ALTER COLUMN "count_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN "book_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_count_book" ADD CONSTRAINT "inventory_count_book_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_counts_store_date_template_uq" ON "inventory_counts" USING btree ("store_id","count_date","template_id") WHERE kind = 'interim' and status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_counts_store_date_branch_uq" ON "inventory_counts" USING btree ("store_id","count_date") WHERE kind = 'interim' and template_id is null and status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_counts_store_period_template_uq" ON "inventory_counts" USING btree ("store_id","period","template_id") WHERE kind = 'monthly' and status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_counts_store_period_branch_uq" ON "inventory_counts" USING btree ("store_id","period") WHERE kind = 'monthly' and template_id is null and status <> 'cancelled';