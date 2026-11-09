// Нарушения оценщика в мини-приложении. Тонкий слой над createViolation, cancelViolation и listViolations
// (violations.ts): права автора, спор, закрытый месяц, видимость и коды ошибок решают они под суженным
// Actor из ev-actor.ts. Здесь только форма входа, фильтр «мои» и ответ без id и имени автора.
// Исключение — форма записи: она открывает карту сотрудника, поэтому назначение проверяется до ответа
// тем же правилом, что в createViolation (текущие филиал и карта сотрудника, канал canEvaluate).
import { kpi_card_items, kpi_cards } from "backend/drizzle/schema";
import { and, asc, eq } from "drizzle-orm";
import { loadScopes, parsePeriod, type Actor, type DbLike } from "../access";
import { canEvaluate, loadDirectory } from "../directory";
import { UUID_RE } from "../employees";
import { KpiError } from "../errors";
import { isPeriodClosed } from "../periods";
import { loadSettings } from "../settings";
import { MAX_PHOTO_BYTES, MAX_PHOTOS } from "../storage";
import { periodOf } from "../time";
import type { ViolationRow } from "../types";
import { cancelViolation, createViolation, listViolations } from "../violations";
import type { EvViolation, EvViolationForm, EvViolations } from "./ev-types";

// Ответ собирается поле за полем: recorded_by и recorded_by_name наружу не идут (автор — всегда я).
export function evViolationOf(v: ViolationRow, canCancel: boolean): EvViolation {
  return {
    id: v.id,
    employee_id: v.employee_id,
    employee_name: v.employee_name,
    terminal_name: v.terminal_name,
    card_item_id: v.card_item_id,
    item_title_ru: v.item_title_ru,
    period: v.period,
    occurred_at: v.occurred_at,
    comment: v.comment,
    status: v.status,
    cancel_reason: v.cancel_reason,
    photo_ids: v.photos.map((p) => p.id),
    open_dispute: v.open_dispute,
    can_cancel: canCancel,
  };
}

// Всё, что не uuid-строка (нет параметра, пусто, мусор), — 404 not_found, как и несуществующий сотрудник.
export async function evViolationForm(db: DbLike, actor: Actor, employeeId: unknown): Promise<EvViolationForm> {
  if (typeof employeeId !== "string" || !UUID_RE.test(employeeId)) throw new KpiError(404, "not_found");
  const [emp] = await loadDirectory(db, { employeeIds: [employeeId], includeInactive: true });
  if (!emp) throw new KpiError(404, "not_found");
  // Назначение — по текущему филиалу и действующей карте; без него ни карты, ни пунктов не отдаём.
  const scopes = await loadScopes(db, actor);
  if (!canEvaluate(actor, scopes, { terminal_id: emp.terminal_id, card_id: emp.card_id, employee_id: emp.id })) {
    throw new KpiError(403, "out_of_scope");
  }

  let cardTitle: string | null = null;
  let items: EvViolationForm["items"] = [];
  if (emp.card_id !== null) {
    const [card] = await db.select({ title_ru: kpi_cards.title_ru }).from(kpi_cards).where(eq(kpi_cards.id, emp.card_id)).limit(1);
    cardTitle = card?.title_ru ?? null;
    items = await db
      .select({ id: kpi_card_items.id, title_ru: kpi_card_items.title_ru, title_uz: kpi_card_items.title_uz })
      .from(kpi_card_items)
      .where(and(eq(kpi_card_items.card_id, emp.card_id), eq(kpi_card_items.active, true)))
      .orderBy(asc(kpi_card_items.sort), asc(kpi_card_items.id));
  }
  const settings = await loadSettings(db);
  return {
    employee: { id: emp.id, first_name: emp.first_name, last_name: emp.last_name, terminal_name: emp.terminal_name },
    card_title: cardTitle,
    items,
    photo_required: settings.violation_photo_required,
    max_photos: MAX_PHOTOS,
    max_photo_bytes: MAX_PHOTO_BYTES,
    comment_min: 3,
  };
}

// Время записи — «сейчас» (решение плана 6): occurred_at в createViolation не передаётся.
// Все проверки (назначение, комментарий, фото, пункт карты, закрытый месяц) делает createViolation.
export async function evCreateViolation(
  db: DbLike,
  actor: Actor,
  input: { employee_id?: unknown; card_item_id?: string; comment?: string; photos: File[] }
): Promise<EvViolation> {
  const row = await createViolation(db, actor, {
    employee_id: input.employee_id as string,
    card_item_id: input.card_item_id,
    comment: input.comment as string,
    photos: input.photos,
  });
  return evViolationOf(row, true);
}

// period не задан (undefined) — месяц момента at; остальное проверяет parsePeriod (пустая строка — 422 bad_period).
// Показ — только мои записи (решение плана 7); правило отмены целиком в cancelViolation, can_cancel лишь повторяет его
// для автора: активное, без открытого спора, месяц не закрыт.
export async function evViolations(db: DbLike, actor: Actor, period: unknown, at: Date): Promise<EvViolations> {
  const p = period === undefined ? periodOf(at) : parsePeriod(period);
  const rows = (await listViolations(db, actor, { period: p })).filter((r) => r.recorded_by === actor.userId);
  const closed = await isPeriodClosed(db, p);
  return {
    period: p,
    period_status: closed ? "closed" : "open",
    items: rows.map((r) => evViolationOf(r, r.status === "active" && !r.open_dispute && !closed)),
  };
}

// Отмена: автор в открытом месяце, без открытого спора; чужое — 403 forbidden, даже у роли с kpi.approve
// (в суженном Actor этого права нет). После отмены повторно отменять нечего, поэтому can_cancel = false.
export async function evCancelViolation(db: DbLike, actor: Actor, id: string, reason: unknown): Promise<EvViolation> {
  return evViolationOf(await cancelViolation(db, actor, id, reason as string), false);
}
