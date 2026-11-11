// Карточка сотрудника для оценщика в мини-приложении. Данные собирает админский loadEmployeeCard под суженным
// Actor оценщика (видимость по назначениям там же), здесь — только сужение ответа до EvCard: без прибавки,
// сумм и служебных признаков HR.
import type { Actor, DbLike } from "../access";
import { parsePeriod } from "../access";
import { now } from "../clock";
import { KpiError } from "../errors";
import { loadEmployeeCard } from "../people";
import { periodOf } from "../time";
import type { EmployeeCard } from "../types";
import { employees } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import { loadSales } from "./ev-sales";
import type { EvCard, EvCardDay } from "./ev-types";

const TASHKENT_MS = 5 * 3600_000;

/** HH:MM по Ташкенту из метки времени; null — отметки нет. */
function hhmm(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms + TASHKENT_MS).toISOString().slice(11, 16);
}

/** Дни от старых к новым. Выходной главнее прогула, прогул главнее опоздания: как в карточке админки. */
function dayOf(d: EmployeeCard["attendance"]["days"][number]): EvCardDay {
  if (d.day_off) return { day: d.day, status: "dayoff", late_minutes: 0, check_in: null, check_out: null };
  if (d.absent) return { day: d.day, status: "absent", late_minutes: 0, check_in: null, check_out: null };
  return { day: d.day, status: d.late_minutes > 0 ? "late" : "ontime", late_minutes: d.late_minutes, check_in: hhmm(d.check_in), check_out: hhmm(d.check_out) };
}

export function evCardOf(c: EmployeeCard): EvCard {
  const e = c.employee;
  return {
    employee: { id: e.id, first_name: e.first_name, last_name: e.last_name, position: e.position, terminal_name: e.terminal_name, tab_number: e.tab_number, active: e.active, has_card: e.has_card },
    period: c.period,
    months: { prev: c.attendance.prev ? `${c.attendance.prev}-01` : null, next: c.attendance.next ? `${c.attendance.next}-01` : null },
    days: c.attendance.days.map(dayOf).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)),
    review: c.review
      ? { score_pct: c.review.score_pct, status: c.review.status, items: c.review.items.map((i) => ({ title_ru: i.title_ru, title_uz: i.title_uz, score: i.score, note: i.note })) }
      : null,
    violations: c.violations.items.map((v) => ({ id: v.id, item_title_ru: v.item_title_ru, item_title_uz: v.item_title_uz, occurred_at: v.occurred_at, comment: v.comment, status: v.status })),
    history: c.history.quarters.map((q) => ({
      quarter_start: q.quarter_start,
      avg_pct: q.avg_pct,
      months: q.months.map((m) => ({ period: m.period, state: m.state, score_pct: m.score_pct })),
    })),
    sales: null,
  };
}

// period не задан — текущий календарный месяц по Ташкенту (оценщик смотрит, как человек ходит сейчас);
// мусор — 422 bad_period. Чужой сотрудник неотличим от несуществующего: 404 not_found, как у остальных экранов оценщика.
export async function evCard(db: DbLike, actor: Actor, employeeId: string, period: unknown): Promise<EvCard> {
  const p = period === undefined ? periodOf(now()) : parsePeriod(period);
  let card: EvCard;
  try {
    card = evCardOf(await loadEmployeeCard(db, actor, employeeId, p));
  } catch (e) {
    if (e instanceof KpiError && e.status === 403) throw new KpiError(404, "not_found");
    throw e;
  }
  // Доступ к сотруднику уже проверен выше; продажи есть только у связанного с кассиром iiko.
  const [link] = await db.select({ cashier: employees.iiko_cashier_id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (link?.cashier) card.sales = await loadSales(db, link.cashier, p);
  return card;
}
