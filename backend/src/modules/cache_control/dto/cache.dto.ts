import { InferSelectModel } from "drizzle-orm";
import { api_tokens, credentials, organization, terminals } from "backend/drizzle/schema";

export type terminalsWithCredentials = InferSelectModel<typeof terminals> & {
  credentials: InferSelectModel<typeof credentials>[];
};


export type organizationWithCredentials = InferSelectModel<typeof organization> & {
  credentials: InferSelectModel<typeof credentials>[];
};


export type apiTokensWithRelations = InferSelectModel<typeof api_tokens> & {
  organization: InferSelectModel<typeof organization>;
};