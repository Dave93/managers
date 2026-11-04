// Баллы формы оценки: черновик, разбор поля, проверки перед запросом, предпросмотр. Без DOM.
// Порт admin/lib/kpi/review-form.ts без изменения правил (они повторяют backend/src/modules/kpi/rules.ts).
import type { EvFormItem } from "@backend/modules/kpi/tg-app/ev-types";
import { tIn, type Key, type Lang } from "../i18n";
import { reasonCount } from "../util";

export const SCORE_BUTTONS = [0, 25, 50, 75, 100] as const;

export type FormItemLite = Pick<EvFormItem, "item_id" | "source" | "weight" | "score" | "note" | "suggestion">;
/** invalid — в поле балла неверный текст («150», «7.5»): score хранит последний верный балл, сохранять нельзя; text — этот текст. */
export type DraftItem = { score: number | null; note: string; invalid?: boolean; text?: string };
export type Draft = Record<string, DraftItem>;

/** Округление половины вверх без плавающих хвостов, как roundTo на backend. */
function roundTo(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(+(x * f).toPrecision(12)) / f;
}

/**
 * Черновик из формы. prefill (новая форма и черновик): пустой автопункт с предложением получает его балл.
 * Пустой балл с заметкой — осознанное «Нет данных», его не трогаем.
 */
export function draftFromItems(items: readonly FormItemLite[], prefill: boolean): Draft {
  const d: Draft = {};
  for (const i of items) {
    const note = i.note ?? "";
    const fill = prefill && i.source !== "manual" && i.score === null && i.suggestion !== null && note.trim() === "";
    d[i.item_id] = { score: fill ? (i.suggestion as { score: number }).score : i.score, note };
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

/** Ввод в поле балла: верное число — новый балл, неверный текст — флаг invalid при прежнем балле; null — менять нечего. */
export function scoreTextChange(value: DraftItem, text: string): DraftItem | null {
  const p = parseScoreInput(text);
  if (p === "invalid") return value.invalid && value.text === text ? null : { ...value, invalid: true, text };
  if (p === value.score && !value.invalid) return null;
  return pickScore(value, p);
}

/** Кнопка балла, «Принять», «Нет данных»: балл ставится, неверный текст сбрасывается. */
export function pickScore(value: DraftItem, score: number | null): DraftItem {
  return { score, note: value.note, invalid: false };
}

/** «Заметка написана к прежнему баллу»: балл подняли с сохранённого ниже 100 до 100, заметку не меняли. */
export function staleNoteHint(prevScore: number | null, nextScore: number | null, prevNote: string, currentNote: string): boolean {
  return prevScore !== null && prevScore < 100 && nextScore === 100 && prevNote.trim() !== "" && currentNote === prevNote;
}

const itemDraft = (i: FormItemLite, draft: Draft): DraftItem => draft[i.item_id] ?? { score: i.score, note: i.note ?? "" };

export function toItemInputs(items: readonly FormItemLite[], draft: Draft): { item_id: string; score: number | null; note: string | null }[] {
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
  return w <= 0 ? null : roundTo(sum / w, 2);
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
  commentMin: number,
): FormIssue[] {
  const out: FormIssue[] = [];
  for (const i of items) {
    const d = itemDraft(i, draft);
    // Неверный текст блокирует любое действие: иначе ушёл бы последний верный балл («150» → 15).
    // Одна проблема на пункт: экран держит их в Map по item_id.
    if (d.invalid) out.push({ code: "bad_score_text", item_id: i.item_id });
    else if (action !== "draft" && i.source === "manual" && d.score === null) out.push({ code: "score_required", item_id: i.item_id });
    else if (i.suggestion && d.score !== null && d.score !== i.suggestion.score && d.note.trim() === "") out.push({ code: "note_required", item_id: i.item_id });
    else if (action !== "draft" && i.source !== "manual" && i.suggestion && d.score === null && d.note.trim() === "") out.push({ code: "note_required", item_id: i.item_id });
  }
  if (action === "change") {
    if (reasonCount(comment) < commentMin) out.push({ code: "comment_required" });
    if (changedItemIds(items, draft).length === 0) out.push({ code: "no_changes" });
  }
  return out;
}

export function evIssueText(i: FormIssue, commentMin: number, l: Lang): string {
  return tIn(l, `ev_issue_${i.code}` as Key, { min: commentMin });
}
