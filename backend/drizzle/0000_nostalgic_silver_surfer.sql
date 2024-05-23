-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
DO $$ BEGIN
 CREATE TYPE "public"."organization_payment_types" AS ENUM('cash', 'card', 'client');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."organization_system_type" AS ENUM('iiko', 'r_keeper', 'jowi');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."report_item_type" AS ENUM('income', 'outcome');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."report_status" AS ENUM('sent', 'checking', 'comfirmed', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."user_status" AS ENUM('active', 'blocked', 'inactive');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."work_schedule_entry_status" AS ENUM('open', 'closed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid NOT NULL,
	"incomingDocumentNumber" varchar(255),
	"incomingDate" timestamp(5) with time zone NOT NULL,
	"useDefaultDocumentTime" boolean DEFAULT false,
	"dueDate" timestamp(5) with time zone,
	"supplier" uuid,
	"defaultStore" uuid,
	"invoice" varchar(255),
	"documentNumber" varchar(255),
	"comment" varchar(255),
	"status" varchar(255),
	"type" varchar(255),
	"accountToCode" varchar(255),
	"revenueAccountCode" varchar(255),
	"defaultStoreId" varchar(255),
	"defaultStoreCode" varchar(255),
	"counteragentId" varchar(255),
	"counteragentCode" varchar(255),
	"linkedIncomingInvoiceId" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_items" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"isAdditionalExpense" boolean DEFAULT false,
	"actualAmount" numeric(10, 4),
	"price" integer,
	"sum" integer,
	"vatPercent" integer,
	"vatSum" integer,
	"discountSum" integer,
	"amountUnit" uuid,
	"num" varchar(255),
	"productArticle" varchar(255),
	"amount" numeric(10, 4),
	"invoice_id" uuid,
	"priceWithoutVat" integer,
	"priceUnit" varchar(255),
	"supplierProduct" varchar(255),
	"supplierProductArticle" varchar(255),
	"storeId" uuid,
	"storeCode" varchar(255),
	"productId" uuid,
	"invoiceincomingdate" timestamp(5) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"token" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounting_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "balance_store" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storeId" uuid,
	"productId" uuid,
	"amount" double precision DEFAULT 10.1,
	"sum" double precision DEFAULT 10.1,
	"enddate" timestamp(5) with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conception" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "corporation_department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parentId" varchar(255),
	"name" varchar(255),
	"type" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "corporation_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255),
	"departmentId" uuid,
	"groupServiceMode" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "corporation_store" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parentId" varchar(255),
	"code" varchar(255),
	"name" varchar(255),
	"type" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "corporation_terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255),
	"computerName" varchar(255),
	"anonymous" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"model" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"model_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discount_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measure_unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false,
	"name" varchar(255),
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nomenclature_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false,
	"name" varchar(255),
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nomenclature_element" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false,
	"name" varchar(255),
	"code" varchar(255),
	"num" varchar(255),
	"tax_category_id" uuid,
	"category_id" uuid,
	"accounting_category_id" uuid,
	"mainUnit" uuid DEFAULT gen_random_uuid(),
	"type" varchar(255),
	"unitWeight" numeric(10, 4),
	"unitCapacity" numeric(10, 4)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nomenclature_element_group" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255) NOT NULL,
	"nomenclature_group_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nomenclature_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"tax_category_id" uuid,
	"category_id" uuid,
	"accounting_category_id" uuid,
	"parent_id" uuid DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"description" text,
	"icon_url" text,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"code" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255),
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"description" varchar(60) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"parent_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_olap" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dateTime" timestamp(5) with time zone,
	"productId" uuid,
	"productName" varchar(255),
	"productType" varchar(255),
	"sessionGroup" varchar(255),
	"transactionType" varchar(255),
	"amauntOut" double precision DEFAULT 10.1
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(255) NOT NULL,
	"color" varchar(255) NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"label" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"code" varchar(50),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"cron" text NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_reports_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_agent" text NOT NULL,
	"device_name" text NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"is_secure" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(255),
	"name" varchar(255),
	"cardNumber" varchar(255),
	"taxpayerIdNumber" varchar(255),
	"snils" varchar(255),
	"departmentCodes" varchar,
	"responsibilityDepartmentCodes" varchar,
	"deleted" boolean,
	"supplier" boolean,
	"employee" boolean,
	"client" boolean,
	"representsStore" boolean,
	"representedStoreId" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"address" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"organization_id" uuid NOT NULL,
	"manager_name" text,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timesheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"date" timestamp(5) with time zone NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(20),
	"email" varchar(100),
	"login" varchar(100) NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"password" varchar NOT NULL,
	"salt" varchar,
	"is_super_user" boolean DEFAULT false NOT NULL,
	"status" "user_status" NOT NULL,
	"birth_date" timestamp(5) with time zone,
	"is_online" boolean DEFAULT false NOT NULL,
	"fcm_token" varchar(250),
	"doc_files" text[],
	"app_version" varchar(100),
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"api_token" varchar(250),
	"tg_id" varchar(250)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"corporation_store_id" uuid
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
	"lat_open" double precision NOT NULL,
	"lat_close" double precision,
	"lon_open" double precision NOT NULL,
	"lon_close" double precision,
	"current_status" "work_schedule_entry_status" DEFAULT 'open' NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(5) DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
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
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "writeoff" (
	"id" uuid NOT NULL,
	"dateincoming" timestamp(5) with time zone NOT NULL,
	"documnentNumber" varchar(255),
	"status" varchar(255),
	"conceptionId" uuid,
	"comment" varchar(255),
	"storeId" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "writeoff_items" (
	"productId" uuid,
	"productSizeId" varchar(255),
	"amountFactor" integer,
	"amount" numeric(10, 4),
	"measureUnitId" uuid,
	"containerId" varchar(255),
	"cost" integer,
	"writeoff_id" uuid,
	"writeoffincomingdate" timestamp(5) with time zone NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL
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
CREATE TABLE IF NOT EXISTS "roles_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "PK_0cd11f0b35c4d348c6ebb9b36b7" PRIMARY KEY("role_id","permission_id")
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
CREATE TABLE IF NOT EXISTS "users_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "PK_c525e9373d63035b9919e578a9c" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_transfer" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"dateIncoming" timestamp(5) with time zone NOT NULL,
	"documentnumber" varchar(255),
	"status" varchar(255),
	"conceptionId" uuid,
	"storeFromId" uuid,
	"storeToId" uuid,
	CONSTRAINT "internal_transfer_pkey" PRIMARY KEY("id","dateIncoming")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_transfer_items" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"productId" uuid,
	"amount" numeric(10, 4),
	"measureUnitId" uuid,
	"containerId" varchar(255),
	"cost" integer,
	"internal_transfer_id" uuid,
	"num" varchar(255),
	"internaltransferdate" timestamp(5) with time zone NOT NULL,
	CONSTRAINT "internalTransferItems_pkey" PRIMARY KEY("id","internaltransferdate")
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
	"amount" integer DEFAULT 0,
	"source" varchar(255) NOT NULL,
	"group_id" uuid,
	"report_date" timestamp(5) with time zone NOT NULL,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_items_pkey" PRIMARY KEY("id","report_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports_logs" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reports_id" uuid NOT NULL,
	"reports_item_id" uuid NOT NULL,
	"before_json" text,
	"after_json" text,
	"created_at" timestamp(5) with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"before_text" text,
	"after_text" text,
	"report_date" timestamp(5) with time zone NOT NULL,
	CONSTRAINT "reports_logs_pkey" PRIMARY KEY("id","report_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_tokens_id_key" ON "api_tokens" ("id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_tokens_token_key" ON "api_tokens" ("token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_d090ad82a0e97ce764c06c7b312" ON "permissions" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_0e2c0e1b4b0b0b0b0b0b0b0b0b0" ON "roles" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_648e3f5447f725579d7d4ffdfb7" ON "roles" ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "settings_key_key" ON "settings" ("key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_0e2c0e1b3b0b0b0b0b0b0b0b0b0" ON "users" ("login");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_0e2c0e1b4b5b0b0b0b0b0b0b0b0" ON "users" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_a000cca60bcf04454e727699490" ON "users" ("phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fki_users_login" ON "users" ("login");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fki_work_schedule_entries_current_status" ON "work_schedule_entries" ("current_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fki_work_schedule_entries_user_id" ON "work_schedule_entries" ("user_id");
*/