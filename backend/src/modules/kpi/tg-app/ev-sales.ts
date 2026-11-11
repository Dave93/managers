// Чеки, средний чек и проданные позиции кассира за месяц и за прошлый: справка оценщику, который ставит оценку за допродажи.
// Источник — cash_shift_cashiers (чеки и выручка за кассовую смену iiko) и cash_shift_cashier_dishes (позиции), день — business_date смены.
// Связь сотрудника с кассиром задаёт HR (cashier-link.ts); без связи в карточке вкладки «Продажи» нет.
import { sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { addMonths, type Period } from "../time";
import type { EvSales, EvSalesProduct, EvSalesTotals } from "./ev-types";

type DayRow = { day: string; checks: number; revenue: string; name: string | null };
type ProductRow = { name: string; qty: string; prev_qty: string };

const avg = (revenue: number, checks: number): number | null => (checks > 0 ? Math.round(revenue / checks) : null);

function totals(rows: { checks: number; revenue: number }[]): EvSalesTotals {
  const checks = rows.reduce((n, r) => n + r.checks, 0);
  const revenue = rows.reduce((n, r) => n + r.revenue, 0);
  return { checks, avg_check: avg(revenue, checks), days: rows.filter((r) => r.checks > 0).length };
}

// qty — штуки в месяце карточки, prev_qty — в прошлом. Позиции, которых в месяце карточки не было, не нужны.
async function loadProducts(db: DbLike, cashierId: string, period: Period, checks: number): Promise<EvSalesProduct[]> {
  const prev = addMonths(period, -1);
  const next = addMonths(period, 1);
  const res = await db.execute(sql`
    SELECT (array_agg(d.dish_name ORDER BY s.open_at DESC))[1] AS name,
           coalesce(sum(d.qty) FILTER (WHERE s.business_date >= ${period}::date), 0)::text AS qty,
           coalesce(sum(d.qty) FILTER (WHERE s.business_date < ${period}::date), 0)::text AS prev_qty
    FROM cash_shift_cashier_dishes d
    JOIN cash_shifts s ON s.id = d.shift_id
    WHERE d.cashier_id = ${cashierId}::uuid
      AND s.business_date >= ${prev}::date AND s.business_date < ${next}::date
    GROUP BY d.dish_id
    HAVING coalesce(sum(d.qty) FILTER (WHERE s.business_date >= ${period}::date), 0) > 0
    ORDER BY 2 DESC`);
  return (res.rows as ProductRow[])
    .map((r) => {
      const qty = Number(r.qty);
      return { name: r.name, qty, per100: checks > 0 ? Math.round((qty / checks) * 1000) / 10 : null, prev_qty: Number(r.prev_qty) };
    })
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "ru"));
}

export async function loadSales(db: DbLike, cashierId: string, period: Period): Promise<EvSales> {
  const prev = addMonths(period, -1);
  const next = addMonths(period, 1);
  const res = await db.execute(sql`
    SELECT s.business_date::text AS day,
           sum(c.orders_count)::int AS checks,
           sum(c.revenue)::text AS revenue,
           (array_agg(c.cashier_name ORDER BY s.open_at DESC))[1] AS name
    FROM cash_shift_cashiers c
    JOIN cash_shifts s ON s.id = c.shift_id
    WHERE c.cashier_id = ${cashierId}::uuid
      AND s.business_date >= ${prev}::date AND s.business_date < ${next}::date
    GROUP BY s.business_date
    ORDER BY s.business_date`);
  const rows = (res.rows as DayRow[]).map((r) => ({ day: r.day, checks: Number(r.checks), revenue: Number(r.revenue), name: r.name }));
  const cur = rows.filter((r) => r.day >= period);
  const before = rows.filter((r) => r.day < period);
  const month = totals(cur);
  return {
    cashier_name: [...rows].reverse().find((r) => r.name)?.name ?? null,
    month,
    prev: totals(before),
    days: cur.map((r) => ({ day: r.day, checks: r.checks, avg_check: avg(r.revenue, r.checks) })),
    products: await loadProducts(db, cashierId, period, month.checks),
  };
}
