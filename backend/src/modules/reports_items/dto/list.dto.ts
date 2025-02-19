import { reports_items, reports, reports_status } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export type ReportsItemsWithRelation = InferSelectModel<typeof reports_items> & {
    reports: InferSelectModel<typeof reports>;
    reports_status: InferSelectModel<typeof reports_status>;
};