// Чистые правила мини-приложения «Мой KPI»: состояния месяцев, подсказка о прибавке, карточка месяца.
// Ни базы, ни часов: всё приходит аргументами.
import { quarterRow, raiseFor, type Tier } from "../rules";
import { addMonths, quarterStart, submitOpensAt, type Period } from "../time";
import type { TgDisputeState, TgLostItem, TgMonth, TgNextTier, TgRaiseHint, TgReviewStatus } from "./types";

// Средний балл, который нужен за оставшиеся месяцы, чтобы набрать порог; вверх до 0,1.
// Начисление даёт ступень при round2(avg) >= порог (половина вверх), в сотых это
// sumH >= n*thrH - n/2. Всё в целых числах: удваиваем, чтобы n/2 осталось целым, плавающего хвоста нет.
export function needPct(thresholdPct: number, scored: number[], remaining: number): number {
  const h = (x: number) => Math.round(x * 100);
  const n = scored.length + remaining;
  const num2 = 2 * (h(thresholdPct) * n - scored.reduce((a, s) => a + h(s), 0)) - n;
  return Math.ceil(num2 / (remaining * 20)) / 10;
}

// Состояние месяца квартала: оценён, ждёт оценки, ещё не открыт, не будет оценён
export function monthState(
  period: Period,
  reportPeriod: Period,
  at: Date,
  submitted: { score_pct: number | null } | null,
): TgMonth {
  const opens = submitOpensAt(period);
  let state: TgMonth["state"];
  let score: number | null = null;
  if (submitted && submitted.score_pct !== null) {
    state = "scored";
    score = submitted.score_pct;
  } else if (submitted || period < reportPeriod) {
    state = "not_rated";
  } else {
    state = at.getTime() >= opens.getTime() ? "pending" : "upcoming";
  }
  return { period, state, score_pct: score, opens_at: opens.toISOString() };
}

// Квартал кончился, когда отчётный месяц ушёл за его последний месяц
export function quarterEnded(quarter: Period, reportPeriod: Period): boolean {
  return addMonths(quarter, 2) < reportPeriod;
}

// Подсказка о прибавке. Ветки по порядку: решение HR, квартал кончился, k + |R| + |O| < min (impossible), k = 0, k < min, квартал идёт.
// openPast (|O|): прошлые месяцы квартала без отправленной оценки, которые HR ещё не закрыл. Оценку за них
// ещё могут прислать с опозданием (submitReview отказывает только по закрытому месяцу), а по months их не отличить
// от отправленной оценки без балла: оба not_rated. Поэтому число приходит отдельно.
export function raiseHint(i: {
  months: TgMonth[];
  tiers: Tier[];
  minMonths: number;
  ended: boolean;
  decision: { amount: number } | null;
  openPast: number;
}): TgRaiseHint {
  const { months, tiers, minMonths, ended, decision, openPast } = i;
  if (decision) return { kind: "decided", amount: decision.amount };
  const S = months.filter((m) => m.state === "scored");
  const scores = S.map((m) => m.score_pct as number);
  // R: отчётный и будущие месяцы без оценки. Прошлые неоценённые (not_rated) сюда не входят:
  // need и «сохранится» считаются только по R (решение 6), опоздавшие месяцы учитывает лишь ветка impossible.
  const R = months.filter((m) => m.state === "pending" || m.state === "upcoming").map((m) => m.period);
  const row = quarterRow(
    months.map((m) => (m.state === "scored" ? m.score_pct : null)),
    tiers,
    minMonths,
  );
  if (ended) return { kind: "waiting_hr", amount: row.suggested_amount };
  // Даже если оценят все оставшиеся месяцы и все открытые прошлые, оценённых будет меньше минимума: прибавки не будет
  if (S.length + R.length + openPast < minMonths) return { kind: "impossible", scored: S.length, min_months: minMonths };
  if (S.length === 0) return { kind: "none" };

  const avg = row.avg_pct as number;
  const asc = [...tiers].sort((a, b) => a.min_pct - b.min_pct);
  let cur = -1; // индекс текущей ступени в asc
  asc.forEach((t, idx) => {
    if (avg >= t.min_pct) cur = idx;
  });
  const amount = raiseFor(avg, tiers);
  const up = asc[cur + 1];
  let next: TgNextTier | null = null;
  if (up && R.length > 0) {
    const need = needPct(up.min_pct, scores, R.length);
    next =
      need <= 100
        ? { amount: up.amount, reachable: true, need_pct: need, periods: R }
        : { amount: up.amount, reachable: false };
  }
  if (S.length < minMonths) {
    return { kind: "too_few", scored: S.length, min_months: minMonths, keep_periods: S.map((m) => m.period), amount, next };
  }
  let keep: { need_pct: number; periods: string[] } | null = null;
  const curTier = asc[cur];
  if (curTier && curTier.amount > 0 && R.length > 0) {
    const need = needPct(curTier.min_pct, scores, R.length);
    if (need > 0) keep = { need_pct: need, periods: R };
  }
  return { kind: "running", amount, keep, next };
}

// Квартал карточки прибавки: квартал отчётного месяца; если в нём ещё нет оценок и решения,
// а в прошлом есть, то прошлый. has: в квартале есть отправленная оценка или решение.
export function raiseQuarter(reportPeriod: Period, has: (quarter: Period) => boolean): Period {
  const q = quarterStart(reportPeriod);
  const prev = addMonths(q, -3);
  return !has(q) && has(prev) ? prev : q;
}

// «Где потеряны баллы»: пункты ниже 100, худшие первыми, при равенстве по порядку в карте, не больше трёх
export function lostItems(
  items: { item_id: string; title_ru: string; title_uz: string; score: number | null; sort: number }[],
): TgLostItem[] {
  return items
    .filter((x): x is typeof x & { score: number } => x.score !== null && x.score < 100)
    .sort((a, b) => a.score - b.score || a.sort - b.sort)
    .slice(0, 3)
    .map((x) => ({ item_id: x.item_id, title_ru: x.title_ru, title_uz: x.title_uz, score: x.score }));
}

// Открытый спор, затем разобранный, затем изменения, иначе ready
export function reviewStatusOf(f: { open: boolean; resolved: boolean; changed: boolean }): TgReviewStatus {
  if (f.open) return "dispute_open";
  if (f.resolved) return "dispute_resolved";
  if (f.changed) return "changed";
  return "ready";
}

// Порядок веток: отменено, открыт, спор уже отклонён, период закрыт, окно спора вышло, иначе можно.
// rejected — по записи есть отклонённый спор (любой, не только последний разобранный).
export function disputeStateOf(f: {
  cancelled: boolean;
  open: boolean;
  rejected: boolean;
  periodClosed: boolean;
  deadline: Date;
  at: Date;
}): TgDisputeState {
  if (f.cancelled) return "cancelled";
  if (f.open) return "open";
  if (f.rejected) return "rejected";
  if (f.periodClosed) return "period_closed";
  if (f.at.getTime() > f.deadline.getTime()) return "window_closed";
  return "can";
}
