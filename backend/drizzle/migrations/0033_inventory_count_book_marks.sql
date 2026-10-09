CREATE TABLE "inventory_count_book_marks" (
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"checked_by" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_count_book_marks_count_id_product_id_pk" PRIMARY KEY("count_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_count_book_marks" ADD CONSTRAINT "inventory_count_book_marks_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE cascade ON UPDATE no action;