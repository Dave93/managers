ALTER TYPE "public"."credit_entry_type" ADD VALUE 'amend';--> statement-breakpoint
DROP INDEX "credit_entries_op_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX "credit_payment_doc_uniq" ON "credit_payments" USING btree ("company_id","doc_number") WHERE doc_number IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_entries_op_uniq" ON "credit_entries" USING btree ("brand","order_id","entry_type") WHERE entry_type IN ('authorize','capture','void','refund','payment','adjustment');