// Общие фикстуры HTTP-тестов KPI. Импортировать только динамически и только
// внутри ветки «есть тестовое окружение»: tests/helpers/http падает без него при импорте.
import { randomUUID } from "node:crypto";
import { drizzleDb } from "backend/src/lib/db";
import type { DrizzleDB } from "@backend/lib/db";
import {
  employees,
  kpi_card_items,
  kpi_cards,
  kpi_disputes,
  kpi_employee_cards,
  kpi_evaluator_scopes,
  kpi_notifications,
  kpi_periods,
  kpi_raise_decisions,
  kpi_review_events,
  kpi_review_items,
  kpi_reviews,
  kpi_settings,
  kpi_violation_photos,
  kpi_violations,
  staff_roles,
} from "backend/drizzle/schema";
import { eq, like, sql } from "drizzle-orm";
import { callApi, ensureApp, type withSession } from "../../../../tests/helpers/http";

export type Session = Awaited<ReturnType<typeof withSession>>;

// seedCards появится в задаче 5; до неё setup его не зовёт.
export async function setup(): Promise<{ db: DrizzleDB }> {
  await ensureApp();
  return { db: drizzleDb };
}

// Подмена «сейчас» для clock.now(); null снимает подмену.
export function setNow(iso: string | null): void {
  if (iso === null) delete process.env.KPI_FAKE_NOW;
  else process.env.KPI_FAKE_NOW = iso;
}

export async function api(s: Session | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = s ? { ...s.headers } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await callApi(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

// Роль-справочник: вставка, если такой code ещё нет.
export async function ensureStaffRole(db: DrizzleDB, code: string): Promise<string> {
  const found = await db.select({ id: staff_roles.id }).from(staff_roles).where(eq(staff_roles.code, code)).limit(1);
  if (found.length) return found[0].id;
  const [row] = await db
    .insert(staff_roles)
    .values({ code, name_ru: code, name_uz: code, group_key: "kitchen", sort: 999, active: true })
    .onConflictDoNothing()
    .returning({ id: staff_roles.id });
  if (row) return row.id;
  const again = await db.select({ id: staff_roles.id }).from(staff_roles).where(eq(staff_roles.code, code)).limit(1);
  return again[0].id;
}

// Сотрудник с меткой «Тест …» в имени: cleanupKpi находит и удаляет по ней.
export async function makeEmployee(
  db: DrizzleDB,
  o: { terminal_id?: string; role_code?: string; is_trainee?: boolean; first_name?: string } = {}
): Promise<{ id: string; terminal_id: string }> {
  const terminal_id = o.terminal_id ?? randomUUID();
  const staff_role_id = o.role_code ? await ensureStaffRole(db, o.role_code) : null;
  const [row] = await db
    .insert(employees)
    .values({
      first_name: o.first_name ?? "Тест Повар",
      last_name: "Фикстура " + randomUUID().slice(0, 8),
      terminal_id,
      staff_role_id,
      is_trainee: o.is_trainee ?? false,
      active: true,
    })
    .returning({ id: employees.id });
  return { id: row.id, terminal_id };
}

export async function makeScope(
  db: DrizzleDB,
  userId: string,
  o: { card_id?: string | null; terminal_id?: string | null } = {}
): Promise<void> {
  await db.insert(kpi_evaluator_scopes).values({
    user_id: userId,
    card_id: o.card_id ?? null,
    terminal_id: o.terminal_id ?? null,
  });
}

// Порядок учитывает внешние ключи внутри модуля. kpi_settings чистим целиком,
// чтобы после тестов снова действовали значения по умолчанию.
export async function cleanupKpi(db: DrizzleDB): Promise<void> {
  await db.delete(kpi_review_events);
  await db.delete(kpi_review_items);
  await db.delete(kpi_reviews);
  await db.delete(kpi_violation_photos);
  await db.delete(kpi_violations);
  await db.delete(kpi_disputes);
  await db.delete(kpi_periods);
  await db.delete(kpi_raise_decisions);
  await db.delete(kpi_notifications);
  await db.delete(kpi_evaluator_scopes);
  await db.delete(kpi_employee_cards);
  await db.delete(employees).where(like(employees.first_name, "Тест%"));
  await db.delete(kpi_settings);
  // Тестовые карты: code вида test_*, подчёркивание экранируем.
  const testCards = sql`${kpi_cards.code} LIKE 'test\\_%'`;
  await db.delete(kpi_card_items).where(sql`${kpi_card_items.card_id} IN (SELECT id FROM kpi_cards WHERE code LIKE 'test\\_%')`);
  await db.delete(kpi_cards).where(testCards);
}
