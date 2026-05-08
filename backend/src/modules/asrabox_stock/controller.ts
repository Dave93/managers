import { ctx } from "@backend/context";
import {
  asrabox_stock_history,
  credentials,
  terminals,
  users_terminals,
} from "backend/drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import Elysia, { t } from "elysia";

const LARAVEL_URL = process.env.LARAVEL_API_URL || "https://api.lesailes.uz";
const INTERNAL_KEY =
  process.env.LARAVEL_INTERNAL_API_KEY || process.env.INTERNAL_API_KEY || "";

interface LaravelComposition {
  composition_id: string;
  name: string;
  price_uzs: number;
  current_quantity: number;
}

// Note: After deploying, seed these permissions in the database:
// INSERT INTO permissions (slug, description, active) VALUES
//   ('asrabox_stock.list', 'View asrabox stock for a terminal', true),
//   ('asrabox_stock.write', 'Set asrabox stock for a terminal', true);
// Then assign them to appropriate roles via roles_permissions table.
export const asraboxStockController = new Elysia({
  name: "@api/asrabox_stock",
})
  .use(ctx)
  .get(
    "/asrabox/stock/my_terminals",
    async ({ user, drizzle, set }) => {
      // Elysia macro resolve returns {user, role, terminals} which gets
      // spread into context — so `user` here IS the user record itself
      // (id, phone, login, ...), not a {user, role, terminals} wrapper.
      const userId = (user as any)?.id;
      if (!userId) {
        set.status = 401;
        return { error: "unauthenticated" };
      }
      const rows = await drizzle
        .select({
          terminal_id: users_terminals.terminal_id,
          name: terminals.name,
          organization_id: terminals.organization_id,
        })
        .from(users_terminals)
        .leftJoin(terminals, eq(terminals.id, users_terminals.terminal_id))
        .where(eq(users_terminals.user_id, userId))
        .execute();
      return rows
        .filter((r) => !!r.terminal_id && !!r.name)
        .map((r) => ({
          id: r.terminal_id,
          name: r.name,
          organization_id: r.organization_id,
        }));
    },
    {
      permission: "asrabox_stock.list",
    }
  )
  .get(
    "/asrabox/stock/compositions",
    async ({ query: { terminal_id }, drizzle, set }) => {
      const credRows = await drizzle
        .select({ key: credentials.key })
        .from(credentials)
        .where(
          and(
            eq(credentials.model, "terminals"),
            eq(credentials.model_id, terminal_id),
            eq(credentials.type, "iiko_id")
          )
        )
        .limit(1)
        .execute();
      if (credRows.length === 0 || !credRows[0].key) {
        set.status = 400;
        return { error: "iiko_id credential not found for terminal" };
      }
      const iikoId = credRows[0].key;

      let laravelData: LaravelComposition[] = [];
      try {
        const rs = await fetch(
          `${LARAVEL_URL}/api/internal/asrabox/compositions?iiko_id=${encodeURIComponent(iikoId)}`,
          {
            method: "GET",
            headers: {
              "X-Internal-API-Key": INTERNAL_KEY,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(15000),
          }
        );
        if (!rs.ok) {
          set.status = rs.status;
          const body = await rs.text();
          return { error: "laravel error", status: rs.status, body };
        }
        laravelData = (await rs.json()) as LaravelComposition[];
      } catch (e: any) {
        set.status = 502;
        return { error: "laravel unreachable", detail: e?.message ?? String(e) };
      }

      const compIds = laravelData.map((c) => c.composition_id);
      type IntentRow = {
        composition_id: string;
        quantity: number;
        set_at: string;
        set_by: string;
      };
      let intents: IntentRow[] = [];
      if (compIds.length > 0) {
        const result = await drizzle.execute(
          sql`SELECT DISTINCT ON (composition_id)
                composition_id, quantity, set_at, set_by
              FROM asrabox_stock_history
              WHERE terminal_id = ${terminal_id}
                AND composition_id IN (${sql.join(
                  compIds.map((id) => sql`${id}`),
                  sql`, `
                )})
              ORDER BY composition_id, set_at DESC`
        );
        const rows = (result as any)?.rows ?? result ?? [];
        intents = Array.isArray(rows) ? (rows as IntentRow[]) : [];
      }
      const intentMap: Record<string, IntentRow> = {};
      for (const r of intents) intentMap[r.composition_id] = r;

      return laravelData.map((c) => ({
        ...c,
        last_intent_quantity: intentMap[c.composition_id]?.quantity ?? null,
        last_intent_set_at: intentMap[c.composition_id]?.set_at ?? null,
      }));
    },
    {
      permission: "asrabox_stock.list",
      query: t.Object({
        terminal_id: t.String({ format: "uuid" }),
      }),
    }
  )
  .post(
    "/asrabox/stock/save",
    async ({ body, drizzle, user, set }) => {
      const { terminal_id, items } = body;
      if (!user) {
        set.status = 401;
        return { error: "unauthenticated" };
      }

      const credRows = await drizzle
        .select({ key: credentials.key })
        .from(credentials)
        .where(
          and(
            eq(credentials.model, "terminals"),
            eq(credentials.model_id, terminal_id),
            eq(credentials.type, "iiko_id")
          )
        )
        .limit(1)
        .execute();
      if (credRows.length === 0 || !credRows[0].key) {
        set.status = 400;
        return { error: "iiko_id credential not found for terminal" };
      }
      const iikoId = credRows[0].key;

      let laravelBody: any = null;
      try {
        const rs = await fetch(
          `${LARAVEL_URL}/api/internal/asrabox/composition-stock`,
          {
            method: "POST",
            headers: {
              "X-Internal-API-Key": INTERNAL_KEY,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ iiko_id: iikoId, items }),
            signal: AbortSignal.timeout(30000),
          }
        );
        const responseText = await rs.text();
        try {
          laravelBody = JSON.parse(responseText);
        } catch {
          laravelBody = { raw: responseText };
        }
        if (!rs.ok) {
          set.status = rs.status;
          return { error: "laravel error", status: rs.status, body: laravelBody };
        }
      } catch (e: any) {
        set.status = 502;
        return { error: "laravel unreachable", detail: e?.message ?? String(e) };
      }

      const updatedIds: string[] = Array.isArray(laravelBody?.updated)
        ? laravelBody.updated.map((u: any) => u.composition_id)
        : [];

      if (updatedIds.length > 0) {
        const successRows = items
          .filter((it) => updatedIds.includes(it.composition_id))
          .map((it) => ({
            terminal_id,
            iiko_id: iikoId,
            composition_id: it.composition_id,
            quantity: it.quantity,
            set_by: user.id,
            laravel_response: laravelBody,
          }));

        if (successRows.length > 0) {
          await drizzle.insert(asrabox_stock_history).values(successRows).execute();
        }
      }

      return {
        updated: laravelBody?.updated ?? [],
        errors: laravelBody?.errors ?? [],
      };
    },
    {
      permission: "asrabox_stock.write",
      body: t.Object({
        terminal_id: t.String({ format: "uuid" }),
        items: t.Array(
          t.Object({
            composition_id: t.String(),
            quantity: t.Integer({ minimum: 0 }),
          }),
          { minItems: 1 }
        ),
      }),
    }
  );
