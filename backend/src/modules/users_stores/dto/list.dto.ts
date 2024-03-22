import {
  users_stores,
  corporation_store,
  users,
} from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export type UsersStoresWithRelation = InferSelectModel<typeof users_stores> & {
  corporation_store: InferSelectModel<typeof corporation_store>;
};
