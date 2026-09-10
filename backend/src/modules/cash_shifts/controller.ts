import { ctx } from "@backend/context";
import { sql } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { resolveTerminalScope, scopeFilter } from "./scope";

const TZ = "Asia/Tashkent";
const MAX_RANGE_DAYS = 92;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  );

// Widened export: keeps the app root .use() chain from overflowing TS
// instantiation depth; routes are HTTP-only (no Eden consumers).
export const cashShiftsController = cashShiftsControllerImpl as unknown as Elysia;
