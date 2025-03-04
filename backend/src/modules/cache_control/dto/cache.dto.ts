import { InferSelectModel } from "drizzle-orm";
import { api_tokens, credentials, organization, terminals, positions, users, work_schedules, work_schedule_entries } from "backend/drizzle/schema";

export type terminalsWithCredentials = InferSelectModel<typeof terminals> & {
  credentials: InferSelectModel<typeof credentials>[];
};


export type organizationWithCredentials = InferSelectModel<typeof organization> & {
  credentials: InferSelectModel<typeof credentials>[];
};


export type apiTokensWithRelations = InferSelectModel<typeof api_tokens> & {
  organization: InferSelectModel<typeof organization>;
};

export type positionsWithRelations = InferSelectModel<typeof positions> & {
  credentials: InferSelectModel<typeof credentials>[];
};

export type usersWithRelations = InferSelectModel<typeof users> & {
  credentials: InferSelectModel<typeof credentials>[];
};

export type workSchedulesWithRelations = InferSelectModel<typeof work_schedules> & {
  credentials: InferSelectModel<typeof credentials>[];
};