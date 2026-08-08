CREATE TYPE "public"."passport_enrollment_status" AS ENUM('active', 'completed', 'failed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."passport_module_status" AS ENUM('draft', 'review', 'published');--> statement-breakpoint
CREATE TYPE "public"."passport_signoff_action" AS ENUM('material_opened', 'quiz_passed', 'quiz_failed', 'observed', 'observation_declined', 'recheck_passed', 'recheck_failed', 'level_set', 'level_rolled_back', 'stamp_issued');--> statement-breakpoint
CREATE TYPE "public"."passport_stamp_type" AS ENUM('module_cert', 'universal_chopar', 'universal_les', 'probation_passed');--> statement-breakpoint
CREATE TYPE "public"."passport_verification_type" AS ENUM('quiz', 'observation', 'quiz_observation', 'quiz_observation_photo', 'dual');--> statement-breakpoint
CREATE TABLE "passport_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"status" "passport_enrollment_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"probation_deadline" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"subject_user_id" uuid,
	"enrollment_id" uuid,
	"meta" jsonb,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) DEFAULT '' NOT NULL,
	"file_path" varchar(500) NOT NULL,
	"status" varchar(20) DEFAULT 'ready' NOT NULL,
	"transcode_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title_ru" varchar(255) NOT NULL,
	"title_uz" varchar(255) DEFAULT '' NOT NULL,
	"brand" varchar(20),
	"owner_department" varchar(50) NOT NULL,
	"status" "passport_module_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"exam_test_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_program_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"deadline_days" integer
);
--> statement-breakpoint
CREATE TABLE "passport_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" varchar(100) NOT NULL,
	"title_ru" varchar(255) NOT NULL,
	"title_uz" varchar(255) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_qr_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_user_id" uuid,
	"trainee_ip" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "passport_rechecks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_progress_id" uuid NOT NULL,
	"assigned_to_user_id" uuid NOT NULL,
	"origin" varchar(10) DEFAULT 'random' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"result" varchar(10),
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"topic_id" uuid,
	"module_id" uuid,
	"action" "passport_signoff_action" NOT NULL,
	"actor_user_id" uuid,
	"actor_employee_id" uuid,
	"terminal_id" uuid,
	"ip" varchar(64),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_stamps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "passport_stamp_type" NOT NULL,
	"module_id" uuid,
	"issued_by_user_id" uuid,
	"manual_comment" text,
	"valid_until" timestamp with time zone,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_tg_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"employee_id" uuid,
	"user_id" uuid,
	"first_name" varchar(255) DEFAULT '' NOT NULL,
	"lang" varchar(2) DEFAULT 'ru' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_topic_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"quiz_attempt_id" uuid,
	"observed_by_user_id" uuid,
	"observed_at" timestamp with time zone,
	"observation_answers" jsonb,
	"photo_path" varchar(500),
	"recheck_due_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passport_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"title_ru" varchar(255) NOT NULL,
	"title_uz" varchar(255) DEFAULT '' NOT NULL,
	"step_ru" text DEFAULT '' NOT NULL,
	"step_uz" text DEFAULT '' NOT NULL,
	"key_point_ru" text DEFAULT '' NOT NULL,
	"key_point_uz" text DEFAULT '' NOT NULL,
	"reason_ru" text DEFAULT '' NOT NULL,
	"reason_uz" text DEFAULT '' NOT NULL,
	"video_id" uuid,
	"verification_type" "passport_verification_type" DEFAULT 'quiz_observation' NOT NULL,
	"quiz_test_id" uuid,
	"observation_checklist" jsonb,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attestation_test_attempts" ADD COLUMN "source" varchar(10) DEFAULT 'kiosk' NOT NULL;--> statement-breakpoint
ALTER TABLE "passport_enrollments" ADD CONSTRAINT "passport_enrollments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_enrollments" ADD CONSTRAINT "passport_enrollments_program_id_passport_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."passport_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_invites" ADD CONSTRAINT "passport_invites_enrollment_id_passport_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."passport_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_program_modules" ADD CONSTRAINT "passport_program_modules_program_id_passport_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."passport_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_program_modules" ADD CONSTRAINT "passport_program_modules_module_id_passport_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."passport_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_rechecks" ADD CONSTRAINT "passport_rechecks_topic_progress_id_passport_topic_progress_id_fk" FOREIGN KEY ("topic_progress_id") REFERENCES "public"."passport_topic_progress"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_signoffs" ADD CONSTRAINT "passport_signoffs_enrollment_id_passport_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."passport_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_stamps" ADD CONSTRAINT "passport_stamps_enrollment_id_passport_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."passport_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_tg_bindings" ADD CONSTRAINT "passport_tg_bindings_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_topic_progress" ADD CONSTRAINT "passport_topic_progress_enrollment_id_passport_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."passport_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_topic_progress" ADD CONSTRAINT "passport_topic_progress_topic_id_passport_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."passport_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_topics" ADD CONSTRAINT "passport_topics_module_id_passport_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."passport_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_passport_prog_mod" ON "passport_program_modules" USING btree ("program_id","module_id");--> statement-breakpoint
CREATE INDEX "IX_passport_signoffs_enr" ON "passport_signoffs" USING btree ("enrollment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_passport_tg" ON "passport_tg_bindings" USING btree ("telegram_id");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_passport_progress" ON "passport_topic_progress" USING btree ("enrollment_id","topic_id");