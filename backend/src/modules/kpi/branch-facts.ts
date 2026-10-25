// Факты филиала из общих таблиц iiko. Ключи из credentials приходят текстом, а orders.restaurant_group_id — uuid:
// всё, что не прошло UUID_RE, отсеивается в JS до запроса (иначе Postgres бросит 22P02 и ответ станет 500).
import { credentials, orders } from "backend/drizzle/schema";
import { and, gte, inArray, lt, sql } from "drizzle-orm";
import type { DbLike } from "./access";
import { UUID_RE } from "./employees";
import { addMonths, type Period } from "./time";

// Ключи в нижнем регистре, только UUID_RE
export type TerminalLinks = { iiko: string[]; stores: string[] };

// Связки филиалов с iiko. Без аргумента — все model_id, прошедшие UUID_RE.
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
        terminalIds ? inArray(credentials.model_id, terminalIds) : undefined
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

export function sumOver(keys: string[], by: Map<string, number>): number {
  let s = 0;
  for (const k of keys) s += by.get(k) ?? 0;
  return s;
}
