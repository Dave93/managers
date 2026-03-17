CREATE TABLE "external_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255),
	"email" varchar(255),
	"password" varchar(255),
	"is_active" boolean DEFAULT true,
	"is_deleted" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "managers_hanging_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand" varchar(50) NOT NULL,
	"date" varchar(10) NOT NULL,
	"terminal_id" text,
	"order_id" text,
	"external_order_number" text,
	"timestamp" timestamp,
	"conception" text,
	"order_type" text,
	"payment_type" text,
	"receipt_number" text,
	"order_status" text,
	"comments" text,
	"problem" text,
	"phone_number" text,
	"amount" numeric(10, 2),
	"composition" text,
	"status" text,
	"comment" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "playground_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_number" varchar(255) NOT NULL,
	"order_amount" integer NOT NULL,
	"children_count" integer NOT NULL,
	"is_used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "basket_additional_sales" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "basket_additional_sales" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "managers_brand_date_idx" ON "managers_hanging_orders" USING btree ("brand","date");--> statement-breakpoint
CREATE INDEX "managers_order_id_idx" ON "managers_hanging_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "managers_timestamp_idx" ON "managers_hanging_orders" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "playground_tickets_terminal_order_key" ON "playground_tickets" USING btree ("terminal_id","order_number");--> statement-breakpoint
CREATE INDEX "idx_playground_tickets_terminal_id" ON "playground_tickets" USING btree ("terminal_id");--> statement-breakpoint
CREATE INDEX "idx_playground_tickets_created_at" ON "playground_tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_playground_tickets_organization_id" ON "playground_tickets" USING btree ("organization_id");