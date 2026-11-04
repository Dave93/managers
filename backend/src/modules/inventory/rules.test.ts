import { describe, expect, it } from "bun:test";
import {
  allowedPeriods,
  defaultPeriod,
  interimBookHiddenForBranch,
  interimDates,
  isValidInterimDate,
  lastDayOf,
  isValidPeriod,
  isValidQty,
  lastDayOfMonth,
  monthlyPeriods,
  nextStatus,
  periodTargets,
  previousPeriod,
} from "./rules";

describe("nextStatus", () => {
  it("draft → submitted → draft, draft → cancelled", () => {
    expect(nextStatus("submit", "draft")).toBe("submitted");
    expect(nextStatus("reopen", "submitted")).toBe("draft");
    expect(nextStatus("cancel", "draft")).toBe("cancelled");
  });
  it("запрещённые переходы дают null", () => {
    expect(nextStatus("submit", "submitted")).toBeNull();
    expect(nextStatus("cancel", "submitted")).toBeNull();
    expect(nextStatus("reopen", "draft")).toBeNull();
    expect(nextStatus("submit", "cancelled")).toBeNull();
    expect(nextStatus("submit", "garbage")).toBeNull();
  });
});

describe("lastDayOfMonth / isValidPeriod", () => {
  it("считает последний день, включая февраль високосного года", () => {
    expect(lastDayOfMonth(2026, 10)).toBe("2026-10-31");
    expect(lastDayOfMonth(2026, 11)).toBe("2026-11-30");
    expect(lastDayOfMonth(2028, 2)).toBe("2028-02-29");
    expect(lastDayOfMonth(2026, 12)).toBe("2026-12-31");
  });
  it("валиден только последний день месяца в формате YYYY-MM-DD", () => {
    expect(isValidPeriod("2026-10-31")).toBe(true);
    expect(isValidPeriod("2026-10-30")).toBe(false);
    expect(isValidPeriod("2026-10-31T00:00:00Z")).toBe(false);
    expect(isValidPeriod("31.10.2026")).toBe(false);
  });
});

describe("allowedPeriods (срока ввода нет: текущий и прошлый месяц всегда)", () => {
  it("в середине месяца — текущий и прошлый", () => {
    expect(allowedPeriods(new Date("2026-10-15T07:00:00Z"))).toEqual(["2026-10-31", "2026-09-30"]);
  });
  it("после 2-го числа прошлый месяц по-прежнему доступен", () => {
    expect(allowedPeriods(new Date("2026-10-07T07:00:00Z"))).toEqual(["2026-10-31", "2026-09-30"]);
  });
  it("1-е число 03:00 +05 (в UTC ещё 31-е) — новый месяц и прошлый", () => {
    expect(allowedPeriods(new Date("2026-10-31T22:00:00Z"))).toEqual(["2026-11-30", "2026-10-31"]);
  });
  it("переход через год", () => {
    expect(allowedPeriods(new Date("2027-01-20T07:00:00Z"))).toEqual(["2027-01-31", "2026-12-31"]);
  });
});

describe("monthlyPeriods — новый месячный: прошлый месяц, в последний день ещё и текущий (04.11.2026)", () => {
  it("в середине месяца — только прошлый", () => {
    expect(monthlyPeriods(new Date("2026-11-04T07:00:00Z"))).toEqual(["2026-10-31"]);
  });
  it("предпоследний день 23:59 +05 — только прошлый, последний 00:00 +05 (в UTC ещё 30-е) — текущий и прошлый", () => {
    expect(monthlyPeriods(new Date("2026-10-30T18:59:00Z"))).toEqual(["2026-09-30"]);
    expect(monthlyPeriods(new Date("2026-10-30T19:00:00Z"))).toEqual(["2026-10-31", "2026-09-30"]);
  });
  it("1-е число 03:00 +05 (в UTC ещё 31-е) — только прошлый", () => {
    expect(monthlyPeriods(new Date("2026-10-31T22:00:00Z"))).toEqual(["2026-10-31"]);
  });
  it("февраль: 28-е в обычный год последний, в високосный — нет", () => {
    expect(monthlyPeriods(new Date("2027-02-28T07:00:00Z"))).toEqual(["2027-02-28", "2027-01-31"]);
    expect(monthlyPeriods(new Date("2028-02-28T07:00:00Z"))).toEqual(["2028-01-31"]);
    expect(monthlyPeriods(new Date("2028-02-29T07:00:00Z"))).toEqual(["2028-02-29", "2028-01-31"]);
  });
  it("переход через год: 31 декабря и 1 января", () => {
    expect(monthlyPeriods(new Date("2026-12-31T07:00:00Z"))).toEqual(["2026-12-31", "2026-11-30"]);
    expect(monthlyPeriods(new Date("2027-01-01T07:00:00Z"))).toEqual(["2026-12-31"]);
  });
  it("всегда внутри allowedPeriods", () => {
    for (const iso of ["2026-11-04T07:00:00Z", "2026-10-30T19:00:00Z", "2027-01-01T07:00:00Z", "2028-02-29T07:00:00Z"]) {
      const now = new Date(iso);
      for (const p of monthlyPeriods(now)) expect(allowedPeriods(now)).toContain(p);
    }
  });
});

describe("defaultPeriod — первый из monthlyPeriods", () => {
  it("1-е число 03:00 +05 (в UTC ещё 31-е) — прошлый месяц", () => {
    expect(defaultPeriod(new Date("2026-10-31T22:00:00Z"))).toBe("2026-10-31");
  });
  it("в середине месяца — прошлый (раньше с 8-го предлагался текущий)", () => {
    expect(defaultPeriod(new Date("2026-11-07T19:00:00Z"))).toBe("2026-10-31");
    expect(defaultPeriod(new Date("2026-11-20T07:00:00Z"))).toBe("2026-10-31");
  });
  it("в последний день месяца — текущий", () => {
    expect(defaultPeriod(new Date("2026-10-31T07:00:00Z"))).toBe("2026-10-31");
  });
  it("переход через год", () => {
    expect(defaultPeriod(new Date("2027-01-03T07:00:00Z"))).toBe("2026-12-31");
  });
  it("всегда один из monthlyPeriods", () => {
    for (const iso of ["2026-10-31T22:00:00Z", "2026-11-07T19:00:00Z", "2026-10-30T19:00:00Z", "2027-01-03T07:00:00Z"]) {
      const now = new Date(iso);
      expect(monthlyPeriods(now)).toContain(defaultPeriod(now));
    }
  });
});

describe("periodTargets — куда офис переносит месячный пересчёт", () => {
  const now = new Date("2026-11-04T07:00:00Z");
  const office = ["inventory.count", "inventory.reconcile"];
  it("ноябрьский → октябрь, октябрьский → ноябрь", () => {
    expect(periodTargets({ kind: "monthly", status: "submitted", period: "2026-11-30" }, office, now)).toEqual(["2026-10-31"]);
    expect(periodTargets({ kind: "monthly", status: "draft", period: "2026-10-31" }, office, now)).toEqual(["2026-11-30"]);
  });
  it("старый месяц — в любой из окна", () => {
    expect(periodTargets({ kind: "monthly", status: "draft", period: "2026-09-30" }, office, now)).toEqual(["2026-11-30", "2026-10-31"]);
  });
  it("без права сверки, промежуточный и отменённый — некуда", () => {
    expect(periodTargets({ kind: "monthly", status: "submitted", period: "2026-11-30" }, ["inventory.count", "inventory.manage"], now)).toEqual([]);
    expect(periodTargets({ kind: "interim", status: "submitted", period: "2026-11-30" }, office, now)).toEqual([]);
    expect(periodTargets({ kind: "monthly", status: "cancelled", period: "2026-11-30" }, office, now)).toEqual([]);
  });
});

describe("previousPeriod", () => {
  it("прошлый месяц по Ташкенту", () => {
    expect(previousPeriod(new Date("2026-10-06T03:00:00Z"))).toBe("2026-09-30");
    // 1 ноября 02:00 +05 — в UTC ещё 31 октября
    expect(previousPeriod(new Date("2026-10-31T21:00:00Z"))).toBe("2026-10-31");
    expect(previousPeriod(new Date("2027-01-03T03:00:00Z"))).toBe("2026-12-31");
  });
});

describe("isValidQty", () => {
  it("принимает 0, дроби до 4 знаков и максимум", () => {
    expect(isValidQty(0)).toBe(true);
    expect(isValidQty(2.5)).toBe(true);
    expect(isValidQty(1.2345)).toBe(true);
    expect(isValidQty(1_000_000)).toBe(true);
  });
  it("отклоняет отрицательные, >1e6, >4 знаков, не числа", () => {
    expect(isValidQty(-0.1)).toBe(false);
    expect(isValidQty(1_000_000.5)).toBe(false);
    expect(isValidQty(1.23456)).toBe(false);
    expect(isValidQty(Number.NaN)).toBe(false);
    expect(isValidQty(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidQty("2.5")).toBe(false);
    expect(isValidQty(null)).toBe(false);
  });
});

describe("interimDates — промежуточный пересчёт только за вчера", () => {
  it("вчера — единственная дата", () => {
    expect(interimDates(new Date("2026-10-08T07:00:00Z"))).toEqual({ min: "2026-10-07", max: "2026-10-07", default: "2026-10-07" });
  });
  it("граница суток по Ташкенту: 1 ноября 02:00 +05 (в UTC ещё 31 октября) — вчера = 31 октября", () => {
    expect(interimDates(new Date("2026-10-31T21:00:00Z"))).toEqual({ min: "2026-10-31", max: "2026-10-31", default: "2026-10-31" });
  });
  it("переход года", () => {
    expect(interimDates(new Date("2027-01-01T07:00:00Z"))).toEqual({ min: "2026-12-31", max: "2026-12-31", default: "2026-12-31" });
  });
});

describe("isValidInterimDate / lastDayOf", () => {
  const now = new Date("2026-10-08T07:00:00Z");
  it("только вчера: сегодня, будущее и позавчера — нельзя", () => {
    expect(isValidInterimDate("2026-10-08", now)).toBe(false);
    expect(isValidInterimDate("2026-10-09", now)).toBe(false);
    expect(isValidInterimDate("2026-10-07", now)).toBe(true);
    expect(isValidInterimDate("2026-10-06", now)).toBe(false);
    expect(isValidInterimDate("2026-09-01", now)).toBe(false);
    expect(isValidInterimDate("2026-08-31", now)).toBe(false);
    expect(isValidInterimDate("2026-09-31", now)).toBe(false);
    expect(isValidInterimDate("07.10.2026", now)).toBe(false);
  });
  it("lastDayOf — последний день месяца даты", () => {
    expect(lastDayOf("2026-10-07")).toBe("2026-10-31");
    expect(lastDayOf("2028-02-10")).toBe("2028-02-29");
  });
});


describe("interimBookHiddenForBranch — сравнение промежуточного после 25-го филиалу не показываем", () => {
  it("промежуточный: до 25-го включительно — виден, с 26-го — скрыт", () => {
    expect(interimBookHiddenForBranch({ kind: "interim", count_date: "2026-10-25" })).toBe(false);
    expect(interimBookHiddenForBranch({ kind: "interim", count_date: "2026-10-26" })).toBe(true);
    expect(interimBookHiddenForBranch({ kind: "interim", count_date: "2026-10-31" })).toBe(true);
    expect(interimBookHiddenForBranch({ kind: "interim", count_date: "2026-10-07" })).toBe(false);
  });
  it("месячный не затрагивается", () => {
    expect(interimBookHiddenForBranch({ kind: "monthly", count_date: "2026-10-31" })).toBe(false);
  });
});
