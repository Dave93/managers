import { ctx } from "@backend/context";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const incomingInvoicesController = new Elysia({
  name: "@api/incoming_invoices",
})
  .use(ctx)
  .get(
    "/incoming_invoices",
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
      if (!user.permissions.includes("incoming_invoices.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
    }
  );
