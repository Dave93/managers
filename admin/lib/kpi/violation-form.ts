// Запись нарушения: проверка полей, multipart-тело, выбор сотрудника и пункта, защёлка от двойной отправки.
import type { Card, CardItem, EmployeeRow } from "@admin/lib/kpi-api";
import { terminalOptions, type Option } from "./filters";
import { commentOk } from "./review-form";

/** MAX_PHOTOS из backend/src/modules/kpi/storage.ts (план 1). */
export const KPI_MAX_PHOTOS = 3;
/** commentOk(comment, 3) в плане 1. */
export const VIOLATION_COMMENT_MIN = 3;

export type ViolationDraft = {
  terminal_id: string | null;
  employee_id: string | null;
  card_item_id: string | null;
  comment: string;
  photos: File[];
};

/** Тексты по порядку полей формы. */
export function violationIssues(d: ViolationDraft, photoRequired: boolean): string[] {
  const out: string[] = [];
  if (!d.terminal_id) out.push("Выберите филиал");
  if (!d.employee_id) out.push("Выберите сотрудника");
  if (!commentOk(d.comment, VIOLATION_COMMENT_MIN)) out.push(`Опишите нарушение: не меньше ${VIOLATION_COMMENT_MIN} символов`);
  if (photoRequired && d.photos.length === 0) out.push("Нужна хотя бы одна фотография");
  if (d.photos.length > KPI_MAX_PHOTOS) out.push(`Не больше ${KPI_MAX_PHOTOS} фотографий`);
  return out;
}

/** Время нарушения не уходит: сервер ставит текущее. Филиал тоже: он выводится из сотрудника. */
export function buildViolationFormData(d: ViolationDraft): FormData {
  const fd = new FormData();
  fd.append("employee_id", d.employee_id ?? "");
  if (d.card_item_id) fd.append("card_item_id", d.card_item_id);
  fd.append("comment", d.comment.trim());
  for (const p of d.photos) fd.append("photos", p);
  return fd;
}

export function evaluableTerminals(
  rows: readonly Pick<EmployeeRow, "terminal_id" | "terminal_name" | "can_evaluate">[]
): Option[] {
  return terminalOptions(rows.filter((r) => r.can_evaluate));
}

export function evaluableEmployees<T extends Pick<EmployeeRow, "terminal_id" | "can_evaluate" | "first_name" | "last_name">>(
  rows: readonly T[],
  terminalId: string | null
): T[] {
  if (!terminalId) return [];
  const key = (r: T) => `${r.last_name} ${r.first_name}`;
  return rows
    .filter((r) => r.can_evaluate && r.terminal_id === terminalId)
    .sort((a, b) => key(a).localeCompare(key(b), "ru"));
}

export function itemsForCard(cards: readonly Pick<Card, "id" | "items">[], cardId: string | null): CardItem[] {
  if (!cardId) return [];
  const card = cards.find((c) => c.id === cardId);
  return card ? card.items.filter((i) => i.active).sort((a, b) => a.sort - b.sort) : [];
}

/** Синхронная защёлка: state React обновляется после тика, а второй тап приходит до него. */
export function createLatch(): { acquire(): boolean; release(): void; held(): boolean } {
  let held = false;
  return {
    acquire() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
    held: () => held,
  };
}
