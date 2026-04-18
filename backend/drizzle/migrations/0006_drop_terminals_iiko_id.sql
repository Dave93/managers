DROP INDEX IF EXISTS "terminals_iiko_id_unique";--> statement-breakpoint
ALTER TABLE "terminals" DROP COLUMN IF EXISTS "iiko_id";
