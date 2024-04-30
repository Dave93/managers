import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  users,
  users_stores,
  corporation_store,
} from "@backend/../drizzle/schema";
import {
  sql,
  and,
  SQLWrapper,
  eq,
  InferSelectModel,
  getTableColumns,
  desc,
  asc,
} from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";
import { UsersStoresWithRelation } from "./dto/list.dto";

export const usersSroresController = new Elysia({
  name: "@api/users_stores",
})
  .use(ctx)
  .get(
    "/users_stores",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("users_stores.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, users_stores, {});
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, users_stores, {});
      }
      const users_storesCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(users_stores)
        .where(and(...whereClause))
        .execute();
      const users_storesList = (await drizzle
        .select(selectFields)
        .from(users_stores)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute()) as InferSelectModel<typeof users_stores>[];

      return {
        total: users_storesCount[0].count,
        data: users_storesList,
      };
    },
    {
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/users_stores/cached",
    async ({ user, set, drizzle, cacheController }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("users_stores.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const storesList = await cacheController.getCachedStores({});

      const usersStoresList = await drizzle
        .select({
          corporation_store_id: users_stores.corporation_store_id,
        })
        .from(users_stores)
        .where(eq(users_stores.user_id, user.user.id))
        .execute();
      console.log("davr", usersStoresList);
      if (usersStoresList.length > 0) {
        const storeIds = usersStoresList.map(
          (store: any) => store.corporation_store_id
        );
        return storesList.filter((store: any) => storeIds.includes(store.id));
      }

      return storesList;
    }
  )
  .post(
    "/users_stores/assign_stores",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("users_stores.edit")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }

      await drizzle
        .delete(users_stores)
        .where(eq(users_stores.user_id, data.user_id))
        .execute();

      const users_storesList = await drizzle
        .insert(users_stores)
        .values(
          data.corporation_store_id.map((corporation_store_id: string) => ({
            user_id: data.user_id,
            corporation_store_id,
          }))
        )
        .execute();
      return {
        data: users_storesList,
      };
    },
    {
      body: t.Object({
        data: t.Object({
          user_id: t.String(),
          corporation_store_id: t.Array(t.String()),
        }),
      }),
    }
  )
  .get("/users_stores/my_stores", async ({ user, set, drizzle }) => {
    if (!user) {
      set.status = 401;
      return {
        message: "User not found",
      };
    }
    if (!user.permissions.includes("users_stores.list")) {
      set.status = 401;
      return {
        message: "You don't have permissions",
      };
    }
    const users_storesList = (await drizzle
      .select({
        ...getTableColumns(users_stores),
        corporation_store: {
          ...getTableColumns(corporation_store),
        },
      })
      .from(users_stores)
      .where(eq(users_stores.user_id, user.user.id))
      .leftJoin(
        corporation_store,
        eq(users_stores.corporation_store_id, corporation_store.id)
      )
      .execute()) as UsersStoresWithRelation[];

    return {
      data: users_storesList,
    };
  });
