import { normUuid } from "../product_links/parse";

// Склад iiko → филиал (terminals.id). Прямой связи в базе нет; её выводим из
// продаж: заказ знает и группу iiko (= credentials iiko_id филиала), и склад
// списания. Spec: docs/superpowers/specs/2026-10-02-inventory-counts-design.md §13.

export type OrderAgg = {
  store_id: string;
  restaurant_group_id: string;
  orders: number;
  last_order_at: string | null;
};

export type StoreTerminal = {
  store_id: string;
  terminal_id: string;
  orders_90d: number;
  last_order_at: string | null;
};

// Для каждого склада — группа с наибольшим числом заказов; при равенстве —
// с более поздним последним заказом (результат не зависит от порядка строк).
// Группы, которых нет среди филиалов managers, пропускаются и считаются.
export function pickTerminalPerStore(
  rows: OrderAgg[],
  terminalByIiko: Map<string, string>
): { links: StoreTerminal[]; unmapped: number } {
  const best = new Map<string, StoreTerminal>();
  let unmapped = 0;
  for (const r of rows) {
    const iiko = normUuid(r.restaurant_group_id);
    const terminalId = iiko ? terminalByIiko.get(iiko) : undefined;
    if (!terminalId) {
      unmapped++;
      continue;
    }
    const cur = best.get(r.store_id);
    const later = (r.last_order_at ?? "") > (cur?.last_order_at ?? "");
    if (!cur || r.orders > cur.orders_90d || (r.orders === cur.orders_90d && later)) {
      best.set(r.store_id, {
        store_id: r.store_id,
        terminal_id: terminalId,
        orders_90d: r.orders,
        last_order_at: r.last_order_at,
      });
    }
  }
  const links = [...best.values()].sort((a, b) => a.store_id.localeCompare(b.store_id));
  return { links, unmapped };
}
