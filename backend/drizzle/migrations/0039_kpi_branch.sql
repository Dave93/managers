CREATE TABLE "kpi_branch_indicators" (
	"code" varchar(32) PRIMARY KEY NOT NULL,
	"title_ru" varchar(100) NOT NULL,
	"weight" integer NOT NULL,
	"floor" numeric(10, 2) NOT NULL,
	"target" numeric(10, 2) NOT NULL,
	"max" numeric(10, 2) NOT NULL,
	"direction" varchar(16) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_branch_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" date NOT NULL,
	"terminal_id" uuid NOT NULL,
	"indicator_code" varchar(32) NOT NULL,
	"version" integer NOT NULL,
	"fact" numeric(14, 2),
	"points" numeric(6, 2),
	"weight" integer NOT NULL,
	"weighted" numeric(6, 2),
	"floor" numeric(10, 2) NOT NULL,
	"target" numeric(10, 2) NOT NULL,
	"max" numeric(10, 2) NOT NULL,
	"direction" varchar(16) NOT NULL,
	"data_status" varchar(16) NOT NULL,
	"reason" varchar(32),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"computed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "kpi_branch_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" date NOT NULL,
	"terminal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"score" numeric(6, 2) NOT NULL,
	"tier_pct" integer NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"computed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "kpi_revenue_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"period" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_sanitary_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"period" date NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"inspector_user_id" uuid NOT NULL,
	"items" jsonb NOT NULL,
	"pct" numeric(5, 2) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_branch_results_uq" ON "kpi_branch_results" USING btree ("period","terminal_id","indicator_code","version");--> statement-breakpoint
CREATE INDEX "kpi_branch_results_period_version_idx" ON "kpi_branch_results" USING btree ("period","version");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_branch_scores_uq" ON "kpi_branch_scores" USING btree ("period","terminal_id","version");--> statement-breakpoint
CREATE INDEX "kpi_branch_scores_period_version_idx" ON "kpi_branch_scores" USING btree ("period","version");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_revenue_plans_terminal_period_uq" ON "kpi_revenue_plans" USING btree ("terminal_id","period");--> statement-breakpoint
CREATE INDEX "kpi_revenue_plans_period_idx" ON "kpi_revenue_plans" USING btree ("period");--> statement-breakpoint
CREATE INDEX "kpi_sanitary_checks_period_terminal_idx" ON "kpi_sanitary_checks" USING btree ("period","terminal_id");