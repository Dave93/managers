DROP INDEX "credit_entries_company_created";--> statement-breakpoint
CREATE INDEX "credit_entries_company_created" ON "credit_entries" USING btree ("company_id","created_at" DESC NULLS LAST);