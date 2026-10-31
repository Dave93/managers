// Чистая логика отображения экрана «Синхронизация Workly»: какая часть группы видна,
// как сложить пропущенные пункты, что написать в подтверждении и в строке плана; для блока
// посещаемости — итог синхронизации, предупреждение о файловом импорте и доля прогулов.
// Ни React, ни сети; тексты экран берёт по ключам от `kpiScreens.workly`.

import type { AttendanceImportRow } from "@backend/modules/kpi/types";
import type { EmployeeFields, PlanItem, PlanKind } from "@backend/modules/workly/plan";
import type { RunRow } from "@backend/modules/workly/runs";
import { KpiApiError } from "./errors";
import { PLAN_GROUP_ORDER, blockReasonKey, connectionErrorKey, effectiveCounts, isWorklyErrorCode } from "./workly";

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

type RunRef = { id: string; kind: string; status: string };

// Статус отдаёт последний прогон каждого вида отдельно (R35): синхронизация посещаемости,
// запущенная после проверки, не прячет готовый план, а проверка — идущую синхронизацию.
type EmployeesRunLike = { last_employees_run: RunRef | null };
type AttendanceRunLike = { last_attendance_run: (RunRef & { period: string | null }) | null };

/** Проверка сотрудников идёт: после перезагрузки страницы карточка сама продолжает опрос этого прогона. */
export function resumeRunId(entry: EmployeesRunLike): string | null {
  const r = entry.last_employees_run;
  return r && r.kind === "employees" && r.status === "running" ? r.id : null;
}

/**
 * Синхронизация посещаемости идёт: после перезагрузки страницы блок «Посещаемость» продолжает
 * опрос этого прогона и сам выбирает его месяц.
 */
export function resumeAttendanceRun(entry: AttendanceRunLike): { id: string; period: string | null } | null {
  const r = entry.last_attendance_run;
  return r && r.kind === "attendance" && r.status === "running" ? { id: r.id, period: r.period } : null;
}

/** Последний прогон проверки — готовый, но не применённый план сотрудников: его можно открыть кнопкой «Открыть план». */
export function plannedRunId(entry: EmployeesRunLike): string | null {
  const r = entry.last_employees_run;
  return r && r.kind === "employees" && r.status === "planned" ? r.id : null;
}

/**
 * Применённый или откатанный последний прогон сотрудников: его итог открывается кнопкой «Открыть итог»
 * (после перезагрузки страницы, когда карточка ни за каким прогоном не следит).
 */
export function resultRunId(entry: EmployeesRunLike): string | null {
  const r = entry.last_employees_run;
  return r && r.kind === "employees" && (r.status === "applied" || r.status === "rolled_back") ? r.id : null;
}

/** Ключ от `kpiScreens` (`workly.errors.x`, его отдают connectionErrorKey и blockReasonKey) → ключ от `kpiScreens.workly`. */
export function inWorkly(key: string): string {
  return key.startsWith("workly.") ? key.slice("workly.".length) : key;
}

/**
 * Ключ текста ошибки ответа маршрута /workly/* от `kpiScreens.workly`: известный код → `errors.<код>`.
 * Прочее (сеть, права, 5xx) → null: для них есть общий текст kpiErrorText.
 */
export function worklyErrorKey(e: unknown): string | null {
  if (!(e instanceof KpiApiError) || !isWorklyErrorCode(e.code)) return null;
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

// ---------- посещаемость и качество данных ----------

/**
 * Доля прогулов процентом с одним знаком после запятой: 0.1234 → «12,3%» (ru), «12.3%» (en).
 * Знак процента приписывается сам: стиль percent в ru ставит перед ним неразрывный пробел.
 * Не число — прочерк.
 */
export function formatShare(share: number, locale = "ru"): string {
  if (!Number.isFinite(share)) return "—";
  const n = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${n.format(share * 100)}%`;
}

/**
 * Предупреждение перед «Синхронизировать» (R23): у организации за месяц уже есть действующий
 * файловый импорт, и синхронизация его заменит. Прежние импорты без организации синхронизация
 * не трогает, поэтому о них не предупреждаем.
 */
export function fileImportWarning(
  imports: readonly Pick<AttendanceImportRow, "source" | "status" | "organization_id">[] | null | undefined,
  organizationId: string | null
): boolean {
  if (!imports || organizationId == null) return false;
  return imports.some((r) => r.source === "file" && r.status === "committed" && r.organization_id === organizationId);
}

/**
 * Коды, у которых в блоке посещаемости свой текст (`attendance.errors.<код>`), а не общий
 * `errors.<код>` карточки подключения. empty_crawl у синхронизации чаще всего значит «нечего
 * записать: сотрудники ещё не связаны», а не сбой Workly, и повтор тут не поможет; stale — это
 * закрытая зависшая синхронизация; period_not_started в первый день месяца означает, что
 * завершённых дней ещё нет; run_in_progress — уже идёт синхронизация, а не проверка.
 */
export const ATTENDANCE_ERROR_CODES = ["empty_crawl", "stale", "period_not_started", "run_in_progress"] as const;

const ATTENDANCE_OVERRIDES: ReadonlySet<string> = new Set(ATTENDANCE_ERROR_CODES);

/** Ключ своего текста ошибки блока посещаемости (от `kpiScreens.workly`) или null — тогда общий текст. */
export function attendanceErrorKey(code: string | null | undefined): string | null {
  return code != null && ATTENDANCE_OVERRIDES.has(code) ? `attendance.errors.${code}` : null;
}

/**
 * Ключ текста ошибки прогона в строке «Последний прогон» карточки (от `kpiScreens.workly`).
 * У упавшей синхронизации посещаемости — тексты блока посещаемости (attendanceErrorKey): общий
 * empty_crawl говорит про пустой список сотрудников, а у синхронизации он значит «нечего записать».
 * Прочие коды и проверка сотрудников — общий `errors.<код>` (неизвестный — `errors.unknown`).
 * Кода нет — null.
 */
export function lastRunErrorKey(run: { kind: string; error: string | null } | null | undefined): string | null {
  if (run?.error == null) return null;
  const own = run.kind === "attendance" ? attendanceErrorKey(run.error) : null;
  return own ?? inWorkly(connectionErrorKey(run.error) ?? "workly.errors.unknown");
}

/** Пояснение под строкой последнего прогона; key — от `kpiScreens.workly`. */
export type LastRunNote = { type: "blocked"; key: string } | { type: "error"; key: string } | { type: "attendanceRunning" };

export type LastRunLine<R> = { kind: "employees" | "attendance"; run: R; note: LastRunNote | null };

type LastRunRow = { id: string; kind: string; status: string; error: string | null; block_reason: string | null };

/**
 * Строки «Последний прогон» карточки подключения: по одной на вид (сначала проверка сотрудников,
 * затем синхронизация посещаемости), вида без прогонов нет. Каждая строка берётся из своего поля
 * статуса (R35), поэтому более новый прогон другого вида её не прячет: ночная остановка проверки
 * (спека 5.8, тревога) видна и после синхронизации посещаемости, и наоборот.
 * Ошибку и причину остановки проверки, за которой карточка уже следит (trackedId), показывает
 * её блок ниже: у этой строки пояснения нет.
 */
export function lastRunLines<R extends LastRunRow>(
  entry: { last_employees_run: R | null; last_attendance_run: R | null },
  trackedId: string | null
): LastRunLine<R>[] {
  const out: LastRunLine<R>[] = [];
  const e = entry.last_employees_run;
  if (e) out.push({ kind: "employees", run: e, note: e.id === trackedId ? null : runNote(e) });
  const a = entry.last_attendance_run;
  if (a) out.push({ kind: "attendance", run: a, note: a.status === "running" ? { type: "attendanceRunning" } : runNote(a) });
  return out;
}

function runNote(run: LastRunRow): LastRunNote | null {
  if (run.status === "blocked") return { type: "blocked", key: inWorkly(blockReasonKey(run.block_reason) ?? "workly.blocked.unknown") };
  if (run.status === "failed") return { type: "error", key: lastRunErrorKey(run) ?? "errors.unknown" };
  return null;
}

export type AttendanceResultKey = "days" | "unknown" | "carried";
export type AttendanceResultLine = { key: AttendanceResultKey; label: string; hint: string; value: number };

const RESULT_KEYS: readonly AttendanceResultKey[] = ["days", "unknown", "carried"];

/**
 * Итог синхронизации посещаемости из run.counts: записано дней, без данных, перенесено.
 * Ключи текстов — от `kpiScreens.workly` (подпись с {count} и пояснение). Поля нет или оно
 * не число — 0: counts приходит из jsonb как Record<string, number | string>.
 */
export function attendanceResultLines(counts: Record<string, number | string> | null | undefined): AttendanceResultLine[] {
  return RESULT_KEYS.map((key) => {
    const raw = counts?.[key];
    const value = raw == null || raw === "" ? 0 : Number(raw);
    return {
      key,
      label: `attendance.result.${key}`,
      hint: `attendance.result.${key}Hint`,
      value: Number.isFinite(value) ? value : 0,
    };
  });
}
