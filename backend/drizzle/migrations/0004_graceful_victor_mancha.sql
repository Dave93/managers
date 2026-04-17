ALTER TABLE "terminals" ADD COLUMN "playground_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "terminals" SET "playground_enabled" = true;