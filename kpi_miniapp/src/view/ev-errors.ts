// Исход действия оценщика (запись, отправка, разбор) → что делать экрану. Без DOM.
// Нет связи ≠ ошибка: запрос мог дойти до сервера, и повторять его вслепую нельзя.
import type { ApiResult } from "../api";
import { dayMonth } from "../format";
import type { Key, Lang } from "../i18n";
import { DICT } from "../i18n";

export type EvOutcome =
  | { kind: "done" }
  | { kind: "unknown" }
  | { kind: "session" }
  | { kind: "reload"; key: Key }
  | { kind: "error"; key: Key; vars?: Record<string, string | number> };

// Состояние на сервере уже другое: экран перезагружается, текст подсказывает почему.
const RELOAD: Record<string, Key> = {
  already_submitted: "ev_err_already_submitted",
  dispute_closed: "ev_err_dispute_closed",
  already_cancelled: "err_already_cancelled",
  unknown_item: "ev_err_unknown_item",
  period_closed: "err_period_closed",
  not_found: "err_not_found",
};

export function evOutcome(r: ApiResult<unknown>, l: Lang): EvOutcome {
  if (r.kind === "ok") return { kind: "done" };
  if (r.kind === "fail") return r.status === "offline" ? { kind: "unknown" } : { kind: "session" };
  const code = r.error;
  if (code === "not_evaluator" || code === "not_employee") return { kind: "session" };
  if (code && RELOAD[code]) return { kind: "reload", key: RELOAD[code] };
  const body = (r.body ?? {}) as { opens_at?: unknown; min?: unknown };
  if (code === "too_early" && typeof body.opens_at === "string") {
    return { kind: "error", key: "ev_err_too_early", vars: { date: dayMonth(body.opens_at, l) } };
  }
  if (code === "comment_required" && typeof body.min === "number") {
    return { kind: "error", key: "err_comment_required", vars: { min: body.min } };
  }
  const key = `ev_err_${code}` as Key;
  if (code && key in DICT.ru) return { kind: "error", key };
  return { kind: "error", key: "err_generic" };
}

/** Код отказа экрана-заглушки (список или карточка недоступны). Остальные коды — общий экран ошибки. */
export function evNoticeKey(code: string): Key | null {
  return code === "forbidden" || code === "out_of_scope" || code === "no_card" ? (`ev_err_${code}` as Key) : null;
}
