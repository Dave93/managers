// «Выданные выходные» оценщика как данные (без DOM): строки, статусы, право отмены.
import type { EvDaysOff } from "@backend/modules/kpi/tg-app/ev-types";
import type { Lang } from "../i18n";
import { monthName, tIn } from "../i18n";
import { hashOf } from "../route";
import { capFirst } from "../util";
import { dayLabel } from "./attendance";
import { reasonLabel } from "./ev-dayoff";

export interface EvDayOffVM {
  id: string; who: string; day: string; reason: string;
  status: { text: string; tone: "active" | "muted" }; canCancel: boolean;
}

export interface EvDaysOffNavVM { label: string; hash: string; aria: string }

/** Месяц «YYYY-MM-01» со сдвигом на n месяцев, через границу года тоже. */
function shiftMonth(period: string, n: number): string {
  const idx = Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1 + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
}

// Соседи показываются всегда, а не только с данными: выходной выдают на месяц вперёд и назад, и отменить его
// нужно из того месяца, куда он выдан. Год в подписи — когда сосед в другом году.
function navOf(period: string, n: -1 | 1, l: Lang): EvDaysOffNavVM {
  const m = shiftMonth(period, n);
  const name = capFirst(monthName(m, "nom", l));
  return { label: m.slice(0, 4) === period.slice(0, 4) ? name : `${name} ${m.slice(0, 4)}`, hash: hashOf({ name: "ev_daysoff", period: m }), aria: tIn(l, n < 0 ? "ev_daysoff_prev" : "ev_daysoff_next") };
}

export function evDaysOffView(
  d: EvDaysOff,
  l: Lang
): { title: string; month: string; prev: EvDaysOffNavVM; next: EvDaysOffNavVM; items: EvDayOffVM[]; empty: boolean; closed: boolean } {
  const items = d.items.map((x): EvDayOffVM => ({
    id: x.id,
    who: [x.employee_name, x.terminal_name].filter((v): v is string => !!v).join(" · "),
    day: dayLabel(x.day, l),
    // У «другой» причины важнее текст управляющего; без него — подпись причины.
    reason: x.reason_code === "other" && x.reason_text ? x.reason_text : reasonLabel(x.reason_code, l),
    status: x.status === "cancelled" ? { text: tIn(l, "ev_daysoff_cancelled"), tone: "muted" } : { text: tIn(l, "ev_daysoff_active"), tone: "active" },
    canCancel: x.can_cancel,
  }));
  return {
    title: tIn(l, "ev_daysoff_title", { month: monthName(d.period, "nom", l) }),
    month: `${capFirst(monthName(d.period, "nom", l))} ${d.period.slice(0, 4)}`,
    prev: navOf(d.period, -1, l),
    next: navOf(d.period, 1, l),
    items,
    empty: items.length === 0,
    closed: d.period_status === "closed",
  };
}
