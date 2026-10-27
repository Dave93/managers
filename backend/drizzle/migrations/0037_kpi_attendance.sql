CREATE TABLE "kpi_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"day" date NOT NULL,
	"terminal_id" uuid NOT NULL,
	"check_in" timestamp with time zone,
	"check_out" timestamp with time zone,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"absent" boolean DEFAULT false NOT NULL,
	"import_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_attendance_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" date NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"mapping" jsonb NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_matched" integer DEFAULT 0 NOT NULL,
	"rows_unmatched" integer DEFAULT 0 NOT NULL,
	"unmatched" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'committed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kpi_attendance" ADD CONSTRAINT "kpi_attendance_import_id_kpi_attendance_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."kpi_attendance_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_attendance_employee_day_uq" ON "kpi_attendance" USING btree ("employee_id","day");--> statement-breakpoint
CREATE INDEX "kpi_attendance_import_idx" ON "kpi_attendance" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "kpi_attendance_terminal_day_idx" ON "kpi_attendance" USING btree ("terminal_id","day");--> statement-breakpoint
CREATE INDEX "kpi_attendance_imports_period_idx" ON "kpi_attendance_imports" USING btree ("period","status");