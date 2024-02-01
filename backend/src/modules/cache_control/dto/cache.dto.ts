import { InferSelectModel } from "drizzle-orm";
import { credentials, organization, terminals } from "backend/drizzle/schema";

export type terminalsWithCredentials = InferSelectModel<typeof terminals> & {
  credentials: InferSelectModel<typeof credentials>[];
};


export type organizationWithCredentials = InferSelectModel<typeof organization> & {
  credentials: InferSelectModel<typeof credentials>[];
};
