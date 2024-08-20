import { corporation_store } from "backend/drizzle/schema";

export type CorporationStoreModel = typeof corporation_store.$inferSelect;