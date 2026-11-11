// Чеки и средний чек кассира за месяц и за прошлый: справка оценщику, который ставит оценку за допродажи.
// Источник — cash_shift_cashiers (чеки и выручка кассира за кассовую смену iiko), день — business_date смены.
// Связь сотрудника с кассиром задаёт HR (cashier-link.ts); без связи в карточке вкладки «Продажи» нет.
import { sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { addMonths, type Period } from "../time";
import type { EvSales, EvSalesTotals } from "./ev-types";

type DayRow = { day: string; checks: number; revenue: string; name: string | null };

const avg = (revenue: number, checks: number): number | null => (checks > 0 ? Math.round(revenue / checks) : null);

function totals(rows: { checks: number; revenue: number }[]): EvSalesTotals {
  const checks = rows.reduce((n, r) => n + r.checks, 0);
  const revenue = rows.reduce((n, r) => n + r.revenue, 0);
  return { checks, avg_check: avg(revenue, checks), days: rows.filter((r) => r.checks > 0).length };
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
  return {
    cashier_name: [...rows].reverse().find((r) => r.name)?.name ?? null,
    month: totals(cur),
    prev: totals(before),
    days: cur.map((r) => ({ day: r.day, checks: r.checks, avg_check: avg(r.revenue, r.checks) })),
  };
}
