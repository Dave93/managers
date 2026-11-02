// Посещаемость из отчётов Workly (раздел 5.6 спеки): T12, late-in и absence превращаются
// в дни kpi_attendance и записываются обычным импортом месяца организации (source: "api").
//
// Окно: с первого числа месяца по вчерашний день по Ташкенту, но не дальше конца месяца.
// Все даты отчётов — местные строки YYYY-MM-DD, времена — местные ЧЧ:ММ без даты;
// через Date в поясе хоста они не проходят.
import type { DrizzleDB } from "@backend/lib/db";
import { employees, kpi_attendance, kpi_attendance_imports, terminals } from "backend/drizzle/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import type { DbLike } from "../kpi/access";
import { lockAttendancePeriod, writeAttendanceImport, type AttendanceDayRow } from "../kpi/attendance";
import { importTotals } from "../kpi/attendance-parse";
import { now } from "../kpi/clock";
import { KpiError } from "../kpi/errors";
import { isPeriodClosed } from "../kpi/periods";
import { addMonths, isPeriod, tashkentDay, type Period } from "../kpi/time";
import type { WorklyClient } from "./client";
import type { AbsenceItem, LateInItem, T12Item } from "./types";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Длительность: часы любым целым (суммы за месяц бывают 280:00), минуты 00..59, секунды
// 00..59 необязательны и отбрасываются. Без них «00:20:59» в late_in стало бы null, то есть
// нулём опоздания: сотрудник вышел бы «вовремя».
const DURATION_RE = /^(\d+):([0-5]\d)(?::[0-5]\d)?$/;
// Время суток: ЧЧ:ММ, секунды, если вдруг придут, отбрасываются.
const CLOCK_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

const pad = (n: number) => String(n).padStart(2, "0");

// Сдвиг календарной даты на n дней. Date только в UTC: пояс хоста не участвует.
function addDays(day: string, n: number): string {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error("workly: неверная дата");
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// Настоящая календарная дата YYYY-MM-DD (не 2026-13-05 и не 2026-02-30).
function isDay(s: unknown): s is string {
  return typeof s === "string" && DAY_RE.test(s) && addDays(s, 0) === s;
}

// Минуты от начала суток; null — не время суток.
function clockMinutes(s: string | null | undefined): number | null {
  if (typeof s !== "string") return null;
  const m = CLOCK_RE.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? h * 60 + mi : null;
}

// "01:05" → 65, "280:00" → 16800, "00:00" → 0, "00:20:59" → 20; null, пусто и мусор → null.
export function hhmmToMinutes(s: string | null | undefined): number | null {
  if (typeof s !== "string") return null;
  const m = DURATION_RE.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Местное время Ташкента в ISO с поясом: "2026-10-20","06:05" → "2026-10-20T06:05:00+05:00".
// nextDay — выход ночной смены на следующие сутки.
export function tashkentTimestamp(day: string, hhmm: string, nextDay = false): string {
  const min = clockMinutes(hhmm);
  if (!isDay(day) || min === null) throw new Error("workly: неверная дата или время отметки");
  const d = nextDay ? addDays(day, 1) : day;
  return `${d}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00+05:00`;
}

// Окно отчётов месяца: с первого числа по min(последний день месяца, вчера). null — прошедших дней нет.
export function attendanceWindow(period: Period, today: string): { from: string; to: string } | null {
  if (!isPeriod(period) || !isDay(today)) throw new Error("workly: неверный месяц или день");
  const last = addDays(addMonths(period, 1), -1);
  const yesterday = addDays(today, -1);
  const to = yesterday < last ? yesterday : last;
  return to < period ? null : { from: period, to };
}

// Наш сотрудник, связанный с записью Workly; start_date — из списка сотрудников Workly.
export interface Person {
  employee_id: string;
  terminal_id: string;
  start_date: string | null;
}

// Всё, что отчёты говорят об одном дне одного человека.
interface DayFacts {
  planned: boolean; // T12: рабочий по графику и не праздник
  holiday: boolean;
  worked: boolean; // T12: work_time > 0
  late: LateInItem["actual"] | null;
  absenceRow: boolean; // строка в absence есть (в том числе оформленное отсутствие)
  absent: boolean; // прогул: timeoff_id пуст и день рабочий
}

/**
 * Дни посещаемости из отчётов. Участвует только человек из people, у которого есть элемент
 * T12 с отчётом: уволенных посреди месяца T12 не содержит, строки late-in и absence о них
 * (и о людях не из people) игнорируются. В каждом дне окна (не раньше start_date, не праздник):
 * работа (work_time > 0 или строка late-in с first_in) — присутствие, опоздание и отметки из
 * late-in; иначе неоформленное отсутствие из absence — прогул; иначе плановый день без строки
 * absence не пишется и считается в unknown. Пара (сотрудник, день) даёт не больше одной строки.
 */
export function buildDays(i: {
  from: string;
  to: string;
  people: ReadonlyMap<number, Person>;
  t12: T12Item[];
  lateIn: LateInItem[];
  absence: AbsenceItem[];
}): { days: AttendanceDayRow[]; unknown: number } {
  const inWindow = (d: unknown): d is string => isDay(d) && d >= i.from && d <= i.to;

  // workly_id → день → факты. Ключи вставляются в порядке T12.
  const facts = new Map<number, Map<string, DayFacts>>();
  for (const item of i.t12) {
    if (item?.report && i.people.has(item.employee_id) && !facts.has(item.employee_id)) facts.set(item.employee_id, new Map());
  }
  const factsOf = (wid: unknown, day: unknown): DayFacts | null => {
    if (typeof wid !== "number") return null;
    const byDay = facts.get(wid);
    if (!byDay || !inWindow(day)) return null;
    let f = byDay.get(day);
    if (!f) {
      f = { planned: false, holiday: false, worked: false, late: null, absenceRow: false, absent: false };
      byDay.set(day, f);
    }
    return f;
  };

  for (const item of i.t12) {
    if (!item?.report || !Array.isArray(item.report.days)) continue;
    for (const d of item.report.days) {
      const f = factsOf(item.employee_id, d?.report_date);
      if (!f) continue;
      f.holiday ||= d.is_holiday === true;
      f.planned ||= d.is_work_day === true && d.is_holiday !== true;
      f.worked ||= (hhmmToMinutes(d.work_time) ?? 0) > 0;
    }
  }
  for (const r of i.lateIn) {
    const f = factsOf(r?.employee?.id, r?.scheduled?.report_date);
    if (!f || !r.actual) continue;
    // Повтор дня: первая строка с отметкой прихода главнее строки без неё.
    if (!f.late || (clockMinutes(f.late.first_in) === null && clockMinutes(r.actual.first_in) !== null)) f.late = r.actual;
  }
  for (const r of i.absence) {
    const f = factsOf(r?.employee?.id, r?.scheduled?.report_date);
    if (!f) continue;
    f.absenceRow = true;
    if (r.scheduled.timeoff_id == null && r.scheduled.is_work_day !== false) f.absent = true;
  }

  const out = new Map<string, AttendanceDayRow>();
  let unknown = 0;
  for (const [wid, byDay] of facts) {
    const p = i.people.get(wid)!;
    for (const day of [...byDay.keys()].sort()) {
      const f = byDay.get(day)!;
      if ((p.start_date && day < p.start_date) || f.holiday) continue;
      const inMin = clockMinutes(f.late?.first_in);
      const present = f.worked || inMin !== null;
      let row: AttendanceDayRow | null = null;
      if (present) {
        const outMin = clockMinutes(f.late?.last_out);
        row = {
          employee_id: p.employee_id,
          day,
          terminal_id: p.terminal_id,
          check_in: inMin !== null ? tashkentTimestamp(day, f.late!.first_in!) : null,
          check_out: outMin !== null ? tashkentTimestamp(day, f.late!.last_out!, inMin !== null && outMin < inMin) : null,
          late_minutes: hhmmToMinutes(f.late?.late_in) ?? 0,
          absent: false,
        };
      } else if (f.absent) {
        row = { employee_id: p.employee_id, day, terminal_id: p.terminal_id, check_in: null, check_out: null, late_minutes: 0, absent: true };
      } else if (f.planned && !f.absenceRow) {
        unknown++;
      }
      if (!row) continue;
      // Два workly_id у одного нашего сотрудника: одна строка за день, присутствие главнее прогула.
      const key = `${p.employee_id}|${day}`;
      const prev = out.get(key);
      if (!prev || (prev.absent && !row.absent)) out.set(key, row);
    }
  }
  return { days: [...out.values()], unknown };
}

// Окно месяца для синхронизации либо отказ: закрытый месяц — 409, месяц без прошедших дней — 422.
async function syncWindow(db: DbLike, period: Period): Promise<{ from: string; to: string }> {
  if (await isPeriodClosed(db, period)) throw new KpiError(409, "period_closed");
  const window = attendanceWindow(period, tashkentDay(now()));
  if (!window) throw new KpiError(422, "period_not_started");
  return window;
}

// Проверка до постановки задачи (маршрут вызывает её до startRun).
export async function assertAttendanceSyncable(db: DbLike, period: Period): Promise<void> {
  await syncWindow(db, period);
}

const startDateOf = (s: unknown): string | null => {
  const d = typeof s === "string" ? s.slice(0, 10) : null;
  return isDay(d) ? d : null;
};

/**
 * Пересобирает посещаемость месяца организации из отчётов Workly и пишет её импортом
 * (file_name "Workly API", mapping.source "api"), заменяющим прежний импорт этой организации.
 *
 * Люди — наши сотрудники филиалов организации, связанные именно с компанией клиента
 * (workly_id не пуст, workly_company_id совпадает), активные и нет. Связанные с другой
 * компанией и сотрудники других организаций не пишутся, даже если их id есть в отчётах.
 *
 * Перенос (carried): дни связанных сотрудников организации, чьего workly_id нет ни в списке
 * сотрудников Workly, ни в элементах T12 (уволен посреди месяца), копируются из прежнего
 * импорта как есть. Кто в отчётах есть, не переносится: его дни целиком заменяются свежими,
 * чтобы исправления в Workly доходили. Уволенный до первой синхронизации месяца остаётся без дней.
 *
 * Первый api-прогон организации заменяет её файловый импорт за месяц: побеждает последняя запись.
 *
 * Пустой обход — сбой, а не «в этом месяце никого»: пустой T12 или ни одного дня к записи
 * (ни свежих, ни перенесённых) дают 422 empty_crawl, и прежний импорт месяца остаётся как был.
 *
 * Обращения к Workly — до транзакции и строго по одному. В транзакции: блокировка месяца,
 * чтение сотрудников и переносимых дней, запись. Месяц, закрытый во время обхода, даёт 409.
 */
export async function runAttendance(
  db: DrizzleDB,
  client: Pick<WorklyClient, "companyId" | "employees" | "t12" | "lateIn" | "absence">,
  org: { id: string },
  period: Period,
  userId: string | null
): Promise<{ import_id: string; days: number; unknown: number; carried: number }> {
  const window = await syncWindow(db, period);

  const companyId = await client.companyId();
  const listed = await client.employees();
  const t12 = await client.t12(window.from, window.to);
  // T12 содержит всех активных (у обеих компаний их сотни): пустой ответ — сбой обхода.
  if (t12.length === 0) throw new KpiError(422, "empty_crawl");
  const lateIn = await client.lateIn(window.from, window.to);
  const absence = await client.absence(window.from, window.to);

  const startDates = new Map(listed.map((w) => [w.id, startDateOf(w.start_date)]));
  // Кого Workly ещё знает: такие люди не переносятся.
  const seen = new Set<number>([...listed.map((w) => w.id), ...t12.map((t) => t.employee_id)]);

  return db.transaction(async (tx) => {
    await lockAttendancePeriod(tx, period);

    const linked = await tx
      .select({ id: employees.id, terminal_id: employees.terminal_id, workly_id: employees.workly_id })
      .from(employees)
      .innerJoin(terminals, eq(terminals.id, employees.terminal_id))
      .where(
        and(eq(terminals.organization_id, org.id), isNotNull(employees.workly_id), eq(employees.workly_company_id, companyId))
      );
    const people = new Map<number, Person>();
    for (const e of linked) {
      people.set(e.workly_id!, { employee_id: e.id, terminal_id: e.terminal_id, start_date: startDates.get(e.workly_id!) ?? null });
    }
    const built = buildDays({ ...window, people, t12, lateIn, absence });

    // Дни действующего импорта организации за месяц у людей, которых Workly уже не знает.
    const previous = await tx
      .select({
        employee_id: kpi_attendance.employee_id,
        day: kpi_attendance.day,
        terminal_id: kpi_attendance.terminal_id,
        check_in: kpi_attendance.check_in,
        check_out: kpi_attendance.check_out,
        late_minutes: kpi_attendance.late_minutes,
        absent: kpi_attendance.absent,
        workly_id: employees.workly_id,
      })
      .from(kpi_attendance)
      .innerJoin(kpi_attendance_imports, eq(kpi_attendance_imports.id, kpi_attendance.import_id))
      .innerJoin(employees, eq(employees.id, kpi_attendance.employee_id))
      .innerJoin(terminals, eq(terminals.id, employees.terminal_id))
      .where(
        and(
          eq(kpi_attendance_imports.period, period),
          eq(kpi_attendance_imports.status, "committed"),
          eq(kpi_attendance_imports.organization_id, org.id),
          eq(terminals.organization_id, org.id),
          isNotNull(employees.workly_id),
          eq(employees.workly_company_id, companyId)
        )
      );
    const carried: AttendanceDayRow[] = previous
      .filter((r) => !seen.has(r.workly_id!))
      .map(({ workly_id: _, ...r }) => r);

    // Перенесённые и свежие дни не пересекаются: у перенесённого сотрудника нет элемента T12.
    const days = [...built.days, ...carried];
    // Писать нечего — значит, отчёты не о нас: прежний импорт не заменяем (откат транзакции).
    if (days.length === 0) throw new KpiError(422, "empty_crawl");
    const imp = await writeAttendanceImport(tx, {
      period,
      organization_id: org.id,
      file_name: "Workly API",
      uploaded_by: userId,
      mapping: { source: "api", totals: importTotals(days), window, unknown: built.unknown },
      days,
      rows_total: days.length,
      rows_unmatched: 0,
      unmatched: [],
    });
    return { import_id: imp.id, days: days.length, unknown: built.unknown, carried: carried.length };
  });
}
