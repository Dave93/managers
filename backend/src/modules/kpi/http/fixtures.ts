// Общие фикстуры HTTP-тестов KPI. Импортировать только динамически и только
// внутри ветки «есть тестовое окружение»: tests/helpers/http падает без него при импорте.
import { expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { drizzleDb } from "backend/src/lib/db";
import type { DrizzleDB } from "@backend/lib/db";
import {
  employees,
  kpi_attendance,
  kpi_attendance_imports,
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
  kpi_tg_bindings,
  kpi_tg_invites,
  kpi_violation_photos,
  kpi_violations,
  permissions,
  roles,
  roles_permissions,
  staff_roles,
  users,
} from "backend/drizzle/schema";
import { eq, inArray, like, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { callApi, ensureApp, type withSession } from "../../../../tests/helpers/http";
import { kpiQueueName, getKpiQueue } from "../queue";
import { seedCards } from "../seed-cards";
import type { BotApi, TgResult } from "../tg/bot-api";
import type { OutMessage } from "../tg/messages";
import type { AttendanceMapping } from "../types";

export type Session = Awaited<ReturnType<typeof withSession>>;

// Роли, которые нужны карте по умолчанию и тестам.
const STAFF_ROLES = ["cook", "universal_cook", "cashier", "manager", "senior_cook", "hall_worker"];

// cleanupKpi карты не трогает (кроме test_*), поэтому стартовые карты и роли заводим здесь.
export async function setup(): Promise<{ db: DrizzleDB }> {
  await ensureApp();
  const db = drizzleDb;
  await seedCards(db);
  for (const code of STAFF_ROLES) await ensureStaffRole(db, code);
  return { db };
}

// Подмена «сейчас» для clock.now(); null снимает подмену.
export function setNow(iso: string | null): void {
  if (iso === null) delete process.env.KPI_FAKE_NOW;
  else process.env.KPI_FAKE_NOW = iso;
}

// Время в ответах — ISO 8601 UTC с миллисекундами. Обходит ответ целиком: каждое поле
// *_at и *_deadline (не null) обязано быть в этом виде, а поля из required — встретиться хотя бы раз.
const TS_KEY = /(_at|_deadline)$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export function expectIsoTimestamps(body: unknown, required: string[]): void {
  const seen = new Set<string>();
  const bad: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (TS_KEY.test(k) && x !== null) {
          seen.add(k);
          if (typeof x !== "string" || !ISO_UTC.test(x)) bad.push(`${path}.${k}=${JSON.stringify(x)}`);
        } else walk(x, `${path}.${k}`);
      }
    }
  };
  walk(body, "$");
  expect(bad).toEqual([]);
  for (const k of required) expect(seen.has(k) ? k : `нет поля ${k}`).toBe(k);
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
  o: { terminal_id?: string; role_code?: string; is_trainee?: boolean; first_name?: string; external_id?: string | null; active?: boolean } = {}
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
      external_id: o.external_id ?? null,
      active: o.active ?? true,
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

// ---------- Telegram ----------

// Тестовый telegram_id: далеко за пределами реальных id.
export function newTelegramId(): number {
  return 9_000_000_000 + Math.floor(Math.random() * 1e8);
}

// Пользователь test_kpi_<hex>. С perms создаётся роль test_kpi_<hex> с этими правами.
// Права берутся из permissions по slug и должны уже лежать в тестовой базе.
export async function makeUser(
  db: DrizzleDB,
  o: { perms?: string[]; status?: "active" | "blocked"; first_name?: string } = {}
): Promise<{ id: string }> {
  let role_id: string | null = null;
  if (o.perms?.length) {
    const found = await db.select({ id: permissions.id, slug: permissions.slug }).from(permissions).where(inArray(permissions.slug, o.perms));
    const missing = o.perms.filter((p) => !found.some((f) => f.slug === p));
    if (missing.length) throw new Error(`makeUser: нет прав ${missing.join(", ")}: запустите seed-permissions на managers_tickets_test`);
    const [role] = await db
      .insert(roles)
      .values({ name: "test_kpi", code: "test_kpi_" + randomUUID().replace(/-/g, "").slice(0, 8) })
      .returning({ id: roles.id });
    role_id = role.id;
    await db.insert(roles_permissions).values(found.map((f) => ({ role_id: role.id, permission_id: f.id })));
  }
  const [row] = await db
    .insert(users)
    .values({
      login: "test_kpi_" + randomUUID().replace(/-/g, "").slice(0, 8),
      password: "x",
      status: o.status ?? "active",
      first_name: o.first_name ?? "Тест",
      last_name: "Оценщик",
      role_id,
    })
    .returning({ id: users.id });
  return { id: row.id };
}

// Привязка напрямую в таблицу, мимо приглашения.
export async function bindTelegram(
  db: DrizzleDB,
  o: { employee_id?: string; user_id?: string; telegram_id?: number; lang?: "ru" | "uz"; active?: boolean }
): Promise<{ id: string; telegram_id: number }> {
  const telegram_id = o.telegram_id ?? newTelegramId();
  const [row] = await db
    .insert(kpi_tg_bindings)
    .values({
      telegram_id,
      employee_id: o.employee_id ?? null,
      user_id: o.user_id ?? null,
      lang: o.lang ?? "ru",
      active: o.active ?? true,
    })
    .returning({ id: kpi_tg_bindings.id });
  return { id: row.id, telegram_id };
}

// Подмена Bot API: send берёт ответы из results по очереди, потом — { ok: true, message_id: 42 }.
export function fakeBotApi(results: TgResult[] = []): {
  api: BotApi;
  sent: { chatId: number; msg: OutMessage }[];
  answered: string[];
} {
  const queue = [...results];
  const sent: { chatId: number; msg: OutMessage }[] = [];
  const answered: string[] = [];
  const api: BotApi = {
    async send(chatId, msg) {
      sent.push({ chatId, msg });
      return queue.shift() ?? { ok: true, message_id: 42 };
    },
    async answerCallback(callbackId) {
      answered.push(callbackId);
      return { ok: true, message_id: null };
    },
  };
  return { api, sent, answered };
}

// Порядок учитывает внешние ключи внутри модуля. kpi_settings чистим целиком,
// чтобы после тестов снова действовали значения по умолчанию.
export async function cleanupKpi(db: DrizzleDB): Promise<void> {
  // Страховка: чистка сносит kpi_* целиком, только в тестовой базе.
  if (!process.env.DATABASE_URL?.endsWith("/managers_tickets_test")) {
    throw new Error("cleanupKpi: DATABASE_URL не указывает на managers_tickets_test");
  }
  // Проверка раньше удалений: без имени тестовой очереди ничего не трогаем.
  if (kpiQueueName() === "kpi-notify") throw new Error("cleanupKpi: очередь теста не задана (KPI_NOTIFY_QUEUE), боевую не чистим");
  await db.delete(kpi_attendance);
  await db.delete(kpi_attendance_imports);
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
  await db.delete(kpi_tg_invites);
  await db.delete(kpi_tg_bindings);
  // Тестовые пользователи и роли (makeUser). Подчёркивание в LIKE экранируем.
  await db.delete(roles_permissions).where(sql`${roles_permissions.role_id} IN (SELECT id FROM roles WHERE code LIKE 'test\\_kpi\\_%')`);
  await db.delete(users).where(sql`${users.login} LIKE 'test\\_kpi\\_%'`);
  await db.delete(roles).where(sql`${roles.code} LIKE 'test\\_kpi\\_%'`);
  await db.delete(employees).where(like(employees.first_name, "Тест%"));
  await db.delete(kpi_settings);
  // Тестовые карты: code вида test_*, подчёркивание экранируем.
  const testCards = sql`${kpi_cards.code} LIKE 'test\\_%'`;
  await db.delete(kpi_card_items).where(sql`${kpi_card_items.card_id} IN (SELECT id FROM kpi_cards WHERE code LIKE 'test\\_%')`);
  await db.delete(kpi_cards).where(testCards);
  // Задачи, поставленные тестами. Боевую очередь не трогаем ни при каких условиях.
  await getKpiQueue().obliterate({ force: true });
}

// ---------- импорт Workly ----------

export const ATT_HEAD = ["Табель", "Дата", "Приход", "Уход", "Опоздание, мин", "Прогул"];
export const ATT_MAP: AttendanceMapping = { external_id: 0, date: 1, check_in: 2, check_out: 3, late_minutes: 4, absent: 5 };

export function xlsxFile(aoa: unknown[][], name = "workly.xlsx", sheet = "Лист1"): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet);
  return new File([XLSX.write(wb, { type: "buffer", bookType: "xlsx" })], name);
}

export async function uploadAttendance(s: Session | null, file: File | null): Promise<{ status: number; body: any }> {
  const fd = new FormData();
  if (file) fd.append("file", file);
  const res = await callApi("/api/kpi/attendance/parse", { method: "POST", headers: s ? { ...s.headers } : {}, body: fd });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// ATT_HEAD + строки → parse → commit (лист «Лист1», заголовки в первой строке)
export async function importAttendance(
  s: Session,
  rows: unknown[][],
  period: string,
  mapping: AttendanceMapping = ATT_MAP
): Promise<{ status: number; body: any }> {
  const up = await uploadAttendance(s, xlsxFile([ATT_HEAD, ...rows]));
  if (up.status !== 200) return up;
  return api(s, "POST", "/api/kpi/attendance/commit", { token: up.body.token, sheet: "Лист1", period, header_row: 1, mapping });
}
