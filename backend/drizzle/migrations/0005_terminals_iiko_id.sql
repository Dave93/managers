ALTER TABLE "terminals" ADD COLUMN IF NOT EXISTS "iiko_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "terminals_iiko_id_unique" ON "terminals" ("iiko_id") WHERE "iiko_id" IS NOT NULL;--> statement-breakpoint
UPDATE "terminals" SET "iiko_id" = '988d67a1-99c5-431c-94a3-111f49373dfe' WHERE "id" = '206fd215-4d09-497e-aa3a-b4433fe2c547';--> statement-breakpoint
UPDATE "terminals" SET "iiko_id" = '24448fa6-63e0-46bf-953f-ba24af65e19e' WHERE "id" = '3dae1a29-0a16-4f46-bd25-b309767b1340';--> statement-breakpoint
UPDATE "terminals" SET "iiko_id" = 'b51063f2-2fa0-459d-8f7c-94b8650dcb0f' WHERE "id" = '0b0c9915-b511-461c-b262-72f59244384a';
