DROP INDEX "kpi_tg_bindings_telegram_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_tg_bindings_tg_employee_uq" ON "kpi_tg_bindings" USING btree ("telegram_id") WHERE "kpi_tg_bindings"."employee_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_tg_bindings_tg_user_uq" ON "kpi_tg_bindings" USING btree ("telegram_id") WHERE "kpi_tg_bindings"."user_id" is not null;