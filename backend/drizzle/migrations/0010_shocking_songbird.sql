CREATE TYPE "public"."credit_brand" AS ENUM('chopar', 'les');--> statement-breakpoint
CREATE TYPE "public"."credit_company_status" AS ENUM('active', 'suspended', 'pending_verification');--> statement-breakpoint
CREATE TYPE "public"."credit_document_type" AS ENUM('contract', 'inn_cert', 'guarantee_letter', 'other');--> statement-breakpoint
CREATE TYPE "public"."credit_entry_type" AS ENUM('authorize', 'capture', 'void', 'refund', 'payment', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."credit_hold_state" AS ENUM('held', 'captured', 'voided', 'expired');--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"posted" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp (5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"inn" text,
	"phone" text,
	"status" "credit_company_status" DEFAULT 'pending_verification' NOT NULL,
	"limit_total" bigint DEFAULT 0 NOT NULL,
	"limit_daily" bigint DEFAULT 0 NOT NULL,
	"limit_monthly" bigint DEFAULT 0 NOT NULL,
	"overdue" boolean DEFAULT false NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp (5) with time zone,
	"created_at" timestamp (5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_company_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" "credit_document_type" DEFAULT 'other' NOT NULL,
	"file_path" text NOT NULL,
	"doc_number" text,
	"doc_date" timestamp (5) with time zone,
	"uploaded_by" uuid,
	"created_at" timestamp (5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_company_phones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"employee_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"hold_id" uuid,
	"brand" "credit_brand",
	"order_id" text,
	"order_number" text,
	"entry_type" "credit_entry_type" NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"period_day_key" text,
	"period_month_key" text,
	"meta" jsonb,
	"created_by" uuid,
	"created_at" timestamp (5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brand" "credit_brand" NOT NULL,
	"order_id" text NOT NULL,
	"order_number" text,
	"amount" bigint NOT NULL,
	"state" "credit_hold_state" DEFAULT 'held' NOT NULL,
	"period_day_key" text NOT NULL,
	"period_month_key" text NOT NULL,
	"expires_at" timestamp (5) with time zone NOT NULL,
	"created_at" timestamp (5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"doc_number" text,
	"doc_date" timestamp (5) with time zone,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp (5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_periods" (
	"company_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"spent" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "credit_periods_company_id_period_key_pk" PRIMARY KEY("company_id","period_key")
);
--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_company_id_credit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."credit_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_company_documents" ADD CONSTRAINT "credit_company_documents_company_id_credit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."credit_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_company_phones" ADD CONSTRAINT "credit_company_phones_company_id_credit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."credit_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_company_id_credit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."credit_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_company_id_credit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."credit_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_company_id_credit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."credit_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_periods" ADD CONSTRAINT "credit_periods_company_id_credit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."credit_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_phone_uniq" ON "credit_company_phones" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "credit_entries_company_created" ON "credit_entries" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_entries_op_uniq" ON "credit_entries" USING btree ("brand","order_id","entry_type");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_hold_order_uniq" ON "credit_holds" USING btree ("brand","order_id");
