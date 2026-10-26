// Общие фикстуры HTTP-тестов KPI. Импортировать только динамически и только
// внутри ветки «есть тестовое окружение»: tests/helpers/http падает без него при импорте.
import { expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { drizzleDb } from "backend/src/lib/db";
import type { DrizzleDB } from "@backend/lib/db";
import {
  credentials,
  employees,
  inventory_reconciliations,
  kpi_attendance,
  kpi_attendance_imports,
  kpi_branch_indicators,
  kpi_branch_results,
  kpi_branch_scores,
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
  kpi_revenue_plans,
  kpi_sanitary_checks,
  kpi_settings,
  kpi_tg_bindings,
  kpi_tg_invites,
  kpi_violation_photos,
  kpi_violations,
  orders,
  permissions,
  productCookingTime,
  roles,
  roles_permissions,
  staff_roles,
  terminals,
  users,
} from "backend/drizzle/schema";
import { eq, inArray, like, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { callApi, ensureApp, type withSession } from "../../../../tests/helpers/http";
import { kpiQueueName, getKpiQueue } from "../queue";
import { SEED_BRANCH_INDICATORS } from "../seed-data";
import { seedBranchIndicators, seedCards } from "../seed-cards";
import { dayStart } from "../time";
import type { BotApi, TgResult } from "../tg/bot-api";
import { signInitData } from "../tg-app/init-data";
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
    // roles.name уникален, поэтому имя несёт тот же суффикс, что и code.
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
    const [role] = await db
      .insert(roles)
      .values({ name: "test_kpi_" + suffix, code: "test_kpi_" + suffix })
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

// ---------- мини-приложение ----------

// Тестовый токен бота: принимается только под PROJECT_PREFIX managers_test_ и managers_smoke_ (tokenAllowed).
export const TG_TEST_BOT_TOKEN = "123456:kpi-test-bot-token";

// Вход в мини-приложение: initData подписывается токеном (по умолчанию тестовым), auth_date — сейчас.
export async function tgLogin(
  telegramId: number,
  o: { token?: string; auth_date?: number } = {}
): Promise<{ status: number; body: any }> {
  const init_data = signInitData(o.token ?? TG_TEST_BOT_TOKEN, {
    telegram_id: telegramId,
    auth_date: o.auth_date ?? Math.floor(Date.now() / 1000),
  });
  return api(null, "POST", "/api/kpi/tg/auth", { init_data });
}

// Запрос мини-приложения с сессией в Authorization: Bearer; null — без заголовка.
export async function tgApi(token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await callApi(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

// GET без разбора тела: для файла фото.
export async function tgRaw(token: string | null, path: string): Promise<Response> {
  return callApi(path, { method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {} });
}

// Подмена Bot API: send берёт ответы из results по очереди, потом — { ok: true, message_id: 42 }.
export function fakeBotApi(results: TgResult[] = []): {
  api: BotApi;
  sent: { chatId: number; msg: OutMessage }[];
  answered: string[];
  menus: { chatId: number | null; text: string; url: string }[];
} {
  const queue = [...results];
  const sent: { chatId: number; msg: OutMessage }[] = [];
  const answered: string[] = [];
  const menus: { chatId: number | null; text: string; url: string }[] = [];
  const api: BotApi = {
    async send(chatId, msg) {
      sent.push({ chatId, msg });
      return queue.shift() ?? { ok: true, message_id: 42 };
    },
    async answerCallback(callbackId) {
      answered.push(callbackId);
      return { ok: true, message_id: null };
    },
    async setMenuButton(chatId, text, url) {
      menus.push({ chatId, text, url });
      return { ok: true, message_id: null };
    },
  };
  return { api, sent, answered, menus };
}

// Метки строк в общих таблицах: cleanupKpi удаляет только их.
const BRANCH_MARK = "kpi_test";
const TERMINAL_PREFIX = "Тест Филиал ";

// ---------- балл филиала ----------

// Ключ credentials: undefined — случайный uuid, null — строки нет, строка — как есть (кривой ключ).
function credKey(v: string | null | undefined): string | null {
  return v === undefined ? randomUUID() : v;
}

// Филиал «Тест Филиал <hex>» со связками iiko (credentials) для расчёта фактов.
export async function makeTerminal(
  db: DrizzleDB,
  o: { active?: boolean; iiko_id?: string | null; store_id?: string | null } = {}
): Promise<{ id: string; name: string; iiko_id: string | null; store_id: string | null }> {
  const name = TERMINAL_PREFIX + randomUUID().replace(/-/g, "").slice(0, 8);
  const [row] = await db
    .insert(terminals)
    .values({ name, latitude: 0, longitude: 0, organization_id: randomUUID(), active: o.active ?? true })
    .returning({ id: terminals.id });
  const iiko_id = credKey(o.iiko_id);
  const store_id = credKey(o.store_id);
  const creds = [
    ...(iiko_id === null ? [] : [{ type: "iiko_id", key: iiko_id }]),
    ...(store_id === null ? [] : [{ type: "iiko_store_id", key: store_id }]),
  ];
  if (creds.length) await db.insert(credentials).values(creds.map((c) => ({ ...c, model: "terminals", model_id: row.id })));
  return { id: row.id, name, iiko_id, store_id };
}

// Заказ в orders за день (местное время без зоны). service_type: по умолчанию COMMON, null пишется как null.
export async function addOrder(
  db: DrizzleDB,
  o: { iiko_id: string; day: string; sum: number; service_type?: string | null; time?: string }
): Promise<string> {
  const id = randomUUID();
  const at = `${o.day} ${o.time ?? "00:00:00"}`;
  await db.insert(orders).values({
    id,
    openTime: at,
    openDateTyped: at,
    restaurantGroupId: o.iiko_id,
    restaurantGroup: BRANCH_MARK,
    dishDiscountSumInt: String(o.sum),
    orderServiceType: o.service_type === undefined ? "COMMON" : o.service_type,
  });
  return id;
}

// По строке product_cooking_time на каждое ожидание (секунды). Группа в верхнем регистре: запрос сравнивает через lower().
export async function addCooking(
  db: DrizzleDB,
  o: { iiko_id: string; order_id: string; day: string; waits: number[] }
): Promise<void> {
  if (!o.waits.length) return;
  await db.insert(productCookingTime).values(
    o.waits.map((w) => ({
      uniqOrderId: o.order_id,
      restorauntGroup: o.iiko_id.toUpperCase(),
      department: BRANCH_MARK,
      departmentId: BRANCH_MARK,
      cookingPlace: "kitchen",
      dishName: "Тест блюдо",
      openTime: `${o.day} 00:00:00`,
      openDateTyped: `${o.day} 00:00:00`,
      dishAmountInt: 1,
      guestWaitTimeAvg: w,
    }))
  );
}

// Сверка склада за месяц period; period сверки — последний день месяца.
export async function addReconciliation(
  db: DrizzleDB,
  o: { store_id: string; period: string; status: string; accepted_diff_bc: string | null; live_diff_bc?: string | null }
): Promise<void> {
  const y = Number(o.period.slice(0, 4));
  const m = Number(o.period.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  await db.insert(inventory_reconciliations).values({
    store_id: o.store_id,
    period: `${o.period.slice(0, 8)}${String(last).padStart(2, "0")}`,
    status: o.status,
    iiko_document_comment: BRANCH_MARK,
    diff_bc_sum: o.live_diff_bc ?? o.accepted_diff_bc,
    accepted_totals:
      o.status === "accepted"
        ? { lines_total: 1, mismatch_ab_count: 0, diff_ab_sum: null, diff_ac_sum: null, diff_bc_sum: o.accepted_diff_bc }
        : null,
  });
}

// Санитарная проверка напрямую: нужен процент, которого не собрать из 30 пунктов.
export async function addSanitaryRow(db: DrizzleDB, o: { terminal_id: string; period: string; pct: number }): Promise<void> {
  await db.insert(kpi_sanitary_checks).values({
    terminal_id: o.terminal_id,
    period: o.period,
    checked_at: dayStart(o.period, 10).toISOString(),
    inspector_user_id: randomUUID(),
    items: [],
    pct: String(o.pct),
  });
}

// Посещаемость филиала за день: одна запись импорта и по строке на каждого сотрудника (uuid без записи в employees).
export async function addAttendance(
  db: DrizzleDB,
  o: { terminal_id: string; day: string; on_time: number; late: number; absent: number }
): Promise<void> {
  const total = o.on_time + o.late + o.absent;
  const [imp] = await db
    .insert(kpi_attendance_imports)
    .values({
      period: `${o.day.slice(0, 7)}-01`,
      file_name: BRANCH_MARK,
      uploaded_by: randomUUID(),
      mapping: {},
      rows_total: total,
      rows_matched: total,
    })
    .returning({ id: kpi_attendance_imports.id });
  const rows = [
    ...Array.from({ length: o.on_time }, () => ({ late_minutes: 0, absent: false })),
    ...Array.from({ length: o.late }, () => ({ late_minutes: 10, absent: false })),
    ...Array.from({ length: o.absent }, () => ({ late_minutes: 0, absent: true })),
  ];
  if (!rows.length) return;
  await db.insert(kpi_attendance).values(
    rows.map((r) => ({ ...r, employee_id: randomUUID(), day: o.day, terminal_id: o.terminal_id, import_id: imp.id }))
  );
}

// Результат показателя и балл филиала той же версии (балл заводится один раз на версию).
export async function addBranchResult(
  db: DrizzleDB,
  o: { period: string; terminal_id: string; version: number; code: string; fact: number | null; points: number | null }
): Promise<void> {
  const ind = SEED_BRANCH_INDICATORS.find((i) => i.code === o.code);
  if (!ind) throw new Error(`addBranchResult: нет показателя ${o.code}`);
  const computed_at = new Date().toISOString();
  await db.insert(kpi_branch_results).values({
    period: o.period,
    terminal_id: o.terminal_id,
    indicator_code: o.code,
    version: o.version,
    fact: o.fact === null ? null : String(o.fact),
    points: o.points === null ? null : String(o.points),
    weight: ind.weight,
    floor: String(ind.floor),
    target: String(ind.target),
    max: String(ind.max),
    direction: ind.direction,
    data_status: o.fact === null ? "no_data" : "ok",
    reason: o.fact === null ? "no_plan" : null,
    computed_at,
  });
  await db
    .insert(kpi_branch_scores)
    .values({ period: o.period, terminal_id: o.terminal_id, version: o.version, score: "100", tier_pct: 100, computed_at })
    .onConflictDoNothing();
}

// Порядок учитывает внешние ключи внутри модуля. kpi_settings чистим целиком,
// чтобы после тестов снова действовали значения по умолчанию.
export async function cleanupKpi(db: DrizzleDB): Promise<void> {
  // Страховка: чистка сносит kpi_* целиком, только в тестовой базе.
  if (!process.env.DATABASE_URL?.endsWith("/managers_tickets_test")) {
    throw new Error("cleanupKpi: DATABASE_URL не указывает на managers_tickets_test");
  }
  // Проверка раньше удалений: без имени тестовой очереди ничего не трогаем.
  if (kpiQueueName() === "kpi-notify" || getKpiQueue().name === "kpi-notify") {
    throw new Error("cleanupKpi: очередь теста не задана (KPI_NOTIFY_QUEUE), боевую не чистим");
  }
  // Балл филиала: kpi_* целиком; общие таблицы iiko — только строки с метками фикстур.
  await db.delete(kpi_branch_results);
  await db.delete(kpi_branch_scores);
  await db.delete(kpi_sanitary_checks);
  await db.delete(kpi_revenue_plans);
  await db.delete(kpi_branch_indicators);
  await seedBranchIndicators(db);
  await db.delete(orders).where(eq(orders.restaurantGroup, BRANCH_MARK));
  await db.delete(productCookingTime).where(eq(productCookingTime.department, BRANCH_MARK));
  await db.delete(inventory_reconciliations).where(eq(inventory_reconciliations.iiko_document_comment, BRANCH_MARK));
  // model_id — text, регистр у него бывает любой. Заодно сироты: связки несуществующих филиалов (охранная проверка базы выше).
  await db.delete(credentials).where(
    sql`${credentials.model} = 'terminals' AND (
      lower(${credentials.model_id}) IN (SELECT lower(id::text) FROM terminals WHERE name LIKE ${TERMINAL_PREFIX + "%"})
      OR NOT EXISTS (SELECT 1 FROM terminals t WHERE lower(t.id::text) = lower(${credentials.model_id}))
    )`
  );
  await db.delete(terminals).where(like(terminals.name, TERMINAL_PREFIX + "%"));
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
