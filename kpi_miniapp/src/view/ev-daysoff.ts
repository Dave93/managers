// «Выданные выходные» оценщика как данные (без DOM): строки, статусы, право отмены.
import type { EvDaysOff } from "@backend/modules/kpi/tg-app/ev-types";
import type { Lang } from "../i18n";
import { monthName, tIn } from "../i18n";
import { dayLabel } from "./attendance";
import { reasonLabel } from "./ev-dayoff";

export interface EvDayOffVM {
  id: string; who: string; day: string; reason: string;
  status: { text: string; tone: "active" | "muted" }; canCancel: boolean;
}

export function evDaysOffView(d: EvDaysOff, l: Lang): { title: string; items: EvDayOffVM[]; empty: boolean; closed: boolean } {
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
    items,
    empty: items.length === 0,
    closed: d.period_status === "closed",
  };
}
