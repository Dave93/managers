CREATE TABLE "employee_twins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_a" uuid NOT NULL,
	"employee_b" uuid NOT NULL,
	"rule" varchar(16) NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_twins_order" CHECK ("employee_twins"."employee_a" < "employee_twins"."employee_b")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "employee_twins_pair_uq" ON "employee_twins" USING btree ("employee_a","employee_b");--> statement-breakpoint
CREATE INDEX "employee_twins_b_idx" ON "employee_twins" USING btree ("employee_b");--> statement-breakpoint
-- Посещаемость с учётом двойников (см. комментарий к kpi_attendance_effective в schema.ts). Те же строки, что в
-- kpi_attendance; у прогула, на день которого вторая запись того же человека отмечена присутствием, берутся её отметки.
CREATE VIEW "kpi_attendance_effective" AS
SELECT
	a."id",
	a."employee_id",
	a."day",
	a."terminal_id",
	CASE WHEN t."id" IS NOT NULL THEN t."check_in" ELSE a."check_in" END AS "check_in",
	CASE WHEN t."id" IS NOT NULL THEN t."check_out" ELSE a."check_out" END AS "check_out",
	CASE WHEN t."id" IS NOT NULL THEN t."late_minutes" ELSE a."late_minutes" END AS "late_minutes",
	(a."absent" AND t."id" IS NULL) AS "absent",
	a."import_id",
	a."created_at"
FROM "kpi_attendance" a
LEFT JOIN LATERAL (
	SELECT t."id", t."check_in", t."check_out", t."late_minutes"
	FROM "employee_twins" w
	JOIN "kpi_attendance" t
		ON t."day" = a."day"
		AND NOT t."absent"
		AND t."employee_id" = CASE WHEN w."employee_a" = a."employee_id" THEN w."employee_b" ELSE w."employee_a" END
	WHERE a."absent"
		AND NOT w."blocked"
		AND (w."employee_a" = a."employee_id" OR w."employee_b" = a."employee_id")
	LIMIT 1
) t ON true;
