// Время приготовления по филиалу сотрудника за месяц: справка оценщику к пункту «Время и скорость приготовления заказа».
// Итог считается как факт филиала для балла (serviceByGroups): заказ целиком, ожидание — максимум по его строкам,
// норматив зависит от типа заказа. По блюдам и по дням те же заказы. Видимость сотрудника — как у карточки:
// чужой и несуществующий неотличимы (404 not_found).
import { sql } from "drizzle-orm";
import type { Actor, DbLike } from "../access";
import { loadScopes, parsePeriod } from "../access";
import { loadBranchSettings } from "../branch-settings";
import { terminalLinks } from "../branch-facts";
import { canSeeEmployee, loadDirectory } from "../directory";
import { UUID_RE } from "../employees";
import { KpiError } from "../errors";
import { addMonths, type Period } from "../time";
import type { EvCooking, EvCookingDay, EvCookingDish } from "./ev-types";

// Блюда, проданные реже, в список не идут: среднее по двум-трём заказам ничего не говорит.
export const COOKING_MIN_QTY = 5;
const MAX_WAIT_SEC = 14400;
// Зальное место приготовления: iiko не меряет готовку отдельного блюда, поэтому напитки и закуски зала не считаем (как на дашборде).
const NOT_HALL = sql`p.cooking_place !~ '(Зал|зал|[Zz]al)[[:space:]]*$'`;

type DayRow = { day: string; orders: number; on_time: number; avg_wait: number };
type DishRow = { name: string; qty: number; avg_wait: number; over: number };

export function shiftOf(v: unknown): "1" | "2" | null {
  if (v === undefined || v === null || v === "") return null;
  if (v === "1" || v === "2") return v;
  throw new KpiError(422, "bad_shift");
}

/** Чистая сборка ответа из строк запросов: итог — сумма дней, среднее взвешено заказами. */
export function shapeCooking(days: DayRow[], dishes: DishRow[]): Pick<EvCooking, "summary" | "days" | "dishes"> {
  const outDays: EvCookingDay[] = days.map((d) => ({ day: d.day, orders: Number(d.orders), on_time: Number(d.on_time), avg_wait_sec: Number(d.avg_wait) }));
  const orders = outDays.reduce((n, d) => n + d.orders, 0);
  const summary =
    orders === 0
      ? null
      : {
          orders,
          on_time: outDays.reduce((n, d) => n + d.on_time, 0),
          avg_wait_sec: Math.round(outDays.reduce((n, d) => n + d.avg_wait_sec * d.orders, 0) / orders),
        };
  const outDishes: EvCookingDish[] = dishes
    .map((d) => {
      const qty = Number(d.qty);
      return { name: d.name, qty, avg_wait_sec: Number(d.avg_wait), over_pct: qty > 0 ? Math.round((1000 * Number(d.over)) / qty) / 10 : 0 };
    })
    .sort((a, b) => b.avg_wait_sec - a.avg_wait_sec || b.qty - a.qty || a.name.localeCompare(b.name, "ru"));
  return { summary, days: outDays, dishes: outDishes };
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
  const base = { employee: { id: dir.id, first_name: dir.first_name, last_name: dir.last_name, terminal_name: dir.terminal_name }, period, shift, norms, min_qty: COOKING_MIN_QTY };

  const groups = (await terminalLinks(db, [dir.terminal_id])).get(dir.terminal_id.toLowerCase())?.iiko ?? [];
  if (groups.length === 0) return { ...base, shifts: false, summary: null, days: [], dishes: [] };

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
  const inShift = (col: ReturnType<typeof sql>): ReturnType<typeof sql> =>
    shift && hasShifts ? sql`AND EXISTS (SELECT 1 FROM shifts s WHERE s.grp = lower(p.restoraunt_group) AND s.ord = ${Number(shift)} AND ${col} >= s.o AND ${col} < s.c)` : sql``;
  const withShifts = shift && hasShifts ? sql`WITH ${shiftsCte}` : sql``;

  const daysRes = await db.execute(sql`
    ${withShifts}
    SELECT d.day, COUNT(*)::int AS orders, COUNT(*) FILTER (WHERE d.wait_sec <= d.norm_sec)::int AS on_time, ROUND(AVG(d.wait_sec))::int AS avg_wait
    FROM (
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
        ${shift && hasShifts ? sql`AND EXISTS (SELECT 1 FROM shifts s WHERE s.grp = w.grp AND s.ord = ${Number(shift)} AND w.open_time >= s.o AND w.open_time < s.c)` : sql``}
    ) d
    GROUP BY d.day ORDER BY d.day`);

  const dishesRes = await db.execute(sql`
    ${withShifts}
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
      AND ${NOT_HALL}
      ${inShift(sql`p.open_time`)}
    GROUP BY p.dish_name
    HAVING SUM(p.dish_amount_int) >= ${COOKING_MIN_QTY}`);

  return { ...base, shift: hasShifts ? shift : null, shifts: hasShifts, ...shapeCooking(daysRes.rows as DayRow[], dishesRes.rows as DishRow[]) };
}
