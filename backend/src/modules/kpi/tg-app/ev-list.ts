// Список сотрудников оценщика в мини-приложении: строки админского listEmployeeRows под суженным Actor,
// то есть только сотрудники из назначений оценщика. Фильтры (филиал, карта, статус) клиент строит сам.
import { parsePeriod, type Actor, type DbLike } from "../access";
import { listEmployeeRows } from "../employees";
import { deadlinesOf, isPeriodClosed } from "../periods";
import { loadSettings } from "../settings";
import { currentReviewPeriod } from "../time";
import type { EvEmployee, EvEmployees } from "./ev-types";

const byName = (a: string, b: string) => a.localeCompare(b, "ru");

// period не задан (undefined) — отчётный месяц; всё остальное проверяет parsePeriod (пустая строка — 422 bad_period).
export async function evEmployees(db: DbLike, actor: Actor, period: unknown, at: Date): Promise<EvEmployees> {
  const settings = await loadSettings(db);
  const p = period === undefined ? currentReviewPeriod(at, settings.review_deadline_day) : parsePeriod(period);
  const rows = await listEmployeeRows(db, actor, { period: p });
  const d = deadlinesOf(p, settings);

  // Справочники фильтров — только то, что есть в строках: чужих филиалов и карт в них нет.
  // Филиал без названия (нет строки в terminals) в фильтр не попадает, сотрудник в списке остаётся.
  const terminals = new Map<string, string>();
  const cards = new Map<string, string>();
  const items: EvEmployee[] = rows.map((r) => {
    if (r.terminal_name !== null) terminals.set(r.terminal_id, r.terminal_name);
    if (r.card) cards.set(r.card.id, r.card.title_ru);
    return {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      terminal_id: r.terminal_id,
      terminal_name: r.terminal_name,
      position: r.staff_role_name,
      card_id: r.card?.id ?? null,
      card_title: r.card?.title_ru ?? null,
      review_status: r.review?.status ?? "none",
      // Балл у черновика не отдаём: у него он промежуточный.
      score_pct: r.review?.status === "submitted" ? r.review.score_pct : null,
      late: r.review?.late ?? false,
      open_dispute: r.open_dispute,
      can_evaluate: r.can_evaluate,
    };
  });

  return {
    period: p,
    period_status: (await isPeriodClosed(db, p)) ? "closed" : "open",
    submit_opens_at: d.submit_opens_at,
    review_deadline: d.review_deadline,
    terminals: [...terminals].map(([id, name]) => ({ id, name })).sort((a, b) => byName(a.name, b.name) || a.id.localeCompare(b.id)),
    cards: [...cards].map(([id, title]) => ({ id, title })).sort((a, b) => byName(a.title, b.title) || a.id.localeCompare(b.id)),
    items,
  };
}
