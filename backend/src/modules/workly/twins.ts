// Двойники между компаниями Workly. В филиалах с общим залом Chopar и Les в одном здании человека заводят в Workly
// дважды (по записи в каждой компании), и он отмечается то в одной, то в другой. У нас ему соответствуют две строки
// employees в разных организациях, и в «чужой» записи он получает прогулы за все дни. Ночная задача workly-twins находит
// такие пары и пишет их в employee_twins; присутствие в одной записи закрывает прогул в другой на чтении
// (представление kpi_attendance_effective), данные Workly и kpi_attendance не меняются.
//
// Общего идентификатора у двух записей нет: телефон, паспорт и счёт у пар почти не совпадают (проба 2026-11-07),
// табельный номер, пин и QR у каждой компании свои. Работает имя и дата рождения:
//   name_birth: имя совпало точно (фамилия + имя, порядок не важен) или с опечаткой (≥2 из 3 слов ФИО, до 2 букв
//               разницы), и дата рождения одинаковая;
//   name_only:  имя совпало точно, а даты рождения разные или не заполнены; пара берётся, только если в один день обе
//               записи отмечены присутствием не были (два тёзки работали бы одновременно).
// Человек, попавший в несколько кандидатов, пропускается (неоднозначно). Ошибочную пару разрывает человек: blocked.
import type { DrizzleDB } from "@backend/lib/db";
import { employee_twins, employees } from "backend/drizzle/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type Redis from "ioredis";
import { assertCompany, clientFor, type WorklyClient } from "./client";
import { CONNECTIONS, credsFromEnv } from "./config";
import { jobFailureCode } from "./job-failure";
import type { ConnKey } from "./types";

export const WORKLY_TWINS_JOB = "workly-twins";

export type TwinRule = "name_birth" | "name_only";
export interface TwinPerson {
  id: number;
  last_name: string;
  first_name: string;
  patronymic: string | null;
  birth_date: string | null;
}
export interface TwinCandidate {
  a: number; // id в первой компании
  b: number; // id во второй
  rule: TwinRule;
}

// ---------- сопоставление имён (чистые функции) ----------

const norm = (s: unknown): string =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[ʼʻ`´'’‘"]/g, "")
    .replace(/[^a-zа-яё0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (p: TwinPerson): string[] => norm(`${p.last_name} ${p.first_name} ${p.patronymic ?? ""}`).split(" ").filter(Boolean);
const exactKey = (p: TwinPerson): string => [norm(p.last_name), norm(p.first_name)].filter(Boolean).sort().join("|");
const birthOf = (p: TwinPerson): string | null => (p.birth_date && /^\d{4}-\d{2}-\d{2}$/.test(p.birth_date) ? p.birth_date : null);

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}

// Слово совпало: то же самое, а у длинных (от 5 букв) допускается разница до двух букв (транслитерация, опечатка).
const wordMatch = (a: string, b: string): boolean => a === b || (Math.min(a.length, b.length) >= 5 && lev(a, b) <= 2);

// Сколько слов первого ФИО нашли пару среди слов второго (каждое слово второго используется один раз).
function matchedWords(a: string[], b: string[]): number {
  const used = new Set<number>();
  let n = 0;
  for (const w of a) {
    const j = b.findIndex((x, i) => !used.has(i) && wordMatch(w, x));
    if (j >= 0) {
      used.add(j);
      n++;
    }
  }
  return n;
}

/**
 * Кандидаты в двойники между двумя списками. Человек, попавший в несколько кандидатов (тёзки, случайно совпавшие
 * даты), пропускается с обеих сторон: ambiguous считает такие пары. name_only потом проверяет ночная задача по
 * посещаемости (правило «в один день не отмечались»), здесь только имя и дата рождения.
 */
export function matchTwins(first: readonly TwinPerson[], second: readonly TwinPerson[]): { pairs: TwinCandidate[]; ambiguous: number } {
  const found: TwinCandidate[] = [];
  const w2 = second.map((p) => ({ p, words: words(p), key: exactKey(p), birth: birthOf(p) }));
  for (const x of first) {
    const xw = words(x);
    const xk = exactKey(x);
    const xb = birthOf(x);
    for (const y of w2) {
      const exact = xk !== "" && xk === y.key;
      const sameBirth = xb !== null && xb === y.birth;
      if (sameBirth && (exact || matchedWords(xw, y.words) >= 2)) found.push({ a: x.id, b: y.p.id, rule: "name_birth" });
      else if (exact) found.push({ a: x.id, b: y.p.id, rule: "name_only" });
    }
  }
  const countA = new Map<number, number>();
  const countB = new Map<number, number>();
  for (const c of found) {
    countA.set(c.a, (countA.get(c.a) ?? 0) + 1);
    countB.set(c.b, (countB.get(c.b) ?? 0) + 1);
  }
  const pairs = found.filter((c) => countA.get(c.a) === 1 && countB.get(c.b) === 1);
  return { pairs, ambiguous: found.length - pairs.length };
}

// ---------- сверка с таблицей (чистая функция) ----------

export interface TwinRow {
  a: string; // employee_a < employee_b
  b: string;
  rule: TwinRule;
  blocked: boolean;
}
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Что сделать с таблицей, чтобы она совпала с найденными парами. Разорванные человеком (blocked) строки не трогаются
 * и заново не создаются; прочие строки, которых нет среди найденных, удаляются.
 */
export function planTwins(
  existing: readonly TwinRow[],
  desired: ReadonlyMap<string, TwinRule>
): { insert: { key: string; rule: TwinRule }[]; update: { key: string; rule: TwinRule }[]; remove: string[]; blocked: number } {
  const have = new Map(existing.map((r) => [pairKey(r.a, r.b), r]));
  const insert: { key: string; rule: TwinRule }[] = [];
  const update: { key: string; rule: TwinRule }[] = [];
  const remove: string[] = [];
  for (const [key, rule] of desired) {
    const row = have.get(key);
    if (!row) insert.push({ key, rule });
    else if (!row.blocked && row.rule !== rule) update.push({ key, rule });
  }
  for (const [key, row] of have) if (!row.blocked && !desired.has(key)) remove.push(key);
  return { insert, update, remove, blocked: existing.filter((r) => r.blocked).length };
}

// Удалять сразу больше половины пар (но не меньше 3) подозрительно: скорее сбой списка, чем увольнения.
export const MIN_REMOVE_LIMIT = 3;
export const removeAllowed = (removing: number, existing: number): boolean => removing <= Math.max(MIN_REMOVE_LIMIT, Math.ceil(existing / 2));

// ---------- задача ----------

export type TwinsClient = Pick<WorklyClient, "companyId"> & { employees(): Promise<(TwinPerson & { id: number })[]> };
export interface TwinsResult {
  status: "ok" | "skipped" | "error";
  pairs: number;
  added: number;
  updated: number;
  removed: number;
  kept_blocked: number;
  ambiguous: number;
  rejected_overlap: number;
  unlinked: number;
  remove_skipped: boolean;
}
const EMPTY: TwinsResult = { status: "skipped", pairs: 0, added: 0, updated: 0, removed: 0, kept_blocked: 0, ambiguous: 0, rejected_overlap: 0, unlinked: 0, remove_skipped: false };

export const twinsOn = (env: Record<string, string | undefined>): boolean => env.WORKLY_TWINS !== "0";

// Сколько дней в последних двух месяцах оба сотрудника были отмечены присутствием (по самим данным Workly).
async function overlapDays(db: DrizzleDB, idA: string, idB: string): Promise<number> {
  const r = await db.execute(sql`
    select count(*)::int as n
    from kpi_attendance a
    join kpi_attendance b on b.day = a.day and not b.absent
    where a.employee_id = ${idA} and b.employee_id = ${idB} and not a.absent
      and a.day >= (date_trunc('month', now()) - interval '1 month')::date`);
  return Number((r.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

/**
 * Пересчёт пар: списки сотрудников обеих компаний, подбор, привязка к нашим строкам, проверка name_only по
 * посещаемости, сверка с таблицей. Любой сбой чтения Workly оставляет таблицу как есть.
 */
export async function syncTwins(
  db: DrizzleDB,
  redis: Redis,
  clientOf: (key: ConnKey) => TwinsClient = (key) => clientFor(key, redis) as unknown as TwinsClient
): Promise<TwinsResult> {
  const keys = CONNECTIONS.map((c) => c.key);
  if (keys.length !== 2 || keys.some((k) => credsFromEnv(k, process.env) === null)) return { ...EMPTY };

  const sides: { companyId: number; people: TwinPerson[] }[] = [];
  for (const key of keys) {
    const client = clientOf(key);
    const companyId = await client.companyId();
    assertCompany(key, companyId);
    const people = await client.employees();
    // Пустой список — сбой чтения, а не «никого нет»: ничего не удаляем.
    if (people.length === 0) return { ...EMPTY };
    sides.push({ companyId, people });
  }

  const { pairs, ambiguous } = matchTwins(sides[0]!.people, sides[1]!.people);

  // Привязка к нашим сотрудникам: активные и связанные именно с этой компанией Workly.
  const ours = await db
    .select({ id: employees.id, company: employees.workly_company_id, wid: employees.workly_id })
    .from(employees)
    .where(and(eq(employees.active, true), isNotNull(employees.workly_id), inArray(employees.workly_company_id, sides.map((s) => s.companyId))));
  const idOf = new Map(ours.map((e) => [`${e.company}:${e.wid}`, e.id]));

  const desired = new Map<string, TwinRule>();
  let unlinked = 0;
  let rejected = 0;
  for (const p of pairs) {
    const idA = idOf.get(`${sides[0]!.companyId}:${p.a}`);
    const idB = idOf.get(`${sides[1]!.companyId}:${p.b}`);
    if (!idA || !idB || idA === idB) {
      unlinked++;
      continue;
    }
    if (p.rule === "name_only" && (await overlapDays(db, idA, idB)) > 0) {
      rejected++;
      continue;
    }
    desired.set(pairKey(idA, idB), p.rule);
  }

  const rows = await db.select().from(employee_twins);
  const existing: TwinRow[] = rows.map((r) => ({ a: r.employee_a, b: r.employee_b, rule: r.rule as TwinRule, blocked: r.blocked }));
  const plan = planTwins(existing, desired);
  const existingLive = existing.filter((r) => !r.blocked).length;
  const removeOk = removeAllowed(plan.remove.length, existingLive);

  await db.transaction(async (tx) => {
    for (const i of plan.insert) {
      const [a, b] = i.key.split("|") as [string, string];
      await tx.insert(employee_twins).values({ employee_a: a, employee_b: b, rule: i.rule }).onConflictDoNothing();
    }
    for (const u of plan.update) {
      const [a, b] = u.key.split("|") as [string, string];
      await tx
        .update(employee_twins)
        .set({ rule: u.rule, updated_at: sql`now()` })
        .where(and(eq(employee_twins.employee_a, a), eq(employee_twins.employee_b, b), eq(employee_twins.blocked, false)));
    }
    if (removeOk) {
      for (const k of plan.remove) {
        const [a, b] = k.split("|") as [string, string];
        await tx.delete(employee_twins).where(and(eq(employee_twins.employee_a, a), eq(employee_twins.employee_b, b), eq(employee_twins.blocked, false)));
      }
    }
  });

  return {
    status: "ok",
    pairs: desired.size,
    added: plan.insert.length,
    updated: plan.update.length,
    removed: removeOk ? plan.remove.length : 0,
    kept_blocked: plan.blocked,
    ambiguous,
    rejected_overlap: rejected,
    unlinked,
    remove_skipped: !removeOk,
  };
}

/** Задача WORKLY_TWINS_JOB. Выключатель WORKLY_TWINS=0. В лог идут только счётчики и код сбоя. */
export async function runTwinsJob(
  db: DrizzleDB,
  redis: Redis,
  clientOf?: (key: ConnKey) => TwinsClient
): Promise<TwinsResult | { status: "disabled" }> {
  if (!twinsOn(process.env)) return { status: "disabled" };
  try {
    const res = await syncTwins(db, redis, clientOf);
    if (res.remove_skipped) console.error("workly twins remove_skipped");
    return res;
  } catch (e) {
    console.error(`workly twins - ${jobFailureCode(e)}`);
    return { ...EMPTY, status: "error" };
  }
}
