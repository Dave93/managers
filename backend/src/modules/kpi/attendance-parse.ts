// Разбор выгрузки Workly: файл → сетка → строки → сопоставление с сотрудниками.
// Чистый модуль: без БД и Redis. Время из файла считается ташкентским (UTC+5).
import * as XLSX from "xlsx";
import { KpiError } from "./errors";
import { addMonths, type Period } from "./time";
import type { AttendanceMapping, AttendanceSheetPreview, UnmatchedRow } from "./types";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const PREVIEW_ROWS = 20;
// Пределы листа: заявленный в файле диапазон без них может съесть всю память
export const MAX_ROWS = 50000;
export const MAX_COLS = 100;
const HEADER_SCAN_ROWS = 20;
const TASHKENT_OFFSET_SEC = 5 * 3600;
const DAY_SEC = 24 * 3600;
// Серийная дата Excel для 9999-12-31: больше этого числа датой не считаем
const MAX_SERIAL = 2958465;

export type FileKind = "xlsx" | "xls" | "csv";
export type Cell = string | number | boolean | null;
// raw[i][j] и text[i][j] — ячейка строки i+1, колонки j+1 листа, отсчёт всегда от A1
export type Grid = { name: string; raw: Cell[][]; text: string[][] };

export function fileKind(fileName: string): FileKind | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return ext === "xlsx" || ext === "xls" || ext === "csv" ? ext : null;
}

const badFile = () => new KpiError(422, "bad_file");

// Индекс первого значимого байта: после BOM и пробелов
function htmlStart(b: Uint8Array): number {
  let i = startsWith(b, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  return i;
}

// HTML-таблица под видом xls: перед "<" могут идти BOM и пробелы
const looksLikeHtml = (b: Uint8Array) => b[htmlStart(b)] === 0x3c;

const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);

function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1251").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

export function readGrids(bytes: Uint8Array, kind: FileKind): Grid[] {
  let wb: XLSX.WorkBook;
  try {
    if (kind === "csv") {
      if (bytes.length === 0) return [];
      wb = XLSX.read(decodeCsv(bytes), { type: "string", raw: true, sheetRows: MAX_ROWS + 1 });
    } else {
      const ok =
        kind === "xlsx"
          ? startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
          : startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) || looksLikeHtml(bytes);
      if (!ok) throw badFile();
      // SheetJS узнаёт HTML только по первому символу: BOM и пробелы срезаем сами
      const body = kind === "xls" && !startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) ? bytes.subarray(htmlStart(bytes)) : bytes;
      wb = XLSX.read(body, { type: "array", raw: true, cellDates: false, sheetRows: MAX_ROWS + 1 });
    }
  } catch (e) {
    if (e instanceof KpiError) throw e;
    throw badFile();
  }

  const grids: Grid[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    // Диапазон всегда от A1, чтобы номера строк и колонок совпадали с Excel
    const e = XLSX.utils.decode_range(ws["!ref"]).e;
    if (e.r + 1 > MAX_ROWS || e.c + 1 > MAX_COLS) throw new KpiError(422, "sheet_too_large", { max_rows: MAX_ROWS, max_cols: MAX_COLS });
    const range = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e });
    const raw = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true, range });
    const text = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "", blankrows: true, range });
    if (text.every((r) => r.every((c) => String(c).trim() === ""))) continue;
    grids.push({ name, raw, text: text.map((r) => r.map((c) => String(c))) });
  }
  return grids;
}

const nonEmpty = (r: string[]) => r.filter((c) => c.trim() !== "").length;

export function guessHeaderRow(text: string[][]): number {
  const i = text.slice(0, HEADER_SCAN_ROWS).findIndex((r) => nonEmpty(r) >= 2);
  return i < 0 ? 1 : i + 1;
}

export function previewOf(g: Grid): AttendanceSheetPreview {
  const width = g.text.reduce((w, r) => Math.max(w, r.length), 0);
  const pad = (r: string[] = []) => [...r, ...Array(Math.max(0, width - r.length)).fill("")];
  const header_row = guessHeaderRow(g.text);
  return {
    name: g.name,
    header_row,
    headers: pad(g.text[header_row - 1]),
    rows: g.text.slice(0, PREVIEW_ROWS).map((r) => pad(r)),
    total_rows: g.text.length,
  };
}

// ---------- ячейки ----------

type Ymd = { y: number; m: number; d: number };
type Hms = { H: number; M: number; S: number };

function validYmd(y: number, m: number, d: number): Ymd | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d } : null;
}

function validHms(H: number, M: number, S: number): Hms | null {
  return H >= 0 && H <= 23 && M >= 0 && M <= 59 && S >= 0 && S <= 59 ? { H, M, S } : null;
}

function serialYmd(v: number): Ymd | null {
  if (!(v >= 1) || v > MAX_SERIAL) return null;
  const p = XLSX.SSF.parse_date_code(Math.floor(v));
  return p ? validYmd(p.y, p.m, p.d) : null;
}

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const DATE_RE = /^(?:(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2}))(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

function parseTimeStr(s: string): Hms | null {
  const m = TIME_RE.exec(s);
  return m ? validHms(Number(m[1]), Number(m[2]), Number(m[3] ?? 0)) : null;
}

// Строка с датой и, возможно, временем
function parseDateStr(s: string): { date: Ymd; time: Hms | null } | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const date = m[3] !== undefined ? validYmd(Number(m[3]), Number(m[2]), Number(m[1])) : validYmd(Number(m[4]), Number(m[5]), Number(m[6]));
  if (!date) return null;
  if (m[7] === undefined) return { date, time: null };
  const time = validHms(Number(m[7]), Number(m[8]), Number(m[9] ?? 0));
  return time ? { date, time } : null;
}

const two = (n: number) => String(n).padStart(2, "0");
const dayStr = (d: Ymd) => `${d.y}-${two(d.m)}-${two(d.d)}`;

export function parseDay(v: Cell): string | null {
  if (typeof v === "number") {
    const d = serialYmd(v);
    return d ? dayStr(d) : null;
  }
  if (typeof v !== "string") return null;
  const p = parseDateStr(v.trim());
  return p ? dayStr(p.date) : null;
}

const isBlank = (v: Cell) => v === null || (typeof v === "string" && v.trim() === "");

// Секунды от полуночи ташкентского дня → ISO в UTC
function isoAt(d: Ymd, secs: number): string {
  return new Date(Date.UTC(d.y, d.m - 1, d.d) + (secs - TASHKENT_OFFSET_SEC) * 1000).toISOString();
}

export function parseTime(v: Cell, day: string): string | null | "bad" {
  if (isBlank(v)) return null;
  const base = validYmd(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)));
  if (!base) return "bad";
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return "bad";
    if (v < 1) return isoAt(base, Math.round(v * DAY_SEC));
    const d = serialYmd(v);
    return d ? isoAt(d, Math.round((v - Math.floor(v)) * DAY_SEC)) : "bad";
  }
  if (typeof v !== "string") return "bad";
  const s = v.trim();
  const t = parseTimeStr(s);
  if (t) return isoAt(base, t.H * 3600 + t.M * 60 + t.S);
  const p = parseDateStr(s);
  return p && p.time ? isoAt(p.date, p.time.H * 3600 + p.time.M * 60 + p.time.S) : "bad";
}

const MAX_LATE = 1440; // сутки; колонка int4, больше — это не опоздание

export function parseLate(v: Cell): number | "bad" {
  const n = lateRaw(v);
  return n !== "bad" && n > MAX_LATE ? "bad" : n;
}

function lateRaw(v: Cell): number | "bad" {
  if (isBlank(v)) return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return "bad";
    if (Number.isInteger(v)) return v;
    return v < 1 ? Math.round(v * 1440) : "bad";
  }
  if (typeof v !== "string") return "bad";
  const s = v.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : "bad";
}

const ABSENT_WORDS = new Set(["1", "да", "yes", "true", "+", "прогул"]);

export function parseAbsent(v: Cell): boolean {
  if (v === true || v === 1) return true;
  return typeof v === "string" && ABSENT_WORDS.has(v.trim().toLowerCase());
}

const FIELDS = ["external_id", "date", "check_in", "check_out", "late_minutes", "absent"] as const;
const REQUIRED = ["external_id", "date"] as const;

export function validateMapping(m: unknown, width: number): AttendanceMapping | null {
  if (typeof m !== "object" || m === null || Array.isArray(m)) return null;
  const src = m as Record<string, unknown>;
  if (Object.keys(src).some((k) => !(FIELDS as readonly string[]).includes(k))) return null;
  const out: Record<string, number> = {};
  for (const f of FIELDS) {
    const v = src[f];
    if (v === null || v === undefined) {
      if ((REQUIRED as readonly string[]).includes(f)) return null;
      continue;
    }
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= width) return null;
    out[f] = v;
  }
  return out as AttendanceMapping;
}

// ---------- строки ----------

export type ParsedRow = { row: number; external_id: string; day: string; check_in: string | null; check_out: string | null; late_minutes: number; absent: boolean };

// Время без даты: число < 1 или «Ч:ММ[:СС]». Только к нему применимо правило ночной смены.
const timeOnly = (v: Cell) => (typeof v === "number" ? v >= 0 && v < 1 : typeof v === "string" && TIME_RE.test(v.trim()));

export function parseRows(
  g: Grid,
  o: { headerRow: number; mapping: AttendanceMapping; period: Period }
): { total: number; rows: ParsedRow[]; bad: UnmatchedRow[] } {
  const { mapping: m, period } = o;
  const end = addMonths(period, 1);
  const rawAt = (i: number, c: number | undefined): Cell => (c === undefined ? null : g.raw[i]?.[c] ?? null);
  const textAt = (i: number, c: number) => g.text[i]?.[c] ?? "";
  const rows: ParsedRow[] = [];
  const bad: UnmatchedRow[] = [];
  let total = 0;

  for (let i = o.headerRow; i < g.text.length; i++) {
    if (g.text[i].every((c) => c.trim() === "")) continue;
    total++;
    const row = i + 1;
    const external_id = textAt(i, m.external_id).trim();
    if (!external_id) {
      bad.push({ row, external_id: null, reason: "no_external_id" });
      continue;
    }
    const fail = (reason: UnmatchedRow["reason"]) => bad.push({ row, external_id, reason });
    const day = parseDay(rawAt(i, m.date));
    if (!day) { fail("bad_date"); continue; }
    if (day < period || day >= end) { fail("outside_period"); continue; }

    const inRaw = rawAt(i, m.check_in);
    const outRaw = rawAt(i, m.check_out);
    const inT = m.check_in === undefined ? null : parseTime(inRaw, day);
    let outT = m.check_out === undefined ? null : parseTime(outRaw, day);
    if (inT === "bad" || outT === "bad") { fail("bad_time"); continue; }
    // Уход раньше прихода при времени без даты — ночная смена
    if (inT && outT && timeOnly(outRaw) && outT < inT) {
      outT = new Date(new Date(outT).getTime() + DAY_SEC * 1000).toISOString();
    }
    const late = m.late_minutes === undefined ? 0 : parseLate(rawAt(i, m.late_minutes));
    if (late === "bad") { fail("bad_late"); continue; }

    rows.push({
      row,
      external_id,
      day,
      check_in: inT,
      check_out: outT,
      late_minutes: late,
      absent: m.absent === undefined ? false : parseAbsent(rawAt(i, m.absent)),
    });
  }
  return { total, rows, bad };
}

// ---------- сопоставление ----------

export type MatchEmployee = { id: string; terminal_id: string; external_id: string | null };
export type AttendanceDay = ParsedRow & { employee_id: string; terminal_id: string };

export function matchRows(rows: ParsedRow[], employees: MatchEmployee[]): { days: AttendanceDay[]; bad: UnmatchedRow[] } {
  const byId = new Map<string, MatchEmployee[]>();
  for (const e of employees) {
    const k = e.external_id?.trim();
    if (!k) continue;
    byId.set(k, [...(byId.get(k) ?? []), e]);
  }
  const days: AttendanceDay[] = [];
  const bad: UnmatchedRow[] = [];
  const taken = new Set<string>();
  for (const r of rows) {
    const key = r.external_id.trim();
    const found = byId.get(key) ?? [];
    if (found.length === 0) { bad.push({ row: r.row, external_id: r.external_id, reason: "unknown_external_id" }); continue; }
    if (found.length > 1) { bad.push({ row: r.row, external_id: r.external_id, reason: "ambiguous_external_id" }); continue; }
    const e = found[0];
    const dk = `${e.id}|${r.day}`;
    if (taken.has(dk)) { bad.push({ row: r.row, external_id: r.external_id, reason: "duplicate_day" }); continue; }
    taken.add(dk);
    days.push({ ...r, employee_id: e.id, terminal_id: e.terminal_id });
  }
  return { days, bad };
}

// ---------- предложение ----------

export type AttendanceStats = { days: number; ontime: number; late: number; absent: number; score: number; basis: string };

function dayWord(n: number): string {
  const t = n % 100;
  const u = n % 10;
  if (t >= 11 && t <= 14) return "дней";
  if (u === 1) return "день";
  if (u >= 2 && u <= 4) return "дня";
  return "дней";
}

export function attendanceSuggestion(rows: { absent: boolean; late_minutes: number }[]): AttendanceStats | null {
  if (rows.length === 0) return null;
  const days = rows.length;
  const absent = rows.filter((r) => r.absent).length;
  const ontime = rows.filter((r) => !r.absent && r.late_minutes === 0).length;
  const late = rows.filter((r) => !r.absent && r.late_minutes > 0).length;
  const score = Math.round((100 * ontime) / days);
  return { days, ontime, late, absent, score, basis: `Workly: ${days} ${dayWord(days)}, вовремя ${ontime}, опозданий ${late}, прогулов ${absent}` };
}
