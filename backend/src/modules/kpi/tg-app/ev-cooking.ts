// Время приготовления по филиалу сотрудника за месяц: справка оценщику к пункту «Время и скорость приготовления заказа».
// Итог считается как факт филиала для балла (serviceByGroups): заказ целиком, ожидание — максимум по его строкам,
// норматив зависит от типа заказа. По блюдам и по дням те же заказы. Видимость сотрудника — как у карточки:
// чужой и несуществующий неотличимы (404 not_found).
import { sql, type SQL } from "drizzle-orm";
import type { Actor, DbLike } from "../access";
import { loadScopes, parsePeriod } from "../access";
import { loadBranchSettings, loadIndicators } from "../branch-settings";
import { terminalLinks } from "../branch-facts";
import { canSeeEmployee, loadDirectory } from "../directory";
import { UUID_RE } from "../employees";
import { KpiError } from "../errors";
import { addMonths, type Period } from "../time";
import type { EvCooking, EvCookingDay, EvCookingDish, EvCookingIssue } from "./ev-types";

// Блюда, проданные реже, в список не идут: среднее по двум-трём заказам ничего не говорит.
export const COOKING_MIN_QTY = 5;
const MAX_WAIT_SEC = 14400;
// Обычное ожидание больше двух нормативов — замеры похожи на ошибку (заказ закрывают позже готовности), а не на медленную кухню.
export const SUSPECT_NORM_RATIO = 2;
// Зальное место приготовления: iiko не меряет готовку отдельного блюда, поэтому напитки и закуски зала не считаем (как на дашборде).
// Если у филиала за месяц нет ни одного другого места (кухни нет в iiko), считаем и зал: иначе у блюд было бы пусто.
const HALL_RE = "(Зал|зал|[Zz]al)[[:space:]]*$";

// Строка итога (GROUPING SETS ()) приходит с day = null.
type DayRow = { day: string | null; orders: number; on_time: number; avg_wait: number; median_wait: number; median_ratio: number | null };
type DishRow = { name: string; qty: number; avg_wait: number; over: number };

export function shiftOf(v: unknown): "1" | "2" | null {
  if (v === undefined || v === null || v === "") return null;
  if (v === "1" || v === "2") return v;
  throw new KpiError(422, "bad_shift");
}

/**
 * Чистая сборка ответа из строк запросов. Итог — строка без дня (по всем заказам сразу: медиану месяца из дней не сложить).
 * noKitchen — у филиала нет отдельной кухни в iiko; иначе подозрительно, если обычное ожидание больше двух нормативов.
 */
export function shapeCooking(
  rows: DayRow[],
  dishes: DishRow[],
  noKitchen = false
): Pick<EvCooking, "summary" | "days" | "dishes" | "data_issue"> {
  const outDays: EvCookingDay[] = rows
    .filter((d) => d.day !== null)
    .map((d) => ({ day: d.day as string, orders: Number(d.orders), on_time: Number(d.on_time), avg_wait_sec: Number(d.avg_wait), median_wait_sec: Number(d.median_wait) }));
  const total = rows.find((d) => d.day === null && Number(d.orders) > 0);
  const summary = total
    ? { orders: Number(total.orders), on_time: Number(total.on_time), avg_wait_sec: Number(total.avg_wait), median_wait_sec: Number(total.median_wait) }
    : null;
  const outDishes: EvCookingDish[] = dishes
    .map((d) => {
      const qty = Number(d.qty);
      return { name: d.name, qty, avg_wait_sec: Number(d.avg_wait), over_pct: qty > 0 ? Math.round((1000 * Number(d.over)) / qty) / 10 : 0 };
    })
    .sort((a, b) => b.avg_wait_sec - a.avg_wait_sec || b.qty - a.qty || a.name.localeCompare(b.name, "ru"));
  let issue: EvCookingIssue | null = null;
  if (total && noKitchen) issue = "no_kitchen";
  else if (total && total.median_ratio !== null && Number(total.median_ratio) > SUSPECT_NORM_RATIO) issue = "too_slow";
  return { summary, days: outDays, dishes: outDishes, data_issue: issue };
}

export async function evCooking(db: DbLike, actor: Actor, employeeId: string, periodRaw: unknown, shiftRaw: unknown): Promise<EvCooking> {
  const period: Period = parsePeriod(periodRaw);
  const shift = shiftOf(shiftRaw);
  if (!UUID_RE.test(employeeId)) throw new KpiError(404, "not_found");
  const [dir] = await loadDirectory(db, { employeeIds: [employeeId], includeInactive: true });
  if (!dir) throw new KpiError(404, "not_found");
  const scopes = await loadScopes(db, actor);
  if (!canSeeEmployee(actor, scopes, { terminal_id: dir.terminal_id, card_id: dir.card_id, employee_id: dir.id })) throw new KpiError(404, "not_found");

  const settings = await loadBranchSettings(db);
  const norms = { hall_min: settings.service_norm_hall_min, delivery_min: settings.service_norm_delivery_min };
  const service = (await loadIndicators(db)).find((i) => i.code === "service" && i.active);
  const base = {
    employee: { id: dir.id, first_name: dir.first_name, last_name: dir.last_name, terminal_name: dir.terminal_name },
    period,
    shift,
    norms,
    min_qty: COOKING_MIN_QTY,
    scale: service ? { floor: service.floor, target: service.target } : null,
  };

  const groups = (await terminalLinks(db, [dir.terminal_id])).get(dir.terminal_id.toLowerCase())?.iiko ?? [];
  if (groups.length === 0) return { ...base, shifts: false, summary: null, days: [], dishes: [], data_issue: null };

  const from = `${period} 00:00:00`;
  const to = `${addMonths(period, 1)} 00:00:00`;
  const list = sql.join(groups.map((g) => sql`${g}`), sql`, `);
  const hallSec = norms.hall_min * 60;
  const deliverySec = norms.delivery_min * 60;
  const normSec = sql`CASE WHEN o.order_service_type IN ('DELIVERY_BY_COURIER', 'DELIVERY_PICKUP') THEN ${deliverySec}::int ELSE ${hallSec}::int END`;

  // Смена — по кассовым сменам iiko, как в таблице дашборда: порядковый номер смены кассы за бизнес-дату, третья и далее считаются второй.
  const shiftsCte = sql`shifts AS (
      SELECT lower(cs.iiko_group_id::text) AS grp,
             (cs.open_at AT TIME ZONE 'Asia/Tashkent') AS o,
             COALESCE(cs.close_at AT TIME ZONE 'Asia/Tashkent', 'infinity'::timestamp) AS c,
             LEAST(ROW_NUMBER() OVER (PARTITION BY cs.iiko_group_id, cs.business_date, cs.cash_reg_number ORDER BY cs.open_at), 2) AS ord
      FROM cash_shifts cs
      WHERE cs.business_date >= ${period}::date - 1 AND cs.business_date <= (${to}::timestamp)::date
        AND lower(cs.iiko_group_id::text) IN (${list}))`;
  const [exists] = (
    await db.execute(sql`SELECT EXISTS (SELECT 1 FROM cash_shifts cs WHERE cs.business_date >= ${period}::date AND cs.business_date < (${to}::timestamp)::date AND lower(cs.iiko_group_id::text) IN (${list})) AS e`)
  ).rows as { e: boolean }[];
  const hasShifts = Boolean(exists?.e);
  const byShift = Boolean(shift && hasShifts);
  const inShift = (grp: SQL, col: SQL): SQL =>
    byShift ? sql`AND EXISTS (SELECT 1 FROM shifts s WHERE s.grp = ${grp} AND s.ord = ${Number(shift)} AND ${col} >= s.o AND ${col} < s.c)` : sql``;
  const withCtes = (...ctes: SQL[]): SQL => {
    const all = byShift ? [shiftsCte, ...ctes] : ctes;
    return all.length ? sql`WITH ${sql.join(all, sql`, `)}` : sql``;
  };

  // Группы iiko филиала с отдельной кухней за месяц (по всему месяцу, не по смене): у них зал в блюда не идёт.
  const placesRes = await db.execute(sql`
    SELECT lower(p.restoraunt_group) AS grp, COALESCE(bool_or(p.cooking_place !~ ${HALL_RE}), false) AS kitchen
    FROM product_cooking_time p
    WHERE lower(p.restoraunt_group) IN (${list})
      AND p.open_date_typed >= ${from}::timestamp AND p.open_date_typed < ${to}::timestamp
    GROUP BY 1`);
  const places = placesRes.rows as { grp: string; kitchen: boolean }[];
  const withKitchen = places.filter((r) => r.kitchen).map((r) => r.grp);
  const noKitchen = places.length > 0 && withKitchen.length === 0;
  const notHall =
    withKitchen.length === 0
      ? sql``
      : withKitchen.length === places.length
        ? sql`AND p.cooking_place !~ ${HALL_RE}`
        : sql`AND (lower(p.restoraunt_group) NOT IN (${sql.join(withKitchen.map((g) => sql`${g}`), sql`, `)}) OR p.cooking_place !~ ${HALL_RE})`;

  const ordersCte = sql`d AS (
      SELECT w.open_date_typed::date::text AS day, w.wait_sec, ${normSec} AS norm_sec
      FROM (
        SELECT p.uniq_order_id, p.open_date_typed, lower(p.restoraunt_group) AS grp, MIN(p.open_time) AS open_time, MAX(p.guest_wait_time_avg) AS wait_sec
        FROM product_cooking_time p
        WHERE lower(p.restoraunt_group) IN (${list})
          AND p.open_date_typed >= ${from}::timestamp AND p.open_date_typed < ${to}::timestamp
          AND p.guest_wait_time_avg > 0 AND p.guest_wait_time_avg <= ${MAX_WAIT_SEC}
        GROUP BY 1, 2, 3
      ) w
      JOIN orders o ON o.id = w.uniq_order_id AND o.open_date_typed = w.open_date_typed
      WHERE o.open_date_typed >= ${from}::timestamp AND o.open_date_typed < ${to}::timestamp
        ${inShift(sql`w.grp`, sql`w.open_time`)})`;
  // Дни и итог одним запросом: GROUPING SETS даёт строку итога с day = null.
  const daysRes = await db.execute(sql`
    ${withCtes(ordersCte)}
    SELECT d.day, COUNT(*)::int AS orders, COUNT(*) FILTER (WHERE d.wait_sec <= d.norm_sec)::int AS on_time,
           ROUND(AVG(d.wait_sec))::int AS avg_wait,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY d.wait_sec))::int AS median_wait,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY d.wait_sec::float8 / d.norm_sec) AS median_ratio
    FROM d
    GROUP BY GROUPING SETS ((d.day), ())
    ORDER BY d.day NULLS LAST`);

  const dishesRes = await db.execute(sql`
    ${withCtes()}
    SELECT p.dish_name AS name, SUM(p.dish_amount_int)::int AS qty,
           ROUND(SUM(p.guest_wait_time_avg::numeric * p.dish_amount_int) / NULLIF(SUM(p.dish_amount_int), 0))::int AS avg_wait,
           COALESCE(SUM(p.dish_amount_int) FILTER (WHERE p.guest_wait_time_avg > ${normSec}), 0)::int AS over
    FROM product_cooking_time p
    JOIN orders o ON o.id = p.uniq_order_id AND o.open_date_typed = p.open_date_typed
    WHERE lower(p.restoraunt_group) IN (${list})
      AND p.open_date_typed >= ${from}::timestamp AND p.open_date_typed < ${to}::timestamp
      AND o.open_date_typed >= ${from}::timestamp AND o.open_date_typed < ${to}::timestamp
      AND p.guest_wait_time_avg > 0 AND p.guest_wait_time_avg <= ${MAX_WAIT_SEC}
      AND p.cooking_finish_time IS NOT NULL AND p.dish_amount_int > 0
      ${notHall}
      ${inShift(sql`lower(p.restoraunt_group)`, sql`p.open_time`)}
    GROUP BY p.dish_name
    HAVING SUM(p.dish_amount_int) >= ${COOKING_MIN_QTY}`);

  return {
    ...base,
    shift: hasShifts ? shift : null,
    shifts: hasShifts,
    ...shapeCooking(daysRes.rows as DayRow[], dishesRes.rows as DishRow[], noKitchen),
  };
}
