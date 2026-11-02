import { describe, expect, it } from "bun:test";
import { attendanceWindow, buildDays, hhmmToMinutes, tashkentTimestamp, type Person } from "./attendance";
import type { AbsenceItem, LateInItem, T12Day, T12Item } from "./types";

describe("hhmmToMinutes", () => {
  it("часы целым числом, минуты 00..59; остальное null", () => {
    expect(hhmmToMinutes("01:05")).toBe(65);
    expect(hhmmToMinutes("280:00")).toBe(16800);
    expect(hhmmToMinutes("00:00")).toBe(0);
    expect(hhmmToMinutes("08:00")).toBe(480);
    expect(hhmmToMinutes(null)).toBeNull();
    expect(hhmmToMinutes(undefined)).toBeNull();
    expect(hhmmToMinutes("")).toBeNull();
    expect(hhmmToMinutes("abc")).toBeNull();
    expect(hhmmToMinutes("x")).toBeNull();
    expect(hhmmToMinutes("08:60")).toBeNull();
    expect(hhmmToMinutes("-01:00")).toBeNull();
    expect(hhmmToMinutes("1:5")).toBeNull();
  });

  it("секунды допускаются и отбрасываются: опоздание с секундами не становится нулём", () => {
    expect(hhmmToMinutes("00:20:59")).toBe(20);
    expect(hhmmToMinutes("08:00:00")).toBe(480);
    expect(hhmmToMinutes("1:05:30")).toBe(65);
    expect(hhmmToMinutes("280:00:00")).toBe(16800);
    expect(hhmmToMinutes(" 00:05:01 ")).toBe(5);
    // Неверные секунды и прочий мусор — по-прежнему null.
    expect(hhmmToMinutes("08:00:60")).toBeNull();
    expect(hhmmToMinutes("08:00:")).toBeNull();
    expect(hhmmToMinutes("08:00:5")).toBeNull();
    expect(hhmmToMinutes("08:60:00")).toBeNull();
    expect(hhmmToMinutes("08:00:00:00")).toBeNull();
  });
});

describe("tashkentTimestamp", () => {
  it("дата плюс время в поясе +05:00; nextDay — следующие сутки", () => {
    expect(tashkentTimestamp("2026-10-20", "06:05")).toBe("2026-10-20T06:05:00+05:00");
    expect(tashkentTimestamp("2026-10-20", "06:05", true)).toBe("2026-10-21T06:05:00+05:00");
    expect(tashkentTimestamp("2026-10-31", "01:00", true)).toBe("2026-11-01T01:00:00+05:00");
    expect(tashkentTimestamp("2026-12-31", "23:59", true)).toBe("2027-01-01T23:59:00+05:00");
    expect(tashkentTimestamp("2026-10-20", "6:05")).toBe("2026-10-20T06:05:00+05:00");
  });

  it("кривые дата или время — ошибка, а не тихая подмена", () => {
    expect(() => tashkentTimestamp("2026-10-20", "25:00")).toThrow();
    expect(() => tashkentTimestamp("2026-10-20", "abc")).toThrow();
    expect(() => tashkentTimestamp("20.10.2026", "06:05")).toThrow();
  });
});

describe("attendanceWindow", () => {
  it("с первого числа по вчера, но не дальше конца месяца; без прошедших дней — null", () => {
    expect(attendanceWindow("2026-10-01", "2026-10-29")).toEqual({ from: "2026-10-01", to: "2026-10-28" });
    expect(attendanceWindow("2026-10-01", "2026-10-01")).toBeNull();
    expect(attendanceWindow("2026-09-01", "2026-10-29")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(attendanceWindow("2026-10-01", "2026-10-02")).toEqual({ from: "2026-10-01", to: "2026-10-01" });
    // Первое число следующего месяца: прошлый месяц целиком
    expect(attendanceWindow("2026-09-01", "2026-10-01")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    // Будущий месяц
    expect(attendanceWindow("2026-11-01", "2026-10-29")).toBeNull();
    // Февраль високосного года
    expect(attendanceWindow("2028-02-01", "2028-03-15")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("buildDays", () => {
  const FROM = "2026-10-01";
  const TO = "2026-10-28";
  const E1 = { employee_id: "e1", terminal_id: "t1", start_date: null } satisfies Person;
  const E2 = { employee_id: "e2", terminal_id: "t2", start_date: null } satisfies Person;

  const people = (entries: [number, Person][] = [[1, E1]]) => new Map<number, Person>(entries);
  const day = (report_date: string, o: Partial<T12Day> = {}): T12Day => ({
    report_date,
    is_work_day: true,
    is_holiday: false,
    work_time: "00:00",
    ...o,
  });
  const t12 = (employee_id: number, days: T12Day[] | null): T12Item => ({ employee_id, report: days ? { days } : null });
  const late = (id: number, d: string, a: Partial<LateInItem["actual"]> = {}): LateInItem => ({
    employee: { id },
    scheduled: { report_date: d },
    actual: { first_in: "09:00", last_out: "18:00", late_in: null, ...a },
  });
  const absent = (id: number, d: string, s: Partial<AbsenceItem["scheduled"]> = {}): AbsenceItem => ({
    employee: { id },
    scheduled: { report_date: d, is_work_day: true, timeoff_id: null, ...s },
  });
  const run = (o: { people?: Map<number, Person>; t12?: T12Item[]; lateIn?: LateInItem[]; absence?: AbsenceItem[] }) =>
    buildDays({ from: FROM, to: TO, people: o.people ?? people(), t12: o.t12 ?? [], lateIn: o.lateIn ?? [], absence: o.absence ?? [] });
  const row = (d: string, o: Record<string, unknown> = {}) => ({
    employee_id: "e1",
    day: d,
    terminal_id: "t1",
    check_in: null,
    check_out: null,
    late_minutes: 0,
    absent: false,
    ...o,
  });

  it("(а) прогул только из absence", () => {
    const r = run({ t12: [t12(1, [day("2026-10-05")])], absence: [absent(1, "2026-10-05")] });
    expect(r).toEqual({ days: [row("2026-10-05", { absent: true })], unknown: 0 });
  });

  it("(б) плановый день без работы и без absence: строки нет, unknown 1", () => {
    const r = run({ t12: [t12(1, [day("2026-10-05")])] });
    expect(r).toEqual({ days: [], unknown: 1 });
  });

  it("(в) опоздание 01:05 — 65 минут; приход и уход из late-in по Ташкенту", () => {
    const r = run({
      t12: [t12(1, [day("2026-10-05", { work_time: "08:00" })])],
      lateIn: [late(1, "2026-10-05", { first_in: "10:05", last_out: "18:30", late_in: "01:05" })],
    });
    expect(r).toEqual({
      days: [
        row("2026-10-05", {
          check_in: "2026-10-05T10:05:00+05:00",
          check_out: "2026-10-05T18:30:00+05:00",
          late_minutes: 65,
        }),
      ],
      unknown: 0,
    });
  });

  it("(г) late_in: null — 0 минут", () => {
    const r = run({
      t12: [t12(1, [day("2026-10-05", { work_time: "08:00" })])],
      lateIn: [late(1, "2026-10-05", { late_in: null })],
    });
    expect(r.days).toEqual([
      row("2026-10-05", { check_in: "2026-10-05T09:00:00+05:00", check_out: "2026-10-05T18:00:00+05:00", late_minutes: 0 }),
    ]);
  });

  it("присутствие без строки late-in: времена пусты, опоздание 0", () => {
    const r = run({ t12: [t12(1, [day("2026-10-05", { work_time: "08:00" })])] });
    expect(r).toEqual({ days: [row("2026-10-05")], unknown: 0 });
  });

  it("(д) report: null пропускается без ошибки: ни строк (даже из absence и late-in), ни unknown", () => {
    const r = run({
      people: people([
        [1, E1],
        [2, E2],
      ]),
      t12: [t12(1, null), t12(2, [day("2026-10-05", { work_time: "08:00" })])],
      lateIn: [late(1, "2026-10-06")],
      absence: [absent(1, "2026-10-07")],
    });
    expect(r).toEqual({ days: [row("2026-10-05", { employee_id: "e2", terminal_id: "t2" })], unknown: 0 });
  });

  it("(е) праздник пропускается целиком: ни присутствия, ни прогула, ни unknown", () => {
    const r = run({
      t12: [
        t12(1, [
          day("2026-10-05", { is_holiday: true }),
          day("2026-10-06", { is_holiday: true, work_time: "08:00" }),
          day("2026-10-07", { is_holiday: true }),
        ]),
      ],
      lateIn: [late(1, "2026-10-06")],
      absence: [absent(1, "2026-10-07")],
    });
    expect(r).toEqual({ days: [], unknown: 0 });
  });

  it("(е) дни до start_date пропускаются, с start_date — учитываются", () => {
    const p = people([[1, { ...E1, start_date: "2026-10-06" }]]);
    const r = run({
      people: p,
      t12: [
        t12(1, [
          day("2026-10-04"),
          day("2026-10-05", { work_time: "08:00" }),
          day("2026-10-06", { work_time: "08:00" }),
          day("2026-10-07"),
        ]),
      ],
      absence: [absent(1, "2026-10-05"), absent(1, "2026-10-07")],
    });
    expect(r).toEqual({ days: [row("2026-10-06"), row("2026-10-07", { absent: true })], unknown: 0 });
  });

  it("(ж) last_out раньше first_in — уход на следующие сутки (ночная смена)", () => {
    const r = run({
      t12: [t12(1, [day("2026-10-05", { work_time: "03:00" })])],
      lateIn: [late(1, "2026-10-05", { first_in: "22:00", last_out: "01:00" })],
    });
    expect(r.days).toEqual([
      row("2026-10-05", { check_in: "2026-10-05T22:00:00+05:00", check_out: "2026-10-06T01:00:00+05:00" }),
    ]);
  });

  it("(з) timeoff_id не пуст — не прогул и не unknown", () => {
    const r = run({ t12: [t12(1, [day("2026-10-05")])], absence: [absent(1, "2026-10-05", { timeoff_id: 77 })] });
    expect(r).toEqual({ days: [], unknown: 0 });
  });

  it("absence с is_work_day: false — не прогул", () => {
    const r = run({ t12: [t12(1, [day("2026-10-05", { is_work_day: false })])], absence: [absent(1, "2026-10-05", { is_work_day: false })] });
    expect(r).toEqual({ days: [], unknown: 0 });
  });

  it("absence без поля is_work_day — прогул", () => {
    const r = run({
      t12: [t12(1, [day("2026-10-05")])],
      absence: [{ employee: { id: 1 }, scheduled: { report_date: "2026-10-05", timeoff_id: null } }],
    });
    expect(r.days).toEqual([row("2026-10-05", { absent: true })]);
  });

  it("(и) день и в absence, и с work_time 08:00 — присутствие", () => {
    const r = run({ t12: [t12(1, [day("2026-10-05", { work_time: "08:00" })])], absence: [absent(1, "2026-10-05")] });
    expect(r).toEqual({ days: [row("2026-10-05")], unknown: 0 });
  });

  it("день и в absence, и со строкой late-in с first_in — присутствие с опозданием", () => {
    const r = run({
      t12: [t12(1, [day("2026-10-05")])],
      lateIn: [late(1, "2026-10-05", { first_in: "09:20", last_out: null, late_in: "00:20" })],
      absence: [absent(1, "2026-10-05")],
    });
    expect(r.days).toEqual([row("2026-10-05", { check_in: "2026-10-05T09:20:00+05:00", late_minutes: 20 })]);
  });

  it("(к) сотрудник есть в absence и late-in, но нет в T12: строк по нему нет", () => {
    const r = run({
      people: people([
        [1, E1],
        [2, E2],
      ]),
      t12: [t12(1, [day("2026-10-05", { work_time: "08:00" })])],
      lateIn: [late(2, "2026-10-05")],
      absence: [absent(2, "2026-10-06")],
    });
    expect(r).toEqual({ days: [row("2026-10-05")], unknown: 0 });
  });

  it("человек из T12, которого нет в people (чужой или не связан), не пишется", () => {
    const r = run({
      t12: [t12(1, [day("2026-10-05", { work_time: "08:00" })]), t12(9, [day("2026-10-05", { work_time: "08:00" }), day("2026-10-06")])],
      absence: [absent(9, "2026-10-07")],
    });
    expect(r).toEqual({ days: [row("2026-10-05")], unknown: 0 });
  });

  it("late-in с first_in без work_time — присутствие; late-in без first_in — нет", () => {
    const r = run({
      t12: [t12(1, [day("2026-10-05"), day("2026-10-06")])],
      lateIn: [
        late(1, "2026-10-05", { first_in: "09:00", last_out: null }),
        late(1, "2026-10-06", { first_in: null, last_out: null, late_in: null }),
      ],
    });
    expect(r).toEqual({ days: [row("2026-10-05", { check_in: "2026-10-05T09:00:00+05:00" })], unknown: 1 });
  });

  it("работа в выходной по графику (is_work_day: false) — присутствие; выходной без работы не пишется и не unknown", () => {
    const r = run({
      t12: [t12(1, [day("2026-10-05", { is_work_day: false, work_time: "04:00" }), day("2026-10-06", { is_work_day: false })])],
    });
    expect(r).toEqual({ days: [row("2026-10-05")], unknown: 0 });
  });

  it("дни вне окна не пишутся и не считаются", () => {
    const r = buildDays({
      from: "2026-10-02",
      to: "2026-10-03",
      people: people(),
      t12: [t12(1, [day("2026-10-01", { work_time: "08:00" }), day("2026-10-02"), day("2026-10-04")])],
      lateIn: [late(1, "2026-10-04")],
      absence: [absent(1, "2026-10-01"), absent(1, "2026-10-03")],
    });
    expect(r).toEqual({ days: [row("2026-10-03", { absent: true })], unknown: 1 });
  });

  it("повторы пар (сотрудник, день) в отчётах дают одну строку", () => {
    const r = run({
      t12: [
        t12(1, [day("2026-10-05", { work_time: "08:00" }), day("2026-10-05", { work_time: "08:00" }), day("2026-10-06")]),
        t12(1, [day("2026-10-06")]),
      ],
      lateIn: [late(1, "2026-10-05", { late_in: "00:10" }), late(1, "2026-10-05", { late_in: "00:30" })],
      absence: [absent(1, "2026-10-06"), absent(1, "2026-10-06")],
    });
    expect(r).toEqual({
      days: [
        row("2026-10-05", { check_in: "2026-10-05T09:00:00+05:00", check_out: "2026-10-05T18:00:00+05:00", late_minutes: 10 }),
        row("2026-10-06", { absent: true }),
      ],
      unknown: 0,
    });
  });

  it("два workly_id одного нашего сотрудника: одна строка за день, присутствие главнее прогула", () => {
    const r = run({
      people: people([
        [1, E1],
        [2, E1],
      ]),
      t12: [t12(1, [day("2026-10-05")]), t12(2, [day("2026-10-05", { work_time: "08:00" })])],
      absence: [absent(1, "2026-10-05")],
    });
    expect(r).toEqual({ days: [row("2026-10-05")], unknown: 0 });
  });

  it("кривые даты и времена не роняют разбор", () => {
    const r = run({
      t12: [t12(1, [day("2026-13-05", { work_time: "08:00" }), day("2026-10-05", { work_time: "x" }), day("2026-10-06", { work_time: "08:00" })])],
      lateIn: [late(1, "2026-10-06", { first_in: "ab:cd", last_out: "18:00", late_in: "zz" })],
    });
    // 10-05: work_time не читается — работы нет, день плановый: unknown; 10-06: время прихода не читается
    expect(r).toEqual({ days: [row("2026-10-06", { check_out: "2026-10-06T18:00:00+05:00" })], unknown: 1 });
  });
});
