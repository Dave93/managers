import { reports, reports_status, terminals, users } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export type ReportsWithRelations = InferSelectModel<typeof reports> & {
    reports_status: InferSelectModel<typeof reports_status>
    terminals: InferSelectModel<typeof terminals>
    users: InferSelectModel<typeof users>
};