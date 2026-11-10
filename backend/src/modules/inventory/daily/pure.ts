// «Дневные остатки» — чистая сборка таблицы «склад × день» из пересчётов месяца.
import { InventoryError } from "../errors";
import { interimDates, isValidPeriod } from "../rules";
import type { DailyBrand, DailyCell, DailyGrid, DailyGridGroup, DailyGridRow } from "./types";

/** exord — у склада есть список товаров из exord (store_product_links): склад работает. */
export type GridStore = { id: string; name: string | null; exord: boolean };
export type GridCount = { id: string; store_id: string; kind: string; count_date: string; status: string };

// Бренд — по коду склада iiko в начале названия. Организация у части складов пустая
// (новые филиалы), а code — у 19030 тоже; название с кодом есть у всех складов филиалов.
// Тестовые склады (00000), «Офис», Pizza Pizza и United под шаблон не попадают.
const BRAND_RE = /^(19|21)\d{3}(?!\d)/;
const BRANDS: DailyBrand[] = ["les", "chopar"];

export function brandOf(name: string | null): DailyBrand | null {
  const m = name ? BRAND_RE.exec(name) : null;
  if (!m) return null;
  return m[1] === "19" ? "les" : "chopar";
}

/** Какие дни месяца показывать. Пересчёт вбивают за вчера (rules.interimDates), поэтому вчерашний
 * день ещё не закончен для «из N», а сегодняшнего и будущих в таблице нет. */
function dayBounds(period: string, now: Date): Pick<DailyGrid, "days" | "entering_day" | "complete_days"> {
  const lastDay = Number(period.slice(8, 10));
  const first = `${period.slice(0, 8)}01`;
  const yesterday = interimDates(now).max;
  if (yesterday < first) return { days: 0, entering_day: null, complete_days: 0 };
  if (yesterday > period) return { days: lastDay, entering_day: null, complete_days: lastDay };
  const d = Number(yesterday.slice(8, 10));
  return { days: d, entering_day: d, complete_days: d - 1 };
}

const better = (a: DailyCell, b: DailyCell | null): boolean => !b || (a.status === "submitted" && b.status !== "submitted");

export function buildDailyGrid(input: { period: string; now: Date; stores: GridStore[]; counts: GridCount[] }): DailyGrid {
  const { period, now } = input;
  if (!isValidPeriod(period)) throw new InventoryError(422, "invalid_period");
  const bounds = dayBounds(period, now);
  const { days, complete_days } = bounds;
  const month = period.slice(0, 8);

  // Закрытые склады (без товаров exord) показываем, только если в этом месяце по ним что-то вбивали.
  const counted = new Set(input.counts.filter((c) => c.status !== "cancelled" && c.count_date.startsWith(month)).map((c) => c.store_id));
  const rows = new Map<string, DailyGridRow & { brand: DailyBrand }>();
  for (const s of input.stores) {
    const brand = brandOf(s.name);
    if (!brand || (!s.exord && !counted.has(s.id))) continue;
    rows.set(s.id, { brand, store_id: s.id, store_name: s.name ?? "", cells: Array(days).fill(null), submitted: 0 });
  }

  for (const c of input.counts) {
    const row = rows.get(c.store_id);
    if (!row || !c.count_date.startsWith(month)) continue;
    if (c.status !== "submitted" && c.status !== "draft") continue;
    const i = Number(c.count_date.slice(8, 10)) - 1;
    if (i < 0 || i >= days) continue;
    const cell: DailyCell = { count_id: c.id, status: c.status, monthly: c.kind === "monthly" };
    if (better(cell, row.cells[i])) row.cells[i] = cell;
  }

  const groups: DailyGridGroup[] = BRANDS.map((brand) => {
    const list = [...rows.values()]
      .filter((r) => r.brand === brand)
      .sort((a, b) => a.store_name.localeCompare(b.store_name, "ru"));
    const totals = Array(days).fill(0);
    const out = list.map(({ brand: _b, ...r }) => {
      r.cells.forEach((cell, i) => {
        if (cell?.status !== "submitted") return;
        totals[i] += 1;
        if (i < complete_days) r.submitted += 1;
      });
      return r;
    });
    return { brand, rows: out, totals };
  }).filter((g) => g.rows.length > 0);

  return { period, ...bounds, groups };
}
