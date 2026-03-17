import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { playground_tickets, terminals } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq } from "drizzle-orm";
import Elysia, { t } from "elysia";

export const playgroundTicketsController = new Elysia({
  name: "@api/playground_tickets",
})
  .use(ctx)
  // Generate ticket — Bearer token auth (same pattern as stoplist webhook)
  .post(
    "/playground_tickets/generate",
    async ({
      // @ts-ignore
      bearer,
      body: { terminal_id, order_number, order_amount },
      set,
      drizzle,
      cacheController,
    }) => {
      if (!bearer) {
        set.status = 401;
        return { message: "Token not found" };
      }

      const apiTokens = await cacheController.getCachedApiTokens({});
      const token = apiTokens.find((item: any) => item.token === bearer);

      if (!token) {
        set.status = 401;
        return { message: "Token not found" };
      }

      if (!token.active) {
        set.status = 401;
        return { message: "Token not active" };
      }

      const organization_id = token.organization_id;
      const children_count = Math.floor(order_amount / 50000);

      if (children_count < 1) {
        set.status = 400;
        return { message: "Order amount too low for playground ticket" };
      }

      // Idempotent insert — ON CONFLICT DO NOTHING to handle HttpHelper retries
      const inserted = await drizzle
        .insert(playground_tickets)
        .values({
          terminal_id,
          organization_id,
          order_number,
          order_amount,
          children_count,
        })
        .onConflictDoNothing({
          target: [playground_tickets.terminal_id, playground_tickets.order_number],
        })
        .returning()
        .execute();

      // If conflict (retry), return existing ticket
      if (inserted.length === 0) {
        const existing = await drizzle
          .select()
          .from(playground_tickets)
          .where(
            and(
              eq(playground_tickets.terminal_id, terminal_id),
              eq(playground_tickets.order_number, order_number)
            )
          )
          .execute();
        const ticket = existing[0];
        return {
          ticket_id: ticket.id,
          children_count: ticket.children_count,
          qr_data: `PLAYGROUND:${ticket.id}`,
        };
      }

      const ticket = inserted[0];

      return {
        ticket_id: ticket.id,
        children_count: ticket.children_count,
        qr_data: `PLAYGROUND:${ticket.id}`,
      };
    },
    {
      body: t.Object({
        terminal_id: t.String(),
        order_number: t.String(),
        order_amount: t.Number(),
      }),
    }
  )
  // Validate ticket — session auth + permission
  .post(
    "/playground_tickets/validate",
    async ({ body: { qr_data }, user, set, drizzle }) => {
      const prefix = "PLAYGROUND:";
      if (!qr_data.startsWith(prefix)) {
        set.status = 400;
        return { message: "Not a playground ticket" };
      }

      const ticket_id = qr_data.substring(prefix.length);

      const results = await drizzle
        .select({
          id: playground_tickets.id,
          terminal_id: playground_tickets.terminal_id,
          organization_id: playground_tickets.organization_id,
          order_number: playground_tickets.order_number,
          order_amount: playground_tickets.order_amount,
          children_count: playground_tickets.children_count,
          is_used: playground_tickets.is_used,
          used_at: playground_tickets.used_at,
          created_at: playground_tickets.created_at,
          terminal_name: terminals.name,
        })
        .from(playground_tickets)
        .leftJoin(terminals, eq(playground_tickets.terminal_id, terminals.id))
        .where(eq(playground_tickets.id, ticket_id))
        .execute();

      if (results.length === 0) {
        set.status = 404;
        return { message: "Ticket not found" };
      }

      const ticket = results[0];

      if (ticket.is_used) {
        set.status = 400;
        return { message: "Ticket already used", used_at: ticket.used_at };
      }

      // Check if ticket was created today (Asia/Tashkent = UTC+5)
      const now = new Date();
      const tashkentOffset = 5 * 60 * 60 * 1000;
      const tashkentNow = new Date(now.getTime() + tashkentOffset);
      const createdAt = new Date(ticket.created_at!);
      const tashkentCreated = new Date(createdAt.getTime() + tashkentOffset);

      const todayStr = tashkentNow.toISOString().split("T")[0];
      const createdStr = tashkentCreated.toISOString().split("T")[0];

      if (todayStr !== createdStr) {
        set.status = 400;
        return { message: "Ticket expired" };
      }

      // Mark as used
      await drizzle
        .update(playground_tickets)
        .set({
          is_used: true,
          used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .where(eq(playground_tickets.id, ticket_id))
        .execute();

      return {
        ticket_id: ticket.id,
        children_count: ticket.children_count,
        order_number: ticket.order_number,
        order_amount: ticket.order_amount,
        terminal_name: ticket.terminal_name,
      };
    },
    {
      permission: "playground_tickets.validate",
      body: t.Object({
        qr_data: t.String(),
      }),
    }
  )
  // List tickets — session auth + permission, scoped by user's terminals
  .get(
    "/playground_tickets",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
      terminals: userTerminals,
    }) => {
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, playground_tickets, {
          terminals,
        });
      }

      // Scope by user's assigned terminals for multi-tenant isolation
      if (userTerminals && userTerminals.length > 0) {
        whereClause.push(
          sql`${playground_tickets.terminal_id} IN (${sql.join(
            userTerminals.map((tid: string) => sql`${tid}::uuid`),
            sql`, `
          )})`
        );
      }

      const countResult = await drizzle
        .select({ count: sql`count(*)` })
        .from(playground_tickets)
        .leftJoin(terminals, eq(playground_tickets.terminal_id, terminals.id))
        .where(and(...whereClause))
        .execute();

      const ticketsList = await drizzle
        .select({
          id: playground_tickets.id,
          terminal_id: playground_tickets.terminal_id,
          organization_id: playground_tickets.organization_id,
          order_number: playground_tickets.order_number,
          order_amount: playground_tickets.order_amount,
          children_count: playground_tickets.children_count,
          is_used: playground_tickets.is_used,
          used_at: playground_tickets.used_at,
          created_at: playground_tickets.created_at,
          terminal_name: terminals.name,
        })
        .from(playground_tickets)
        .leftJoin(terminals, eq(playground_tickets.terminal_id, terminals.id))
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute();

      return {
        total: countResult[0].count,
        data: ticketsList,
      };
    },
    {
      permission: "playground_tickets.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  );
