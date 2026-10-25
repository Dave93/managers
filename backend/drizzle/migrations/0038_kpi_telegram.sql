CREATE TABLE "kpi_tg_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"employee_id" uuid,
	"user_id" uuid,
	"lang" varchar(2) DEFAULT 'ru' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_tg_bindings_one_person" CHECK (("kpi_tg_bindings"."employee_id" is null) <> ("kpi_tg_bindings"."user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "kpi_tg_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(64) NOT NULL,
	"employee_id" uuid,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_tg_invites_one_person" CHECK (("kpi_tg_invites"."employee_id" is null) <> ("kpi_tg_invites"."user_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_tg_bindings_telegram_uq" ON "kpi_tg_bindings" USING btree ("telegram_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_tg_bindings_employee_active_uq" ON "kpi_tg_bindings" USING btree ("employee_id") WHERE "kpi_tg_bindings"."active" and "kpi_tg_bindings"."employee_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_tg_bindings_user_active_uq" ON "kpi_tg_bindings" USING btree ("user_id") WHERE "kpi_tg_bindings"."active" and "kpi_tg_bindings"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_tg_invites_token_uq" ON "kpi_tg_invites" USING btree ("token");