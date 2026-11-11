CREATE TABLE "cash_shift_cashier_dishes" (
	"shift_id" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"dish_id" uuid NOT NULL,
	"dish_type" text NOT NULL,
	"dish_name" text NOT NULL,
	"qty" numeric(18, 3) NOT NULL,
	"revenue" numeric(18, 2) NOT NULL,
	CONSTRAINT "cash_shift_cashier_dishes_pk" PRIMARY KEY("shift_id","cashier_id","dish_id","dish_type")
);
--> statement-breakpoint
ALTER TABLE "cash_shift_cashier_dishes" ADD CONSTRAINT "cash_shift_cashier_dishes_shift_id_cash_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."cash_shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cash_shift_cashier_dishes_cashier" ON "cash_shift_cashier_dishes" USING btree ("cashier_id");