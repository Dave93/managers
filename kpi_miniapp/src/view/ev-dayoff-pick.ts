// Экран «Кому выдать выходной» как данные (без DOM): фильтр по филиалу и имени, подписи строк. Сотрудники приходят
// со всех филиалов оценщика, с картой и без: выходной выдаёт управляющий филиала, карта не важна.
import type { EvDayOffEmployees } from "@backend/modules/kpi/tg-app/ev-types";
import type { Lang } from "../i18n";
import { tIn } from "../i18n";
import { hashOf } from "../route";

export interface DayOffPickFilter { terminal_id: string | null; search: string }
export interface DayOffPickRowVM { id: string; name: string; sub: string; hash: string }
export interface DayOffPickVM {
  title: string;
  branches: { id: string | null; label: string }[]; showBranch: boolean;
  rows: DayOffPickRowVM[]; counter: string; empty: "ev_dayoff_pick_empty" | "ev_empty_filter" | null;
}

// Все слова поиска входят подстрокой в «Фамилия Имя», без регистра.
function byName(e: { last_name: string; first_name: string }, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${e.last_name} ${e.first_name}`.toLowerCase();
  return words.every((w) => hay.indexOf(w) >= 0);
}

export function dayOffPickView(d: EvDayOffEmployees, f: DayOffPickFilter, l: Lang): DayOffPickVM {
  const shown = d.items.filter((e) => (!f.terminal_id || e.terminal_id === f.terminal_id) && byName(e, f.search));
  const rows: DayOffPickRowVM[] = shown.map((e) => ({
    id: e.id,
    name: `${e.last_name} ${e.first_name}`.trim(),
    sub: [e.position, e.terminal_name].filter((x): x is string => !!x).join(" · "),
    hash: hashOf({ name: "ev_dayoff", employee_id: e.id }),
  }));
  return {
    title: tIn(l, "ev_dayoff_pick_title"),
    branches: [{ id: null, label: tIn(l, "ev_f_all_branches") }, ...d.terminals.map((x) => ({ id: x.id, label: x.name }))],
    showBranch: d.terminals.length > 1,
    rows,
    counter: tIn(l, "ev_counter", { shown: rows.length, total: d.items.length }),
    empty: d.items.length === 0 ? "ev_dayoff_pick_empty" : rows.length === 0 ? "ev_empty_filter" : null,
  };
}
