CREATE TABLE "workly_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workly_company_id" integer NOT NULL,
	"workly_location_id" integer NOT NULL,
	"title" varchar(120) NOT NULL,
	"terminal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workly_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workly_company_id" integer,
	"kind" varchar(16) NOT NULL,
	"period" date,
	"trigger" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"block_reason" varchar(32),
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active_fetched" integer DEFAULT 0 NOT NULL,
	"plan" jsonb,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "kpi_attendance_imports" ALTER COLUMN "uploaded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "workly_company_id" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "workly_id" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "workly_tab_number" varchar(32);--> statement-breakpoint
ALTER TABLE "kpi_attendance_imports" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "workly_locations_uq" ON "workly_locations" USING btree ("workly_company_id","workly_location_id");--> statement-breakpoint
CREATE INDEX "workly_sync_runs_org_created_idx" ON "workly_sync_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workly_sync_runs_running_uq" ON "workly_sync_runs" USING btree ("organization_id","kind") WHERE "workly_sync_runs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "employees_workly_uq" ON "employees" USING btree ("workly_company_id","workly_id") WHERE "employees"."workly_id" is not null;