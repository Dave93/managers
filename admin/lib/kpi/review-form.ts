// Форма оценки: баллы, черновик, проверки перед запросом, предпросмотр процента.
// Правила повторяют backend/src/modules/kpi (rules.ts: scorePct, noteRequired, commentOk, diffScores).
import type { KpiItemInput, ReviewFormItem } from "@admin/lib/kpi-api";

export const SCORE_BUTTONS = [0, 25, 50, 75, 100] as const;

export type FormItemLite = Pick<ReviewFormItem, "item_id" | "source" | "weight" | "score" | "note" | "suggestion">;
export type DraftItem = { score: number | null; note: string };
export type Draft = Record<string, DraftItem>;
export type ReviewMode = "readonly" | "new" | "draft" | "change";

export function reviewMode(canEdit: boolean, status: "draft" | "submitted" | null): ReviewMode {
  if (!canEdit) return "readonly";
  if (status === null) return "new";
  return status === "draft" ? "draft" : "change";
}

export function draftFromItems(items: readonly FormItemLite[]): Draft {
  const d: Draft = {};
  for (const i of items) d[i.item_id] = { score: i.score, note: i.note ?? "" };
  return d;
}

/** Пустое поле — «нет оценки» (null), а не 0: Number("") === 0 испортил бы среднюю за квартал. */
export function parseScoreInput(text: string): number | null | "invalid" {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d{1,3}$/.test(t)) return "invalid";
  const n = Number(t);
  return n <= 100 ? n : "invalid";
}

const itemDraft = (i: FormItemLite, draft: Draft): DraftItem => draft[i.item_id] ?? { score: i.score, note: i.note ?? "" };

export function toItemInputs(items: readonly FormItemLite[], draft: Draft): KpiItemInput[] {
  return items.map((i) => {
    const d = itemDraft(i, draft);
    const note = d.note.trim();
    return { item_id: i.item_id, score: d.score, note: note === "" ? null : note };
  });
}

export function previewPct(items: readonly FormItemLite[], draft: Draft): number | null {
  let sum = 0;
  let w = 0;
  for (const i of items) {
    const s = itemDraft(i, draft).score;
    if (s === null) continue;
    sum += s * i.weight;
    w += i.weight;
  }
  if (w <= 0) return null;
  return Math.round((sum / w) * 100) / 100;
}

/** Букв и цифр не меньше min: пробелы, пунктуация и невидимые символы не считаются (как на сервере). */
export function commentOk(c: string, min: number): boolean {
  return (c.match(/[\p{L}\p{N}]/gu) ?? []).length >= min;
}

/** Только баллы, как diffScores на сервере: заметка сама по себе изменением не считается. */
export function changedItemIds(items: readonly FormItemLite[], draft: Draft): string[] {
  return items.filter((i) => itemDraft(i, draft).score !== i.score).map((i) => i.item_id);
}

export type IssueCode = "score_required" | "note_required" | "comment_required" | "no_changes";
export type FormIssue = { code: IssueCode; item_id?: string };

export function reviewIssues(
  items: readonly FormItemLite[],
  draft: Draft,
  action: "draft" | "submit" | "change",
  comment: string,
  commentMin: number
): FormIssue[] {
  const out: FormIssue[] = [];
  for (const i of items) {
    const d = itemDraft(i, draft);
    if (action !== "draft" && i.source === "manual" && d.score === null) {
      out.push({ code: "score_required", item_id: i.item_id });
    } else if (i.suggestion && d.score !== null && d.score !== i.suggestion.score && d.note.trim() === "") {
      out.push({ code: "note_required", item_id: i.item_id });
    }
  }
  if (action === "change") {
    if (!commentOk(comment, commentMin)) out.push({ code: "comment_required" });
    if (changedItemIds(items, draft).length === 0) out.push({ code: "no_changes" });
  }
  return out;
}

export function issueText(i: FormIssue, commentMin: number): string {
  switch (i.code) {
    case "score_required":
      return "Поставьте балл: пункт обязателен";
    case "note_required":
      return "Балл отличается от предложения — напишите заметку";
    case "comment_required":
      return `Комментарий к изменению — не меньше ${commentMin} символов без пробелов`;
    case "no_changes":
      return "Баллы не изменились — сохранять нечего";
  }
}
