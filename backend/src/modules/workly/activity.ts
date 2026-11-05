// Опрос действий пользователей Workly (GET /v1/user-activities) каждые 15 минут.
//
// У Workly нет вебхуков, поэтому о правках сотрудников (приём, увольнение, смена должности или
// локации, правка профиля) мы узнаём, читая журнал действий. Само действие ничего не говорит о
// том, что изменилось (в записи только номер, название и текст сообщения с именами), поэтому оно
// служит сигналом: пришло нужное событие — запускаем ту же сверку сотрудников, что и ночью
// (syncAuto: те же предохранители, тот же журнал, связи по имени так же ждут человека).
// Ночной прогон остаётся страховкой на случай пропущенных событий и сбоя курсора.
//
// Курсор — наибольший id уже виденного действия по подключению, лежит в Redis. Потеря ключа ничего
// не стоит: первый опрос без курсора только запоминает текущий максимум и сверку не запускает.
import type { DrizzleDB } from "@backend/lib/db";
import { workly_sync_runs } from "backend/drizzle/schema";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type Redis from "ioredis";
import { now } from "../kpi/clock";
import { KpiError } from "../kpi/errors";
import { tashkentDay } from "../kpi/time";
import { clientFor, type WorklyClient } from "./client";
import { CONNECTIONS, credsFromEnv, resolveOrganizationId } from "./config";
import { jobFailureCode } from "./job-failure";
import { hasAppliedRun, syncAuto, type RunClient, type RunRow } from "./runs";
import type { ActivityItem, ConnKey } from "./types";

export const WORKLY_ACTIVITY_JOB = "workly-activity";

// Действия, после которых данные, читаемые планом сотрудников (имя, табельный номер, должность,
// локации, список уволенных), могли измениться. Прочее (ручные отметки прихода и ухода,
// роли пользователей Workly, графики, зарплаты, отгулы) — шум: в живом журнале это около 80% записей.
export const RELEVANT_ACTIONS: ReadonlySet<string> = new Set([
  "addEmployee",
  "dismissEmployee",
  "cancelDismissEmployee",
  "recoverEmployee",
  "editPersonProfile",
  "editEmployeeCode",
  "assignedLocation",
  "deletedLocationEmployee",
  "assignedPosition",
  "deletedAssignedPosition",
  "transferEmpDep",
  "updatedPosition",
  "deletedPosition",
]);

// Свежий план HR (planned) или заблокированный прогон (blocked) ждёт человека. Новый прогон той же
// организации вытеснил бы его (applyRun: run_superseded), и «Применить» вернуло бы 409. Пока такой
// прогон моложе этого срока, сверка по событиям не запускается, курсор остаётся: она пройдёт позже.
const HOLD_HOURS = 6;

export type ActivityClient = RunClient & Pick<WorklyClient, "userActivities">;
export type ActivityStatus = RunRow["status"] | "init" | "idle" | "busy" | "hold" | "error" | "skipped" | "disabled";
export interface ActivityResult {
  key: ConnKey;
  status: ActivityStatus;
}

// Опрос включён, пока WORKLY_ACTIVITY_POLL не равен "0". Проверяется при каждой задаче: расписание
// живёт в Redis и переживает перезапуск, так что флаг при регистрации его бы не остановил.
export function activityPollOn(env: Record<string, string | undefined>): boolean {
  return env.WORKLY_ACTIVITY_POLL !== "0";
}

export function activityCursorKey(key: ConnKey): string {
  return `${process.env.PROJECT_PREFIX}workly_activity_cursor:${key}`;
}

// Окно запроса: со вчерашнего дня по завтрашний по Ташкенту. end_date в Workly не входит в выборку
// (проба 2026-11-05: end_date = сегодня даёт 0 записей), поэтому берём завтра; вчера покрывает полночь.
export function activityWindow(at: Date): { from: string; to: string } {
  const DAY = 86_400_000;
  return { from: tashkentDay(new Date(at.getTime() - DAY)), to: tashkentDay(new Date(at.getTime() + DAY)) };
}

export type Decision = { action: "init" | "idle" | "sync"; cursor: number; relevant: number };

/**
 * Что делать с полученными событиями. Чистая функция.
 * Без курсора: init, курсор встаёт на наибольший id (0, если записей нет), сверки нет.
 * С курсором: новые — записи с id больше курсора; есть среди них нужные — sync, иначе idle.
 * Курсор никогда не уменьшается.
 */
export function decide(events: readonly ActivityItem[], cursor: number | null): Decision {
  const top = events.reduce((m, e) => Math.max(m, e.id), 0);
  if (cursor === null) return { action: "init", cursor: top, relevant: 0 };
  const relevant = events.filter((e) => e.id > cursor && RELEVANT_ACTIONS.has(e.action_name)).length;
  return { action: relevant > 0 ? "sync" : "idle", cursor: Math.max(cursor, top), relevant };
}

const CURSOR_RE = /^\d{1,15}$/;

async function readCursor(redis: Redis, key: ConnKey): Promise<number | null> {
  const raw = await redis.get(activityCursorKey(key));
  return raw !== null && CURSOR_RE.test(raw) ? Number(raw) : null;
}

// Последний завершённый прогон сотрудников моложе HOLD_HOURS ждёт человека.
async function humanRunPending(db: DrizzleDB, organizationId: string): Promise<boolean> {
  const [last] = await db
    .select({ status: workly_sync_runs.status })
    .from(workly_sync_runs)
    .where(
      and(
        eq(workly_sync_runs.organization_id, organizationId),
        eq(workly_sync_runs.kind, "employees"),
        ne(workly_sync_runs.status, "running"),
        sql`${workly_sync_runs.created_at} > now() - make_interval(hours => ${HOLD_HOURS})`
      )
    )
    .orderBy(desc(workly_sync_runs.created_at))
    .limit(1);
  return last?.status === "planned" || last?.status === "blocked";
}

/**
 * Один опрос одного подключения. Курсор двигается так:
 * - init и idle — вперёд сразу;
 * - сверка дошла до конца (любой итоговый статус, в том числе failed и blocked) — вперёд: повтор
 *   сбойного обхода каждые 15 минут ничего не даёт, а ночной прогон всё равно подберёт правки;
 * - hold (ждёт человека), busy (идёт другой прогон), error (не прочитали журнал или упал сам
 *   вызов) — на месте: те же события будут разобраны следующим опросом.
 * Курсор читается до сверки, а записывается после неё: событие, пришедшее во время обхода,
 * осталось выше курсора и запустит сверку при следующем опросе.
 */
export async function pollActivity(
  db: DrizzleDB,
  redis: Redis,
  org: { id: string; key: ConnKey },
  clientOf: (key: ConnKey) => ActivityClient = (key) => clientFor(key, redis)
): Promise<ActivityStatus> {
  try {
    const { from, to } = activityWindow(now());
    const events = await clientOf(org.key).userActivities(from, to);
    const cursor = await readCursor(redis, org.key);
    const d = decide(events, cursor);

    if (d.action !== "sync") {
      if (d.cursor !== cursor) await redis.set(activityCursorKey(org.key), String(d.cursor));
      return d.action;
    }
    if (await humanRunPending(db, org.id)) return "hold";

    let run: RunRow;
    try {
      run = await syncAuto(db, redis, org, (key) => clientOf(key), "activity");
    } catch (e) {
      if (e instanceof KpiError && e.code === "run_in_progress") return "busy";
      throw e;
    }
    await redis.set(activityCursorKey(org.key), String(d.cursor));
    return run.status;
  } catch (e) {
    console.error(`workly activity ${org.key} - ${jobFailureCode(e)}`);
    return "error";
  }
}

// Подключение пропускается, пока нет применённого прогона сотрудников (первый прогон всегда ручной,
// как и у ночной сверки) и пока не заданы ключи Workly.
async function connectionStep(
  db: DrizzleDB,
  redis: Redis,
  key: ConnKey,
  clientOf: (key: ConnKey) => ActivityClient
): Promise<ActivityStatus> {
  try {
    const organizationId = await resolveOrganizationId(db, key);
    if (!organizationId) {
      console.error(`workly activity ${key} organization_missing`);
      return "skipped";
    }
    if (!(await hasAppliedRun(db, organizationId))) return "skipped";
    if (!credsFromEnv(key, process.env)) {
      console.error(`workly activity ${key} not_configured`);
      return "skipped";
    }
    return await pollActivity(db, redis, { id: organizationId, key }, clientOf);
  } catch (e) {
    console.error(`workly activity ${key} - ${jobFailureCode(e)}`);
    return "error";
  }
}

/** Задача WORKLY_ACTIVITY_JOB: подключения по очереди, сбой одного не останавливает другое. */
export async function runActivityPoll(
  db: DrizzleDB,
  redis: Redis,
  clientOf: (key: ConnKey) => ActivityClient = (key) => clientFor(key, redis)
): Promise<ActivityResult[]> {
  if (!activityPollOn(process.env)) return CONNECTIONS.map(({ key }) => ({ key, status: "disabled" as const }));
  const out: ActivityResult[] = [];
  for (const { key } of CONNECTIONS) out.push({ key, status: await connectionStep(db, redis, key, clientOf) });
  return out;
}
