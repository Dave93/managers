CREATE TABLE "sales_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"planned_qty" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_plan_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_item_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"date" varchar(10) NOT NULL,
	"sold_qty" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_sales_plan_items_plan_id" ON "sales_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_plan_stats_item_terminal_date_key" ON "sales_plan_stats" USING btree ("plan_item_id","terminal_id","date");--> statement-breakpoint
CREATE INDEX "idx_sales_plan_stats_terminal_date" ON "sales_plan_stats" USING btree ("terminal_id","date");--> statement-breakpoint
CREATE INDEX "idx_sales_plan_stats_plan_id" ON "sales_plan_stats" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_plans_terminal_year_month_key" ON "sales_plans" USING btree ("terminal_id","year","month");--> statement-breakpoint
CREATE INDEX "idx_sales_plans_terminal_id" ON "sales_plans" USING btree ("terminal_id");--> statement-breakpoint
CREATE INDEX "idx_sales_plans_organization_id" ON "sales_plans" USING btree ("organization_id");