// Санитарная проверка: кого может проверять пользователь, черновик формы, тело запроса.
import type { SanitaryCheckRow, SanitaryCreate, ScopeRow } from "@admin/lib/kpi-api";
import type { Option } from "./filters";

const COMMENT_MAX = 1000;

/** Филиалы для проверки: с правом kpi.manage или назначением без филиала — все, иначе филиалы назначений. */
export function inspectableTerminals(scopes: readonly Pick<ScopeRow, "terminal_id">[], all: readonly Option[], manage: boolean): Option[] {
  const anyTerminal = manage || scopes.some((s) => s.terminal_id === null);
  const ids = new Set(scopes.map((s) => s.terminal_id));
  return all.filter((t) => anyTerminal || ids.has(t.id)).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export type SanitaryDraft = { terminal_id: string | null; answers: (boolean | null)[]; comment: string };

export function emptySanitary(count: number, terminalId: string | null): SanitaryDraft {
  return { terminal_id: terminalId, answers: Array.from({ length: count }, () => null), comment: "" };
}

/** Процент «да» по пунктам; пока не отмечены все — null. */
export function draftPct(d: SanitaryDraft): number | null {
  if (d.answers.length === 0 || d.answers.some((a) => a === null)) return null;
  const yes = d.answers.filter((a) => a === true).length;
  return Math.round((yes / d.answers.length) * 10000) / 100;
}

export function sanitaryIssues(d: SanitaryDraft): string[] {
  const out: string[] = [];
  if (!d.terminal_id) out.push("Выберите филиал");
  const left = d.answers.filter((a) => a === null).length;
  if (left > 0) out.push(`Отметьте все пункты: осталось ${left}`);
  if (d.comment.trim().length > COMMENT_MAX) out.push("Комментарий — до 1000 символов");
  return out;
}

/** Тело POST: пункты ровно по шаблону, в его порядке. Вызывать, когда sanitaryIssues пуст. */
export function sanitaryBody(d: SanitaryDraft, titles: readonly string[]): SanitaryCreate {
  const body: SanitaryCreate = {
    terminal_id: d.terminal_id as string,
    items: titles.map((title, i) => ({ title, ok: d.answers[i] === true })),
  };
  const comment = d.comment.trim();
  if (comment !== "") body.comment = comment;
  return body;
}

export function failedTitles(c: Pick<SanitaryCheckRow, "items">): string[] {
  return c.items.filter((i) => !i.ok).map((i) => i.title);
}
