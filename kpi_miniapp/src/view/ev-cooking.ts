// Время приготовления для оценщика как данные (без DOM): что рисует screens/ev-cooking.ts.
// Справка к пункту «Время и скорость приготовления заказа»: итог месяца, блюда и дни по филиалу сотрудника.
// iiko меряет ожидание по заказу целиком, поэтому у блюда — среднее ожидание заказов с ним (подпись на экране это говорит).
// Время показываем медианой («обычно ждут»): среднее тянут вверх единичные заказы на несколько часов.
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
/** bad — доля в норматив ниже порога, с которого филиал получает баллы. */
export interface CookingDayVM { label: string; count: string; median: string; onTime: string; bar: number; bad: boolean }
export interface CookingDishVM { name: string; qty: string; avg: string; over: string; slow: string | null }
export interface EvCookingVM {
  title: string;
  sub: string;
  shifts: CookingShiftVM[] | null; // null — кассовых смен за месяц нет, переключатель не нужен
  empty: string | null;
  figures: { label: string; value: string; bad: boolean }[];
  explain: string;
  scale: string | null;
  issue: string | null;
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
// Порог из настроек как есть: «80», «92,5».
const threshold = (n: number): string => String(n).replace(".", ",");
const ISSUE_KEY: Record<NonNullable<EvCooking["data_issue"]>, Key> = { no_kitchen: "ev_cook_issue_no_kitchen", too_slow: "ev_cook_issue_too_slow" };

export function evCookingView(d: EvCooking, l: Lang): EvCookingVM {
  const name = `${d.employee.last_name} ${d.employee.first_name}`.trim();
  const month = `${capFirst(monthName(d.period, "nom", l))} ${d.period.slice(0, 4)}`;
  const sub = d.employee.terminal_name ? `${d.employee.terminal_name} · ${month}` : month;
  const pick = (value: "all" | "1" | "2"): CookingShiftVM => {
    const shift = value === "all" ? null : value;
    const label: Key = value === "all" ? "ev_cook_shift_all" : value === "1" ? "ev_cook_shift_1" : "ev_cook_shift_2";
    return { value, label: tIn(l, label), hash: hashOf({ name: "ev_cooking", employee_id: d.employee.id, period: d.period, shift }), selected: (d.shift ?? "all") === value };
  };
  // Ниже порога показателя филиал не получает баллов: такие доли выделяются. Без порога (показатель выключен) не выделяем.
  const isBad = (pct: number): boolean => d.scale !== null && pct < d.scale.floor;
  // Доля чуть ниже порога не округляется до самого порога: 79,96 — «79,9 %», а не «80,0 %» рядом с красной подсветкой.
  const guard = d.scale ? [d.scale.floor, d.scale.target] : [];
  const percent = (n: number): string => `${pct1(n, guard)}${NBSP}%`;
  const s = d.summary;
  const sPct = s ? pctOf(s.on_time, s.orders) : 0;
  return {
    title: name,
    sub,
    shifts: d.shifts ? [pick("all"), pick("1"), pick("2")] : null,
    empty: s ? null : tIn(l, d.shift ? "ev_cook_none_shift" : "ev_cook_none"),
    figures: s
      ? [
          { label: tIn(l, "ev_cook_fig_norm"), value: percent(sPct), bad: isBad(sPct) },
          { label: tIn(l, "ev_cook_fig_count"), value: tIn(l, "ev_cook_of", { on: s.on_time, n: s.orders }), bad: false },
          { label: tIn(l, "ev_cook_fig_median"), value: waitText(s.median_wait_sec, l), bad: false },
        ]
      : [],
    explain: tIn(l, "ev_cook_explain", { hall: d.norms.hall_min, del: d.norms.delivery_min }),
    scale: d.scale ? tIn(l, "ev_cook_scale", { floor: threshold(d.scale.floor), target: threshold(d.scale.target) }) : null,
    issue: s && d.data_issue ? tIn(l, ISSUE_KEY[d.data_issue]) : null,
    days: d.days.map((x) => {
      const p = pctOf(x.on_time, x.orders);
      return {
        label: dayMonth(x.day, l),
        count: tIn(l, "ev_cook_day_of", { on: x.on_time, n: x.orders }),
        median: tIn(l, "ev_cook_day_median", { t: waitText(x.median_wait_sec, l) }),
        onTime: percent(p),
        bar: Math.max(4, Math.round(p)),
        bad: isBad(p),
      };
    }),
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
