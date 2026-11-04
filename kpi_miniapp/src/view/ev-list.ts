// Модель экрана «Мои сотрудники» оценщика: фильтры, порядок, подписи. Без DOM.
import type { EvEmployee, EvEmployees, EvStatus } from "@backend/modules/kpi/tg-app/ev-types";
import { dayMonth, pct1 } from "../format";
import type { Key, Lang } from "../i18n";
import { monthName, tIn } from "../i18n";
import { hashOf } from "../route";

export interface EvFilter { terminal_id: string | null; card_id: string | null; status: "all" | EvStatus; search: string }
export interface EvRowVM { id: string; name: string; sub: string; chip: { text: string; tone: "ok" | "wait" | "warn" }; late: string | null; score: string | null; hash: string }
export interface EvListVM {
  title: string; info: string; closed: boolean;
  branches: { id: string | null; label: string }[]; showBranch: boolean;
  cards: { id: string | null; label: string }[]; showCard: boolean;
  statuses: { value: "all" | EvStatus; label: string; count: number }[];
  rows: EvRowVM[]; counter: string; empty: "ev_empty" | "ev_empty_filter" | null;
}

const NBSP = " ";
const STATUSES: ("all" | EvStatus)[] = ["all", "none", "draft", "submitted", "disputed"];
const ST_KEY: Record<"all" | EvStatus, Key> = { all: "ev_st_all", none: "ev_st_none", draft: "ev_st_draft", submitted: "ev_st_submitted", disputed: "ev_st_disputed" };

const matches = (e: EvEmployee, s: "all" | EvStatus): boolean =>
  s === "all" ? true : s === "disputed" ? e.open_dispute : s === "submitted" ? e.review_status === "submitted" : e.review_status === s;

// Все слова поиска входят подстрокой в «Фамилия Имя», без регистра.
function byName(e: EvEmployee, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${e.last_name} ${e.first_name}`.toLowerCase();
  return words.every((w) => hay.indexOf(w) >= 0);
}

export function evListView(d: EvEmployees, f: EvFilter, l: Lang, nowMs: number): EvListVM {
  const base = d.items.filter((e) => (!f.terminal_id || e.terminal_id === f.terminal_id) && (!f.card_id || e.card_id === f.card_id) && byName(e, f.search));
  const shown = base.filter((e) => matches(e, f.status));
  // Не оценённые и черновики первыми: им нужно внимание. Порядок сервера внутри групп сохраняется.
  const sorted = [...shown.filter((e) => e.review_status !== "submitted"), ...shown.filter((e) => e.review_status === "submitted")];

  const rows: EvRowVM[] = sorted.map((e) => {
    const chip: EvRowVM["chip"] = e.open_dispute
      ? { text: tIn(l, "ev_chip_disputed"), tone: "warn" }
      : e.review_status === "submitted"
        ? { text: tIn(l, "ev_chip_submitted"), tone: "ok" }
        : { text: tIn(l, e.review_status === "draft" ? "ev_chip_draft" : "ev_chip_none"), tone: "wait" };
    return {
      id: e.id,
      name: `${e.last_name} ${e.first_name}`.trim(),
      sub: [e.position, e.terminal_name].filter((x): x is string => !!x).join(" · "),
      chip,
      late: e.late ? tIn(l, "ev_late") : null,
      score: e.review_status === "submitted" && e.score_pct !== null ? `${pct1(e.score_pct)}${NBSP}%` : null,
      hash: hashOf({ name: "ev_review", period: d.period, employee_id: e.id }),
    };
  });

  const info =
    d.period_status === "closed"
      ? tIn(l, "ev_closed")
      : nowMs < Date.parse(d.submit_opens_at)
        ? tIn(l, "ev_opens", { date: dayMonth(d.submit_opens_at, l) })
        : tIn(l, "ev_deadline", { date: dayMonth(d.review_deadline, l) });

  return {
    title: tIn(l, "ev_list_title", { month: monthName(d.period, "nom", l) }),
    info,
    closed: d.period_status === "closed",
    branches: [{ id: null, label: tIn(l, "ev_f_all_branches") }, ...d.terminals.map((x) => ({ id: x.id, label: x.name }))],
    showBranch: d.terminals.length > 1,
    cards: [{ id: null, label: tIn(l, "ev_f_all_cards") }, ...d.cards.map((x) => ({ id: x.id, label: x.title }))],
    showCard: d.cards.length > 1,
    statuses: STATUSES.map((value) => ({ value, label: tIn(l, ST_KEY[value]), count: base.filter((e) => matches(e, value)).length })),
    rows,
    counter: tIn(l, "ev_counter", { shown: rows.length, total: d.items.length }),
    empty: d.items.length === 0 ? "ev_empty" : rows.length === 0 ? "ev_empty_filter" : null,
  };
}
