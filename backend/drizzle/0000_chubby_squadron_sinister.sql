-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
DO $$ BEGIN
 CREATE TYPE "user_status" AS ENUM('inactive', 'blocked', 'active');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "organization_system_type" AS ENUM('jowi', 'r_keeper', 'iiko');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "work_schedule_entry_status" AS ENUM('closed', 'open');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "organization_payment_types" AS ENUM('client', 'card', 'cash');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "report_status" AS ENUM('cancelled', 'comfirmed', 'checking', 'sent');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "report_item_type" AS ENUM('outcome', 'income');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"code" varchar(50),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"description" text,
	"icon_url" text,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"code" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"address" text,
	"latitude" double precision DEFAULT 0 NOT NULL,
	"longitude" double precision DEFAULT 0 NOT NULL,
	"organization_id" uuid NOT NULL,
	"manager_name" text,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"token" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" varchar(20),
	"email" varchar(100),
	"login" varchar(100) NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"password" varchar NOT NULL,
	"salt" varchar,
	"is_super_user" boolean DEFAULT false NOT NULL,
	"status" "user_status" NOT NULL,
	"card_name" varchar(100),
	"card_number" varchar(100),
	"birth_date" timestamp(5) with time zone,
	"car_model" varchar(100),
	"car_number" varchar(100),
	"is_online" boolean DEFAULT false NOT NULL,
	"latitude" double precision DEFAULT 0,
	"longitude" double precision DEFAULT 0,
	"fcm_token" varchar(250),
	"wallet_balance" double precision DEFAULT 0 NOT NULL,
	"max_active_order_count" integer,
	"doc_files" text[],
	"order_start_date" timestamp(5) with time zone,
	"app_version" varchar(100),
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"api_token" varchar(250),
	"tg_id" varchar(250)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"user_agent" text NOT NULL,
	"device_name" text NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"organization_id" uuid NOT NULL,
	"days" text[],
	"start_time" "time(5) with time zone" NOT NULL,
	"end_time" "time(5) with time zone" NOT NULL,
	"max_start_time" "time(5) with time zone" NOT NULL,
	"bonus_price" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_schedule_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_schedule_id" uuid NOT NULL,
	"date_start" timestamp(5) with time zone NOT NULL,
	"date_finish" timestamp(5) with time zone,
	"duration" integer DEFAULT 0 NOT NULL,
	"ip_open" text,
	"ip_close" text,
	"lat_open" double precision DEFAULT 0 NOT NULL,
	"lat_close" double precision DEFAULT 0,
	"lon_open" double precision DEFAULT 0 NOT NULL,
	"lon_close" double precision DEFAULT 0,
	"current_status" "work_schedule_entry_status" DEFAULT 'open' NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(5) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"model" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"model_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"is_secure" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timesheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"date" timestamp(5) with time zone NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"cron" text NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"parent_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"description" varchar(60) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_reports_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(255) NOT NULL,
	"color" varchar(255) NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"label" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users_terminals" (
	"user_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	CONSTRAINT "PK_users_terminals_id" PRIMARY KEY("user_id","terminal_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users_work_schedules" (
	"user_id" uuid NOT NULL,
	"work_schedule_id" uuid NOT NULL,
	CONSTRAINT "PK_users_work_schedules_id" PRIMARY KEY("user_id","work_schedule_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users_permissions" (
	"user_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "PK_7f3736984cd8546a1e418005561" PRIMARY KEY("user_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "PK_0cd11f0b35c4d348c6ebb9b36b7" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "PK_c525e9373d63035b9919e578a9c" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp(5) with time zone NOT NULL,
	"status_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"cash_ids" text[],
	"total_amount" integer DEFAULT 0 NOT NULL,
	"total_manager_price" integer DEFAULT 0 NOT NULL,
	"difference" integer DEFAULT 0 NOT NULL,
	"arryt_income" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reports_pkey" PRIMARY KEY("id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports_items" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"label" varchar(255) NOT NULL,
	"type" "report_item_type" NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"source" varchar(255) NOT NULL,
	"group_id" uuid,
	"report_date" timestamp(5) with time zone NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "reports_items_pkey" PRIMARY KEY("id","report_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports_logs" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reports_id" uuid NOT NULL,
	"reports_item_id" uuid NOT NULL,
	"before_json" text,
	"after_json" text,
	"created_at" timestamp(5) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"user_id" uuid NOT NULL,
	"before_text" text,
	"after_text" text,
	"report_date" timestamp(5) with time zone NOT NULL,
	CONSTRAINT "reports_logs_pkey" PRIMARY KEY("id","report_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_648e3f5447f725579d7d4ffdfb7" ON "roles" ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_0e2c0e1b4b0b0b0b0b0b0b0b0b0" ON "roles" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_tokens_id_key" ON "api_tokens" ("id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_tokens_token_key" ON "api_tokens" ("token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_a000cca60bcf04454e727699490" ON "users" ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_0e2c0e1b4b5b0b0b0b0b0b0b0b0" ON "users" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_0e2c0e1b3b0b0b0b0b0b0b0b0b0" ON "users" ("login");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fki_users_login" ON "users" ("login");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fki_work_schedule_entries_current_status" ON "work_schedule_entries" ("current_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fki_work_schedule_entries_user_id" ON "work_schedule_entries" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "settings_key_key" ON "settings" ("key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_d090ad82a0e97ce764c06c7b312" ON "permissions" ("slug");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roles" ADD CONSTRAINT "FK_4a39f3095781cdd9d6061afaae5" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roles" ADD CONSTRAINT "FK_747b580d73db0ad78963d78b076" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization" ADD CONSTRAINT "FK_organization_created_by" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization" ADD CONSTRAINT "FK_organization_updated_by" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "terminals" ADD CONSTRAINT "FK_terminals_organization_id" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_tokens" ADD CONSTRAINT "FK_api_tokens_created_by" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_tokens" ADD CONSTRAINT "FK_api_tokens_organization_id" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_tokens" ADD CONSTRAINT "FK_api_tokens_updated_by" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_schedules" ADD CONSTRAINT "FK_work_schedules_created_by" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_schedules" ADD CONSTRAINT "FK_work_schedules_organization_id" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_schedules" ADD CONSTRAINT "FK_work_schedules_updated_by" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_schedule_entries" ADD CONSTRAINT "FK_work_schedule_entries_created_by" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_schedule_entries" ADD CONSTRAINT "FK_work_schedule_entries_updated_by" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_schedule_entries" ADD CONSTRAINT "FK_work_schedule_entries_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_schedule_entries" ADD CONSTRAINT "FK_work_schedule_entries_work_schedule_id" FOREIGN KEY ("work_schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credentials" ADD CONSTRAINT "FK_credentials_created_by" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credentials" ADD CONSTRAINT "FK_credentials_updated_by" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timesheet" ADD CONSTRAINT "FK_timesheet_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_groups" ADD CONSTRAINT "FK_parent_id_report_groups" FOREIGN KEY ("parent_id") REFERENCES "public"."report_groups"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permissions" ADD CONSTRAINT "FK_58fae278276b7c2c6dde2bc19a5" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permissions" ADD CONSTRAINT "FK_c398f7100db3e0d9b6a6cd6beaf" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_reports_subscription" ADD CONSTRAINT "FK_scheduled_reports_subscription_report_id" FOREIGN KEY ("report_id") REFERENCES "public"."scheduled_reports"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_reports_subscription" ADD CONSTRAINT "FK_scheduled_reports_subscription_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_terminals" ADD CONSTRAINT "FK_users_terminals_terminal_id" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_terminals" ADD CONSTRAINT "FK_users_terminals_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_work_schedules" ADD CONSTRAINT "FK_users_work_schedules_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_work_schedules" ADD CONSTRAINT "FK_users_work_schedules_work_schedule_id" FOREIGN KEY ("work_schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_permissions" ADD CONSTRAINT "FK_1139f007de51cfe686c4b2abb43" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_permissions" ADD CONSTRAINT "FK_4de7d0b175f702be3be55270023" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_permissions" ADD CONSTRAINT "FK_997b44464224900ee2727190813" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_permissions" ADD CONSTRAINT "FK_b09b9a210c60f41ec7b453758e9" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roles_permissions" ADD CONSTRAINT "FK_337aa8dba227a1fe6b73998307b" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roles_permissions" ADD CONSTRAINT "FK_7d2dad9f14eddeb09c256fea719" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roles_permissions" ADD CONSTRAINT "FK_a3f5b9874c55ee69fdd01531e14" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roles_permissions" ADD CONSTRAINT "FK_d1ba552f47d08621fdd2bbb0124" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_roles" ADD CONSTRAINT "FK_1cf664021f00b9cc1ff95e17de4" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_roles" ADD CONSTRAINT "FK_471c7c874c2a37052f53d920803" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_roles" ADD CONSTRAINT "FK_88da3fa85d1220b0ac18b08ce47" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users_roles" ADD CONSTRAINT "FK_e4435209df12bc1f001e5360174" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "FK_reports_status_id" FOREIGN KEY ("status_id") REFERENCES "public"."reports_status"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "FK_reports_terminal_id" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "FK_reports_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports_items" ADD CONSTRAINT "FK_reports_id" FOREIGN KEY ("report_id","report_date") REFERENCES "public"."reports"("id","date") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports_items" ADD CONSTRAINT "FK_report_groups_id" FOREIGN KEY ("group_id") REFERENCES "public"."report_groups"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports_logs" ADD CONSTRAINT "FK_reports_logs_reports_id" FOREIGN KEY ("reports_id","report_date") REFERENCES "public"."reports"("id","date") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports_logs" ADD CONSTRAINT "FK_reports_logs_reports_item_id" FOREIGN KEY ("reports_item_id","report_date") REFERENCES "public"."reports_items"("id","report_date") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports_logs" ADD CONSTRAINT "FK_reports_logs_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

*/