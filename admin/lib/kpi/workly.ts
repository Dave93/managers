// Чистая логика экрана «Синхронизация Workly»: группы плана, исключения, коды ошибок,
// опрос прогона. Ни React, ни сети: типы приходят из бэкенда через `import type`
// (в бандл ничего не попадает), тексты экран берёт по ключам, которые отдают функции здесь.
// Ключи относительны к пространству `kpiScreens` (`kpiScreens.workly.errors.<код>` и т.д.).

import type { BlockReason } from "@backend/modules/workly/guards";
import type { PlanItem, PlanKind } from "@backend/modules/workly/plan";

/** Порядок групп в плане: сначала то, что отключает людей, в конце новые сотрудники. */
export const PLAN_GROUP_ORDER: readonly PlanKind[] = ["deactivate", "link", "relink", "update", "move", "reactivate", "create"];

// Record<PlanKind, …> не даёт забыть новый вид пункта: без него здесь будет ошибка сборки.
const ZERO_COUNTS: Record<PlanKind, number> = {
  link: 0,
  relink: 0,
  update: 0,
  move: 0,
  create: 0,
  deactivate: 0,
  reactivate: 0,
};

/** Пункты плана по видам: только непустые группы, в порядке PLAN_GROUP_ORDER, порядок внутри группы сохраняется. */
export function groupPlan(items: PlanItem[]): { kind: PlanKind; items: PlanItem[] }[] {
  const byKind = new Map<PlanKind, PlanItem[]>();
  for (const it of items) {
    const list = byKind.get(it.kind);
    if (list) list.push(it);
    else byKind.set(it.kind, [it]);
  }
  const out: { kind: PlanKind; items: PlanItem[] }[] = [];
  for (const kind of PLAN_GROUP_ORDER) {
    const list = byKind.get(kind);
    if (list) out.push({ kind, items: list });
  }
  return out;
}

/** Исключение пункта из применения: ключ добавляется или снимается, исходное множество не меняется. */
export function toggleExclusion(excluded: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(excluded);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** Сколько пунктов каждого вида уйдёт в применение (исключённые не считаются); все виды присутствуют, пустые — нулём. */
export function effectiveCounts(items: PlanItem[], excluded: ReadonlySet<string>): Record<PlanKind, number> {
  const out = { ...ZERO_COUNTS };
  for (const it of items) if (!excluded.has(it.key)) out[it.kind] += 1;
  return out;
}

/** «Применить» доступно только у спланированного прогона: применённый, заблокированный, упавший и идущий не применяются. */
export function canApply(run: { status: string } | null | undefined): boolean {
  return run?.status === "planned";
}

/**
 * Тело POST /workly/sync/apply. Бэкенд отвергает запрос без `exclude`, поэтому поле есть всегда:
 * без исключений это пустой массив. Повторы ключей схлопываются, массив новый (не общий с аргументом).
 */
export function applyBody(runId: string, exclude: Iterable<string>): { run_id: string; exclude: string[] } {
  return { run_id: runId, exclude: Array.from(new Set(exclude)) };
}

/**
 * Коды, которыми прогон завершается или отвечают маршруты /workly/* (R19 и коды проверки входа).
 * У каждого есть текст `workly.errors.<код>`.
 */
export const WORKLY_ERROR_CODES = [
  // прогон завершился с кодом (workly_sync_runs.error)
  "empty_crawl",
  "crawl_failed",
  "crawl_short",
  "apply_failed",
  "client_invalid",
  "force_update",
  "auth_failed",
  "http_error",
  "not_configured",
  "period_closed",
  "period_not_started",
  "enqueue_failed",
  "stale",
  // ответы маршрутов
  "run_in_progress",
  "run_not_planned",
  "run_superseded",
  "run_not_found",
  "queue_unavailable",
  "organization_not_connected",
  "employee_not_found",
  "workly_employee_not_found",
  "workly_id_taken",
  "terminal_other_org",
  "location_not_found",
  "organization_required",
  "bad_organization",
  // проверка входа: табельный номер Workly длиннее 32 символов, неверный id, неверный месяц
  "bad_tab_number",
  "bad_workly_id",
  "bad_period",
  // ключи подключения принадлежат другой компании Workly: прогон failed, маршрут 422
  "company_mismatch",
] as const;

const ERROR_CODES: ReadonlySet<string> = new Set(WORKLY_ERROR_CODES);

/** Ключ текста ошибки подключения или прогона по коду: известный код → `workly.errors.<код>`, прочий → `workly.errors.unknown`, null → null. */
export function connectionErrorKey(code: string | null | undefined): string | null {
  if (code == null) return null;
  return ERROR_CODES.has(code) ? `workly.errors.${code}` : "workly.errors.unknown";
}

// Record<BlockReason, true> привязан к типу бэкенда (guards.ts): новая или удалённая причина там даёт ошибку сборки здесь.
const BLOCK_REASON_FLAGS: Record<BlockReason, true> = {
  crawl_short: true,
  too_many_deactivations: true,
  too_many_creations: true,
  empty_crawl: true,
  first_run: true,
};

/** Причины, по которым ночной прогон остановился (workly_sync_runs.block_reason). */
export const WORKLY_BLOCK_REASONS: readonly BlockReason[] = Object.keys(BLOCK_REASON_FLAGS) as BlockReason[];

const BLOCK_REASONS: ReadonlySet<string> = new Set(WORKLY_BLOCK_REASONS);

/** Ключ текста причины блокировки: известная → `workly.blocked.<причина>`, прочая → `workly.blocked.unknown`, null → null. */
export function blockReasonKey(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  return BLOCK_REASONS.has(reason) ? `workly.blocked.${reason}` : "workly.blocked.unknown";
}

/** Обход Workly ещё идёт (70–100 секунд в фоне). */
export function isRunning(run: { status: string } | null | undefined): boolean {
  return run?.status === "running";
}

/** Прогон завершился ошибкой: код лежит в run.error, кнопку можно нажать снова. */
export function isFailed(run: { status: string } | null | undefined): boolean {
  return run?.status === "failed";
}

/** Период опроса прогона в мс для refetchInterval: 2 секунды, пока идёт обход, иначе опрос выключен. */
export function pollInterval(run: { status: string } | null | undefined): number | false {
  return isRunning(run) ? 2000 : false;
}
