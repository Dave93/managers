// Карточка сотрудника оценщика как данные (без DOM): что рисует screens/ev-card.ts.
// Справка об одном человеке: шапка, три числа за месяц и четыре раздела — посещаемость (итоги, календарь,
// отклонения), оценка, нарушения, история. Сумм прибавки в данных нет (сервер не отдаёт), поэтому
// и в виде их нет. Время и дата — по Ташкенту; метки дней строятся из «YYYY-MM-DD» без Date.
import type { EvCard, EvCardDay, EvCardDayStatus, EvCardMonth } from "@backend/modules/kpi/tg-app/ev-types";
import { dayMonth, pct1 } from "../format";
import type { Key, Lang } from "../i18n";
import { monthName, quarterTitle, tIn } from "../i18n";
import { hashOf } from "../route";
import { capFirst } from "../util";

const NBSP = " ";
const DASH = "—";
const TASHKENT_MS = 5 * 3600 * 1000;

export type CardTab = "attendance" | "review" | "violations" | "history";
export const CARD_TABS: CardTab[] = ["attendance", "review", "violations", "history"];
const TAB_KEY: Record<CardTab, Key> = { attendance: "ev_card_tab_att", review: "ev_card_tab_review", violations: "ev_card_tab_viol", history: "ev_card_tab_hist" };

const WEEKDAYS: Record<Lang, string[]> = { ru: ["пн", "вт", "ср", "чт", "пт", "сб", "вс"], uz: ["du", "se", "chor", "pay", "ju", "sha", "yak"] };

/** Число дней месяца «YYYY-MM-01». */
export function daysInPeriod(period: string): number {
  return new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
}

/** День недели дня месяца: 0 — понедельник … 6 — воскресенье. */
export function weekdayOf(period: string, day: number): number {
  return (new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, day)).getUTCDay() + 6) % 7;
}

/** Сегодняшний день по Ташкенту «YYYY-MM-DD». */
export function tashkentToday(nowMs: number): string {
  return new Date(nowMs + TASHKENT_MS).toISOString().slice(0, 10);
}

export interface CalCellVM {
  day: number;
  // pending — сегодня и позже, записи ещё нет и быть не должно; empty — прошедший день без записи
  state: EvCardDayStatus | "pending" | "empty";
  badge: string | null; // «+12» у опоздания
  aria: string; // «3 ноября, не вышел»
}
export interface DeviationVM { day: string; weekday: string; text: string; tone: "bad" | "warn" | "info"; times: string | null }
export interface SwitchVM { label: string; hash: string; aria: string }
export interface CardReviewVM {
  empty: string | null;
  score: string | null;
  status: string | null;
  items: { title: string; score: string; note: string | null }[];
}
export interface CardViolationVM { id: string; title: string; date: string; comment: string; cancelled: string | null }
export interface CardQuarterVM { title: string; months: { label: string; value: string }[]; avg: string | null }
export interface EvCardVM {
  name: string;
  sub: string;
  inactive: string | null;
  month: string; // «Ноябрь 2026»
  prev: SwitchVM | null;
  next: SwitchVM | null;
  figures: { label: string; value: string; tone: "bad" | "warn" | null }[];
  tabs: { value: CardTab; label: string; count: number | null }[];
  att: {
    empty: string | null;
    summary: { state: EvCardDayStatus | "none"; label: string; value: number }[];
    streak: string | null;
    weekdays: string[];
    lead: number; // пустых клеток до первого числа
    cells: CalCellVM[];
    deviations: DeviationVM[];
  };
  review: CardReviewVM;
  violations: { empty: string | null; items: CardViolationVM[] };
  history: { empty: string | null; quarters: CardQuarterVM[] };
}

const STATUS_TEXT: Record<Exclude<EvCardDayStatus, "ontime">, Key> = { late: "att_late", absent: "att_absent", dayoff: "att_day_off" };

function dayLabel(day: string, l: Lang): string {
  const n = Number(day.slice(8, 10));
  return l === "ru" ? `${n} ${monthName(day, "gen", "ru")}` : `${n}-${monthName(day, "gen", "uz")}`;
}

/** Самая длинная серия прогулов подряд по календарным дням (день без записи серию рвёт). */
export function absentStreak(days: readonly EvCardDay[]): number {
  let best = 0;
  let run = 0;
  let prev = "";
  for (const d of days) {
    const next = prev === "" ? "" : new Date(Date.parse(`${prev}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    run = d.status === "absent" ? (prev !== "" && next === d.day ? run + 1 : 1) : 0;
    prev = d.status === "absent" ? d.day : "";
    if (run > best) best = run;
  }
  return best;
}

/** Сосед по месяцам: с годом, если он не соседний по календарю или в другом году. */
function switchOf(shown: string, m: string | null, aria: Key, l: Lang, employeeId: string): SwitchVM | null {
  if (m === null) return null;
  const seq = (p: string): number => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
  const plain = Math.abs(seq(m) - seq(shown)) === 1 && m.slice(0, 4) === shown.slice(0, 4);
  const name = capFirst(monthName(m, "nom", l));
  return { label: plain ? name : `${name} ${m.slice(0, 4)}`, hash: hashOf({ name: "ev_card", employee_id: employeeId, period: m }), aria: tIn(l, aria) };
}

function attView(d: EvCard, l: Lang, today: string): EvCardVM["att"] {
  const total = daysInPeriod(d.period);
  const byDay = new Map<number, EvCardDay>();
  for (const x of d.days) byDay.set(Number(x.day.slice(8, 10)), x);
  const ym = d.period.slice(0, 8);
  const count = (s: EvCardDayStatus): number => d.days.filter((x) => x.status === s).length;
  const recorded = count("ontime") + count("late") + count("absent");
  // «Без отметки» — только прошедшие дни: будущие и сегодняшний ещё не должны иметь записи.
  let none = 0;
  const cells: CalCellVM[] = [];
  for (let n = 1; n <= total; n++) {
    const iso = `${ym}${String(n).padStart(2, "0")}`;
    const e = byDay.get(n);
    const label = dayLabel(iso, l);
    if (e) {
      const txt = e.status === "ontime" ? null : e.status === "late" ? tIn(l, "att_late", { n: e.late_minutes }) : tIn(l, STATUS_TEXT[e.status]);
      cells.push({ day: n, state: e.status, badge: e.status === "late" ? `+${e.late_minutes}` : null, aria: txt ? `${label}, ${txt}` : label });
    } else if (iso >= today) {
      cells.push({ day: n, state: "pending", badge: null, aria: label });
    } else {
      none++;
      cells.push({ day: n, state: "empty", badge: null, aria: label });
    }
  }
  const summary: EvCardVM["att"]["summary"] = [
    { state: "ontime", label: tIn(l, "ev_card_sum_ontime"), value: count("ontime") },
    { state: "late", label: tIn(l, "ev_card_fig_late"), value: count("late") },
    { state: "absent", label: tIn(l, "ev_card_fig_absent"), value: count("absent") },
    ...(count("dayoff") > 0 ? [{ state: "dayoff" as const, label: tIn(l, "att_day_off"), value: count("dayoff") }] : []),
    { state: "none", label: tIn(l, "ev_card_sum_none"), value: none },
  ];
  const streak = absentStreak(d.days);
  return {
    empty: recorded === 0 && count("dayoff") === 0 ? tIn(l, "att_empty") : null,
    summary,
    streak: streak >= 2 ? tIn(l, "ev_card_streak", { n: streak }) : null,
    weekdays: WEEKDAYS[l],
    lead: weekdayOf(d.period, 1),
    cells,
    deviations: d.days
      .filter((x) => x.status !== "ontime")
      .map((x) => ({
        day: dayLabel(x.day, l),
        weekday: WEEKDAYS[l][weekdayOf(d.period, Number(x.day.slice(8, 10)))] ?? "",
        text: x.status === "late" ? tIn(l, "att_late", { n: x.late_minutes }) : tIn(l, STATUS_TEXT[x.status as Exclude<EvCardDayStatus, "ontime">]),
        tone: x.status === "absent" ? ("bad" as const) : x.status === "late" ? ("warn" as const) : ("info" as const),
        times: x.status === "late" && x.check_in && x.check_out ? `${tIn(l, "att_in")} ${x.check_in} · ${tIn(l, "att_out")} ${x.check_out}` : null,
      })),
  };
}

const REVIEW_STATUS: Record<NonNullable<EvCard["review"]>["status"], Key> = { ready: "st_ready", dispute_open: "st_dispute_open", dispute_resolved: "st_dispute_resolved", changed: "st_changed" };

function reviewView(d: EvCard, l: Lang): CardReviewVM {
  if (!d.employee.has_card) return { empty: tIn(l, "ev_card_rev_nocard"), score: null, status: null, items: [] };
  const r = d.review;
  if (!r) return { empty: tIn(l, "ev_card_rev_none"), score: null, status: null, items: [] };
  return {
    empty: null,
    score: r.score_pct === null ? DASH : `${pct1(r.score_pct)}${NBSP}%`,
    status: tIn(l, REVIEW_STATUS[r.status]),
    items: r.items.map((i) => ({ title: l === "uz" && i.title_uz ? i.title_uz : i.title_ru, score: i.score === null ? DASH : String(i.score), note: i.note })),
  };
}

function monthValue(m: EvCardMonth, l: Lang): string {
  if (m.state === "scored") return m.score_pct === null ? DASH : `${pct1(m.score_pct)}${NBSP}%`;
  if (m.state === "pending") return tIn(l, "hist_pending");
  if (m.state === "not_rated") return tIn(l, "m_not_rated");
  return DASH;
}

export function evCardView(d: EvCard, l: Lang, nowMs: number): EvCardVM {
  const e = d.employee;
  const att = attView(d, l, tashkentToday(nowMs));
  const active = d.violations.filter((v) => v.status === "active").length;
  const count = (s: EvCardDayStatus): number => d.days.filter((x) => x.status === s).length;
  const none = d.days.length === 0;
  return {
    name: `${e.last_name} ${e.first_name}`.trim(),
    sub: [e.position, e.terminal_name, e.tab_number ? tIn(l, "ev_card_tab_no", { n: e.tab_number }) : null].filter((x): x is string => !!x).join(" · "),
    inactive: e.active ? null : tIn(l, "ev_card_inactive"),
    month: `${capFirst(monthName(d.period, "nom", l))} ${d.period.slice(0, 4)}`,
    prev: switchOf(d.period, d.months.prev, "att_prev", l, e.id),
    next: switchOf(d.period, d.months.next, "att_next", l, e.id),
    figures: [
      { label: tIn(l, "ev_card_fig_absent"), value: none ? DASH : String(count("absent")), tone: count("absent") > 0 ? "bad" : null },
      { label: tIn(l, "ev_card_fig_late"), value: none ? DASH : String(count("late")), tone: count("late") > 0 ? "warn" : null },
      { label: tIn(l, "ev_card_tab_viol"), value: String(active), tone: null },
    ],
    tabs: CARD_TABS.map((value) => ({ value, label: tIn(l, TAB_KEY[value]), count: value === "violations" && active > 0 ? active : null })),
    att,
    review: reviewView(d, l),
    violations: {
      empty: d.violations.length === 0 ? tIn(l, "ev_card_viol_none") : null,
      items: d.violations.map((v) => ({
        id: v.id,
        title: (l === "uz" && v.item_title_uz ? v.item_title_uz : v.item_title_ru) ?? "",
        date: dayMonth(v.occurred_at, l),
        comment: v.comment,
        cancelled: v.status === "cancelled" ? tIn(l, "viol_cancelled") : null,
      })),
    },
    history: {
      empty: d.history.length === 0 ? tIn(l, "hist_empty") : null,
      quarters: d.history.map((q) => ({
        title: quarterTitle(q.quarter_start, l, true),
        months: q.months.map((m) => ({ label: capFirst(monthName(m.period, "nom", l)), value: monthValue(m, l) })),
        avg: q.avg_pct === null ? null : `${pct1(q.avg_pct)}${NBSP}%`,
      })),
    },
  };
}
