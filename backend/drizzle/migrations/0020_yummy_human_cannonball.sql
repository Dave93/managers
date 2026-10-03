ALTER TABLE "stoplist_events" ADD COLUMN "terminal_iiko_id" uuid;--> statement-breakpoint
ALTER TABLE "stoplist_intervals" ADD COLUMN "terminal_iiko_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_stoplist_intervals_iiko_ended" ON "stoplist_intervals" USING btree ("terminal_iiko_id","ended_at");