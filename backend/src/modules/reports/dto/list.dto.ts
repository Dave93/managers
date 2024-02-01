import { reports, reports_status } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export type ReportsWithRelations = InferSelectModel<typeof reports> & {
    reports_status: InferSelectModel<typeof reports_status>
};