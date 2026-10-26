// «История» как данные (без DOM): что рисует screens/history.ts. Макет screens.html, экран 3:
// кварталы новыми сверху (не больше 4, как прислал сервер), в каждом итог, месяцы и средний.
// Оценённый месяц ведёт на свою «Вся оценка».
//
// Слова итога — из спеки 4.4: «идёт», «Ждём решения HR», «Утверждено +N сум», «Без прибавки».
// Порогов ступеней в истории нет, поэтому проценты — обычное округление pct1: защиты порога,
// как на главном (решение 6), здесь не из чего построить.
import type { TgHistory, TgHistoryQuarter, TgMonth, TgQuarterResult } from "@backend/modules/kpi/tg-app/types";
import { dayMonth, pct1, sum } from "../format";
import { type Lang, monthName, quarterTitle, tIn } from "../i18n";
import { hashOf } from "../route";
import { capFirst } from "../util";

const NBSP = "\u00a0";
const DASH = "—";

export interface QuarterVM {
  title: string; // «IV квартал 2026» / «2026-yil IV chorak»
  result: { text: string; tone: "ok" | "muted" | "wait" };
  months: { label: string; value: string; hash: string | null }[]; // hash — только у оценённого
  avg: string | null; // «96,3 %»; среднего нет — null
}

function resultOf(r: TgQuarterResult, l: Lang): QuarterVM["result"] {
  switch (r.kind) {
    case "running":
      return { text: tIn(l, "hist_running"), tone: "wait" };
    case "waiting_hr":
      return { text: tIn(l, "hist_waiting"), tone: "wait" };
    case "decided":
      return r.amount > 0 ? { text: tIn(l, "hist_approved", { sum: sum(r.amount) }), tone: "ok" } : { text: tIn(l, "hist_no_raise"), tone: "muted" };
  }
}

/** Значение месяца (решение 9): первый будущий — с какого числа оценят, следующие — «—». */
function monthValue(m: TgMonth, firstUpcoming: boolean, l: Lang): string {
  switch (m.state) {
    case "scored":
      return m.score_pct === null ? DASH : `${pct1(m.score_pct)}${NBSP}%`;
    case "pending":
      return tIn(l, "hist_pending");
    case "not_rated":
      return tIn(l, "m_not_rated");
    case "upcoming":
      return firstUpcoming ? tIn(l, "hist_upcoming", { date: dayMonth(m.opens_at, l) }) : DASH;
  }
}

function quarterView(q: TgHistoryQuarter, l: Lang): QuarterVM {
  let seenUpcoming = false;
  return {
    title: quarterTitle(q.quarter_start, l, true),
    result: resultOf(q.result, l),
    months: q.months.map((m) => {
      const first = m.state === "upcoming" && !seenUpcoming;
      if (m.state === "upcoming") seenUpcoming = true;
      return {
        label: capFirst(monthName(m.period, "nom", l)),
        value: monthValue(m, first, l),
        hash: m.state === "scored" ? hashOf({ name: "review", period: m.period }) : null,
      };
    }),
    avg: q.avg_pct === null ? null : `${pct1(q.avg_pct)}${NBSP}%`,
  };
}

export function historyView(h: TgHistory, l: Lang): { quarters: QuarterVM[]; empty: boolean } {
  return { quarters: h.quarters.map((q) => quarterView(q, l)), empty: h.quarters.length === 0 };
}
