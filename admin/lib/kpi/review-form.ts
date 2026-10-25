// Форма оценки: баллы, черновик, проверки перед запросом, предпросмотр процента.
// Правила повторяют backend/src/modules/kpi (rules.ts: scorePct, noteRequired, noDataNoteRequired, commentOk, diffScores).
import type { KpiItemInput, ReviewFormItem } from "@admin/lib/kpi-api";

export const SCORE_BUTTONS = [0, 25, 50, 75, 100] as const;

export type FormItemLite = Pick<ReviewFormItem, "item_id" | "source" | "weight" | "score" | "note" | "suggestion">;
/**
 * invalid — в поле балла неверный текст («150», «7.5»): score хранит последний верный балл, сохранять нельзя.
 * text — этот неверный текст: строка пересоздаётся при смене вкладки и должна показать то же, что видел оценщик.
 */
export type DraftItem = { score: number | null; note: string; invalid?: boolean; text?: string };
export type Draft = Record<string, DraftItem>;
export type ReviewMode = "readonly" | "new" | "draft" | "change";

export function reviewMode(canEdit: boolean, status: "draft" | "submitted" | null): ReviewMode {
  if (!canEdit) return "readonly";
  if (status === null) return "new";
  return status === "draft" ? "draft" : "change";
}

/**
 * Черновик из формы. В новой форме и черновике пустой автопункт с предложением получает балл предложения.
 * Пустой балл с заметкой — осознанное «Нет данных», его не трогаем.
 */
export function draftFromItems(items: readonly FormItemLite[], mode: ReviewMode = "readonly"): Draft {
  const prefill = mode === "new" || mode === "draft";
  const d: Draft = {};
  for (const i of items) {
    const note = i.note ?? "";
    const fill = prefill && i.source !== "manual" && i.score === null && i.suggestion !== null && note.trim() === "";
    d[i.item_id] = { score: fill ? i.suggestion!.score : i.score, note };
  }
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

/** Ввод в поле балла. Верное число — новый балл, неверный текст — флаг invalid при прежнем балле. null — менять нечего. */
export function scoreTextChange(value: DraftItem, text: string): DraftItem | null {
  const p = parseScoreInput(text);
  if (p === "invalid") return value.invalid && value.text === text ? null : { ...value, invalid: true, text };
  if (p === value.score && !value.invalid) return null;
  return pickScore(value, p);
}

/** Кнопка балла, «Принять», «Нет данных»: балл ставится, неверный текст сбрасывается, даже если балл тот же. */
export function pickScore(value: DraftItem, score: number | null): DraftItem {
  return { score, note: value.note, invalid: false };
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

export type IssueCode = "bad_score_text" | "score_required" | "note_required" | "comment_required" | "no_changes";
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
    // Неверный текст блокирует любое действие: иначе ушёл бы последний верный балл («150» → 15).
    // Одна проблема на пункт: экран держит их в Map по item_id.
    if (d.invalid) {
      out.push({ code: "bad_score_text", item_id: i.item_id });
    } else if (action !== "draft" && i.source === "manual" && d.score === null) {
      out.push({ code: "score_required", item_id: i.item_id });
    } else if (i.suggestion && d.score !== null && d.score !== i.suggestion.score && d.note.trim() === "") {
      out.push({ code: "note_required", item_id: i.item_id });
    } else if (action !== "draft" && i.source !== "manual" && i.suggestion && d.score === null && d.note.trim() === "") {
      // «Нет данных» при готовом предложении: черновик сохраняется, отправить без заметки нельзя (как на сервере).
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
    case "bad_score_text":
      return "Целое от 0 до 100";
    case "score_required":
      return "Поставьте балл: пункт обязателен";
    case "note_required":
      return "Балл отличается от предложения или не поставлен — напишите заметку";
    case "comment_required":
      return `Комментарий к изменению — не меньше ${commentMin} символов без пробелов`;
    case "no_changes":
      return "Баллы не изменились — сохранять нечего";
  }
}
