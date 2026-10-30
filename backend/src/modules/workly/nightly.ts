// Ночной прогон Workly и разбор задач очереди (разделы 5.5 и 5.9 спеки).
//
// Задача WORKLY_NIGHTLY_JOB (расписание 03:30 по Ташкенту, см. cron/kpi_worker.ts) обходит
// подключения по очереди и выполняет обходы Workly прямо в задаче: у воркера нет HTTP-таймаута.
// Сотрудников сверяет syncAuto (сам применяет план в пределах предохранителей), посещаемость
// пересобирает текущий месяц и предыдущий, пока он не закрыт для KPI.
//
// В лог и в результат попадают только ключ подключения, id прогона и короткий код. Текст
// исключения и сам объект ошибки не пишутся нигде: DrizzleQueryError несёт параметры запроса
// (имена сотрудников), а BullMQ хранит failedReason = error.message.
import type { DrizzleDB } from "@backend/lib/db";
import { workly_sync_runs } from "backend/drizzle/schema";
import { and, eq } from "drizzle-orm";
import type Redis from "ioredis";
import { now } from "../kpi/clock";
import { UUID_RE } from "../kpi/employees";
import { KpiError } from "../kpi/errors";
import { isPeriodClosed } from "../kpi/periods";
import { addMonths, periodOf, type Period } from "../kpi/time";
import { assertAttendanceSyncable } from "./attendance";
import { WorklyError } from "./client";
import { CONNECTIONS, credsFromEnv, resolveOrganizationId } from "./config";
import { WORKLY_RUN_JOB } from "./queue";
import { executeRun, getRun, hasAppliedRun, startRun, syncAuto, type RunRow } from "./runs";
import type { ConnKey } from "./types";

export const WORKLY_NIGHTLY_JOB = "workly-nightly";

// ---------- коды ошибок ----------

// Короткий код сбоя для лога и failedReason. Только WorklyError.code и KpiError.code;
// всё прочее (в том числе ошибка базы с параметрами запроса) — общий job_failed.
export function jobFailureCode(e: unknown): string {
  if (e instanceof WorklyError || e instanceof KpiError) return e.code;
  return "job_failed";
}

// Код из сообщения ошибки, которую воркер уже заменил на new Error(code): нужен слушателю
// failed, где пришла ошибка BullMQ (например, «job stalled more than allowable limit»).
// Сообщение, не похожее на код, не пропускается: в нём мог оказаться любой текст.
const CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;
export function failedJobCode(e: unknown): string {
  return e instanceof Error && CODE_RE.test(e.message) ? e.message : "job_failed";
}

// ---------- задачи очереди ----------

export interface WorklyJobLike {
  name: string;
  data?: unknown;
}

/**
 * Разбор задачи очереди Workly. WORKLY_RUN_JOB вызывает handlers.run(runId), WORKLY_NIGHTLY_JOB —
 * handlers.nightly(). Любой сбой логируется как `workly job failed <имя> <runId|-> <код>` и
 * пробрасывается новой Error с одним кодом: BullMQ не получает ни исходного сообщения, ни стека.
 */
export async function handleWorklyJob(
  job: WorklyJobLike,
  handlers: { run: (runId: string) => Promise<unknown>; nightly: () => Promise<unknown> }
): Promise<unknown> {
  const name = String(job.name).slice(0, 64);
  const rawId = (job.data as { runId?: unknown } | null | undefined)?.runId;
  // В лог идёт только настоящий uuid: прочее значение — данные из Redis, не доверяем.
  const runId = typeof rawId === "string" && UUID_RE.test(rawId) ? rawId : "-";
  const fail = (code: string): never => {
    console.error(`workly job failed ${name} ${runId} ${code}`);
    throw new Error(code);
  };

  if (job.name !== WORKLY_RUN_JOB && job.name !== WORKLY_NIGHTLY_JOB) return fail("unknown_job");
  if (job.name === WORKLY_RUN_JOB && typeof rawId !== "string") return fail("bad_job");
  try {
    return job.name === WORKLY_RUN_JOB ? await handlers.run(rawId as string) : await handlers.nightly();
  } catch (e) {
    return fail(jobFailureCode(e));
  }
}

// ---------- шаги ночного прогона ----------

// Ночная посещаемость включается только значением "1" (прочее, включая "true", выключено).
// Флаг нельзя включать на проде, пока нет защиты от обрезанного обхода T12: неполный отчёт
// (часть сотрудников не дочитана) заменил бы импорт месяца неполными днями, и KPI посчитался бы по ним.
// Такой защиты для посещаемости пока нет, поэтому по умолчанию шаг выключен.
export function attendanceNightlyOn(env: Record<string, string | undefined>): boolean {
  return env.WORKLY_ATTENDANCE_NIGHTLY === "1";
}

export interface NightlyStep {
  key: ConnKey;
  employees: boolean;
  attendance: boolean;
  misconfigured: boolean;
}

/**
 * Что делать с каждым подключением ночью. Чистая функция: ни базы, ни сети.
 * employees — настроено и есть применённый прогон (первый прогон организации всегда ручной);
 * attendance — настроено и WORKLY_ATTENDANCE_NIGHTLY === "1";
 * misconfigured — не настроено, но шаг ожидался (есть применённый прогон или посещаемость включена).
 */
export function nightlySteps(
  env: Record<string, string | undefined>,
  connections: { key: ConnKey; hasApplied: boolean; configured: boolean }[]
): NightlyStep[] {
  const attendanceOn = attendanceNightlyOn(env);
  return connections.map((c) => ({
    key: c.key,
    employees: c.configured && c.hasApplied,
    attendance: c.configured && attendanceOn,
    misconfigured: !c.configured && (c.hasApplied || attendanceOn),
  }));
}

export interface NightlyResult {
  key: ConnKey;
  employees: RunRow["status"] | "skipped" | "error";
  attendance: "ok" | "skipped" | "error";
}

// Пропускаем месяц без ошибки: он закрыт для KPI или в нём ещё нет прошедших дней (1 число, ночь).
const SKIPPABLE = new Set(["period_closed", "period_not_started"]);

const runIs = (runId: string, status: RunRow["status"]) =>
  and(eq(workly_sync_runs.id, runId), eq(workly_sync_runs.status, status));

// Тревога «не настроено»: строка журнала (без неё сбой виден только в логе процесса).
// Строка закрывается сразу, иначе она держала бы индекс «один running на организацию и вид».
async function writeNotConfigured(db: DrizzleDB, org: { id: string; key: ConnKey }, kind: "employees" | "attendance", period?: Period) {
  const { run_id } = await startRun(db, org, kind, "schedule", null, period);
  await db
    .update(workly_sync_runs)
    .set({ status: "failed", error: "not_configured" })
    .where(runIs(run_id, "running"));
}

// Сверка сотрудников: статус строки журнала, который вернул syncAuto.
async function employeesStep(
  db: DrizzleDB,
  redis: Redis,
  org: { id: string; key: ConnKey }
): Promise<NightlyResult["employees"]> {
  try {
    const run = await syncAuto(db, redis, org);
    // failed и blocked — тревоги: строка уже в журнале, в лог идут id и код.
    if (run.status === "failed" || run.status === "blocked") {
      console.error(`workly nightly ${org.key} employees ${run.id} ${run.error ?? run.block_reason ?? run.status}`);
    }
    return run.status;
  } catch (e) {
    console.error(`workly nightly ${org.key} employees - ${jobFailureCode(e)}`);
    return "error";
  }
}

// Посещаемость: текущий месяц, затем предыдущий, если он не закрыт. По очереди, не параллельно.
async function attendanceStep(db: DrizzleDB, redis: Redis, org: { id: string; key: ConnKey }): Promise<NightlyResult["attendance"]> {
  let done = 0;
  let failed = 0;
  let periods: Period[];
  try {
    const current = periodOf(now());
    const previous = addMonths(current, -1);
    periods = (await isPeriodClosed(db, previous)) ? [current] : [current, previous];
  } catch (e) {
    console.error(`workly nightly ${org.key} attendance - ${jobFailureCode(e)}`);
    return "error";
  }

  for (const period of periods) {
    try {
      try {
        await assertAttendanceSyncable(db, period);
      } catch (e) {
        if (e instanceof KpiError && SKIPPABLE.has(e.code)) continue;
        throw e;
      }
      const { run_id } = await startRun(db, org, "attendance", "schedule", null, period);
      await executeRun(db, redis, run_id);
      const run = await getRun(db, run_id);
      if (run.status === "applied") {
        done++;
      } else {
        // executeRun уже записал failed с кодом; здесь только id и код для лога.
        failed++;
        console.error(`workly nightly ${org.key} attendance ${run_id} ${run.error ?? run.status}`);
      }
    } catch (e) {
      failed++;
      console.error(`workly nightly ${org.key} attendance - ${jobFailureCode(e)}`);
    }
  }
  return failed > 0 ? "error" : done > 0 ? "ok" : "skipped";
}

/**
 * Ночной прогон: сверка сотрудников и (если включено) посещаемость по каждому подключению.
 * Подключения идут по очереди; сбой одного не останавливает другое. Не настроенное, но ожидаемое
 * подключение пишет в журнал failed/not_configured и в console.error (не тихий пропуск).
 */
export async function runNightly(db: DrizzleDB, redis: Redis): Promise<NightlyResult[]> {
  const env = process.env;
  const attendanceOn = attendanceNightlyOn(env);
  const results = new Map<ConnKey, NightlyResult>();
  const known: { key: ConnKey; hasApplied: boolean; configured: boolean; organizationId: string }[] = [];

  for (const { key } of CONNECTIONS) {
    try {
      const organizationId = await resolveOrganizationId(db, key);
      if (!organizationId) {
        console.error(`workly nightly ${key} organization_missing`);
        results.set(key, { key, employees: "skipped", attendance: "skipped" });
        continue;
      }
      known.push({
        key,
        organizationId,
        configured: credsFromEnv(key, env) !== null,
        hasApplied: await hasAppliedRun(db, organizationId),
      });
    } catch (e) {
      console.error(`workly nightly ${key} ${jobFailureCode(e)}`);
      results.set(key, { key, employees: "error", attendance: attendanceOn ? "error" : "skipped" });
    }
  }

  const steps = nightlySteps(env, known);
  for (const step of steps) {
    const c = known.find((k) => k.key === step.key)!;
    const org = { id: c.organizationId, key: step.key };
    const result: NightlyResult = { key: step.key, employees: "skipped", attendance: "skipped" };
    results.set(step.key, result);

    if (step.misconfigured) {
      console.error(`workly nightly ${step.key} not_configured`);
      result.employees = c.hasApplied ? "error" : "skipped";
      result.attendance = attendanceOn ? "error" : "skipped";
      // Строки по видам независимы: сбой одной не отменяет другую.
      const kinds: ["employees" | "attendance", Period | undefined][] = [];
      if (c.hasApplied) kinds.push(["employees", undefined]);
      if (attendanceOn) kinds.push(["attendance", periodOf(now())]);
      for (const [kind, period] of kinds) {
        try {
          await writeNotConfigured(db, org, kind, period);
        } catch (e) {
          console.error(`workly nightly ${step.key} not_configured ${kind} ${jobFailureCode(e)}`);
        }
      }
      continue;
    }
    if (step.employees) result.employees = await employeesStep(db, redis, org);
    if (step.attendance) result.attendance = await attendanceStep(db, redis, org);
  }

  return CONNECTIONS.map(({ key }) => results.get(key)!);
}
