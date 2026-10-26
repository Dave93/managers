// Главный экран и история мини-приложения «Мой KPI» (решения 6–11 и 22). «Сейчас» приходит аргументом.
// Ответы собираются поле за полем: строки базы целиком наружу не уходят (оценщик, комментарий HR).
import { employees, kpi_card_items, kpi_raise_decisions, kpi_review_items, kpi_violations, staff_roles } from "backend/drizzle/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { loadDirectory } from "../directory";
import { KpiError } from "../errors";
import { laggingEvaluators } from "../periods";
import { getTiers } from "../raises";
import { quarterRow, type KpiSettings } from "../rules";
import { loadSettings } from "../settings";
import { addMonths, currentReviewPeriod, quarterMonths, quarterStart, reviewDeadline, submitOpensAt, type Period } from "../time";
import type { KpiTgPrincipal } from "./ctx";
import { reviewDispute, submittedReviews, type SubmittedReview } from "./load";
import { lostItems, monthState, quarterEnded, raiseHint, raiseQuarter } from "./rules";
import type {
  TgEmployeeHome,
  TgEvaluatorCard,
  TgHistory,
  TgHistoryQuarter,
  TgHome,
  TgMonth,
  TgMonthCard,
  TgPendingMonth,
  TgQuarterResult,
  TgRaiseCard,
  TgRole,
} from "./types";

// Ссылка оценщика в админку (решение 15): KPI_ADMIN_URL — только схема и хост, хвостовой "/" срезается.
// Не задана или с путём, запросом, без схемы — null, и клиент ссылку не рисует.
export function adminReviewsUrl(): string | null {
  const m = /^(https?:\/\/[^/\s?#@]+)\/?$/i.exec((process.env.KPI_ADMIN_URL ?? "").trim());
  return m ? `${m[1]}/ru/kpi/reviews` : null;
}

type DecisionFact = { status: string; approved_amount: string | null };

// Что известно о сотруднике за 4 квартала: отправленные оценки и строки решений о прибавке.
type Facts = {
  s: KpiSettings;
  R: Period; // отчётный месяц
  at: Date;
  reviews: Map<Period, SubmittedReview>;
  decisions: Map<Period, DecisionFact>;
};

async function loadFacts(db: DbLike, employeeId: string, s: KpiSettings, R: Period, at: Date): Promise<Facts> {
  // Квартал отчётного месяца и три прошлых; черновики submittedReviews не читает.
  const from = addMonths(quarterStart(R), -9);
  const reviews = await submittedReviews(db, employeeId, from);
  // Только статус и сумма: комментарий HR не читаем вовсе.
  const rows = await db
    .select({
      quarter_start: kpi_raise_decisions.quarter_start,
      status: kpi_raise_decisions.status,
      approved_amount: kpi_raise_decisions.approved_amount,
    })
    .from(kpi_raise_decisions)
    .where(and(eq(kpi_raise_decisions.employee_id, employeeId), gte(kpi_raise_decisions.quarter_start, from)));
  const decisions = new Map<Period, DecisionFact>();
  for (const r of rows) decisions.set(r.quarter_start, { status: r.status, approved_amount: r.approved_amount });
  return { s, R, at, reviews, decisions };
}

// Решение HR — только approved или rejected (решение 22); proposed и insufficient появляются после «Рассчитать» у всех.
function hrDecision(d: DecisionFact | undefined): { amount: number } | null {
  if (d?.status === "approved") return { amount: Number(d.approved_amount ?? 0) };
  if (d?.status === "rejected") return { amount: 0 };
  return null;
}

function monthsOf(q: Period, f: Facts): TgMonth[] {
  return quarterMonths(q).map((p) => monthState(p, f.R, f.at, f.reviews.get(p) ?? null));
}

// Средний по оценённым месяцам, тем же round2, что при начислении; от шкалы и минимума он не зависит.
function avgOf(months: TgMonth[]): number | null {
  return quarterRow(months.map((m) => (m.state === "scored" ? m.score_pct : null)), [], 0).avg_pct;
}

// Решение 11: квартал отчётного месяца и три прошлых, новые сверху. Квартал есть, если в нём
// отправленная оценка или строка решения; квартал отчётного месяца — ещё и при наличии карты.
function historyOf(f: Facts, hasCard: boolean): TgHistoryQuarter[] {
  const q0 = quarterStart(f.R);
  const out: TgHistoryQuarter[] = [];
  for (let i = 0; i < 4; i++) {
    const q = addMonths(q0, -3 * i);
    const scored = quarterMonths(q).some((p) => f.reviews.has(p));
    if (!scored && !f.decisions.has(q) && !(i === 0 && hasCard)) continue;
    const months = monthsOf(q, f);
    const hr = hrDecision(f.decisions.get(q));
    const result: TgQuarterResult = hr
      ? { kind: "decided", amount: hr.amount }
      : quarterEnded(q, f.R)
        ? { kind: "waiting_hr" }
        : { kind: "running" };
    out.push({ quarter_start: q, months, avg_pct: avgOf(months), result });
  }
  return out;
}

async function activeViolations(db: DbLike, employeeId: string, period: Period): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(kpi_violations)
    .where(and(eq(kpi_violations.employee_id, employeeId), eq(kpi_violations.period, period), eq(kpi_violations.status, "active")));
  return Number(row?.n ?? 0);
}

// Карточка оценённого месяца. sort — из карты оценки; пункта в карте нет — после остальных (решение 20).
async function monthCard(db: DbLike, r: SubmittedReview, f: Facts): Promise<TgMonthCard> {
  const items = await db
    .select({
      item_id: kpi_review_items.item_id,
      title_ru: kpi_review_items.title_ru,
      title_uz: kpi_review_items.title_uz,
      score: kpi_review_items.score,
      sort: kpi_card_items.sort,
    })
    .from(kpi_review_items)
    .leftJoin(kpi_card_items, and(eq(kpi_card_items.id, kpi_review_items.item_id), eq(kpi_card_items.card_id, r.card_id)))
    .where(eq(kpi_review_items.review_id, r.id));
  const { dispute, status } = await reviewDispute(db, r, f.at, f.s);
  return {
    period: r.period,
    review_id: r.id,
    score_pct: r.score_pct,
    status,
    dispute,
    lost: lostItems(items.map((i) => ({ ...i, sort: i.sort ?? Number.MAX_SAFE_INTEGER }))),
  };
}

// Карточка прибавки: квартал по решению 9, подсказка по правилам раздела 5 спеки.
async function raiseCard(db: DbLike, f: Facts): Promise<TgRaiseCard> {
  const tiers = await getTiers(db);
  const q = raiseQuarter(f.R, (x) => quarterMonths(x).some((p) => f.reviews.has(p)) || f.decisions.has(x));
  const months = monthsOf(q, f);
  const hint = raiseHint({
    months,
    tiers,
    minMonths: f.s.raise_min_months,
    ended: quarterEnded(q, f.R),
    decision: hrDecision(f.decisions.get(q)),
  });
  return {
    quarter_start: q,
    tiers: [...tiers].sort((a, b) => a.min_pct - b.min_pct).map((t) => ({ min_pct: t.min_pct, amount: t.amount })),
    avg_pct: avgOf(months),
    months,
    hint,
  };
}

async function employeeHome(db: DbLike, employeeId: string, s: KpiSettings, R: Period, at: Date): Promise<TgEmployeeHome> {
  const [dir] = await loadDirectory(db, { employeeIds: [employeeId], includeInactive: true });
  // Строки сотрудника нет — сессия не про него: клиент войдёт заново и получит свой отказ.
  if (!dir) throw new KpiError(401, "unauthorized");
  const [pos] = await db
    .select({ name_ru: staff_roles.name_ru, name_uz: staff_roles.name_uz })
    .from(employees)
    .innerJoin(staff_roles, eq(staff_roles.id, employees.staff_role_id))
    .where(eq(employees.id, employeeId));
  const f = await loadFacts(db, employeeId, s, R, at);
  const hasCard = dir.card_id !== null;

  let pending: TgPendingMonth | null = null;
  let month: TgMonthCard | null = null;
  let raise: TgRaiseCard | null = null;
  if (hasCard) {
    // Решение 10: главный месяц — отчётный, если по нему есть отправленная оценка (балл может быть null),
    // иначе прошлый. Короткая карточка — только когда у отчётного нет отправленной оценки.
    const reported = f.reviews.get(R) ?? null;
    const main = reported ?? f.reviews.get(addMonths(R, -1)) ?? null;
    if (!reported) {
      pending = {
        period: R,
        submit_opens_at: submitOpensAt(R).toISOString(),
        review_deadline: reviewDeadline(R, s.review_deadline_day).toISOString(),
        violations: await activeViolations(db, employeeId, R),
      };
    }
    if (main) month = await monthCard(db, main, f);
    raise = await raiseCard(db, f);
  }
  const vPeriod = month?.period ?? R;
  return {
    first_name: dir.first_name,
    last_name: dir.last_name,
    position_ru: pos?.name_ru ?? null,
    position_uz: pos?.name_uz ?? null,
    terminal_name: dir.terminal_name,
    has_card: hasCard,
    pending,
    month,
    raise,
    violations: { period: vPeriod, count: await activeViolations(db, employeeId, vPeriod) },
    has_history: historyOf(f, hasCard).length > 0,
  };
}

export async function homeFor(db: DbLike, p: KpiTgPrincipal, at: Date): Promise<TgHome> {
  const s = await loadSettings(db);
  const R = currentReviewPeriod(at, s.review_deadline_day);
  const roles: TgRole[] = [];
  if (p.employee_id) roles.push("employee");
  if (p.user_id) roles.push("evaluator");

  let evaluator: TgEvaluatorCard | null = null;
  if (p.user_id) {
    const userId = p.user_id;
    const lag = (await laggingEvaluators(db, R)).find((l) => l.user_id === userId);
    evaluator = {
      period: R,
      pending: lag?.pending ?? 0,
      review_deadline: reviewDeadline(R, s.review_deadline_day).toISOString(),
      admin_url: adminReviewsUrl(),
    };
  }
  const employee = p.employee_id ? await employeeHome(db, p.employee_id, s, R, at) : null;
  return { lang: p.lang, roles, evaluator, employee };
}

export async function historyFor(db: DbLike, employeeId: string, at: Date): Promise<TgHistory> {
  const s = await loadSettings(db);
  const R = currentReviewPeriod(at, s.review_deadline_day);
  const [dir] = await loadDirectory(db, { employeeIds: [employeeId], includeInactive: true });
  const f = await loadFacts(db, employeeId, s, R, at);
  return { quarters: historyOf(f, (dir?.card_id ?? null) !== null) };
}
