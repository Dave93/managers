CREATE TABLE "kpi_days_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"day" date NOT NULL,
	"terminal_id" uuid NOT NULL,
	"reason_code" varchar(16) NOT NULL,
	"reason_text" text,
	"given_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_days_off_employee_day_uq" ON "kpi_days_off" USING btree ("employee_id","day") WHERE "kpi_days_off"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "kpi_days_off_terminal_day_idx" ON "kpi_days_off" USING btree ("terminal_id","day");--> statement-breakpoint
CREATE INDEX "kpi_days_off_given_by_idx" ON "kpi_days_off" USING btree ("given_by","day");