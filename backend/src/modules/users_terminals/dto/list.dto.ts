import { users_terminals, terminals, users } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export type UsersTerminalsWithRelation = InferSelectModel<typeof users_terminals> & {
    terminals: InferSelectModel<typeof terminals>
};