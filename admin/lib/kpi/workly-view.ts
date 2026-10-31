// Чистая логика отображения экрана «Синхронизация Workly»: какая часть группы видна,
// как сложить пропущенные пункты, что написать в подтверждении и в строке плана.
// Ни React, ни сети; тексты экран берёт по ключам от `kpiScreens.workly`.

import type { EmployeeFields, PlanItem, PlanKind } from "@backend/modules/workly/plan";
import type { RunRow } from "@backend/modules/workly/runs";
import { KpiApiError } from "./errors";
import { PLAN_GROUP_ORDER, WORKLY_ERROR_CODES, connectionErrorKey, effectiveCounts } from "./workly";

/** Сколько строк группы видно до «Показать все»: в группе Les Ailes бывают сотни пунктов. */
export const GROUP_PAGE = 50;

/** Сколько строк пропущенных пунктов видно в итоге до «Показать все». */
export const SKIPPED_PAGE = 100;

/** Видимая часть списка: первые `limit` (по умолчанию GROUP_PAGE), пока список не раскрыт целиком. */
export function visibleItems<T>(items: readonly T[], expanded: boolean, limit: number = GROUP_PAGE): readonly T[] {
  return expanded || items.length <= limit ? items : items.slice(0, limit);
}

export type SkipReason = "excluded" | "stale" | "conflict";
export type SkippedItem = { key: string; reason: SkipReason };

// Ключ пункта плана — `<вид>:<id сотрудника>` или `create:w<id Workly>` (itemKey в plan.ts).
const keyTail = (key: string): string => {
  const i = key.indexOf(":");
  return i < 0 ? key : key.slice(i + 1);
};

/**
 * Пропущенные пункты, сложенные по сотруднику: move:X стоит рядом со своей парой
 * link:X / relink:X / reactivate:X (и update:X). Группы — в порядке первого появления,
 * внутри группы исходный порядок.
 */
export function skippedGroups<T extends { key: string }>(skipped: readonly T[]): T[][] {
  const byTail = new Map<string, T[]>();
  for (const s of skipped) {
    const tail = keyTail(s.key);
    const list = byTail.get(tail);
    if (list) list.push(s);
    else byTail.set(tail, [s]);
  }
  return [...byTail.values()];
}

/**
 * Переносы, которые пропустятся сами, хотя их не исключали: applyRun пропускает move сотрудника,
 * чья связь по имени (link или relink) не применилась, иначе человек уехал бы в филиал
 * неподтверждённой записи. Здесь предсказуем только случай «связь исключена вручную».
 * Пара ищется по employee_id; reactivate и update перенос не тянут. Уже исключённые переносы не входят.
 */
export function impliedSkips(items: readonly PlanItem[], excluded: ReadonlySet<string>): Set<string> {
  const unlinked = new Set<string>();
  for (const it of items) {
    if ((it.kind === "link" || it.kind === "relink") && it.employee_id && excluded.has(it.key)) unlinked.add(it.employee_id);
  }
  const out = new Set<string>();
  if (unlinked.size === 0) return out;
  for (const it of items) {
    if (it.kind === "move" && it.employee_id && unlinked.has(it.employee_id) && !excluded.has(it.key)) out.add(it.key);
  }
  return out;
}

export type ConfirmSummary = {
  /** Ненулевые виды в порядке PLAN_GROUP_ORDER. */
  lines: { kind: PlanKind; count: number }[];
  /** Деактивации отдельно: в подтверждении это выделенная строка. */
  deactivate: number;
  excluded: number;
  /** Сколько пунктов уйдёт в применение; 0 — применять нечего. */
  total: number;
};

/** Числа для окна подтверждения «Применить план». */
export function confirmSummary(counts: Record<PlanKind, number>, excludedCount: number): ConfirmSummary {
  const lines: { kind: PlanKind; count: number }[] = [];
  let total = 0;
  for (const kind of PLAN_GROUP_ORDER) {
    const count = counts[kind] ?? 0;
    total += count;
    if (count > 0) lines.push({ kind, count });
  }
  return { lines, deactivate: counts.deactivate ?? 0, excluded: excludedCount, total };
}

export type ApplyPreview = ConfirmSummary & {
  /** Сколько пунктов каждого вида реально уйдёт в применение. */
  counts: Record<PlanKind, number>;
  /** Переносы, которые пропустятся вместе с исключённой связью (impliedSkips). */
  implied: Set<string>;
};

/**
 * Что покажут счётчики и окно «Применить план»: не считаются ни исключённые человеком
 * пункты, ни переносы, которые бэкенд пропустит вместе с исключённой связью.
 * `excluded` в итоге — только исключения человека: в apply уходят они одни.
 */
export function applyPreview(items: readonly PlanItem[], excluded: ReadonlySet<string>): ApplyPreview {
  const implied = excluded.size > 0 ? impliedSkips(items, excluded) : new Set<string>();
  const notApplied = implied.size > 0 ? new Set([...excluded, ...implied]) : excluded;
  const counts = effectiveCounts(items as PlanItem[], notApplied);
  return { ...confirmSummary(counts, excluded.size), counts, implied };
}

/** Часть описания изменения в строке плана; текст — `plan.change.<type>`. */
export type ChangePart =
  | { type: "deactivate" }
  | { type: "deactivateByName"; workly_id: number }
  | { type: "activate" }
  | { type: "link"; workly_id: number }
  | { type: "relink"; from: number | null; to: number }
  | { type: "terminal"; from: string | null; to: string | null }
  | { type: "position"; from: string | null; to: string | null }
  | { type: "tab"; from: string | null; to: string | null }
  | { type: "create"; position: string | null; terminal_id: string | null };

// Record<ChangePart["type"], true> не даёт забыть текст для нового вида части.
const CHANGE_FLAGS: Record<ChangePart["type"], true> = {
  deactivate: true,
  deactivateByName: true,
  activate: true,
  link: true,
  relink: true,
  terminal: true,
  position: true,
  tab: true,
  create: true,
};
export const CHANGE_TYPES = Object.keys(CHANGE_FLAGS) as ChangePart["type"][];

type Fields = Partial<EmployeeFields> | null;
const has = (o: Fields, k: keyof EmployeeFields): boolean => o != null && Object.hasOwn(o, k);
const str = (v: unknown): string | null => (v == null ? null : String(v));

function positionPart(before: Fields, after: Fields): ChangePart[] {
  if (!has(after, "position")) return [];
  const from = str(before?.position);
  const to = str(after?.position);
  return from === to ? [] : [{ type: "position", from, to }];
}

function tabPart(before: Fields, after: Fields): ChangePart[] {
  if (!has(after, "workly_tab_number")) return [];
  const from = str(before?.workly_tab_number);
  const to = str(after?.workly_tab_number);
  return from === to ? [] : [{ type: "tab", from, to }];
}

// Связь, кроме прочего, включает сотрудника: если он был выключен, это видно отдельно.
const activatePart = (before: Fields): ChangePart[] => (before?.active === false ? [{ type: "activate" }] : []);

/**
 * Короткое описание пункта плана из before/after: что станет с сотрудником.
 * Порядок частей: связь, включение, должность, табельный номер. id терминалов
 * отдаются как есть, названия подставляет экран.
 */
export function changeSummary(item: PlanItem): ChangePart[] {
  const { before, after } = item;
  switch (item.kind) {
    case "deactivate":
      // У нас связи не было: деактивация держится на совпадении имени с уволенной записью
      // (plan.ts, правило 3). Номер этой записи — главное свидетельство, его надо видеть.
      return before?.workly_id == null ? [{ type: "deactivateByName", workly_id: item.workly_id }] : [{ type: "deactivate" }];
    case "move":
      return [{ type: "terminal", from: str(before?.terminal_id), to: str(after.terminal_id) }];
    case "create":
      return [{ type: "create", position: str(after.position), terminal_id: str(after.terminal_id) }];
    case "link":
      return [{ type: "link", workly_id: item.workly_id }, ...activatePart(before), ...positionPart(before, after)];
    case "relink":
      return [
        { type: "relink", from: before?.workly_id ?? null, to: item.workly_id },
        ...activatePart(before),
        ...positionPart(before, after),
      ];
    case "reactivate":
      return [{ type: "activate" }, ...positionPart(before, after), ...tabPart(before, after)];
    case "update":
      return [...positionPart(before, after), ...tabPart(before, after)];
  }
}

// Record<RunRow["status"], true> привязан к типу бэкенда: новый статус даёт ошибку сборки здесь.
const STATUS_FLAGS: Record<RunRow["status"], true> = {
  running: true,
  planned: true,
  applied: true,
  blocked: true,
  failed: true,
  rolled_back: true,
};
/** Все статусы прогона: у каждого есть текст `card.status.<статус>`. */
export const RUN_STATUSES = Object.keys(STATUS_FLAGS) as RunRow["status"][];

type LastRunLike = { last_run: { id: string; kind: string; status: string } | null };

/** Проверка сотрудников идёт: после перезагрузки страницы карточка сама продолжает опрос этого прогона. */
export function resumeRunId(entry: LastRunLike): string | null {
  const r = entry.last_run;
  return r && r.kind === "employees" && r.status === "running" ? r.id : null;
}

/** Последний прогон — готовый, но не применённый план сотрудников: его можно открыть кнопкой «Открыть план». */
export function plannedRunId(entry: LastRunLike): string | null {
  const r = entry.last_run;
  return r && r.kind === "employees" && r.status === "planned" ? r.id : null;
}

/** Ключ от `kpiScreens` (`workly.errors.x`, его отдают connectionErrorKey и blockReasonKey) → ключ от `kpiScreens.workly`. */
export function inWorkly(key: string): string {
  return key.startsWith("workly.") ? key.slice("workly.".length) : key;
}

const ERROR_CODES: ReadonlySet<string> = new Set(WORKLY_ERROR_CODES);

/**
 * Ключ текста ошибки ответа маршрута /workly/* от `kpiScreens.workly`: известный код → `errors.<код>`.
 * Прочее (сеть, права, 5xx) → null: для них есть общий текст kpiErrorText.
 */
export function worklyErrorKey(e: unknown): string | null {
  if (!(e instanceof KpiApiError) || !ERROR_CODES.has(e.code)) return null;
  const key = connectionErrorKey(e.code);
  return key ? inWorkly(key) : null;
}

/** Хвост id для строки, где имени нет: «…6789ab». */
export function shortId(id: string): string {
  return id.length > 6 ? `…${id.slice(-6)}` : id;
}

/** Начальный текст поиска ручной связи: подпись строки отчёта без хвоста «(Workly: 12, 15)». */
export function searchSeed(label: string): string {
  return label.replace(/\s*\(Workly:[^)]*\)\s*$/, "").trim();
}


// Пороги «зависания» прогона. Бэкенд закрывает строку running старше 15 минут как failed/stale
// только при следующем запуске (startRun), поэтому зависшую проверку закрывает лишь новое
// «Проверить». Минута сверху — на расхождение часов клиента и сервера.
const SLOW_AFTER_MS = 4 * 60 * 1000;
const STUCK_AFTER_MS = 16 * 60 * 1000;

/**
 * Насколько долго идёт прогон: ok; slow — дольше обычного (с 4 минут); stuck — с 16 минут,
 * воркер, скорее всего, не отвечает, и «Проверить» снова доступна. created_at — время сервера,
 * nowMs — часы клиента. Отрицательный возраст и непонятная дата дают ok.
 */
export function runStaleness(createdAtIso: string, nowMs: number): "ok" | "slow" | "stuck" {
  const created = Date.parse(createdAtIso);
  if (Number.isNaN(created)) return "ok";
  const age = nowMs - created;
  if (age >= STUCK_AFTER_MS) return "stuck";
  if (age >= SLOW_AFTER_MS) return "slow";
  return "ok";
}
