CREATE TYPE "public"."interview_result" AS ENUM('positive', 'negative', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."interview_status" AS ENUM('scheduled', 'completed', 'cancelled', 'pending');--> statement-breakpoint
CREATE TYPE "public"."organization_payment_types" AS ENUM('cash', 'card', 'client');--> statement-breakpoint
CREATE TYPE "public"."organization_system_type" AS ENUM('iiko', 'r_keeper', 'jowi');--> statement-breakpoint
CREATE TYPE "public"."report_item_type" AS ENUM('income', 'outcome');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('sent', 'checking', 'comfirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'blocked', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."vacancy_status_v2" AS ENUM('open', 'in_progress', 'found_candidates', 'interview', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."work_schedule_entry_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "accounting_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"token" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "balance_store" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storeId" uuid,
	"productId" uuid,
	"amount" double precision DEFAULT 10.1,
	"sum" double precision DEFAULT 10.1,
	"enddate" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "basket_additional_sales" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"terminal_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric NOT NULL,
	"operator" varchar(255),
	"source" varchar(255) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"order_id" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "basket_additional_sales_id_created_at_pk" PRIMARY KEY("id","created_at")
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vacancy_id" uuid,
	"full_name" varchar(255) NOT NULL,
	"birth_date" timestamp with time zone,
	"citizenship" varchar(255),
	"residence" varchar(255),
	"phone_number" varchar(255) NOT NULL,
	"email" varchar(255),
	"passport_number" varchar(255),
	"passport_series" varchar(255),
	"passport_id_date" timestamp with time zone,
	"passport_id_place" varchar(255),
	"source" varchar(255),
	"family_status" varchar(255),
	"children" integer,
	"language" varchar(255),
	"strengths_shortage" varchar(255),
	"relatives" varchar(255),
	"desired_salary" integer,
	"desired_schedule" varchar(255),
	"purpose" varchar(255),
	"desired_position" varchar(255),
	"result_status" "interview_result" DEFAULT 'neutral',
	"is_first_job" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conception" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporation_department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parentId" varchar(255),
	"name" varchar(255),
	"type" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "corporation_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255),
	"departmentId" uuid,
	"groupServiceMode" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "corporation_store" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parentId" varchar(255),
	"code" varchar(255),
	"name" varchar(255),
	"type" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "corporation_terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255),
	"computerName" varchar(255),
	"anonymous" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"model" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"model_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "education" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid,
	"date_start" timestamp with time zone,
	"date_end" timestamp with time zone,
	"education_type" varchar(255),
	"university" varchar(255),
	"speciality" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "family_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid,
	"family_list_name" varchar(255),
	"family_list_birth_date" timestamp with time zone,
	"family_list_phone" varchar(255),
	"family_list_relation" varchar(255),
	"family_list_address" varchar(255),
	"family_job" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "internal_transfer" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"dateIncoming" timestamp with time zone NOT NULL,
	"documentnumber" varchar(255),
	"status" varchar(255),
	"conceptionId" uuid,
	"storeFromId" uuid,
	"storeToId" uuid,
	CONSTRAINT "internal_transfer_pkey" PRIMARY KEY("id","dateIncoming")
);
--> statement-breakpoint
CREATE TABLE "internal_transfer_items" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"productId" uuid,
	"amount" numeric(10, 4),
	"measureUnitId" uuid,
	"containerId" varchar(255),
	"cost" integer,
	"internal_transfer_id" uuid,
	"num" varchar(255),
	"internaltransferdate" timestamp with time zone NOT NULL,
	CONSTRAINT "internalTransferItems_pkey" PRIMARY KEY("id","internaltransferdate")
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid,
	"interviewer_id" uuid,
	"interview_date" timestamp NOT NULL,
	"interview_result" varchar(255),
	"status" "interview_status" DEFAULT 'scheduled',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
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
	"invoiceincomingdate" timestamp with time zone NOT NULL,
	CONSTRAINT "invoice_items_id_invoiceincomingdate_pk" PRIMARY KEY("id","invoiceincomingdate")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid NOT NULL,
	"incomingDocumentNumber" varchar(255),
	"incomingDate" timestamp with time zone NOT NULL,
	"useDefaultDocumentTime" boolean DEFAULT false,
	"dueDate" timestamp with time zone,
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
	"linkedIncomingInvoiceId" varchar(255),
	CONSTRAINT "invoices_id_incomingDate_pk" PRIMARY KEY("id","incomingDate")
);
--> statement-breakpoint
CREATE TABLE "last_work_place" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid,
	"last_work_place" varchar(255),
	"dismissal_date" timestamp with time zone,
	"employment_date" timestamp with time zone,
	"experience" varchar(255),
	"organization_name" varchar(255),
	"position" varchar(255),
	"address_org" varchar(255),
	"dismissal_reason" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "measure_unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false,
	"name" varchar(255),
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "nomenclature_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false,
	"name" varchar(255),
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "nomenclature_element" (
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
CREATE TABLE "nomenclature_element_group" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255) NOT NULL,
	"nomenclature_group_id" uuid
);
--> statement-breakpoint
CREATE TABLE "nomenclature_element_organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nomenclature_element_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nomenclature_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"tax_category_id" uuid,
	"category_id" uuid,
	"accounting_category_id" uuid,
	"parent_id" uuid DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid NOT NULL,
	"uniq_order_id" uuid NOT NULL,
	"dish_id" uuid,
	"dish_name" varchar(255),
	"dish_amount_int" numeric,
	"dish_discount_sum_int" numeric,
	"dish_type" varchar(255),
	"order_type" varchar(255),
	"order_type_id" varchar(255),
	"open_date_typed" timestamp NOT NULL,
	"delivery_phone" varchar(255),
	"restaurant_group" varchar(255),
	"restaurant_group_id" uuid,
	"department" varchar(255),
	"department_id" varchar(255),
	CONSTRAINT "order_items_id_uniq_order_id_open_date_typed_pk" PRIMARY KEY("id","uniq_order_id","open_date_typed")
);
--> statement-breakpoint
CREATE TABLE "order_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid NOT NULL,
	"cash_register_name" varchar(255),
	"cash_register_number" numeric,
	"open_time" timestamp,
	"close_time" timestamp,
	"delivery_actual_time" timestamp,
	"delivery_bill_time" timestamp,
	"delivery_close_time" timestamp,
	"delivery_customer_phone" varchar(255),
	"delivery_email" varchar(255),
	"delivery_id" varchar(255),
	"is_delivery" varchar(255),
	"delivery_number" varchar(255),
	"delivery_phone" varchar(255),
	"delivery_print_time" timestamp,
	"delivery_send_time" timestamp,
	"delivery_service_type" varchar(255),
	"delivery_source_key" varchar(255),
	"delivery_way_duration" varchar(255),
	"conception" varchar(255),
	"day_of_week_open" varchar(255),
	"deleted_with_writeoff" varchar(255),
	"department" varchar(255),
	"department_id" varchar(255),
	"discount_percent" numeric,
	"discount_sum" numeric,
	"dish_amount_int" numeric,
	"dish_discount_sum_int" numeric,
	"external_number" varchar(255),
	"fiscal_cheque_number" numeric,
	"hour_close" varchar(255),
	"hour_open" varchar(255),
	"increase_percent" numeric,
	"jur_name" varchar(255),
	"month_open" varchar(255),
	"open_date_typed" timestamp NOT NULL,
	"order_deleted" varchar(255),
	"order_discount_type" varchar(255),
	"order_num" numeric,
	"order_service_type" varchar(255),
	"order_type" varchar(255),
	"order_type_id" varchar(255),
	"origin_name" varchar(255),
	"pay_types_combo" varchar(255),
	"precheque_time" timestamp,
	"price_category" varchar(255),
	"quarter_open" varchar(255),
	"restaurant_section_id" uuid,
	"restaurant_group" varchar(255),
	"restaurant_group_id" uuid,
	"session_num" numeric,
	"store_id" uuid,
	"store_name" varchar(255),
	"store_to" varchar(255),
	"table_num" numeric,
	"uniq_order_id_id" uuid,
	"week_in_month_open" varchar(255),
	"week_in_year_open" varchar(255),
	"year_open" varchar(255),
	"storned" varchar(255),
	"dish_type" varchar(255),
	CONSTRAINT "orders_id_open_date_typed_pk" PRIMARY KEY("id","open_date_typed")
);
--> statement-breakpoint
CREATE TABLE "orders_by_time" (
	"id" uuid NOT NULL,
	"cash_register_name" varchar(255),
	"cash_register_number" numeric,
	"open_time" timestamp NOT NULL,
	"close_time" timestamp,
	"delivery_actual_time" timestamp,
	"delivery_bill_time" timestamp,
	"delivery_close_time" timestamp,
	"delivery_customer_phone" varchar(255),
	"delivery_email" varchar(255),
	"delivery_id" varchar(255),
	"is_delivery" varchar(255),
	"delivery_number" varchar(255),
	"delivery_phone" varchar(255),
	"delivery_print_time" timestamp,
	"delivery_send_time" timestamp,
	"delivery_service_type" varchar(255),
	"delivery_source_key" varchar(255),
	"delivery_way_duration" varchar(255),
	"conception" varchar(255),
	"day_of_week_open" varchar(255),
	"deleted_with_writeoff" varchar(255),
	"department" varchar(255),
	"department_id" varchar(255),
	"discount_percent" numeric,
	"discount_sum" numeric,
	"dish_amount_int" numeric,
	"dish_discount_sum_int" numeric,
	"external_number" varchar(255),
	"fiscal_cheque_number" numeric,
	"hour_close" varchar(255),
	"hour_open" varchar(255),
	"increase_percent" numeric,
	"jur_name" varchar(255),
	"month_open" varchar(255),
	"open_date_typed" timestamp NOT NULL,
	"order_deleted" varchar(255),
	"order_discount_type" varchar(255),
	"order_num" numeric,
	"order_service_type" varchar(255),
	"order_type" varchar(255),
	"order_type_id" varchar(255),
	"origin_name" varchar(255),
	"pay_types_combo" varchar(255),
	"precheque_time" timestamp,
	"price_category" varchar(255),
	"quarter_open" varchar(255),
	"restaurant_section_id" uuid,
	"restaurant_group" varchar(255),
	"restaurant_group_id" uuid,
	"session_num" numeric,
	"store_id" uuid,
	"store_name" varchar(255),
	"store_to" varchar(255),
	"table_num" numeric,
	"uniq_order_id_id" uuid,
	"week_in_month_open" varchar(255),
	"week_in_year_open" varchar(255),
	"year_open" varchar(255),
	"storned" varchar(255),
	"dish_type" varchar(255),
	CONSTRAINT "orders_by_time_id_open_time_pk" PRIMARY KEY("id","open_time")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"description" text,
	"icon_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"code" text
);
--> statement-breakpoint
CREATE TABLE "payment_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255),
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"description" varchar(60) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(100) NOT NULL,
	"description" text,
	"requirements" text,
	"salary_min" integer,
	"salary_max" integer,
	"terminal_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_cooking_time" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"uniq_order_id" uuid NOT NULL,
	"restoraunt_group" varchar(255) NOT NULL,
	"cooking_place" varchar(255) NOT NULL,
	"dish_name" varchar(255) NOT NULL,
	"open_time" timestamp NOT NULL,
	"cooking_finish_time" timestamp,
	"dish_amount_int" integer NOT NULL,
	"guest_wait_time_avg" integer NOT NULL,
	"open_date_typed" timestamp NOT NULL,
	"department_id" varchar(255) NOT NULL,
	"department" varchar(255) NOT NULL,
	CONSTRAINT "product_cooking_time_id_uniq_order_id_open_date_typed_pk" PRIMARY KEY("id","uniq_order_id","open_date_typed")
);
--> statement-breakpoint
CREATE TABLE "product_group_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_group_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"organization_id" uuid NOT NULL,
	"show_inventory" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_olap" (
	"id" uuid DEFAULT gen_random_uuid(),
	"dateTime" timestamp with time zone,
	"productId" uuid,
	"productName" varchar(255),
	"productType" varchar(255),
	"sessionGroup" varchar(255),
	"transactionType" varchar(255),
	"amauntOut" double precision DEFAULT 10.1,
	"store" varchar(255),
	"productNum" varchar(255),
	"productUnit" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp with time zone NOT NULL,
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
CREATE TABLE "reports_items" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"label" varchar(255) NOT NULL,
	"type" "report_item_type" NOT NULL,
	"amount" integer DEFAULT 0,
	"source" varchar(255) NOT NULL,
	"report_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_items_pkey" PRIMARY KEY("id","report_date")
);
--> statement-breakpoint
CREATE TABLE "reports_logs" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reports_id" uuid NOT NULL,
	"reports_item_id" uuid NOT NULL,
	"before_json" text,
	"after_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"before_text" text,
	"after_text" text,
	"report_date" timestamp with time zone NOT NULL,
	CONSTRAINT "reports_logs_pkey" PRIMARY KEY("id","report_date")
);
--> statement-breakpoint
CREATE TABLE "reports_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(255) NOT NULL,
	"color" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"label" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"code" varchar(50),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "roles_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "PK_0cd11f0b35c4d348c6ebb9b36b7" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "scheduled_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"cron" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_reports_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_agent" text NOT NULL,
	"device_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"is_secure" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
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
CREATE TABLE "tax_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"address" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"organization_id" uuid NOT NULL,
	"manager_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
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
	"birth_date" timestamp with time zone,
	"is_online" boolean DEFAULT false NOT NULL,
	"fcm_token" varchar(250),
	"doc_files" text[],
	"app_version" varchar(100),
	"role_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"api_token" varchar(250),
	"tg_id" varchar(250)
);
--> statement-breakpoint
CREATE TABLE "users_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"corporation_store_id" uuid
);
--> statement-breakpoint
CREATE TABLE "users_terminals" (
	"user_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	CONSTRAINT "PK_users_terminals_id" PRIMARY KEY("user_id","terminal_id")
);
--> statement-breakpoint
CREATE TABLE "users_work_schedules" (
	"user_id" uuid NOT NULL,
	"work_schedule_id" uuid NOT NULL,
	CONSTRAINT "PK_users_work_schedules_id" PRIMARY KEY("user_id","work_schedule_id")
);
--> statement-breakpoint
CREATE TABLE "vacancy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_num" varchar(255) NOT NULL,
	"organization_id" uuid,
	"terminal_id" uuid,
	"position" uuid,
	"work_schedule_id" uuid,
	"reason" varchar(255) NOT NULL,
	"open_date" timestamp with time zone NOT NULL,
	"closing_date" timestamp with time zone,
	"recruiter" uuid,
	"internship_date" timestamp with time zone,
	"term_closing_date" timestamp with time zone,
	"comments" text,
	"status" "vacancy_status_v2" DEFAULT 'open',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "work_schedule_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_schedule_id" uuid NOT NULL,
	"date_start" timestamp with time zone NOT NULL,
	"date_finish" timestamp with time zone,
	"duration" integer DEFAULT 0 NOT NULL,
	"ip_open" text,
	"ip_close" text,
	"lat_open" double precision NOT NULL,
	"lat_close" double precision,
	"lon_open" double precision NOT NULL,
	"lon_close" double precision,
	"current_status" "work_schedule_entry_status" DEFAULT 'open' NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"organization_id" uuid NOT NULL,
	"days" text[],
	"start_time" time with time zone NOT NULL,
	"end_time" time with time zone NOT NULL,
	"max_start_time" time with time zone NOT NULL,
	"bonus_price" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "writeoff" (
	"id" uuid NOT NULL,
	"dateincoming" timestamp with time zone NOT NULL,
	"documnentNumber" varchar(255),
	"status" varchar(255),
	"conceptionId" uuid,
	"comment" varchar(255),
	"storeId" uuid,
	CONSTRAINT "writeoff_id_dateincoming_pk" PRIMARY KEY("id","dateincoming")
);
--> statement-breakpoint
CREATE TABLE "writeoff_items" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"productId" uuid,
	"productSizeId" varchar(255),
	"amountFactor" integer,
	"amount" numeric(10, 4),
	"measureUnitId" uuid,
	"containerId" varchar(255),
	"cost" integer,
	"writeoff_id" uuid,
	"writeoffincomingdate" timestamp with time zone NOT NULL,
	CONSTRAINT "writeoff_items_id_writeoffincomingdate_pk" PRIMARY KEY("id","writeoffincomingdate")
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_vacancy_id_vacancy_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education" ADD CONSTRAINT "education_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_list" ADD CONSTRAINT "family_list_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_interviewer_id_users_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "last_work_place" ADD CONSTRAINT "last_work_place_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy" ADD CONSTRAINT "vacancy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy" ADD CONSTRAINT "vacancy_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy" ADD CONSTRAINT "vacancy_position_positions_id_fk" FOREIGN KEY ("position") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy" ADD CONSTRAINT "vacancy_work_schedule_id_work_schedules_id_fk" FOREIGN KEY ("work_schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy" ADD CONSTRAINT "vacancy_recruiter_users_id_fk" FOREIGN KEY ("recruiter") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_id_key" ON "api_tokens" USING btree ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_key" ON "api_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_basket_additional_sales_source" ON "basket_additional_sales" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_basket_additional_sales_operator" ON "basket_additional_sales" USING btree ("operator");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_d090ad82a0e97ce764c06c7b312" ON "permissions" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_0e2c0e1b4b0b0b0b0b0b0b0b0b0" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_648e3f5447f725579d7d4ffdfb7" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_key" ON "settings" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_0e2c0e1b3b0b0b0b0b0b0b0b0b0" ON "users" USING btree ("login");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_0e2c0e1b4b5b0b0b0b0b0b0b0b0" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_a000cca60bcf04454e727699490" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "fki_users_login" ON "users" USING btree ("login");--> statement-breakpoint
CREATE INDEX "fki_work_schedule_entries_current_status" ON "work_schedule_entries" USING btree ("current_status");--> statement-breakpoint
CREATE INDEX "fki_work_schedule_entries_user_id" ON "work_schedule_entries" USING btree ("user_id");