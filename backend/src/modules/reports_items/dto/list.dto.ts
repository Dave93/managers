import { reports_items, reports, report_groups, reports_status } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export type ReportsItemsWithRelation = InferSelectModel<typeof reports_items> & {
    report_groups: InferSelectModel<typeof report_groups>;
    reports: InferSelectModel<typeof reports>;
    reports_status: InferSelectModel<typeof reports_status>;
};