import { ctx } from "@backend/context";
import { sql } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { resolveTerminalScope, scopeFilter } from "./scope";

const TZ = "Asia/Tashkent";
const MAX_RANGE_DAYS = 92;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unwrapRows = (res: unknown): any[] =>
  Array.isArray(res) ? (res as any[]) : (((res as any)?.rows ?? []) as any[]);
const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);
const num = (v: unknown): number => (v == null ? 0 : Number(v));

const LITE_COLUMNS = sql`
  cs.id, cs.terminal_id, t.name AS terminal_name, cs.iiko_group_id, cs.iiko_group_name,
  cs.cash_reg_number, cs.cash_register_name, to_char(cs.business_date, 'YYYY-MM-DD') AS business_date,
  cs.open_at, cs.close_at, cs.status, cs.pay_orders`;

const liteRow = (r: any) => ({
  id: String(r.id),
  terminal_id: r.terminal_id ?? null,
  terminal_name: r.terminal_name ?? null,
  iiko_group_id: r.iiko_group_id ?? null,
  iiko_group_name: r.iiko_group_name ?? null,
  cash_reg_number: Number(r.cash_reg_number),
  cash_register_name: r.cash_register_name ?? null,
  business_date: String(r.business_date),
  open_at: iso(r.open_at)!,
  close_at: iso(r.close_at),
  status: String(r.status),
  pay_orders: num(r.pay_orders),
});

// Registered on the app root (src/app.ts) with an explicit /api prefix and a
// widened export, same as stoplistController: the apiController .use() chain
// overflows TS2589 and these routes are HTTP-only (no Eden consumers).
const cashShiftsControllerImpl = new Elysia({ name: "@api/cash_shifts", prefix: "/api" })
  .use(ctx)
  // Dashboard widget, level 1: all shifts of the period without cashiers.
  .get(
    "/cash_shifts",
    async (c: any) => {
      const { query, set, drizzle } = c;
      const startMs = Date.parse(query.startDate);
      const endMs = Date.parse(query.endDate);
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
        set.status = 422;
        return { message: "startDate and endDate must be ISO dates, startDate <= endDate" };
      }
      if ((endMs - startMs) / 86_400_000 > MAX_RANGE_DAYS) {
        set.status = 400;
        return { message: `period is limited to ${MAX_RANGE_DAYS} days` };
      }
      const scope = resolveTerminalScope(query.terminals, c.terminals as string[] | undefined);
      // synced_at: latest sync over the same scoped rows as UTC ISO (null when none).
      const rows = unwrapRows(
        await drizzle.execute(sql`
          SELECT ${LITE_COLUMNS},
                 to_char(max(cs.synced_at) OVER () AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS synced_at_max
          FROM cash_shifts cs
          LEFT JOIN terminals t ON t.id = cs.terminal_id
          WHERE cs.business_date
                BETWEEN (${query.startDate}::timestamptz AT TIME ZONE ${TZ})::date
                    AND (${query.endDate}::timestamptz AT TIME ZONE ${TZ})::date
          ${scopeFilter(scope)}
          ORDER BY cs.business_date DESC, t.name NULLS LAST, cs.cash_reg_number, cs.open_at`)
      );
      return { shifts: rows.map(liteRow), synced_at: rows.length > 0 ? iso(rows[0].synced_at_max) : null };
    },
    {
      permission: "charts.list",
      query: t.Object({
        startDate: t.String(),
        endDate: t.String(),
        terminals: t.Optional(t.String()),
      }),
    } as any
  )
  // Level 2: one business day with cashiers and money.
  .get(
    "/cash_shifts/day",
    async (c: any) => {
      const { query, set, drizzle } = c;
      if (!DAY_RE.test(query.day)) {
        set.status = 422;
        return { message: "day (YYYY-MM-DD) is required" };
      }
      const scope = resolveTerminalScope(query.terminals, c.terminals as string[] | undefined);
      const rows = unwrapRows(
        await drizzle.execute(sql`
          SELECT ${LITE_COLUMNS},
                 cs.session_number, cs.responsible_user_name, cs.manager_name,
                 cs.sales_cash, cs.sales_card, cs.sales_credit, cs.pay_in, cs.pay_out, cs.cash_diff,
                 COALESCE((
                   SELECT json_agg(json_build_object(
                            'cashier_id', c.cashier_id, 'cashier_name', c.cashier_name,
                            'cashier_code', c.cashier_code, 'orders_count', c.orders_count,
                            'revenue', c.revenue) ORDER BY c.revenue DESC)
                   FROM cash_shift_cashiers c WHERE c.shift_id = cs.id), '[]'::json) AS cashiers
          FROM cash_shifts cs
          LEFT JOIN terminals t ON t.id = cs.terminal_id
          WHERE cs.business_date = ${query.day}::date
          ${scopeFilter(scope)}
          ORDER BY t.name NULLS LAST, cs.cash_reg_number, cs.open_at`)
      );
      return {
        day: query.day,
        shifts: rows.map((r: any) => ({
          ...liteRow(r),
          session_number: Number(r.session_number),
          responsible_user_name: r.responsible_user_name ?? null,
          manager_name: r.manager_name ?? null,
          sales_cash: num(r.sales_cash),
          sales_card: num(r.sales_card),
          sales_credit: num(r.sales_credit),
          pay_in: num(r.pay_in),
          pay_out: num(r.pay_out),
          cash_diff: num(r.cash_diff),
          cashiers: (r.cashiers ?? []).map((x: any) => ({
            cashier_id: String(x.cashier_id),
            cashier_name: String(x.cashier_name),
            cashier_code: x.cashier_code ?? null,
            orders_count: Number(x.orders_count) || 0,
            revenue: num(x.revenue),
          })),
        })),
      };
    },
    {
      permission: "charts.list",
      query: t.Object({
        day: t.String(),
        terminals: t.Optional(t.String()),
      }),
    } as any
  )
  // Level 3: per-cashier KPIs for the window plus the immediately preceding
  // window of the same length (delta chip in the UI). Hours are apportioned
  // to a shift's cashiers in proportion to their orders_count.
  .get(
    "/cash_shifts/cashiers",
    async (c: any) => {
      const { query, set, drizzle } = c;
      const startMs = Date.parse(query.startDate);
      const endMs = Date.parse(query.endDate);
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
        set.status = 422;
        return { message: "startDate and endDate must be ISO dates, startDate <= endDate" };
      }
      if ((endMs - startMs) / 86_400_000 > MAX_RANGE_DAYS) {
        set.status = 400;
        return { message: `period is limited to ${MAX_RANGE_DAYS} days` };
      }
      const scope = resolveTerminalScope(query.terminals, c.terminals as string[] | undefined);
      const boundsRows = unwrapRows(
        await drizzle.execute(sql`
          SELECT to_char(b.d_from, 'YYYY-MM-DD') AS d_from,
                 to_char(b.d_to, 'YYYY-MM-DD') AS d_to,
                 to_char(b.d_from - (b.d_to - b.d_from + 1), 'YYYY-MM-DD') AS prev_from,
                 to_char(b.d_from - 1, 'YYYY-MM-DD') AS prev_to
          FROM (SELECT (${query.startDate}::timestamptz AT TIME ZONE ${TZ})::date AS d_from,
                       (${query.endDate}::timestamptz AT TIME ZONE ${TZ})::date AS d_to) b`)
      );
      const bounds = boundsRows[0] ?? {};
      const rows = unwrapRows(
        await drizzle.execute(sql`
          WITH bounds AS (
            SELECT (${query.startDate}::timestamptz AT TIME ZONE ${TZ})::date AS d_from,
                   (${query.endDate}::timestamptz AT TIME ZONE ${TZ})::date AS d_to
          ), scope AS (
            SELECT cs.id, cs.terminal_id, t.name AS terminal_name, cs.business_date,
                   CASE WHEN cs.close_at IS NULL THEN 0
                        ELSE EXTRACT(epoch FROM (cs.close_at - cs.open_at)) / 3600.0 END AS hours,
                   (SELECT sum(x.orders_count) FROM cash_shift_cashiers x WHERE x.shift_id = cs.id AND x.cashier_id <> '00000000-0000-0000-0000-000000000000'::uuid) AS shift_orders,
                   CASE WHEN cs.business_date BETWEEN b.d_from AND b.d_to THEN 'cur' ELSE 'prev' END AS period
            FROM cash_shifts cs
            LEFT JOIN terminals t ON t.id = cs.terminal_id
            CROSS JOIN bounds b
            WHERE cs.business_date BETWEEN b.d_from - (b.d_to - b.d_from + 1) AND b.d_to
            ${scopeFilter(scope)}
          )
          SELECT s.period,
                 c.cashier_id,
                 max(c.cashier_name) AS cashier_name,
                 max(c.cashier_code) AS cashier_code,
                 mode() WITHIN GROUP (ORDER BY s.terminal_name) AS terminal_name,
                 count(*)::int AS shifts,
                 sum(c.orders_count)::int AS orders,
                 sum(c.revenue) AS revenue,
                 sum(CASE WHEN coalesce(s.shift_orders, 0) = 0 THEN 0
                          ELSE s.hours * (c.orders_count::numeric / s.shift_orders) END) AS hours
          FROM cash_shift_cashiers c
          JOIN scope s ON s.id = c.shift_id
          WHERE c.cashier_id <> '00000000-0000-0000-0000-000000000000'::uuid
          GROUP BY s.period, c.cashier_id`)
      );
      const byId = new Map<string, { cur?: any; prev?: any }>();
      for (const r of rows) {
        const id = String(r.cashier_id);
        const entry = byId.get(id) ?? {};
        entry[r.period as "cur" | "prev"] = r;
        byId.set(id, entry);
      }
      const metrics = (r: any) => {
        const revenue = num(r.revenue);
        const hours = num(r.hours);
        const orders = num(r.orders);
        return {
          shifts: num(r.shifts),
          orders,
          revenue,
          hours,
          avg_check: orders > 0 ? revenue / orders : 0,
          orders_per_hour: hours > 0 ? orders / hours : 0,
          revenue_per_hour: hours > 0 ? revenue / hours : 0,
        };
      };
      const cashiers: any[] = [];
      for (const [id, entry] of byId) {
        if (!entry.cur) continue;
        cashiers.push({
          cashier_id: id,
          cashier_name: entry.cur.cashier_name ?? null,
          cashier_code: entry.cur.cashier_code ?? null,
          terminal_name: entry.cur.terminal_name ?? null,
          ...metrics(entry.cur),
          prev: entry.prev ? metrics(entry.prev) : null,
        });
      }
      cashiers.sort((a, b) => b.revenue - a.revenue);
      return {
        from: bounds.d_from ?? null,
        to: bounds.d_to ?? null,
        prev_from: bounds.prev_from ?? null,
        prev_to: bounds.prev_to ?? null,
        cashiers,
      };
    },
    {
      permission: "charts.list",
      query: t.Object({
        startDate: t.String(),
        endDate: t.String(),
        terminals: t.Optional(t.String()),
      }),
    } as any
  )
  // Level 4: daily series for the window, optionally split out one cashier
  // via FILTER; cashier_* stay null when cashierId is absent or malformed.
  .get(
    "/cash_shifts/cashiers/daily",
    async (c: any) => {
      const { query, set, drizzle } = c;
      const startMs = Date.parse(query.startDate);
      const endMs = Date.parse(query.endDate);
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
        set.status = 422;
        return { message: "startDate and endDate must be ISO dates, startDate <= endDate" };
      }
      if ((endMs - startMs) / 86_400_000 > MAX_RANGE_DAYS) {
        set.status = 400;
        return { message: `period is limited to ${MAX_RANGE_DAYS} days` };
      }
      const scope = resolveTerminalScope(query.terminals, c.terminals as string[] | undefined);
      const cashierId =
        typeof query.cashierId === "string" && UUID_RE.test(query.cashierId) ? query.cashierId : null;
      const cashierFilter = cashierId ? sql`c.cashier_id = ${cashierId}::uuid` : sql`false`;
      const rows = unwrapRows(
        await drizzle.execute(sql`
          SELECT to_char(cs.business_date, 'YYYY-MM-DD') AS day,
                 sum(c.revenue) AS revenue,
                 sum(c.orders_count)::int AS orders,
                 count(DISTINCT c.cashier_id)::int AS active_cashiers,
                 sum(c.revenue) FILTER (WHERE ${cashierFilter}) AS cashier_revenue,
                 sum(c.orders_count) FILTER (WHERE ${cashierFilter}) AS cashier_orders
          FROM cash_shift_cashiers c
          JOIN cash_shifts cs ON cs.id = c.shift_id
          WHERE cs.business_date
                BETWEEN (${query.startDate}::timestamptz AT TIME ZONE ${TZ})::date
                    AND (${query.endDate}::timestamptz AT TIME ZONE ${TZ})::date
            AND c.cashier_id <> '00000000-0000-0000-0000-000000000000'::uuid
            ${scopeFilter(scope)}
          GROUP BY cs.business_date
          ORDER BY cs.business_date ASC`)
      );
      const days = rows.map((r: any) => {
        const revenue = num(r.revenue);
        const activeCashiers = num(r.active_cashiers);
        return {
          day: String(r.day),
          revenue,
          orders: num(r.orders),
          active_cashiers: activeCashiers,
          revenue_per_cashier: activeCashiers > 0 ? revenue / activeCashiers : 0,
          cashier_revenue: cashierId ? num(r.cashier_revenue) : null,
          cashier_orders: cashierId ? num(r.cashier_orders) : null,
        };
      });
      return { days };
    },
    {
      permission: "charts.list",
      query: t.Object({
        startDate: t.String(),
        endDate: t.String(),
        terminals: t.Optional(t.String()),
        cashierId: t.Optional(t.String()),
      }),
    } as any
  );

// Widened export: keeps the app root .use() chain from overflowing TS
// instantiation depth; routes are HTTP-only (no Eden consumers).
export const cashShiftsController = cashShiftsControllerImpl as unknown as Elysia;
