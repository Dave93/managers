CREATE TYPE "public"."medical_exam_result" AS ENUM('fit', 'fit_restricted', 'unfit');--> statement-breakpoint
CREATE TABLE "medical_exam_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"interval_months" integer DEFAULT 6 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medical_exam_schedules_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "medical_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"planned_due_date" date NOT NULL,
	"completed_date" date,
	"result" "medical_exam_result",
	"notes" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
