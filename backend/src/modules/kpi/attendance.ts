// Импорт посещаемости Workly: файл живёт в Redis 30 минут, commit заменяет импорт месяца той же организации одной транзакцией.
import { randomUUID } from "node:crypto";
import type { DrizzleDB } from "@backend/lib/db";
import { employees, kpi_attendance, kpi_attendance_effective, kpi_attendance_imports, organization, terminals } from "backend/drizzle/schema";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type Redis from "ioredis";
import { parsePeriod, type DbLike } from "./access";
import {
  fileKind,
  guessHeaderRow,
  matchRows,
  splitBad,
  MAX_UPLOAD_BYTES,
  parseRows,
  previewOf,
  readGrids,
  validateMapping,
  attendanceSuggestion,
  importTotals,
  type AttendanceStats,
  type FileKind,
} from "./attendance-parse";
import { now } from "./clock";
import { activeDaysOff } from "./days-off";
import { userNames } from "./directory";
import { UUID_RE } from "./employees";
import { KpiError } from "./errors";
import { iso } from "./iso";
import { lockPeriodShared } from "./periods";
import { addMonths, type Period } from "./time";
import type { AttendanceImportRow, AttendanceMapping, AttendanceParseResponse, AttendanceTotals, UnmatchedRow } from "./types";

export const UPLOAD_TTL_SECONDS = 1800;
export const UNMATCHED_LIMIT = 500;
const NOTHING_MATCHED_SHOWN = 20;
const INSERT_BATCH = 1000;
const MAX_HEADER_ROW = 20;
const MAX_FILE_NAME = 255;

export const uploadKey = (token: string) => `${process.env.PROJECT_PREFIX}kpi_attendance_upload:${token}`;

type Stored = { user_id: string; file_name: string; kind: FileKind; data: string };

export async function parseUpload(redis: Redis, userId: string, file: unknown): Promise<AttendanceParseResponse> {
  if (!(file instanceof File)) throw new KpiError(422, "file_required");
  const fileName = file.name.trim().slice(0, MAX_FILE_NAME);
  const kind = fileKind(fileName);
  if (!kind) throw new KpiError(422, "bad_file_type");
  if (file.size > MAX_UPLOAD_BYTES) throw new KpiError(422, "file_too_large");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const grids = readGrids(bytes, kind);
  if (grids.length === 0) throw new KpiError(422, "empty_file");

  const token = randomUUID();
  const stored: Stored = { user_id: userId, file_name: fileName, kind, data: Buffer.from(bytes).toString("base64") };
  await redis.set(uploadKey(token), JSON.stringify(stored), "EX", UPLOAD_TTL_SECONDS);
  return {
    token,
    file_name: fileName,
    expires_at: new Date(now().getTime() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
    sheets: grids.map(previewOf),
  };
}

export type ImportDbRow = typeof kpi_attendance_imports.$inferSelect;

// В mapping лежат и итоги по дням: отдельных колонок под них в таблице нет (миграция 0037 одна).
// Пропущенные строки найденных сотрудников там же: у прежних импортов их нет, они читаются как 0.
// source: "api" ставит синхронизация с Workly; у такого импорта листа, строки заголовков и сопоставления колонок нет,
// зато есть окно отчётов и число плановых дней без данных (unknown).
type StoredMapping = {
  sheet?: string;
  header_row?: number;
  mapping?: AttendanceMapping;
  totals?: AttendanceTotals;
  skipped?: { count: number; rows: UnmatchedRow[] };
  source?: "api";
  window?: { from: string; to: string };
  unknown?: number;
};
const NO_TOTALS: AttendanceTotals = { days_present: 0, days_late: 0, days_absent: 0 };

function toImportRow(r: ImportDbRow, names: Map<string, string>): AttendanceImportRow {
  const m = r.mapping as StoredMapping;
  const t = m.totals ?? NO_TOTALS;
  const api = m.source === "api";
  return {
    id: r.id,
    period: r.period,
    file_name: r.file_name,
    uploaded_by: r.uploaded_by,
    uploaded_by_name: r.uploaded_by ? names.get(r.uploaded_by) ?? null : null,
    organization_id: r.organization_id,
    source: api ? "api" : "file",
    sheet: api ? null : m.sheet ?? null,
    header_row: api ? null : m.header_row ?? null,
    mapping: api ? null : m.mapping ?? null,
    rows_total: r.rows_total,
    rows_matched: r.rows_matched,
    rows_unmatched: r.rows_unmatched,
    days_present: t.days_present,
    days_late: t.days_late,
    days_absent: t.days_absent,
    unmatched: r.unmatched as UnmatchedRow[],
    rows_skipped: m.skipped?.count ?? 0,
    skipped: m.skipped?.rows ?? [],
    status: r.status as AttendanceImportRow["status"],
    created_at: iso(r.created_at),
  };
}

async function loadStored(redis: Redis, userId: string, token: unknown): Promise<Stored> {
  if (typeof token !== "string") throw new KpiError(404, "upload_expired");
  const raw = await redis.get(uploadKey(token));
  let stored: Stored | null = null;
  try {
    stored = raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    stored = null;
  }
  // Чужой токен неотличим от истёкшего
  if (!stored || stored.user_id !== userId) throw new KpiError(404, "upload_expired");
  return stored;
}

// День сотрудника для записи: AttendanceDay из matchRows подходит как есть (лишние поля строки не читаются).
export interface AttendanceDayRow {
  employee_id: string;
  day: string;
  terminal_id: string;
  check_in: string | null;
  check_out: string | null;
  late_minutes: number;
  absent: boolean;
}

// Блокировка месяца для записи посещаемости: файловые commit и синхронизация с Workly идут по очереди.
// Закрытый месяц не пишется (409). Повторный вызов в той же транзакции безвреден.
export async function lockAttendancePeriod(tx: DbLike, period: Period): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kpi_attendance:' || ${period}::text))`);
  if (await lockPeriodShared(tx, period)) throw new KpiError(409, "period_closed");
}

// Запись импорта месяца организации: прошлые действующие импорты этой же организации помечаются replaced,
// их дни удаляются, затем вставляются новый импорт и его дни. Импорты других организаций не трогаются. Прежние
// без организации (organization_id IS NULL) тоже: это файловые импорты мастера, который работает на проде
// с 2026-10-27 и до релиза Workly организацию не спрашивал, они могут там быть. Замена по организации их
// не помечает replaced; убирает их оператор после повторной загрузки месяца (docs/superpowers/workly-deploy.md).
// Вызывать внутри транзакции: период блокируется первым делом.
// mapping кладётся в импорт как есть (итоги totals считает вызывающий), skipped — в mapping.skipped.
export async function writeAttendanceImport(
  tx: DbLike,
  a: {
    period: Period;
    organization_id: string;
    file_name: string;
    uploaded_by: string | null;
    mapping: object;
    days: AttendanceDayRow[];
    rows_total: number;
    rows_unmatched: number;
    unmatched: UnmatchedRow[];
    skipped?: unknown;
  }
): Promise<ImportDbRow> {
  await lockAttendancePeriod(tx, a.period);

  const past = await tx
    .update(kpi_attendance_imports)
    .set({ status: "replaced" })
    .where(
      and(
        eq(kpi_attendance_imports.period, a.period),
        eq(kpi_attendance_imports.status, "committed"),
        eq(kpi_attendance_imports.organization_id, a.organization_id)
      )
    )
    .returning({ id: kpi_attendance_imports.id });
  if (past.length > 0) {
    await tx.delete(kpi_attendance).where(inArray(kpi_attendance.import_id, past.map((p) => p.id)));
  }

  const [imp] = await tx
    .insert(kpi_attendance_imports)
    .values({
      period: a.period,
      organization_id: a.organization_id,
      file_name: a.file_name,
      uploaded_by: a.uploaded_by,
      mapping: a.skipped === undefined ? a.mapping : { ...a.mapping, skipped: a.skipped },
      rows_total: a.rows_total,
      rows_matched: a.days.length,
      rows_unmatched: a.rows_unmatched,
      unmatched: a.unmatched,
      status: "committed",
      // clock_timestamp, а не now(): порядок списка совпадает с порядком коммитов
      created_at: sql`clock_timestamp()`,
    })
    .returning();

  for (let i = 0; i < a.days.length; i += INSERT_BATCH) {
    const values = a.days.slice(i, i + INSERT_BATCH).map((d) => ({
      employee_id: d.employee_id,
      day: d.day,
      terminal_id: d.terminal_id,
      check_in: d.check_in,
      check_out: d.check_out,
      late_minutes: d.late_minutes,
      absent: d.absent,
      import_id: imp.id,
    }));
    await tx
      .insert(kpi_attendance)
      .values(values)
      .onConflictDoUpdate({
        target: [kpi_attendance.employee_id, kpi_attendance.day],
        set: {
          terminal_id: sql`excluded.terminal_id`,
          check_in: sql`excluded.check_in`,
          check_out: sql`excluded.check_out`,
          late_minutes: sql`excluded.late_minutes`,
          absent: sql`excluded.absent`,
          import_id: sql`excluded.import_id`,
        },
      });
  }
  return imp;
}

// organization_id тела commit: нет или не строка — organization_required; строка не uuid
// (до базы такое не доходит: Postgres бросил бы 22P02) или не организация — bad_organization.
async function requireOrganization(db: DbLike, raw: unknown): Promise<string> {
  if (typeof raw !== "string") throw new KpiError(422, "organization_required");
  if (!UUID_RE.test(raw)) throw new KpiError(422, "bad_organization");
  const [found] = await db.select({ id: organization.id }).from(organization).where(eq(organization.id, raw)).limit(1);
  if (!found) throw new KpiError(422, "bad_organization");
  return found.id;
}

export async function commitImport(
  db: DrizzleDB,
  redis: Redis,
  userId: string,
  body: Record<string, unknown>
): Promise<AttendanceImportRow> {
  const stored = await loadStored(redis, userId, body.token);
  const period = parsePeriod(body.period);

  const grid = readGrids(Buffer.from(stored.data, "base64"), stored.kind).find((g) => g.name === body.sheet);
  if (!grid) throw new KpiError(422, "bad_sheet");

  let headerRow: number;
  if (body.header_row === undefined || body.header_row === null) headerRow = guessHeaderRow(grid.text);
  else {
    const h = body.header_row;
    if (typeof h !== "number" || !Number.isInteger(h) || h < 1 || h > MAX_HEADER_ROW || h > grid.text.length) {
      throw new KpiError(422, "bad_header_row");
    }
    headerRow = h;
  }

  const width = grid.text.reduce((w, r) => Math.max(w, r.length), 0);
  const mapping = validateMapping(body.mapping, width);
  if (!mapping) throw new KpiError(422, "bad_mapping");

  const organizationId = await requireOrganization(db, body.organization_id);

  const parsed = parseRows(grid, { headerRow, mapping, period });

  const saved = await db.transaction(async (tx) => {
    // Месяц блокируется до чтения сотрудников: закрытый месяц отвечает 409 раньше, чем nothing_matched
    await lockAttendancePeriod(tx, period);

    // Только активные сотрудники филиалов этой организации
    const emps = await tx
      .select({ id: employees.id, terminal_id: employees.terminal_id, external_id: employees.external_id })
      .from(employees)
      .innerJoin(terminals, eq(terminals.id, employees.terminal_id))
      .where(and(eq(employees.active, true), isNotNull(employees.external_id), eq(terminals.organization_id, organizationId)));
    const matched = matchRows(parsed.rows, emps);
    // «Не сопоставлено» — строки без найденного сотрудника; остальные отказы у найденного — «пропущено»
    const { unmatched: unmatchedAll, skipped: skippedAll } = splitBad(parsed.bad, matched.bad, emps);
    if (matched.days.length === 0) {
      throw new KpiError(422, "nothing_matched", {
        rows_total: parsed.total,
        unmatched: [...unmatchedAll, ...skippedAll].sort((a, b) => a.row - b.row).slice(0, NOTHING_MATCHED_SHOWN),
      });
    }

    return writeAttendanceImport(tx, {
      period,
      organization_id: organizationId,
      file_name: stored.file_name,
      uploaded_by: userId,
      mapping: {
        sheet: grid.name,
        header_row: headerRow,
        mapping,
        totals: importTotals(matched.days),
      } satisfies Omit<StoredMapping, "skipped">,
      days: matched.days,
      rows_total: matched.days.length + unmatchedAll.length + skippedAll.length,
      rows_unmatched: unmatchedAll.length,
      unmatched: unmatchedAll.slice(0, UNMATCHED_LIMIT),
      skipped: { count: skippedAll.length, rows: skippedAll.slice(0, UNMATCHED_LIMIT) } satisfies StoredMapping["skipped"],
    });
  });
  return toImportRow(saved, await userNames(db, saved.uploaded_by ? [saved.uploaded_by] : []));
}

export async function listImports(db: DbLike, period: Period): Promise<AttendanceImportRow[]> {
  const rows = await db
    .select()
    .from(kpi_attendance_imports)
    .where(eq(kpi_attendance_imports.period, period))
    .orderBy(desc(kpi_attendance_imports.created_at), desc(kpi_attendance_imports.id));
  const names = await userNames(db, rows.flatMap((r) => (r.uploaded_by ? [r.uploaded_by] : [])));
  return rows.map((r) => toImportRow(r, names));
}

// Статистика сотрудника за месяц по действующему импорту (с учётом двойников: kpi_attendance_effective); без строк null. Прогул Workly, на день которого есть
// неотменённый выходной, из расчёта выпадает (его число — off); присутствие главнее выходного.
export async function attendanceStats(db: DbLike, employeeId: string, period: Period): Promise<AttendanceStats | null> {
  const next = addMonths(period, 1);
  const rows = await db
    .select({ day: kpi_attendance_effective.day, absent: kpi_attendance_effective.absent, late_minutes: kpi_attendance_effective.late_minutes })
    .from(kpi_attendance_effective)
    .where(and(eq(kpi_attendance_effective.employee_id, employeeId), gte(kpi_attendance_effective.day, period), lt(kpi_attendance_effective.day, next)));
  const off = (await activeDaysOff(db, { employeeIds: [employeeId], from: period, to: next })).get(employeeId);
  const kept = off ? rows.filter((r) => !(r.absent && off.has(r.day))) : rows;
  return attendanceSuggestion(kept, rows.length - kept.length);
}
