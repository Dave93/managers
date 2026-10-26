// Главный экран как данные (без DOM): что и в каком порядке рисует screens/home.ts.
// Порядок блоков — макет home-layout-v3.html: шапка, оценщик, неоценённый месяц,
// оценённый месяц, прибавка, строки-ссылки.
//
// Язык передаётся явно: экран строит вид от lang(), а не от d.lang, иначе старая
// копия из кэша после смены языка вернула бы прежний.
import type { TgDisputeInfo, TgEmployeeHome, TgHome, TgMonth, TgRaiseCard, TgReviewStatus } from "@backend/modules/kpi/tg-app/types";
import { dayMonth, ddmm, initials, pct1, sumShort, trackPos } from "../format";
import { raiseBadge, hintLines } from "../hint";
import { type Lang, monthName, quarterTitle, ruPlural, tIn } from "../i18n";
import { hashOf } from "../route";
import { capFirst } from "../util";

const NBSP = "\u00a0";
const DASH = "—";

export interface HomeVM {
  header: { initials: string; name: string; sub: string } | null; // sub: «должность · филиал», пустые части выпадают
  evaluator: { text: string; link: string | null } | null;
  pending: { title: string; when: string; violations: string; hash: string } | null;
  month: {
    title: string;
    chip: { text: string; tone: "ok" | "wait" | "warn" };
    score: string;
    disputeLine: string;
    lost: { title: string; score: string }[];
    lostNone: boolean;
    hash: string;
  } | null;
  raise: {
    title: string;
    badge: { text: string; tone: "prelim" | "ok" | "muted" };
    ticks: { pct: string; amount: string; at: number }[];
    marker: { label: string; at: number } | null;
    months: { label: string; value: string; current: boolean }[];
    lines: string[];
  } | null;
  links: { text: string; count: string | null; hash: string }[];
  noCard: boolean;
}

const STATUS_KEY = {
  ready: "st_ready",
  dispute_open: "st_dispute_open",
  dispute_resolved: "st_dispute_resolved",
  changed: "st_changed",
} as const;

function chipOf(s: TgReviewStatus, l: Lang): { text: string; tone: "ok" | "wait" | "warn" } {
  return { text: tIn(l, STATUS_KEY[s]), tone: s === "ready" ? "ok" : s === "dispute_open" ? "warn" : "wait" };
}

/** Строка про спор под баллом. Для оценки «отменено» не бывает — строки нет. */
function disputeLine(d: TgDisputeInfo, l: Lang): string {
  switch (d.state) {
    case "can":
      return tIn(l, "dsp_can", { date: dayMonth(d.deadline, l) });
    case "open":
      return d.opened_at ? tIn(l, "dsp_open", { date: dayMonth(d.opened_at, l) }) : "";
    case "window_closed":
      return tIn(l, "dsp_window_closed");
    case "period_closed":
      return tIn(l, "dsp_period_closed");
    case "cancelled":
      return "";
  }
}

const routeHash = (name: "review" | "violations", period: string): string => hashOf({ name, period });

function header(e: TgEmployeeHome, l: Lang): HomeVM["header"] {
  const position = l === "ru" ? e.position_ru : e.position_uz;
  const sub = [position, e.terminal_name].filter((x): x is string => !!x && x.trim() !== "").join(" · ");
  return { initials: initials(e.first_name, e.last_name), name: `${e.first_name} ${e.last_name}`.trim(), sub };
}

/** Порог шкалы: целый без десятичной («85 %»), дробный — с одной («87,5 %»). */
const tickPct = (min: number): string => `${pct1(min).replace(/,0$/, "")}${NBSP}%`;

/** Значение плитки месяца в строке квартала (решение 9). */
function monthValue(m: TgMonth, firstUpcoming: boolean, l: Lang): string {
  switch (m.state) {
    case "scored":
      return m.score_pct === null ? DASH : pct1(m.score_pct);
    case "pending":
      return tIn(l, "m_pending");
    case "not_rated":
      return tIn(l, "m_not_rated");
    case "upcoming":
      return firstUpcoming ? tIn(l, "m_upcoming", { ddmm: ddmm(m.opens_at) }) : DASH;
  }
}

function raise(r: TgRaiseCard, current: string | null, l: Lang): HomeVM["raise"] {
  const tiers = r.tiers.slice().sort((a, b) => a.min_pct - b.min_pct);
  const mins = tiers.map((x) => x.min_pct);
  let seenUpcoming = false;
  return {
    title: tIn(l, "raise_title", { quarter: quarterTitle(r.quarter_start, l) }),
    badge: raiseBadge(r.hint, l),
    ticks: tiers.map((x, i) => ({ pct: tickPct(x.min_pct), amount: sumShort(x.amount, l), at: (i + 1) / (tiers.length + 1) })),
    // Средний защищён от перехода ступени (решение 6): «89,9», а не «90,0» рядом с суммой 85 %.
    marker: r.avg_pct === null ? null : { label: `${pct1(r.avg_pct, mins)}${NBSP}%`, at: trackPos(r.avg_pct, mins) },
    months: r.months.map((m) => {
      const first = m.state === "upcoming" && !seenUpcoming;
      if (m.state === "upcoming") seenUpcoming = true;
      return { label: capFirst(monthName(m.period, "nom", l)), value: monthValue(m, first, l), current: m.period === current };
    }),
    lines: hintLines(r.hint, l),
  };
}

export function homeView(d: TgHome, l: Lang, nowMs: number): HomeVM {
  const ev = d.evaluator;
  const evaluator: HomeVM["evaluator"] = ev
    ? {
        text:
          ev.pending > 0
            ? tIn(l, "eval_pending", {
                n: ev.pending,
                // В узбекском шаблоне склонения нет — подстановка просто не используется.
                employees: ruPlural(ev.pending, ["сотрудника", "сотрудников", "сотрудников"]),
                date: dayMonth(ev.review_deadline, l),
              })
            : tIn(l, "eval_done"),
        link: ev.admin_url,
      }
    : null;

  const e = d.employee;
  if (!e) return { header: null, evaluator, pending: null, month: null, raise: null, links: [], noCard: false };

  const history = { text: tIn(l, "link_history"), count: null, hash: hashOf({ name: "history" }) };

  // Без карты: вместо карточек одна строка «не настроен» и история, если она есть.
  if (!e.has_card) {
    return { header: header(e, l), evaluator, pending: null, month: null, raise: null, links: e.has_history ? [history] : [], noCard: true };
  }

  const p = e.pending;
  const pending: HomeVM["pending"] = p
    ? {
        title: tIn(l, "pending_title", { month: monthName(p.period, "nom", l) }),
        // Решение 10: до открытия оценок — «с 20 ноября», после — «до 7 декабря».
        when:
          nowMs < Date.parse(p.submit_opens_at)
            ? tIn(l, "pending_from", { date: dayMonth(p.submit_opens_at, l) })
            : tIn(l, "pending_until", { date: dayMonth(p.review_deadline, l) }),
        violations: tIn(l, "pending_viol", { month: monthName(p.period, "prep", l), n: p.violations }),
        hash: routeHash("violations", p.period),
      }
    : null;

  const m = e.month;
  const month: HomeVM["month"] = m
    ? {
        title: capFirst(monthName(m.period, "nom", l)),
        chip: chipOf(m.status, l),
        score: m.score_pct === null ? DASH : pct1(m.score_pct),
        disputeLine: disputeLine(m.dispute, l),
        lost: m.lost.slice(0, 3).map((x) => ({ title: l === "ru" ? x.title_ru : x.title_uz || x.title_ru, score: String(Math.round(x.score)) })),
        lostNone: m.lost.length === 0,
        hash: routeHash("review", m.period),
      }
    : null;

  const links: HomeVM["links"] = [
    {
      text: tIn(l, "link_viol", { month: monthName(e.violations.period, "prep", l) }),
      count: String(e.violations.count),
      hash: routeHash("violations", e.violations.period),
    },
  ];
  if (e.has_history || m) links.push(history);

  // Решение 9: текущим подсвечивается отчётный месяц.
  const current = p ? p.period : m ? m.period : null;
  return {
    header: header(e, l),
    evaluator,
    pending,
    month,
    raise: e.raise ? raise(e.raise, current, l) : null,
    links,
    noCard: false,
  };
}
