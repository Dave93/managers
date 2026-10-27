// Журнал нарушений: запись с фото, отмена, список, файл фото.
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { DrizzleDB } from "@backend/lib/db";
import {
  employees,
  kpi_card_items,
  kpi_disputes,
  kpi_violation_photos,
  kpi_violations,
} from "backend/drizzle/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { has, loadScopes, parsePeriod, seesNetwork, type Actor, type DbLike } from "./access";
import { now } from "./clock";
import { canEvaluate, canSeeEither, loadDirectory, terminalNames, userNames, type DirEmployee } from "./directory";
import { UUID_RE } from "./employees";
import { KpiError } from "./errors";
import { iso } from "./iso";
import { enqueue } from "./notify";
import { isPeriodClosed, lockPeriodShared } from "./periods";
import { commentOk, type Scope } from "./rules";
import { loadSettings } from "./settings";
import { checkPhoto, resolveUploadFile, savePhoto, uploadsBase } from "./storage";
import { addMonths, dayStart, periodOf, type Period } from "./time";
import type { ViolationRow } from "./types";

type VRow = typeof kpi_violations.$inferSelect;

const FUTURE_SLACK_MS = 5 * 60 * 1000;
// Дата и время с явным смещением: Z или ±hh:mm. Без смещения время читалось бы в поясе сервера.
export const OCCURRED_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/i;

const inTx = <T>(db: DbLike, fn: (tx: DbLike) => Promise<T>): Promise<T> =>
  (db as DrizzleDB).transaction((tx) => fn(tx));

// Есть ли открытый спор по оценке или нарушению.
export async function hasOpenDispute(db: DbLike, subjectType: "review" | "violation", subjectId: string): Promise<boolean> {
  const d = await db
    .select({ id: kpi_disputes.id })
    .from(kpi_disputes)
    .where(
      and(
        eq(kpi_disputes.subject_type, subjectType),
        eq(kpi_disputes.subject_id, subjectId),
        eq(kpi_disputes.status, "open")
      )
    )
    .limit(1);
  return d.length > 0;
}

// Был ли по записи отклонённый спор. После отказа новый спор по ней не открывается ни из какого канала (план 8).
export async function hasRejectedDispute(db: DbLike, subjectType: "review" | "violation", subjectId: string): Promise<boolean> {
  const d = await db
    .select({ id: kpi_disputes.id })
    .from(kpi_disputes)
    .where(
      and(
        eq(kpi_disputes.subject_type, subjectType),
        eq(kpi_disputes.subject_id, subjectId),
        eq(kpi_disputes.status, "rejected")
      )
    )
    .limit(1);
  return d.length > 0;
}

// Строки базы в ответ API: имена, фото, открытые и отклонённые споры одним пакетом запросов.
async function toRows(db: DbLike, rows: VRow[]): Promise<ViolationRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const empIds = [...new Set(rows.map((r) => r.employee_id))];
  const emps = await db
    .select({ id: employees.id, first_name: employees.first_name, last_name: employees.last_name })
    .from(employees)
    .where(inArray(employees.id, empIds));
  const empName = new Map(emps.map((e) => [e.id, `${e.last_name} ${e.first_name}`.trim()]));
  const tNames = await terminalNames(db, rows.map((r) => r.terminal_id));
  const uNames = await userNames(db, rows.map((r) => r.recorded_by));
  const photoRows = await db
    .select({ id: kpi_violation_photos.id, violation_id: kpi_violation_photos.violation_id })
    .from(kpi_violation_photos)
    .where(inArray(kpi_violation_photos.violation_id, ids))
    .orderBy(asc(kpi_violation_photos.created_at), asc(kpi_violation_photos.id));
  const photos = new Map<string, { id: string }[]>();
  for (const p of photoRows) {
    const list = photos.get(p.violation_id) ?? [];
    list.push({ id: p.id });
    photos.set(p.violation_id, list);
  }
  const disputeRows = await db
    .select({ subject_id: kpi_disputes.subject_id, status: kpi_disputes.status })
    .from(kpi_disputes)
    .where(
      and(
        eq(kpi_disputes.subject_type, "violation"),
        inArray(kpi_disputes.status, ["open", "rejected"]),
        inArray(kpi_disputes.subject_id, ids)
      )
    );
  const disputed = new Set(disputeRows.filter((d) => d.status === "open").map((d) => d.subject_id));
  const rejected = new Set(disputeRows.filter((d) => d.status === "rejected").map((d) => d.subject_id));
  return rows.map((r) => ({
    id: r.id,
    terminal_id: r.terminal_id,
    terminal_name: tNames.get(r.terminal_id) ?? null,
    employee_id: r.employee_id,
    employee_name: empName.get(r.employee_id) ?? "",
    card_item_id: r.card_item_id,
    item_title_ru: r.item_title_ru,
    period: r.period,
    occurred_at: iso(r.occurred_at),
    comment: r.comment,
    recorded_by: r.recorded_by,
    recorded_by_name: uNames.get(r.recorded_by) ?? null,
    status: r.status as "active" | "cancelled",
    cancel_reason: r.cancel_reason,
    photos: photos.get(r.id) ?? [],
    open_dispute: disputed.has(r.id),
    dispute_rejected: rejected.has(r.id),
    created_at: iso(r.created_at),
  }));
}

// Файл или массив файлов из multipart к одному виду; пустые строки поля не файлы.
function normalizePhotos(v: unknown): File[] {
  const list = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  return list.filter((x): x is File => typeof File !== "undefined" && x instanceof File);
}

export async function createViolation(
  db: DbLike,
  actor: Actor,
  input: {
    employee_id: string;
    card_item_id?: string | null;
    occurred_at?: string | null;
    comment: string;
    photos: File[];
  }
): Promise<ViolationRow> {
  if (typeof input.employee_id !== "string" || input.employee_id === "") throw new KpiError(422, "bad_id");
  if (!UUID_RE.test(input.employee_id)) throw new KpiError(404, "not_found");
  const [emp] = await loadDirectory(db, { employeeIds: [input.employee_id], includeInactive: true });
  if (!emp) throw new KpiError(404, "not_found");
  // Назначение проверяется по текущему филиалу и действующей карте; без него не раскрываем ничего о сотруднике.
  const scopes = await loadScopes(db, actor.userId);
  if (!canEvaluate(actor, scopes, { terminal_id: emp.terminal_id, card_id: emp.card_id })) {
    throw new KpiError(403, "out_of_scope");
  }

  if (!commentOk(input.comment, 3)) throw new KpiError(422, "comment_required");

  const photos = input.photos;
  // Всё проверяем до записи на диск.
  for (let i = 0; i < photos.length; i++) {
    const bad = checkPhoto(photos[i], i);
    if (bad) throw new KpiError(422, bad);
  }
  const settings = await loadSettings(db);
  if (settings.violation_photo_required && photos.length === 0) throw new KpiError(422, "photo_required");

  let itemTitle: string | null = null;
  let itemTitleUz: string | null = null;
  const itemId = input.card_item_id ? input.card_item_id : null;
  if (itemId !== null) {
    const [item] =
      UUID_RE.test(itemId) && emp.card_id !== null
        ? await db
            .select({ id: kpi_card_items.id, title_ru: kpi_card_items.title_ru, title_uz: kpi_card_items.title_uz })
            .from(kpi_card_items)
            .where(
              and(
                eq(kpi_card_items.id, itemId),
                eq(kpi_card_items.card_id, emp.card_id),
                eq(kpi_card_items.active, true)
              )
            )
            .limit(1)
        : [];
    if (!item) throw new KpiError(422, "unknown_item");
    itemTitle = item.title_ru;
    itemTitleUz = item.title_uz;
  }

  const current = now();
  let occurredAt = current;
  if (input.occurred_at !== undefined && input.occurred_at !== null && input.occurred_at !== "") {
    if (typeof input.occurred_at !== "string" || !OCCURRED_RE.test(input.occurred_at)) {
      throw new KpiError(422, "bad_occurred_at");
    }
    occurredAt = new Date(input.occurred_at);
    // Не в будущем (с запасом на часы) и не раньше первого числа прошлого месяца по Ташкенту.
    const earliest = dayStart(addMonths(periodOf(current), -1), 1);
    if (
      Number.isNaN(occurredAt.getTime()) ||
      occurredAt.getTime() > current.getTime() + FUTURE_SLACK_MS ||
      occurredAt.getTime() < earliest.getTime()
    ) {
      throw new KpiError(422, "bad_occurred_at");
    }
  }
  const period = periodOf(occurredAt);
  // Ранняя проверка без блокировки: в закрытый месяц не пишем файлы. Решает проверка в транзакции.
  if (await isPeriodClosed(db, period)) throw new KpiError(409, "period_closed");

  const violationId = randomUUID();
  const attempted: string[] = [];
  try {
    const saved: { file_path: string; mime: string; size_bytes: number }[] = [];
    for (const f of photos) saved.push(await savePhoto(f, violationId, (p) => attempted.push(p)));

    return await inTx(db, async (tx) => {
      // Месяц могли закрыть, пока писались файлы; под FOR SHARE его не закроют до конца записи.
      if (await lockPeriodShared(tx, period)) throw new KpiError(409, "period_closed");
      const [row] = await tx
        .insert(kpi_violations)
        .values({
          id: violationId,
          terminal_id: emp.terminal_id,
          employee_id: emp.id,
          card_item_id: itemId,
          item_title_ru: itemTitle,
          period,
          occurred_at: occurredAt.toISOString(),
          comment: input.comment.trim(),
          recorded_by: actor.userId,
        })
        .returning();
      if (saved.length) {
        const base = current.getTime();
        await tx.insert(kpi_violation_photos).values(
          saved.map((s, i) => ({
            violation_id: violationId,
            file_path: s.file_path,
            mime: s.mime,
            size_bytes: s.size_bytes,
            created_at: new Date(base + i).toISOString(), // порядок загрузки
          }))
        );
      }
      await enqueue(tx, {
        recipient_kind: "employee",
        employee_id: emp.id,
        kind: "violation_recorded",
        payload: {
          violation_id: violationId,
          period,
          item_title_ru: itemTitle,
          item_title_uz: itemTitleUz,
          occurred_at: iso(row.occurred_at),
          comment: row.comment,
        },
        dedupe_key: `violation_recorded:${violationId}`,
      });
      return (await toRows(tx, [row]))[0];
    });
  } catch (e) {
    // Файлы легли раньше строк: при любом сбое убираем сирот и пустую папку.
    for (const p of attempted) {
      try {
        fs.unlinkSync(p);
      } catch (err: any) {
        if (err?.code !== "ENOENT") console.error("kpi: не удалось удалить файл нарушения", p, err);
      }
    }
    try {
      fs.rmdirSync(`${uploadsBase()}/${violationId}`);
    } catch {
      // папки нет или в ней что-то осталось
    }
    throw e;
  }
}

// Отмена без проверки автора и спора: её зовёт и разбор спора, и cancelViolation. Блокирует строку,
// затем месяц (FOR SHARE): закрытие не пройдёт посреди отмены.
export async function cancelViolationTx(tx: DbLike, id: string, reason: string, userId: string): Promise<ViolationRow> {
  if (!UUID_RE.test(id)) throw new KpiError(404, "not_found");
  const [v] = await tx.select().from(kpi_violations).where(eq(kpi_violations.id, id)).for("update");
  if (!v) throw new KpiError(404, "not_found");
  await lockPeriodShared(tx, v.period);
  if (v.status === "cancelled") throw new KpiError(409, "already_cancelled");
  const [row] = await tx
    .update(kpi_violations)
    .set({
      status: "cancelled",
      cancelled_by: userId,
      cancelled_at: now().toISOString(),
      cancel_reason: reason.trim(),
    })
    .where(eq(kpi_violations.id, id))
    .returning();
  return (await toRows(tx, [row]))[0];
}

export async function cancelViolation(db: DbLike, actor: Actor, id: string, reason: string): Promise<ViolationRow> {
  if (!UUID_RE.test(id)) throw new KpiError(404, "not_found");
  return inTx(db, async (tx) => {
    const [v] = await tx.select().from(kpi_violations).where(eq(kpi_violations.id, id)).for("update");
    if (!v) throw new KpiError(404, "not_found");
    // Автор — пока месяц открыт; согласующий — всегда.
    const author = v.recorded_by === actor.userId && !(await lockPeriodShared(tx, v.period));
    if (!author && !has(actor, "kpi.approve")) throw new KpiError(403, "forbidden");
    // Оспоренное нарушение снимает только разбор спора; openDispute блокирует ту же строку.
    if (await hasOpenDispute(tx, "violation", v.id)) throw new KpiError(409, "open_dispute");
    if (!commentOk(reason, 3)) throw new KpiError(422, "comment_required");
    return cancelViolationTx(tx, id, reason, actor.userId);
  });
}

// Видимость строки: филиал записи или текущий филиал сотрудника; карта — текущая карта сотрудника.
function visible(actor: Actor, scopes: Scope[], v: VRow, emp: DirEmployee | undefined): boolean {
  if (seesNetwork(actor)) return true;
  const card_id = emp?.card_id ?? null;
  return canSeeEither(
    actor,
    scopes,
    emp ? { terminal_id: emp.terminal_id, card_id } : null,
    { terminal_id: v.terminal_id, card_id }
  );
}

async function directoryMap(db: DbLike, employeeIds: string[]): Promise<Map<string, DirEmployee>> {
  const list = await loadDirectory(db, { employeeIds: [...new Set(employeeIds)], includeInactive: true });
  return new Map(list.map((e) => [e.id, e]));
}

export async function listViolations(
  db: DbLike,
  actor: Actor,
  q: { period?: Period; terminal_id?: string; employee_id?: string; status?: "active" | "cancelled" }
): Promise<ViolationRow[]> {
  const conds = [];
  if (q.period !== undefined) conds.push(eq(kpi_violations.period, parsePeriod(q.period)));
  if (q.terminal_id !== undefined) {
    if (!UUID_RE.test(q.terminal_id)) throw new KpiError(422, "bad_id");
    conds.push(eq(kpi_violations.terminal_id, q.terminal_id));
  }
  if (q.employee_id !== undefined) {
    if (!UUID_RE.test(q.employee_id)) throw new KpiError(422, "bad_id");
    conds.push(eq(kpi_violations.employee_id, q.employee_id));
  }
  if (q.status !== undefined) {
    if (q.status !== "active" && q.status !== "cancelled") throw new KpiError(422, "bad_status");
    conds.push(eq(kpi_violations.status, q.status));
  }
  const rows = await db
    .select()
    .from(kpi_violations)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(kpi_violations.occurred_at), asc(kpi_violations.id));
  let shown = rows;
  if (!seesNetwork(actor)) {
    const scopes = await loadScopes(db, actor.userId);
    const dir = await directoryMap(db, rows.map((r) => r.employee_id));
    shown = rows.filter((r) => visible(actor, scopes, r, dir.get(r.employee_id)));
  }
  return toRows(db, shown);
}

export async function photoFile(db: DbLike, actor: Actor, photoId: string): Promise<{ path: string; mime: string }> {
  if (!UUID_RE.test(photoId)) throw new KpiError(404, "not_found");
  const [p] = await db.select().from(kpi_violation_photos).where(eq(kpi_violation_photos.id, photoId)).limit(1);
  if (!p) throw new KpiError(404, "not_found");
  const [v] = await db.select().from(kpi_violations).where(eq(kpi_violations.id, p.violation_id)).limit(1);
  if (!v) throw new KpiError(404, "not_found");
  // Чужое и несуществующее неотличимы.
  const scopes = await loadScopes(db, actor.userId);
  const dir = await directoryMap(db, [v.employee_id]);
  if (!visible(actor, scopes, v, dir.get(v.employee_id))) throw new KpiError(404, "not_found");
  // Путь вне каталога загрузок или файла нет — как нет фото.
  const file = resolveUploadFile(p.file_path);
  if (file === null) throw new KpiError(404, "not_found");
  return { path: file, mime: p.mime };
}

// Активные нарушения сотрудника за месяц, для формы оценки.
export async function violationsFor(db: DbLike, employeeId: string, period: Period): Promise<ViolationRow[]> {
  const rows = await db
    .select()
    .from(kpi_violations)
    .where(
      and(
        eq(kpi_violations.employee_id, employeeId),
        eq(kpi_violations.period, period),
        eq(kpi_violations.status, "active")
      )
    )
    .orderBy(asc(kpi_violations.occurred_at), asc(kpi_violations.id));
  return toRows(db, rows);
}

export { normalizePhotos };
