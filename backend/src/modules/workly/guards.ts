// Предохранители ночного прогона Workly. Чистая функция: ни базы, ни сети, ни env.
// Ручной «Применить» их не вызывает: человек видел план и сам решил его применить.
// Ночной прогон применяет план без человека, поэтому перед применением сверяет план
// с прошлым успешно применённым прогоном и при любом подозрении останавливается.

export type BlockReason =
  | "first_run"
  | "empty_crawl"
  | "crawl_short"
  | "too_many_deactivations"
  | "too_many_creations";

export interface GuardInput {
  /** Сколько сотрудников план деактивирует. */
  deactivations: number;
  /** Сколько новых сотрудников план создаёт. */
  creations: number;
  /** Сколько активных сотрудников сейчас в организации у нас. */
  orgActive: number;
  /** Сколько активных сотрудников вернул обход Workly в этом прогоне. */
  activeFetched: number;
  /** Прошлый успешно применённый прогон; null, если его ещё не было. */
  lastApplied: { activeFetched: number } | null;
}

export type GuardResult = { ok: true } | { ok: false; reason: BlockReason };

// Обход короче 90% от прошлого применённого считается неполным.
const CRAWL_SHORT_RATIO = 0.9;
// Деактиваций можно не больше 10% активных, но не меньше 10 штук (для маленьких организаций).
const DEACTIVATION_SHARE = 0.1;
const DEACTIVATION_FLOOR = 10;
// Новых сотрудников за один ночной прогон не больше 50.
const MAX_CREATIONS = 50;

// Порядок проверок важен: reason пишется в журнал прогона, и первой должна
// называться самая «грубая» причина. Все сравнения строгие, пороги не округляются.
export function checkGuards(i: GuardInput): GuardResult {
  // Без прошлого применённого прогона сравнивать не с чем: первый прогон применяет человек.
  if (!i.lastApplied) return { ok: false, reason: "first_run" };

  // Пустой обход: Workly не отдал ни одного активного. Скорее сбой, чем массовое увольнение.
  if (i.activeFetched === 0) return { ok: false, reason: "empty_crawl" };

  // Обход заметно короче прошлого: часть списка, скорее всего, не дочитана.
  if (i.activeFetched < CRAWL_SHORT_RATIO * i.lastApplied.activeFetched) {
    return { ok: false, reason: "crawl_short" };
  }

  if (i.deactivations > Math.max(DEACTIVATION_FLOOR, DEACTIVATION_SHARE * i.orgActive)) {
    return { ok: false, reason: "too_many_deactivations" };
  }

  if (i.creations > MAX_CREATIONS) return { ok: false, reason: "too_many_creations" };

  return { ok: true };
}

// ---------- защита ночной посещаемости ----------
//
// Посещаемость плана не строит: прогон сразу заменяет импорт месяца. Обрезанный отчёт Workly (T12, late-in
// или absence дочитан не до конца) заменил бы импорт неполными днями, и прогон закончился бы успешно.
// Поэтому ночной прогон сравнивает результат с действующим api-импортом того же месяца до записи и при
// любом подозрении отказывает (executeRun пишет failed/crawl_short, прежний импорт остаётся).
// Ручную синхронизацию защита не касается: человек сам решил заменить импорт.

export interface AttendanceSnapshot {
  /** Дни со строкой: присутствие и прогул. */
  rows: number;
  /** Из них с отметкой прихода (она приходит из late-in). */
  withCheckIn: number;
}

export interface AttendanceGuardInput {
  /** Действующий api-импорт месяца в общем окне с новым результатом; null — сравнивать не с чем. */
  previous: AttendanceSnapshot | null;
  /** Новый результат в том же окне. */
  next: AttendanceSnapshot;
  /** Плановые дни без строки (нет ни работы, ни записи absence) в том же общем окне, что и next. */
  unknown: number;
}

export type AttendanceGuardResult = { ok: true } | { ok: false; check: "rows" | "check_in" | "unknown" };

// Меньше стольких строк в прежнем импорте — базы для сравнения нет (маленькая организация, начало месяца).
const ATTENDANCE_MIN_BASELINE = 50;
// Как у crawl_short сотрудников: результат короче 90% прежнего считается неполным.
const ATTENDANCE_SHORT_RATIO = 0.9;
// Плановых дней без строки больше 5%: на проде 2026-11-05 было 0,7–2,3%.
const ATTENDANCE_MAX_UNKNOWN_SHARE = 0.05;

// Порядок проверок: самая грубая причина первой. Все сравнения строгие.
export function checkAttendanceGuards(i: AttendanceGuardInput): AttendanceGuardResult {
  if (!i.previous || i.previous.rows < ATTENDANCE_MIN_BASELINE) return { ok: true };
  // Обрезанный T12: людей нет в результате, их дни не перенеслись.
  if (i.next.rows < ATTENDANCE_SHORT_RATIO * i.previous.rows) return { ok: false, check: "rows" };
  // Обрезанный late-in: люди и дни те же, но отметки пропали.
  if (i.next.withCheckIn < ATTENDANCE_SHORT_RATIO * i.previous.withCheckIn) return { ok: false, check: "check_in" };
  // Обрезанный absence: прогулы пропали, плановые дни ушли в «неизвестно».
  const total = i.next.rows + i.unknown;
  if (total > 0 && i.unknown > ATTENDANCE_MAX_UNKNOWN_SHARE * total) return { ok: false, check: "unknown" };
  return { ok: true };
}

/** Строки и приходы за дни до to включительно (YYYY-MM-DD сравниваются как строки). */
export function attendanceSnapshot(rows: readonly { day: string; check_in: string | null }[], to: string): AttendanceSnapshot {
  let n = 0;
  let withCheckIn = 0;
  for (const r of rows) {
    if (r.day > to) continue;
    n++;
    if (r.check_in != null) withCheckIn++;
  }
  return { rows: n, withCheckIn };
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Последний день окна прежнего импорта, если это api-импорт (mapping.source = "api") с настоящей датой
 * mapping.window.to; иначе null. Файловый импорт базой не служит: у него другой состав и нет окна.
 */
export function previousApiWindowEnd(mapping: unknown): string | null {
  const m = mapping as { source?: unknown; window?: { to?: unknown } | null } | null;
  if (typeof m !== "object" || m === null || m.source !== "api") return null;
  const to = m.window?.to;
  if (typeof to !== "string") return null;
  const parts = DAY_RE.exec(to);
  if (!parts) return null;
  const t = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  const back = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  return back === to ? to : null;
}
