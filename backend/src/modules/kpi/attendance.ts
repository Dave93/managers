// Импорт посещаемости Workly: файл живёт в Redis 30 минут, commit заменяет импорт месяца одной транзакцией.
import { randomUUID } from "node:crypto";
import type { DrizzleDB } from "@backend/lib/db";
import { employees, kpi_attendance, kpi_attendance_imports } from "backend/drizzle/schema";
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
import { userNames } from "./directory";
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

type ImportDbRow = typeof kpi_attendance_imports.$inferSelect;

// В mapping лежат и итоги по дням: отдельных колонок под них в таблице нет (миграция 0037 одна).
// Пропущенные строки найденных сотрудников там же: у прежних импортов их нет, они читаются как 0.
type StoredMapping = {
  sheet: string;
  header_row: number;
  mapping: AttendanceMapping;
  totals?: AttendanceTotals;
  skipped?: { count: number; rows: UnmatchedRow[] };
};
const NO_TOTALS: AttendanceTotals = { days_present: 0, days_late: 0, days_absent: 0 };

function toImportRow(r: ImportDbRow, names: Map<string, string>): AttendanceImportRow {
  const m = r.mapping as StoredMapping;
  const t = m.totals ?? NO_TOTALS;
  return {
    id: r.id,
    period: r.period,
    file_name: r.file_name,
    uploaded_by: r.uploaded_by,
    uploaded_by_name: names.get(r.uploaded_by) ?? null,
    sheet: m.sheet,
    header_row: m.header_row,
    mapping: m.mapping,
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

  const parsed = parseRows(grid, { headerRow, mapping, period });

  const saved = await db.transaction(async (tx) => {
    // Два commit одного месяца идут по очереди
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kpi_attendance:' || ${period}::text))`);
    if (await lockPeriodShared(tx, period)) throw new KpiError(409, "period_closed");

    const emps = await tx
      .select({ id: employees.id, terminal_id: employees.terminal_id, external_id: employees.external_id })
      .from(employees)
      .where(and(eq(employees.active, true), isNotNull(employees.external_id)));
    const matched = matchRows(parsed.rows, emps);
    // «Не сопоставлено» — строки без найденного сотрудника; остальные отказы у найденного — «пропущено»
    const { unmatched: unmatchedAll, skipped: skippedAll } = splitBad(parsed.bad, matched.bad, emps);
    if (matched.days.length === 0) {
      throw new KpiError(422, "nothing_matched", {
        rows_total: parsed.total,
        unmatched: [...unmatchedAll, ...skippedAll].sort((a, b) => a.row - b.row).slice(0, NOTHING_MATCHED_SHOWN),
      });
    }

    // Прошлый импорт месяца: помечаем и убираем его дни
    const past = await tx
      .update(kpi_attendance_imports)
      .set({ status: "replaced" })
      .where(and(eq(kpi_attendance_imports.period, period), eq(kpi_attendance_imports.status, "committed")))
      .returning({ id: kpi_attendance_imports.id });
    if (past.length > 0) {
      await tx.delete(kpi_attendance).where(inArray(kpi_attendance.import_id, past.map((p) => p.id)));
    }

    const [imp] = await tx
      .insert(kpi_attendance_imports)
      .values({
        period,
        file_name: stored.file_name,
        uploaded_by: userId,
        mapping: {
          sheet: grid.name,
          header_row: headerRow,
          mapping,
          totals: importTotals(matched.days),
          skipped: { count: skippedAll.length, rows: skippedAll.slice(0, UNMATCHED_LIMIT) },
        } satisfies StoredMapping,
        rows_total: matched.days.length + unmatchedAll.length + skippedAll.length,
        rows_matched: matched.days.length,
        rows_unmatched: unmatchedAll.length,
        unmatched: unmatchedAll.slice(0, UNMATCHED_LIMIT),
        status: "committed",
        // clock_timestamp, а не now(): порядок списка совпадает с порядком коммитов
        created_at: sql`clock_timestamp()`,
      })
      .returning();

    for (let i = 0; i < matched.days.length; i += INSERT_BATCH) {
      const values = matched.days.slice(i, i + INSERT_BATCH).map((d) => ({
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
  });
  return toImportRow(saved, await userNames(db, [saved.uploaded_by]));
}

export async function listImports(db: DbLike, period: Period): Promise<AttendanceImportRow[]> {
  const rows = await db
    .select()
    .from(kpi_attendance_imports)
    .where(eq(kpi_attendance_imports.period, period))
    .orderBy(desc(kpi_attendance_imports.created_at), desc(kpi_attendance_imports.id));
  const names = await userNames(db, rows.map((r) => r.uploaded_by));
  return rows.map((r) => toImportRow(r, names));
}

// Статистика сотрудника за месяц по действующему импорту; без строк null.
export async function attendanceStats(db: DbLike, employeeId: string, period: Period): Promise<AttendanceStats | null> {
  const rows = await db
    .select({ absent: kpi_attendance.absent, late_minutes: kpi_attendance.late_minutes })
    .from(kpi_attendance)
    .where(
      and(
        eq(kpi_attendance.employee_id, employeeId),
        gte(kpi_attendance.day, period),
        lt(kpi_attendance.day, addMonths(period, 1))
      )
    );
  return attendanceSuggestion(rows);
}
