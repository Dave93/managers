// Персоны стенда «Мой KPI» на managers_kpi_smoke (план 7, задача 3): по персоне на каждое состояние
// мини-приложения. Стенд живёт в реальном времени (решение 17: KPI_FAKE_NOW под managers_smoke_ не действует),
// поэтому всё строится от сегодняшнего отчётного месяца R.
//
//   cd backend
//   DATABASE_URL=…/managers_kpi_smoke PROJECT_PREFIX=managers_smoke_ KPI_UPLOADS_DIR=/tmp/kpi_smoke_uploads \
//     bun run src/modules/kpi/tg-app/smoke-seed.ts
//
// KPI_UPLOADS_DIR — тот же, что у dev-backend стенда, иначе он не найдёт фото нарушения.
// Повторный запуск сначала убирает только свои строки: сотрудников «Смоук …» и все их kpi_*, привязки
// с telegram_id 9100000001–9100000099, пользователей test_kpi_smoke* с назначениями и филиал «Тест Филиал Смоук».
// Остальное в базе (данные прошлых E2E-прогонов, периоды, карты, роли) не трогает. Очистка и запись — одна
// транзакция: при сбое стенд остаётся прежним. Строки пишут seed* из dev-data.ts мимо доменных проверок.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
  employees,
  kpi_attendance,
  kpi_card_items,
  kpi_cards,
  kpi_disputes,
  kpi_employee_cards,
  kpi_evaluator_scopes,
  kpi_notifications,
  kpi_raise_decisions,
  kpi_review_events,
  kpi_review_items,
  kpi_reviews,
  kpi_tg_bindings,
  kpi_tg_invites,
  kpi_violation_photos,
  kpi_violations,
  staff_roles,
  terminals,
  users,
} from "backend/drizzle/schema";
import { and, asc, between, eq, inArray, like, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { seedCards } from "../seed-cards";
import { loadSettings } from "../settings";
import { uploadsBase } from "../storage";
import { addMonths, currentReviewPeriod, dayStart, quarterStart, type Period } from "../time";
import { seedDecision, seedDispute, seedReview, seedViolation } from "./dev-data";

const SMOKE_DB = "managers_kpi_smoke";
const TG_FROM = 9100000001;
const TG_TO = 9100000099;
const BRANCH = "Тест Филиал Смоук";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Роли стенда: вставляются, только если такого code ещё нет (group_key, sort, active — как у ensureStaffRole в http/fixtures.ts).
const STAFF_ROLES = [
  { code: "cook", name_ru: "Повар", name_uz: "Oshpaz" },
  { code: "manager", name_ru: "Менеджер филиала", name_uz: "Filial menejeri" },
  { code: "hall_worker", name_ru: "Работник зала", name_uz: "Zal xodimi" },
];

// Баллы семи пунктов карты cook (вес у всех 1, процент — среднее): суммы 672, 665 и 686 дают ровно 96, 95 и 98.
const ALL_100 = [100, 100, 100, 100, 100, 100, 100];
const S01 = [100, 100, 75, 100, 90, 75, 100];
const S96 = [100, 100, 86, 100, 100, 86, 100];
const S95 = [100, 100, 90, 100, 90, 85, 100];
const S98 = [100, 100, 100, 100, 86, 100, 100];
const S83 = [100, 100, 75, 75, 75, 75, 80]; // 82,86 — «около 83», ниже нижней ступени

// ---------- PNG без зависимостей ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Чанк PNG: длина, тип, данные, CRC32 по типу и данным.
function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Сплошная заливка w×h, RGB 8 бит, без чересстрочности; у каждой строки байт фильтра 0.
function pngSolid(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // глубина
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", new Uint8Array(0))]);
}

// ---------- очистка прошлого стенда ----------

// Возвращает id удалённых нарушений: их каталоги с фото убираются после фиксации транзакции.
async function cleanup(tx: DbLike): Promise<string[]> {
  const emps = (await tx.select({ id: employees.id }).from(employees).where(like(employees.last_name, "Смоук %"))).map((r) => r.id);
  // Подчёркивание в LIKE — любой символ, поэтому экранируем.
  const usrs = (await tx.select({ id: users.id }).from(users).where(sql`${users.login} LIKE 'test\\_kpi\\_smoke%'`)).map((r) => r.id);
  // Филиал — строго по имени: «Тест Филиал Чиланзар» и «Тест Филиал Юнусабад» прошлых прогонов не наши.
  const branches = (await tx.select({ id: terminals.id }).from(terminals).where(eq(terminals.name, BRANCH))).map((r) => r.id);

  let violationIds: string[] = [];
  if (emps.length) {
    const reviewIds = (await tx.select({ id: kpi_reviews.id }).from(kpi_reviews).where(inArray(kpi_reviews.employee_id, emps))).map((r) => r.id);
    violationIds = (await tx.select({ id: kpi_violations.id }).from(kpi_violations).where(inArray(kpi_violations.employee_id, emps))).map((r) => r.id);
    if (reviewIds.length) {
      // Каскад есть только у пунктов оценки; события удаляем сами.
      await tx.delete(kpi_review_events).where(inArray(kpi_review_events.review_id, reviewIds));
      await tx.delete(kpi_review_items).where(inArray(kpi_review_items.review_id, reviewIds));
    }
    if (violationIds.length) await tx.delete(kpi_violation_photos).where(inArray(kpi_violation_photos.violation_id, violationIds));
    await tx.delete(kpi_violations).where(inArray(kpi_violations.employee_id, emps));
    await tx.delete(kpi_disputes).where(inArray(kpi_disputes.employee_id, emps));
    await tx.delete(kpi_reviews).where(inArray(kpi_reviews.employee_id, emps));
    await tx.delete(kpi_raise_decisions).where(inArray(kpi_raise_decisions.employee_id, emps));
    await tx.delete(kpi_employee_cards).where(inArray(kpi_employee_cards.employee_id, emps));
    await tx.delete(kpi_attendance).where(inArray(kpi_attendance.employee_id, emps));
    await tx.delete(kpi_notifications).where(inArray(kpi_notifications.employee_id, emps));
    await tx.delete(kpi_tg_invites).where(inArray(kpi_tg_invites.employee_id, emps));
    await tx.delete(kpi_tg_bindings).where(inArray(kpi_tg_bindings.employee_id, emps));
  }
  await tx.delete(kpi_tg_bindings).where(between(kpi_tg_bindings.telegram_id, TG_FROM, TG_TO));
  if (usrs.length) {
    await tx.delete(kpi_evaluator_scopes).where(inArray(kpi_evaluator_scopes.user_id, usrs));
    await tx.delete(kpi_tg_bindings).where(inArray(kpi_tg_bindings.user_id, usrs));
    await tx.delete(kpi_tg_invites).where(inArray(kpi_tg_invites.user_id, usrs));
    await tx.delete(kpi_notifications).where(inArray(kpi_notifications.user_id, usrs));
    await tx.delete(users).where(inArray(users.id, usrs));
  }
  if (branches.length) {
    // Назначение на филиал стенда (хоть чужому пользователю) без самого филиала повисло бы.
    await tx.delete(kpi_evaluator_scopes).where(inArray(kpi_evaluator_scopes.terminal_id, branches));
    await tx.delete(terminals).where(inArray(terminals.id, branches));
  }
  if (emps.length) await tx.delete(employees).where(inArray(employees.id, emps));
  return violationIds;
}

// ---------- персоны ----------

async function seed(tx: DbLike): Promise<{ R: Period; personas: number }> {
  for (const r of STAFF_ROLES) {
    await tx
      .insert(staff_roles)
      .values({ ...r, group_key: "kitchen", sort: 999, active: true })
      .onConflictDoNothing({ target: staff_roles.code });
  }
  const roleRows = await tx
    .select({ id: staff_roles.id, code: staff_roles.code })
    .from(staff_roles)
    .where(inArray(staff_roles.code, STAFF_ROLES.map((r) => r.code)));
  const roleId = new Map(roleRows.map((r) => [r.code, r.id]));

  await seedCards(tx);
  const settings = await loadSettings(tx);
  const R = currentReviewPeriod(new Date(), settings.review_deadline_day);
  const Q = quarterStart(R);
  const P = addMonths(Q, -3);

  const [cook] = await tx.select({ id: kpi_cards.id }).from(kpi_cards).where(eq(kpi_cards.code, "cook"));
  if (!cook) throw new Error("нет карты cook");
  const cookItems = await tx
    .select({ id: kpi_card_items.id })
    .from(kpi_card_items)
    .where(and(eq(kpi_card_items.card_id, cook.id), eq(kpi_card_items.active, true)))
    .orderBy(asc(kpi_card_items.sort), asc(kpi_card_items.created_at));
  // Баллы персон рассчитаны на семь пунктов: другая карта дала бы другие проценты и состояния.
  if (cookItems.length !== 7) throw new Error(`у карты cook ${cookItems.length} активных пунктов, персоны рассчитаны на 7`);
  const kitchenItem = cookItems[1].id; // «Чистота кухни»
  const hygieneItem = cookItems[2].id; // пункт 3, «Гигиена сотрудника»

  const [branch] = await tx
    .insert(terminals)
    .values({ name: BRANCH, latitude: 0, longitude: 0, organization_id: randomUUID(), active: true })
    .returning({ id: terminals.id });
  const terminal_id = branch.id;

  // Пользователи стенда войти в админку не могут: пароль «x» не хеш.
  const makeUser = async (login: string, last_name: string): Promise<string> => {
    const [row] = await tx
      .insert(users)
      .values({ login, password: "x", status: "active", first_name: "Тест", last_name })
      .returning({ id: users.id });
    await tx.insert(kpi_evaluator_scopes).values({ user_id: row.id, card_id: null, terminal_id });
    return row.id;
  };
  const evalId = await makeUser("test_kpi_smoke_eval", "Смоук Оценщик");
  const leadId = await makeUser("test_kpi_smoke_lead", "Смоук Руководитель");

  const personas: number[] = [];
  const bind = async (telegram_id: number, who: { employee_id: string } | { user_id: string }): Promise<void> => {
    await tx.insert(kpi_tg_bindings).values({ telegram_id, ...who, lang: "ru", active: true });
  };
  const person = async (tg: number, last_name: string, role = "cook", active = true): Promise<string> => {
    const staff_role_id = roleId.get(role);
    if (!staff_role_id) throw new Error(`нет роли ${role}`);
    const [row] = await tx
      .insert(employees)
      .values({ first_name: "Тест", last_name, terminal_id, staff_role_id, is_trainee: false, active })
      .returning({ id: employees.id });
    await bind(tg, { employee_id: row.id });
    personas.push(tg);
    return row.id;
  };
  const review = (
    employee_id: string,
    period: Period,
    scores: (number | null)[], // null — «нет данных»
    extra: { notes?: (string | null)[]; change?: { old_score_pct: number; comment: string } } = {}
  ) => seedReview(tx, { employee_id, terminal_id, card_id: cook.id, evaluator_user_id: evalId, period, scores, ...extra });
  // Нарушение в R в 10:00 по Ташкенту заданного дня; день ещё не наступил — час назад (всё равно внутри R).
  const occurredAt = (day: number): string =>
    new Date(Math.min(dayStart(R, day).getTime() + 10 * 3600_000, Date.now() - 3600_000)).toISOString();
  const violation = (
    employee_id: string,
    o: { day: number; card_item_id: string; comment: string; photo?: Uint8Array; cancel_reason?: string }
  ) =>
    seedViolation(tx, {
      employee_id,
      terminal_id,
      recorded_by: evalId,
      period: R,
      occurred_at: occurredAt(o.day),
      card_item_id: o.card_item_id,
      comment: o.comment,
      photo: o.photo ?? null,
      status: o.cancel_reason ? "cancelled" : "active",
      cancel_reason: o.cancel_reason,
    });

  // 01 — месяц оценён: заметка у пункта 3, нарушение с фото и отменённое.
  const e01 = await person(9100000001, "Смоук Оценка");
  await review(e01, R, S01, { notes: [null, null, "Форма была грязной 14 и 18 числа"] });
  await violation(e01, { day: 14, card_item_id: hygieneItem, comment: "Грязная форма на смене", photo: pngSolid(640, 480, [96, 125, 139]) });
  await violation(e01, { day: 9, card_item_id: kitchenItem, comment: "Не убрано рабочее место", cancel_reason: "записано по ошибке" });

  // 02 — в квартале оценены два месяца. R открывает квартал — второй месяц будущий (решение 17).
  const e02 = await person(9100000002, "Смоук Два месяца");
  await review(e02, R, S01);
  const next = addMonths(R, 1);
  await review(e02, quarterStart(next) === Q ? next : addMonths(R, -1), [100, 100, 100, 100, 90, 100, 100]);

  // 03 — R ещё не оценён, прошлый месяц на максимуме, в R два нарушения.
  const e03 = await person(9100000003, "Смоук Ждёт");
  await review(e03, addMonths(R, -1), ALL_100);
  await violation(e03, { day: 5, card_item_id: hygieneItem, comment: "Без головного убора на кухне" });
  await violation(e03, { day: 12, card_item_id: kitchenItem, comment: "Грязная доска после смены" });

  // 04 — открытый спор из мини-приложения.
  const e04 = await person(9100000004, "Смоук Спор");
  const r04 = await review(e04, R, [100, 100, 75, 100, 100, 100, 100]);
  await seedDispute(tx, { subject_type: "review", subject_id: r04.id, employee_id: e04, period: R, status: "open", via: "miniapp" });

  // 05 — оценку меняли после отправки, спор отклонён.
  const e05 = await person(9100000005, "Смоук Изменена");
  const r05 = await review(e05, R, [100, 100, 50, 100, 90, 75, 100], { change: { old_score_pct: 85, comment: "Пересчитали гигиену" } });
  await seedDispute(tx, {
    subject_type: "review",
    subject_id: r05.id,
    employee_id: e05,
    period: R,
    status: "rejected",
    resolution_comment: "Проверили журнал смен",
  });

  // 06 — все пункты на максимуме.
  const e06 = await person(9100000006, "Смоук Максимум");
  await review(e06, R, ALL_100);

  // 07 — прошлый квартал оценён целиком (96, 95, 98), решения HR нет, в текущем пусто.
  const pMonths = [P, addMonths(P, 1), addMonths(P, 2)];
  const pScores = [S96, S95, S98];
  const e07 = await person(9100000007, "Смоук Ждём HR");
  for (let i = 0; i < 3; i++) await review(e07, pMonths[i], pScores[i]);

  // 08 — как 07, но HR утвердил 500 000; квартал раньше — один месяц около 83 и отказ.
  const e08 = await person(9100000008, "Смоук Решение");
  const pPct: (number | null)[] = [];
  for (let i = 0; i < 3; i++) pPct.push((await review(e08, pMonths[i], pScores[i])).score_pct);
  await seedDecision(tx, { quarter_start: P, employee_id: e08, months: pPct, status: "approved", amount: 500000 });
  const P3 = addMonths(P, -3);
  const r08old = await review(e08, P3, S83);
  await seedDecision(tx, { quarter_start: P3, employee_id: e08, months: [r08old.score_pct, null, null], status: "rejected" });

  // 09 — роль без карты; в истории оценка по снимку карты cook.
  const e09 = await person(9100000009, "Смоук Без карты", "hall_worker");
  await review(e09, P, S95);

  // 10 — уволен, привязка осталась.
  await person(9100000010, "Смоук Уволен", "cook", false);

  // 11 — только оценщик.
  await bind(9100000011, { user_id: evalId });
  personas.push(9100000011);

  // 12 — руководитель: сотрудник с картой manager без оценки в R и оценщик на том же telegram_id (миграция 0040).
  await person(9100000012, "Смоук Руководитель", "manager");
  await bind(9100000012, { user_id: leadId });

  // 13 — без привязки: строк нет вовсе.
  personas.push(9100000013);

  // 14 — «В этом квартале прибавки не будет» (подсказка impossible). Отчётный месяц оценён, остальные
  // месяцы его квартала — отправленные оценки без балла («нет данных»): они уже not_rated и не ждут
  // оценки, поэтому k + |R| + |O| = 1 + 0 + 0 меньше raise_min_months. Работает при любом положении R
  // в квартале и не закрывает периоды (kpi_periods общие для всех персон). Будущий месяц с оценкой
  // бывает только на стенде (решение 17), как у 02. При raise_min_months = 1 нужен k = 0: тогда и R без балла.
  const e14 = await person(9100000014, "Смоук Без прибавки");
  const NO_DATA = ALL_100.map(() => null);
  for (const p of [Q, addMonths(Q, 1), addMonths(Q, 2)]) {
    await review(e14, p, p === R && settings.raise_min_months >= 2 ? S96 : NO_DATA);
  }

  return { R, personas: personas.length };
}

// ---------- запуск ----------

function refusal(): string | null {
  if (!(process.env.DATABASE_URL ?? "").endsWith("/managers_kpi_smoke")) return "только managers_kpi_smoke";
  if (process.env.PROJECT_PREFIX !== "managers_smoke_") return "нужен PROJECT_PREFIX=managers_smoke_ (seed* из dev-data.ts под другим префиксом не пишут)";
  if (!process.env.KPI_UPLOADS_DIR) return "нужен KPI_UPLOADS_DIR — тот же, что у dev-backend стенда";
  return null;
}

async function main(): Promise<number> {
  // Все проверки — до первого запроса и до подключения к базе: модуль базы подгружается только после них.
  const no = refusal();
  if (no) {
    console.error(`smoke-seed: ${no}`);
    return 1;
  }
  const { drizzleDb, closePool } = await import("@backend/lib/db");
  try {
    const out = await drizzleDb.transaction(async (tx) => {
      // Суффикс URL — не имя базы: …/managers?application_name=/managers_kpi_smoke и …/managers#/managers_kpi_smoke
      // проходят проверку выше, а подключаются к managers. Поэтому имя спрашиваем у сервера — до первого удаления.
      const res = await tx.execute(sql`select current_database() as db`);
      const db = (res.rows as { db: string }[])[0]?.db;
      if (db !== SMOKE_DB) throw new Error(`подключились к базе «${db}», а не к ${SMOKE_DB}; ничего не тронуто`);
      const old = await cleanup(tx);
      return { old, ...(await seed(tx)) };
    });
    // Фото прошлых нарушений — только после фиксации: при откате строки остались бы без файлов.
    for (const id of out.old) {
      if (UUID_RE.test(id)) fs.rmSync(path.join(uploadsBase(), id), { recursive: true, force: true });
    }
    console.log(`smoke-seed: R=${out.R}, персон ${out.personas}`);
    return 0;
  } finally {
    await closePool();
  }
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`smoke-seed: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
