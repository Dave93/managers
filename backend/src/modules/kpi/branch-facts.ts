// Факты филиала из общих таблиц iiko. Ключи из credentials приходят текстом, а orders.restaurant_group_id — uuid:
// всё, что не прошло UUID_RE, отсеивается в JS до запроса (иначе Postgres бросит 22P02 и ответ станет 500).
import { credentials, inventory_reconciliations, kpi_attendance, kpi_revenue_plans, kpi_sanitary_checks, orders } from "backend/drizzle/schema";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DbLike } from "./access";
import { monthLastDay } from "./branch-rules";
import { UUID_RE } from "./employees";
import { addMonths, type Period } from "./time";

// Ключи в нижнем регистре, только UUID_RE
export type TerminalLinks = { iiko: string[]; stores: string[] };

// Связки филиалов с iiko. Без аргумента — все model_id, прошедшие UUID_RE.
// model_id в credentials — text, регистр у него не гарантирован: с ids сравниваем через lower().
export async function terminalLinks(db: DbLike, terminalIds?: string[]): Promise<Map<string, TerminalLinks>> {
  const out = new Map<string, TerminalLinks>();
  if (terminalIds && terminalIds.length === 0) return out;
  const rows = await db
    .select({ model_id: credentials.model_id, type: credentials.type, key: credentials.key })
    .from(credentials)
    .where(
      and(
        sql`${credentials.model} = 'terminals'`,
        inArray(credentials.type, ["iiko_id", "iiko_store_id"]),
        terminalIds
          ? inArray(sql`lower(${credentials.model_id})`, terminalIds.map((t) => t.toLowerCase()))
          : undefined
      )
    );
  for (const r of rows) {
    if (!r.model_id || !UUID_RE.test(r.model_id) || !UUID_RE.test(r.key)) continue;
    const id = r.model_id.toLowerCase();
    const key = r.key.toLowerCase();
    let links = out.get(id);
    if (!links) {
      links = { iiko: [], stores: [] };
      out.set(id, links);
    }
    const list = r.type === "iiko_id" ? links.iiko : links.stores;
    if (!list.includes(key)) list.push(key);
  }
  return out;
}

// Выручка по группам iiko за месяц: SUM(dish_discount_sum_int), без фильтра по статусу.
// open_date_typed — местное время без зоны, границы месяца берём тоже местными.
export async function revenueByGroups(db: DbLike, groups: string[], period: Period): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const safe = [...new Set(groups.filter((g) => UUID_RE.test(g)).map((g) => g.toLowerCase()))];
  if (safe.length === 0) return out;
  const from = `${period} 00:00:00`;
  const to = `${addMonths(period, 1)} 00:00:00`;
  const grp = sql<string>`lower(${orders.restaurantGroupId}::text)`;
  const rows = await db
    .select({ grp, revenue: sql<number>`SUM(${orders.dishDiscountSumInt})::float8` })
    .from(orders)
    .where(and(inArray(orders.restaurantGroupId, safe), gte(orders.openDateTyped, from), lt(orders.openDateTyped, to)))
    .groupBy(grp);
  for (const r of rows) out.set(r.grp, Number(r.revenue ?? 0));
  return out;
}

// Общие и составные ключи. Факт филиала суммируется по его ключам (iiko-группам или складам), каждый ключ один раз.
// Ключ, который записан у двух филиалов, целиком засчитывается обоим: так же считает дашборд по группе.
// Поэтому любой итог по всей сети (выручка, затраты) нельзя собирать суммой по филиалам:
// его считают по РАЗЛИЧНЫМ ключам (revenueByGroups по уникальным группам), иначе общий ключ войдёт дважды.
export function sumOver(keys: string[], by: Map<string, number>): number {
  let s = 0;
  for (const k of new Set(keys)) s += by.get(k) ?? 0;
  return s;
}

const safeKeys = (keys: string[]): string[] => [...new Set(keys.filter((k) => UUID_RE.test(k)).map((k) => k.toLowerCase()))];

// Доля заказов в норматив по группам iiko. Ожидание заказа — максимум по строкам; 0 — не замерено;
// тип заказа из orders (нет строки в orders — заказ не считается). Нормативы в минутах.
export async function serviceByGroups(
  db: DbLike,
  groups: string[],
  period: Period,
  norms: { hall_min: number; delivery_min: number }
): Promise<Map<string, { orders: number; on_time: number }>> {
  const out = new Map<string, { orders: number; on_time: number }>();
  const safe = safeKeys(groups);
  if (safe.length === 0) return out;
  const from = `${period} 00:00:00`;
  const to = `${addMonths(period, 1)} 00:00:00`;
  const list = sql.join(safe.map((g) => sql`${g}`), sql`, `);
  const res = await db.execute(sql`
    WITH w AS (
      SELECT lower(p.restoraunt_group) AS grp, p.uniq_order_id, p.open_date_typed, MAX(p.guest_wait_time_avg) AS wait_sec
      FROM product_cooking_time p
      WHERE lower(p.restoraunt_group) IN (${list})
        AND p.open_date_typed >= ${from}::timestamp AND p.open_date_typed < ${to}::timestamp
        AND p.guest_wait_time_avg > 0 AND p.guest_wait_time_avg <= 14400
      GROUP BY 1, 2, 3
    )
    SELECT w.grp, COUNT(*)::int AS orders,
      COUNT(*) FILTER (WHERE w.wait_sec <= CASE WHEN o.order_service_type IN ('DELIVERY_BY_COURIER', 'DELIVERY_PICKUP')
                                                THEN ${norms.delivery_min * 60}::int ELSE ${norms.hall_min * 60}::int END)::int AS on_time
    FROM w
    JOIN orders o ON o.id = w.uniq_order_id AND o.open_date_typed = w.open_date_typed
    WHERE o.open_date_typed >= ${from}::timestamp AND o.open_date_typed < ${to}::timestamp
    GROUP BY w.grp
  `);
  for (const r of res.rows as { grp: string; orders: number; on_time: number }[]) {
    out.set(r.grp, { orders: Number(r.orders), on_time: Number(r.on_time) });
  }
  return out;
}

// Сверки складов за месяц (period сверки — последний день месяца). Сумма — из снимка «принято», не из живой колонки.
export async function reconciliationsByStores(
  db: DbLike,
  stores: string[],
  period: Period
): Promise<Map<string, { status: string; diff_bc: number | null }>> {
  const out = new Map<string, { status: string; diff_bc: number | null }>();
  const safe = safeKeys(stores);
  if (safe.length === 0) return out;
  const rows = await db
    .select({
      store: sql<string>`lower(${inventory_reconciliations.store_id}::text)`,
      status: inventory_reconciliations.status,
      diff_bc: sql<string | null>`${inventory_reconciliations.accepted_totals}->>'diff_bc_sum'`,
    })
    .from(inventory_reconciliations)
    .where(and(inArray(inventory_reconciliations.store_id, safe), eq(inventory_reconciliations.period, monthLastDay(period))));
  for (const r of rows) {
    const n = r.status === "accepted" && r.diff_bc !== null && r.diff_bc.trim() !== "" ? Number(r.diff_bc) : null;
    out.set(r.store, { status: r.status, diff_bc: n !== null && Number.isFinite(n) ? n : null });
  }
  return out;
}

// Санитарные проверки месяца по филиалам: число и средний процент (колонка period уже по Ташкенту).
export async function sanitaryByTerminal(db: DbLike, period: Period): Promise<Map<string, { checks: number; avg: number }>> {
  const rows = await db
    .select({
      terminal_id: kpi_sanitary_checks.terminal_id,
      checks: sql<number>`count(*)::int`,
      avg: sql<string>`round(avg(${kpi_sanitary_checks.pct}), 2)`,
    })
    .from(kpi_sanitary_checks)
    .where(eq(kpi_sanitary_checks.period, period))
    .groupBy(kpi_sanitary_checks.terminal_id);
  return new Map(rows.map((r) => [r.terminal_id, { checks: Number(r.checks), avg: Number(r.avg) }]));
}

// Посещаемость месяца по филиалам: строки «сотрудник-день». date-колонка, граница месяца без зон.
export async function attendanceByTerminal(
  db: DbLike,
  period: Period
): Promise<Map<string, { days: number; on_time: number; late: number; absent: number }>> {
  const a = kpi_attendance;
  const rows = await db
    .select({
      terminal_id: a.terminal_id,
      days: sql<number>`count(*)::int`,
      on_time: sql<number>`(count(*) filter (where not ${a.absent} and ${a.late_minutes} = 0))::int`,
      late: sql<number>`(count(*) filter (where not ${a.absent} and ${a.late_minutes} > 0))::int`,
      absent: sql<number>`(count(*) filter (where ${a.absent}))::int`,
    })
    .from(a)
    .where(and(gte(a.day, period), lt(a.day, addMonths(period, 1))))
    .groupBy(a.terminal_id);
  return new Map(
    rows.map((r) => [r.terminal_id, { days: Number(r.days), on_time: Number(r.on_time), late: Number(r.late), absent: Number(r.absent) }])
  );
}

// Планы выручки месяца по филиалам
export async function plansByTerminal(db: DbLike, period: Period): Promise<Map<string, number>> {
  const rows = await db
    .select({ terminal_id: kpi_revenue_plans.terminal_id, amount: kpi_revenue_plans.amount })
    .from(kpi_revenue_plans)
    .where(eq(kpi_revenue_plans.period, period));
  return new Map(rows.map((r) => [r.terminal_id, Number(r.amount)]));
}
