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
//
// Правки HR в Workly идут по шагам (перевод сотрудника: уволить старую запись, затем завести новую),
// а сверка сразу применяет план: деактивацию и создание. Снимок между шагами дал бы деактивацию без
// возврата или дубль. Поэтому сверка запускается не на первом опросе, увидевшем нужное событие, а на
// следующем, если новее его нужных событий не появилось (ожидание, «settling»): задержка 15–30 минут.
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

// Свежий план HR (planned, запущенный вручную) ждёт «Применить». Новый прогон той же организации
// вытеснил бы его (applyRun: run_superseded), и «Применить» вернуло бы 409. Пока такой план моложе
// этого срока, сверка по событиям не запускается, курсор остаётся: она пройдёт позже. Заблокированный
// прогон (blocked) не ждёт «Применить»: applyRun берёт только planned, человек строит новый план.
const HOLD_HOURS = 6;

// Сбой обхода (failed или crawl_short) повторяется на следующих опросах, а не ждёт ночи: всего три
// попытки подряд, потом курсор уходит вперёд, чтобы постоянный сбой не писал строку журнала каждые 15 минут.
const MAX_ATTEMPTS = 3;

export type ActivityClient = RunClient & Pick<WorklyClient, "userActivities">;
export type ActivityStatus =
  | RunRow["status"]
  | "init"
  | "idle"
  | "settling"
  | "busy"
  | "hold"
  | "error"
  | "skipped"
  | "disabled";
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

// id самого нового нужного события, которое предыдущий опрос уже видел, но сверку не запустил.
export function activityPendingKey(key: ConnKey): string {
  return `${process.env.PROJECT_PREFIX}workly_activity_pending:${key}`;
}

// Сколько раз подряд сверка по этим событиям закончилась сбоем обхода.
export function activityFailsKey(key: ConnKey): string {
  return `${process.env.PROJECT_PREFIX}workly_activity_fails:${key}`;
}

// Окно запроса: со вчерашнего дня по завтрашний по Ташкенту. end_date в Workly не входит в выборку
// (проба 2026-11-05: end_date = сегодня даёт 0 записей), поэтому берём завтра; вчера покрывает полночь.
export function activityWindow(at: Date): { from: string; to: string } {
  const DAY = 86_400_000;
  return { from: tashkentDay(new Date(at.getTime() - DAY)), to: tashkentDay(new Date(at.getTime() + DAY)) };
}

export type Decision = { action: "init" | "idle" | "sync"; cursor: number; relevant: number; newest: number; reset?: true };

/**
 * Что делать с полученными событиями. Чистая функция.
 * Без курсора: init, курсор встаёт на наибольший id (0, если записей нет), сверки нет.
 * С курсором: новые — записи с id больше курсора; есть среди них нужные — sync, иначе idle;
 * newest — id самого нового нужного (0, если их нет). Курсор не уменьшается, кроме самовосстановления:
 * в окне вчера..завтра есть записи, а самая новая из них старее курсора. Так не бывает (записи растут
 * с id, окно покрывает последние сутки-двое), значит id в Workly сбросились или в курсор попало лишнее число;
 * курсор встаёт на наибольший id окна (reset), сверки нет, ночной прогон остаётся страховкой.
 */
export function decide(events: readonly ActivityItem[], cursor: number | null): Decision {
  const top = events.reduce((m, e) => Math.max(m, e.id), 0);
  if (cursor === null) return { action: "init", cursor: top, relevant: 0, newest: 0 };
  if (top > 0 && top < cursor) return { action: "idle", cursor: top, relevant: 0, newest: 0, reset: true };
  const fresh = events.filter((e) => e.id > cursor && RELEVANT_ACTIONS.has(e.action_name));
  const newest = fresh.reduce((m, e) => Math.max(m, e.id), 0);
  return { action: fresh.length > 0 ? "sync" : "idle", cursor: Math.max(cursor, top), relevant: fresh.length, newest };
}

// Целое до 16 цифр, но только безопасное для Number: больше Number.MAX_SAFE_INTEGER теряет точность.
const INT_RE = /^\d{1,16}$/;

// Целое из Redis по ключу; нет ключа или значение не число — null.
async function readInt(redis: Redis, redisKey: string): Promise<number | null> {
  const raw = await redis.get(redisKey);
  if (raw === null || !INT_RE.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

// Последний завершённый прогон сотрудников моложе HOLD_HOURS — план HR, который ещё не применили.
// Брошенная строка running не в счёт (её закроет startRun), планы автоматических прогонов тоже:
// человек их не просил и «Применить» по ним не нажимает.
async function humanRunPending(db: DrizzleDB, organizationId: string): Promise<boolean> {
  const [last] = await db
    .select({ status: workly_sync_runs.status, trigger: workly_sync_runs.trigger })
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
  return last?.status === "planned" && last.trigger === "manual";
}

/**
 * Один опрос одного подключения. Курсор двигается так:
 * - init и idle — вперёд сразу;
 * - сверка дошла до конца — вперёд, маркер ожидания и счётчик сбоев сбрасываются. Исключение:
 *   сбой обхода (failed или crawl_short) повторяется, пока не набралось MAX_ATTEMPTS подряд;
 * - settling (ждём тишины в журнале), hold (ждёт план HR), busy (идёт другой прогон), error (не
 *   прочитали журнал или упал сам вызов) — на месте: те же события будут разобраны следующим опросом.
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
    const cursor = await readInt(redis, activityCursorKey(org.key));
    const d = decide(events, cursor);

    if (d.action !== "sync") {
      if (d.cursor !== cursor) await redis.set(activityCursorKey(org.key), String(d.cursor));
      // Тревога: курсор был выше любого id окна. Только ключ и числа, без данных журнала.
      if (d.reset) console.error(`workly activity ${org.key} cursor_reset ${cursor} -> ${d.cursor}`);
      return d.action;
    }
    // Ожидание: сверка идёт, только если новее нужных событий с прошлого опроса не появилось.
    const pendingKey = activityPendingKey(org.key);
    if ((await readInt(redis, pendingKey)) !== d.newest) {
      await redis.set(pendingKey, String(d.newest));
      return "settling";
    }
    if (await humanRunPending(db, org.id)) return "hold";

    let run: RunRow;
    try {
      run = await syncAuto(db, redis, org, (key) => clientOf(key), "activity");
    } catch (e) {
      if (e instanceof KpiError && e.code === "run_in_progress") return "busy";
      throw e;
    }
    // failed и blocked — тревоги: строка уже в журнале, в лог идут id и код (как у ночной сверки).
    if (run.status === "failed" || run.status === "blocked") {
      console.error(`workly activity ${org.key} ${run.id} ${run.error ?? run.block_reason ?? run.status}`);
    }
    const failsKey = activityFailsKey(org.key);
    if (run.status === "failed" || (run.status === "blocked" && run.block_reason === "crawl_short")) {
      const fails = ((await readInt(redis, failsKey)) ?? 0) + 1;
      if (fails < MAX_ATTEMPTS) {
        await redis.set(failsKey, String(fails));
        return run.status;
      }
    }
    await redis.set(activityCursorKey(org.key), String(d.cursor));
    await redis.del(pendingKey, failsKey);
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
