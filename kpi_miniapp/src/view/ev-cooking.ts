// Время приготовления для оценщика как данные (без DOM): что рисует screens/ev-cooking.ts.
// Справка к пункту «Время и скорость приготовления заказа»: итог месяца, дни и блюда по филиалу сотрудника.
// iiko меряет ожидание по заказу целиком, поэтому у блюда — среднее ожидание заказов с ним (подпись на экране это говорит).
import type { EvCooking } from "@backend/modules/kpi/tg-app/ev-types";
import { dayMonth, pct1 } from "../format";
import type { Key, Lang } from "../i18n";
import { monthName, tIn } from "../i18n";
import { hashOf } from "../route";
import { capFirst } from "../util";

const NBSP = " ";
export const COOKING_DISH_LIMIT = 10;
// Блюдо, из заказов с которым больше половины дольше норматива, помечается: так отличают случайные срывы от привычки.
const SLOW_OVER_PCT = 50;

export interface CookingShiftVM { value: "all" | "1" | "2"; label: string; hash: string; selected: boolean }
export interface CookingDayVM { label: string; orders: string; avg: string; onTime: string; bar: number }
export interface CookingDishVM { name: string; qty: string; avg: string; over: string; slow: string | null }
export interface EvCookingVM {
  title: string;
  sub: string;
  shifts: CookingShiftVM[] | null; // null — кассовых смен за месяц нет, переключатель не нужен
  empty: string | null;
  figures: { label: string; value: string }[];
  norms: string;
  days: CookingDayVM[];
  dishes: CookingDishVM[];
  dishesEmpty: string | null;
  note: string;
}

/** «8 мин 20 с» / «8 мин» / «8 daq 20 s»: ожидание в секундах. */
export function waitText(sec: number, l: Lang): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? tIn(l, "ev_cook_m", { m }) : tIn(l, "ev_cook_ms", { m, s });
}

const pctOf = (part: number, whole: number): number => (whole > 0 ? (100 * part) / whole : 0);
const percent = (n: number): string => `${pct1(n)}${NBSP}%`;

export function evCookingView(d: EvCooking, l: Lang): EvCookingVM {
  const name = `${d.employee.last_name} ${d.employee.first_name}`.trim();
  const month = `${capFirst(monthName(d.period, "nom", l))} ${d.period.slice(0, 4)}`;
  const sub = d.employee.terminal_name ? `${d.employee.terminal_name} · ${month}` : month;
  const pick = (value: "all" | "1" | "2"): CookingShiftVM => {
    const shift = value === "all" ? null : value;
    const label: Key = value === "all" ? "ev_cook_shift_all" : value === "1" ? "ev_cook_shift_1" : "ev_cook_shift_2";
    return { value, label: tIn(l, label), hash: hashOf({ name: "ev_cooking", employee_id: d.employee.id, period: d.period, shift }), selected: (d.shift ?? "all") === value };
  };
  const s = d.summary;
  return {
    title: name,
    sub,
    shifts: d.shifts ? [pick("all"), pick("1"), pick("2")] : null,
    empty: s ? null : tIn(l, d.shift ? "ev_cook_none_shift" : "ev_cook_none"),
    figures: s
      ? [
          { label: tIn(l, "ev_cook_fig_orders"), value: String(s.orders) },
          { label: tIn(l, "ev_cook_fig_avg"), value: waitText(s.avg_wait_sec, l) },
          { label: tIn(l, "ev_cook_fig_norm"), value: percent(pctOf(s.on_time, s.orders)) },
        ]
      : [],
    norms: tIn(l, "ev_cook_norms", { hall: d.norms.hall_min, del: d.norms.delivery_min }),
    days: d.days.map((x) => ({
      label: dayMonth(x.day, l),
      orders: tIn(l, "ev_cook_day_orders", { n: x.orders }),
      avg: waitText(x.avg_wait_sec, l),
      onTime: percent(pctOf(x.on_time, x.orders)),
      bar: Math.max(4, Math.round(pctOf(x.on_time, x.orders))),
    })),
    dishes: d.dishes.map((x) => ({
      name: x.name,
      qty: tIn(l, "ev_cook_dish_qty", { n: x.qty }),
      avg: waitText(x.avg_wait_sec, l),
      over: tIn(l, "ev_cook_dish_over", { p: pct1(x.over_pct) }),
      slow: x.over_pct >= SLOW_OVER_PCT ? tIn(l, "ev_cook_dish_slow") : null,
    })),
    dishesEmpty: s && d.dishes.length === 0 ? tIn(l, "ev_cook_dishes_none") : null,
    note: tIn(l, "ev_cook_note", { n: d.min_qty }),
  };
}
