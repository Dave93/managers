import { describe, expect, it } from "bun:test";
import type { BoardDay, BoardEmployee } from "@admin/lib/kpi-api";
import {
  absentShare,
  absentStreak,
  branchStats,
  calendarCells,
  dayOffReasonText,
  deviations,
  filterBoard,
  formatShare,
  groupByTerminal,
  isPendingDay,
  lateShare,
  matchesQuery,
  medianOf,
  statusOf,
  sumTotals,
  tabCounts,
  tashkentToday,
  todayInPeriod,
  totalsOf,
  weekdayOf,
} from "./timesheet";

const ON: BoardDay = [0, 0, null, null];
const LATE: BoardDay = [1, 15, "09:15", "18:00"];
const ABS: BoardDay = [2, 0, null, null];
const OFF: BoardDay = [3, 0, null, null];

function emp(id: string, terminal: string, days: (BoardDay | null)[], last = id, org = "org"): BoardEmployee {
  return {
    id,
    first_name: "Имя",
    last_name: last,
    role: null,
    terminal_id: terminal,
    terminal_name: terminal.toUpperCase(),
    organization_id: org,
    organization_name: org.toUpperCase(),
    active: true,
    days,
  };
}

describe("timesheet: счёт дней", () => {
  it("пустые дни не входят в записанные", () => {
    expect(totalsOf([ON, LATE, ABS, null, null])).toEqual({ ontime: 1, late: 1, absent: 1, off: 0, recorded: 3 });
  });
  it("доля прогулов — среди записанных; доля опозданий — среди присутствовавших", () => {
    const t = totalsOf([ON, ON, LATE, ABS]);
    expect(absentShare(t)).toBe(25);
    expect(lateShare(t)).toBeCloseTo(33.333, 2);
    expect(absentShare(totalsOf([null]))).toBeNull();
    expect(lateShare(totalsOf([ABS]))).toBeNull();
  });
  it("серия прогулов подряд и дни-отклонения", () => {
    const days = [ON, ABS, ABS, LATE, ABS, null, ABS, ABS, ABS];
    expect(absentStreak(days)).toBe(3);
    expect(deviations(days).map((d) => d.day)).toEqual([2, 3, 4, 5, 7, 8, 9]);
  });
});

describe("timesheet: филиалы", () => {
  const mk = (abs: number, total: number) => [...Array.from({ length: abs }, () => ABS), ...Array.from({ length: total - abs }, () => ON)];
  it("медиана и отметка «выше нормы»: больше удвоенной медианы", () => {
    const emps = [emp("1", "a", mk(10, 100)), emp("2", "b", mk(10, 100)), emp("3", "c", mk(10, 100)), emp("4", "d", mk(30, 100))];
    const { branches, medians } = branchStats(emps);
    expect(medians).toEqual([{ organization: "org", name: "ORG", median: 10 }]);
    expect(branches.map((b) => [b.id, b.above])).toEqual([["d", true], ["a", false], ["b", false], ["c", false]]);
  });
  it("ровно в два раза выше медианы — ещё норма", () => {
    const emps = [emp("1", "a", mk(10, 100)), emp("2", "b", mk(10, 100)), emp("3", "c", mk(20, 100))];
    expect(branchStats(emps).branches.find((b) => b.id === "c")!.above).toBe(false);
  });
  it("нулевая медиана: отмечается только доля больше половины", () => {
    const emps = [emp("1", "a", mk(0, 10)), emp("2", "b", mk(0, 10)), emp("5", "e", mk(0, 10)), emp("3", "c", mk(6, 10)), emp("4", "d", mk(5, 10))];
    const { branches, medians } = branchStats(emps);
    expect(medians[0].median).toBe(0);
    expect(Object.fromEntries(branches.map((b) => [b.id, b.above]))).toEqual({ a: false, b: false, e: false, c: true, d: false });
  });
  it("филиал без записей не влияет на медиану", () => {
    const { branches, medians } = branchStats([emp("1", "a", mk(5, 10)), emp("2", "b", [null, null])]);
    expect(medians[0].median).toBe(50);
    expect(branches.find((b) => b.id === "b")!.share).toBeNull();
  });
  it("медиана и отметка считаются внутри организации, а не по всей сети", () => {
    const emps = [
      emp("1", "a1", mk(10, 100), "1", "A"),
      emp("2", "a2", mk(10, 100), "2", "A"),
      emp("3", "a3", mk(10, 100), "3", "A"),
      emp("4", "a4", mk(30, 100), "4", "A"),
      emp("5", "b1", mk(40, 100), "5", "B"),
      emp("6", "b2", mk(40, 100), "6", "B"),
      emp("7", "b3", mk(40, 100), "7", "B"),
    ];
    const { branches, medians } = branchStats(emps);
    expect(medians.map((m) => [m.organization, m.median])).toEqual([["A", 10], ["B", 40]]);
    // по всей сети медиана была бы 30 и a4 не отмечался бы; внутри организации A он втрое выше медианы
    expect(Object.fromEntries(branches.map((b) => [b.id, b.above]))).toEqual({ a1: false, a2: false, a3: false, a4: true, b1: false, b2: false, b3: false });
  });
  it("medianOf", () => {
    expect(medianOf([])).toBe(0);
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("timesheet: отбор", () => {
  const list = [emp("1", "a", [ON, ABS], "Алиев"), emp("2", "a", [LATE], "Бобиев"), emp("3", "b", [null, null], "Вахидов"), emp("4", "b", [ON], "Гулов")];
  it("вкладки и счётчики", () => {
    expect(tabCounts(list)).toEqual({ all: 4, absent: 1, late: 1, nodata: 1 });
    expect(filterBoard(list, { tab: "absent", terminal: null, query: "" }).map((e) => e.id)).toEqual(["1"]);
    expect(filterBoard(list, { tab: "nodata", terminal: null, query: "" }).map((e) => e.id)).toEqual(["3"]);
  });
  it("филиал и поиск вместе", () => {
    expect(filterBoard(list, { tab: "all", terminal: "b", query: "гул" }).map((e) => e.id)).toEqual(["4"]);
    expect(matchesQuery({ first_name: "Азиз", last_name: "Тестов" }, "азиз тест")).toBe(true);
    expect(matchesQuery({ first_name: "Азиз", last_name: "Тестов" }, "тест азиз")).toBe(true);
    expect(matchesQuery({ first_name: "Азиз", last_name: "Тестов" }, "бобур")).toBe(false);
  });
  it("группы по филиалам идут в порядке строк; без записей — в конец группы", () => {
    expect(groupByTerminal(list).map((g) => [g.id, g.employees.length])).toEqual([["a", 2], ["b", 2]]);
    const mixed = [emp("1", "a", [null], "Аа"), emp("2", "a", [ON], "Бб"), emp("3", "a", [null], "Вв"), emp("4", "a", [ABS], "Гг")];
    expect(groupByTerminal(mixed)[0].employees.map((e) => e.id)).toEqual(["2", "4", "1", "3"]);
  });
  it("формат доли: один знак и запятая", () => {
    expect(formatShare(20.2367)).toBe("20,2\u00a0%");
    expect(formatShare(0)).toBe("0,0\u00a0%");
    expect(formatShare(null)).toBe("—");
  });
});

describe("timesheet: календарь", () => {
  it("день недели: 1 октября 2026 — четверг", () => {
    expect(weekdayOf("2026-10-01", 1)).toBe(3);
    expect(weekdayOf("2026-11-01", 1)).toBe(6);
  });
  it("сетка месяца начинается с понедельника", () => {
    const c = calendarCells("2026-10-01", 31);
    expect(c.slice(0, 4)).toEqual([null, null, null, 1]);
    expect(c).toHaveLength(34);
  });
  it("сегодня по Ташкенту и ещё не записанные дни", () => {
    // 23:30 UTC 4 ноября — уже 5 ноября 04:30 в Ташкенте
    const today = tashkentToday(new Date("2026-11-04T23:30:00Z"));
    expect(today).toBe("2026-11-05");
    expect(isPendingDay("2026-11-01", 4, today)).toBe(false);
    // сегодня данных ещё нет: синхронизация идёт по вчерашний день
    expect(isPendingDay("2026-11-01", 5, today)).toBe(true);
    expect(isPendingDay("2026-11-01", 6, today)).toBe(true);
    expect(todayInPeriod("2026-11-01", today)).toBe(5);
    expect(todayInPeriod("2026-10-01", today)).toBeNull();
  });
});

describe("timesheet: выходные", () => {
  it("статус 3 — выходной", () => {
    expect(statusOf(OFF)).toBe("dayoff");
  });
  it("выходной считается отдельно и не входит в записанные дни", () => {
    expect(totalsOf([ON, OFF, ABS, null])).toEqual({ ontime: 1, late: 0, absent: 1, off: 1, recorded: 2 });
    expect(totalsOf([OFF, OFF, null])).toEqual({ ontime: 0, late: 0, absent: 0, off: 2, recorded: 0 });
  });
  it("доля прогулов без выходных в знаменателе, итоги суммируют выходные", () => {
    const t = totalsOf([ON, OFF, ABS, null]);
    expect(absentShare(t)).toBe(50);
    expect(sumTotals([t, totalsOf([OFF])])).toEqual({ ontime: 1, late: 0, absent: 1, off: 2, recorded: 2 });
  });
  it("сотрудник только с выходными — «нет данных», а не с прогулами", () => {
    expect(tabCounts([emp("a", "t1", [OFF, OFF])])).toEqual({ all: 1, absent: 0, late: 0, nodata: 1 });
  });
  it("серия прогулов прерывается выходным; выходной попадает в дни-отклонения", () => {
    expect(absentStreak([ABS, OFF, ABS])).toBe(1);
    expect(deviations([ON, OFF, LATE]).map((x) => [x.day, x.entry[0]])).toEqual([[2, 3], [3, 1]]);
  });
  it("будущий выходной остаётся выходным, а пустое будущее — ожидающим днём", () => {
    // Сегодня 5 ноября; 20 ноября — будущее.
    expect(statusOf([3, 0, null, null])).toBe("dayoff");
    expect(isPendingDay("2026-11-01", 20, "2026-11-05")).toBe(true);
    expect(totalsOf([...Array.from({ length: 19 }, () => null), OFF]).recorded).toBe(0);
  });
  it("причина: подпись по коду, у «другой» — текст управляющего", () => {
    const label = (c: string) => `L:${c}`;
    expect(dayOffReasonText({ reason_code: "sick", reason_text: null }, label)).toBe("L:sick");
    expect(dayOffReasonText({ reason_code: "other", reason_text: "Свадьба брата" }, label)).toBe("Свадьба брата");
    expect(dayOffReasonText({ reason_code: "other", reason_text: null }, label)).toBe("L:other");
  });
});
