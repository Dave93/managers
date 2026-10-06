import { describe, expect, it } from "bun:test";
import {
  allowedPeriods,
  inputDeadline,
  isInputOpen,
  isValidPeriod,
  isValidQty,
  lastDayOfMonth,
  nextStatus,
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

describe("inputDeadline — 2-е число следующего месяца, 12:00 Ташкент (07:00 UTC)", () => {
  it("октябрь → 2 ноября 07:00Z", () => {
    expect(inputDeadline("2026-10-31").toISOString()).toBe("2026-11-02T07:00:00.000Z");
  });
  it("декабрь → 2 января следующего года", () => {
    expect(inputDeadline("2026-12-31").toISOString()).toBe("2027-01-02T07:00:00.000Z");
  });
  it("февраль високосного года", () => {
    expect(inputDeadline("2028-02-29").toISOString()).toBe("2028-03-02T07:00:00.000Z");
  });
});

describe("isInputOpen", () => {
  it("до срока — открыт", () => {
    expect(isInputOpen("2026-10-31", null, new Date("2026-11-02T06:59:59Z"))).toBe(true);
  });
  it("ровно в срок и позже — закрыт", () => {
    expect(isInputOpen("2026-10-31", null, new Date("2026-11-02T07:00:00Z"))).toBe(false);
    expect(isInputOpen("2026-10-31", null, new Date("2026-11-20T10:00:00Z"))).toBe(false);
  });
  it("разблокировка офиса открывает до unlocked_until", () => {
    const now = new Date("2026-11-10T10:00:00Z");
    expect(isInputOpen("2026-10-31", "2026-11-11T10:00:00Z", now)).toBe(true);
    expect(isInputOpen("2026-10-31", "2026-11-10T10:00:00Z", now)).toBe(false);
    expect(isInputOpen("2026-10-31", "2026-11-09T10:00:00Z", now)).toBe(false);
  });
  it("кривой период — закрыт", () => {
    expect(isInputOpen("2026-10-30", null, new Date("2026-10-01T00:00:00Z"))).toBe(false);
  });
});

describe("allowedPeriods (прошлый месяц — до его срока ввода)", () => {
  it("в середине месяца — только текущий", () => {
    expect(allowedPeriods(new Date("2026-10-15T07:00:00Z"))).toEqual(["2026-10-31"]);
  });
  it("1-е число 03:00 +05 (в UTC ещё 31-е) — новый месяц и прошлый", () => {
    expect(allowedPeriods(new Date("2026-10-31T22:00:00Z"))).toEqual(["2026-11-30", "2026-10-31"]);
  });
  it("2-е 11:59 +05 — прошлый ещё доступен", () => {
    expect(allowedPeriods(new Date("2026-11-02T06:59:00Z"))).toEqual(["2026-11-30", "2026-10-31"]);
  });
  it("2-е 12:00 +05 — прошлый уже нет", () => {
    expect(allowedPeriods(new Date("2026-11-02T07:00:00Z"))).toEqual(["2026-11-30"]);
  });
  it("переход через год", () => {
    expect(allowedPeriods(new Date("2027-01-02T06:00:00Z"))).toEqual(["2027-01-31", "2026-12-31"]);
    expect(allowedPeriods(new Date("2027-01-02T07:00:00Z"))).toEqual(["2027-01-31"]);
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
