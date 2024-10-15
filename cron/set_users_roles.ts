import { drizzleDb } from "@backend/lib/db";
import { users, users_roles } from "backend/drizzle/schema";
import { SQL, and, eq, sql, lte } from "drizzle-orm";
import { mapCompactResponse, t } from "elysia";
import { Redis } from "ioredis";
import { CacheControlService } from "@backend/modules/cache_control/service";

const main = async () => {
    const usersRolesList = await drizzleDb.select().from(users_roles);
    for (const userRole of usersRolesList) {
        await drizzleDb.update(users).set({ role_id: userRole.role_id }).where(eq(users.id, userRole.user_id));
    }
};

main();
