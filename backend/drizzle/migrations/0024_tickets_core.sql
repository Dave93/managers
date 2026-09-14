CREATE TYPE "public"."ticket_actor_kind" AS ENUM('manager', 'executor', 'office', 'system');--> statement-breakpoint
CREATE TYPE "public"."ticket_attachment_phase" AS ENUM('problem', 'result');--> statement-breakpoint
CREATE TYPE "public"."ticket_event_type" AS ENUM('created', 'assigned', 'comment', 'done_submitted', 'reopened', 'closed', 'cancelled', 'payment_approved', 'payment_rejected');--> statement-breakpoint
CREATE TYPE "public"."ticket_executor_kind" AS ENUM('external', 'staff');--> statement-breakpoint
CREATE TYPE "public"."ticket_notification_kind" AS ENUM('send', 'edit');--> statement-breakpoint
CREATE TYPE "public"."ticket_notification_status" AS ENUM('pending', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ticket_payment_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('normal', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('new', 'in_progress', 'done', 'closed', 'cancelled');--> statement-breakpoint
CREATE TABLE "ticket_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"phase" "ticket_attachment_phase" NOT NULL,
	"file_path" text NOT NULL,
	"mime" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_kind" "ticket_actor_kind" NOT NULL,
	"uploaded_by_user_id" uuid,
	"uploaded_by_executor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_kind" "ticket_actor_kind" NOT NULL,
	"author_user_id" uuid,
	"author_executor_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_contractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"type" "ticket_event_type" NOT NULL,
	"actor_kind" "ticket_actor_kind" NOT NULL,
	"actor_user_id" uuid,
	"actor_executor_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_executors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ticket_executor_kind" NOT NULL,
	"contractor_id" uuid,
	"user_id" uuid,
	"full_name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"tg_user_id" bigint,
	"lang" varchar(10) DEFAULT 'ru' NOT NULL,
	"invite_code" uuid DEFAULT gen_random_uuid() NOT NULL,
	"invite_used_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"channel" varchar(20) DEFAULT 'telegram' NOT NULL,
	"recipient_executor_id" uuid,
	"recipient_chat_id" bigint NOT NULL,
	"kind" "ticket_notification_kind" DEFAULT 'send' NOT NULL,
	"target_message_id" bigint,
	"status" "ticket_notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"tg_message_id" bigint,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"number_prefix" varchar(5) NOT NULL,
	"name_ru" varchar(255) NOT NULL,
	"name_uz" varchar(255) NOT NULL,
	"icon" varchar(50),
	"executor_kind" "ticket_executor_kind" NOT NULL,
	"contractor_id" uuid,
	"fields_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_cost" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"qty" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit" varchar(20),
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" serial NOT NULL,
	"type_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "ticket_status" DEFAULT 'new' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"assigned_executor_id" uuid,
	"assigned_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"closed_by" uuid,
	"cancelled_by" uuid,
	"reopen_count" integer DEFAULT 0 NOT NULL,
	"work_total_amount" numeric(14, 2),
	"payment_status" "ticket_payment_status" DEFAULT 'pending' NOT NULL,
	"payment_approved_by" uuid,
	"payment_approved_at" timestamp with time zone,
	"payment_comment" text,
	"manager_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_executors" ADD CONSTRAINT "ticket_executors_contractor_id_ticket_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."ticket_contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_notifications" ADD CONSTRAINT "ticket_notifications_event_id_ticket_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."ticket_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_notifications" ADD CONSTRAINT "ticket_notifications_recipient_executor_id_ticket_executors_id_fk" FOREIGN KEY ("recipient_executor_id") REFERENCES "public"."ticket_executors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_contractor_id_ticket_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."ticket_contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_work_items" ADD CONSTRAINT "ticket_work_items_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_type_id_ticket_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."ticket_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_executor_id_ticket_executors_id_fk" FOREIGN KEY ("assigned_executor_id") REFERENCES "public"."ticket_executors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ticket_attachments_ticket_id" ON "ticket_attachments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_comments_ticket_id" ON "ticket_comments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_events_ticket_id" ON "ticket_events" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ticket_executors_tg_user_id" ON "ticket_executors" USING btree ("tg_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ticket_executors_invite_code" ON "ticket_executors" USING btree ("invite_code");--> statement-breakpoint
CREATE INDEX "idx_ticket_executors_contractor_id" ON "ticket_executors" USING btree ("contractor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ticket_notifications_dedupe" ON "ticket_notifications" USING btree ("event_id","recipient_chat_id","kind");--> statement-breakpoint
CREATE INDEX "idx_ticket_notifications_status" ON "ticket_notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ticket_types_code" ON "ticket_types" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_ticket_work_items_ticket_id" ON "ticket_work_items" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_terminal_id" ON "tickets" USING btree ("terminal_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_status" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tickets_type_id" ON "tickets" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_created_at" ON "tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_tickets_assigned_executor_id" ON "tickets" USING btree ("assigned_executor_id");