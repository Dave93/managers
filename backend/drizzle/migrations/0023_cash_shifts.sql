CREATE TABLE "cash_shift_cashiers" (
	"shift_id" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"cashier_name" text NOT NULL,
	"cashier_code" text,
	"orders_count" integer NOT NULL,
	"revenue" numeric(18, 2) NOT NULL,
	CONSTRAINT "cash_shift_cashiers_shift_id_cashier_id_pk" PRIMARY KEY("shift_id","cashier_id")
);
--> statement-breakpoint
CREATE TABLE "cash_shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"terminal_id" uuid,
	"iiko_group_id" uuid,
	"iiko_group_name" text,
	"point_of_sale_id" uuid NOT NULL,
	"cash_reg_number" integer NOT NULL,
	"cash_register_name" text,
	"session_number" integer NOT NULL,
	"open_at" timestamp with time zone NOT NULL,
	"close_at" timestamp with time zone,
	"business_date" date NOT NULL,
	"status" text NOT NULL,
	"responsible_user_id" uuid,
	"responsible_user_name" text,
	"manager_id" uuid,
	"manager_name" text,
	"pay_orders" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sales_cash" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sales_card" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sales_credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"pay_in" numeric(18, 2) DEFAULT '0' NOT NULL,
	"pay_out" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cash_diff" numeric(18, 2) DEFAULT '0' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_shift_cashiers" ADD CONSTRAINT "cash_shift_cashiers_shift_id_cash_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."cash_shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cash_shifts_business_date" ON "cash_shifts" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "idx_cash_shifts_terminal_date" ON "cash_shifts" USING btree ("terminal_id","business_date");