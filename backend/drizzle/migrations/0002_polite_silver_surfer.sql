DROP INDEX "playground_tickets_terminal_order_key";--> statement-breakpoint
ALTER TABLE "nomenclature_group" ALTER COLUMN "parent_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "nomenclature_group" ALTER COLUMN "parent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "nomenclature_element" ADD COLUMN "parent_id" uuid;