// Ошибки API KPI: код из тела ответа (`{ error: code }`) или из статуса, русские тексты.
// Роуты за макросом permission отвечают 401/403 телом `{ message }` — для них код берём из статуса.

import { INDICATOR_LABEL } from "@admin/lib/kpi/branch";
import { ruT, type KpiT } from "@admin/lib/kpi/i18n";
import { RU_LIB } from "@admin/lib/kpi/ru";

export class KpiApiError extends Error {
  constructor(public status: number, public code: string, public body: Record<string, unknown>) {
    super(code);
    this.name = "KpiApiError";
  }
}

function asBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function toKpiError(status: number, value: unknown): KpiApiError {
  const body = asBody(value);
  let code: string;
  if (typeof body.error === "string" && body.error) code = body.error;
  else if (status === 401) code = "unauthorized";
  else if (status === 403) code = "forbidden";
  else if (status === 404) code = "not_found";
  else if (status === 422) code = "invalid_input";
  else if (status >= 500) code = "server_error";
  else code = `http_${status}`;
  return new KpiApiError(status, code, body);
}

/** Русские тексты кодов (запасной вариант без `t` и для тестов); переводы — ключи `lib.errors.<code>`. */
export const KPI_ERROR_TEXT: Record<string, string> = Object.fromEntries(
  Object.keys(RU_LIB.errors).map((code) => [code, ruT(`lib.errors.${code}`)])
);

export function codeText(code: string, t: KpiT = ruT): string {
  return Object.hasOwn(RU_LIB.errors, code) ? t(`lib.errors.${code}`) : t("lib.errorFallback", { code });
}

export function kpiErrorText(e: unknown, t: KpiT = ruT): string {
  if (e instanceof KpiApiError) {
    const base = codeText(e.code, t);
    if (e.code === "missing_items" && Array.isArray(e.body.items)) return t("lib.errorDetail.missingItems", { base, count: e.body.items.length });
    if (e.code === "open_disputes" && Array.isArray(e.body.ids)) return t("lib.errorDetail.count", { base, count: e.body.ids.length });
    if (e.code === "external_id_taken" && typeof e.body.employee_name === "string" && e.body.employee_name) return t("lib.errorDetail.name", { base, name: e.body.employee_name });
    if (e.code === "nothing_matched" && typeof e.body.rows_total === "number") return t("lib.errorDetail.rows", { base, count: e.body.rows_total });
    if (e.code === "weights_sum" && typeof e.body.sum === "number") return t("lib.errorDetail.sum", { base, sum: e.body.sum });
    if (e.code === "bad_thresholds" && typeof e.body.code === "string" && Object.hasOwn(INDICATOR_LABEL, e.body.code)) {
      return t("lib.errorDetail.name", { base, name: t(`lib.indicator.${e.body.code}`) });
    }
    return base;
  }
  if (e instanceof Error) return e.message;
  return t("lib.errors.server_error");
}

/** Исход известен, если сервер ответил отказом 4xx. Сеть, таймаут и 5xx — неизвестен: действие могло пройти. */
export function outcomeKnown(e: unknown): boolean {
  return e instanceof KpiApiError && e.status >= 400 && e.status < 500;
}

export function shouldRetry(failureCount: number, e: unknown): boolean {
  if (e instanceof KpiApiError && e.status >= 400 && e.status < 500) return false;
  return failureCount < 2;
}

export type LoadResult = { error: unknown; data: unknown };

/**
 * Ошибка загрузки блокирует экран, только пока данных нет. Если данные уже есть, это сбой фонового
 * обновления: экран остаётся, поверх — предупреждение. Берётся первая ошибка каждого вида.
 */
export function loadErrors(...qs: LoadResult[]): { blocking: unknown; stale: unknown } {
  let blocking: unknown = null;
  let stale: unknown = null;
  for (const q of qs) {
    if (q.error == null) continue;
    if (q.data === undefined) blocking = blocking ?? q.error;
    else stale = stale ?? q.error;
  }
  return { blocking, stale };
}
