CREATE TABLE "inventory_reconciliation_line_marks" (
	"reconciliation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"checked_by" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reconciliation_line_marks_reconciliation_id_product_id_pk" PRIMARY KEY("reconciliation_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_reconciliation_line_marks" ADD CONSTRAINT "inventory_reconciliation_line_marks_reconciliation_id_inventory_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."inventory_reconciliations"("id") ON DELETE cascade ON UPDATE no action;