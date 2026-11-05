import { describe, expect, it } from "bun:test";
import { KpiError } from "./errors";
import { addDays, checkReason, DAY_OFF_REASONS, expandRange, periodOfDay } from "./days-off-rules";

const TODAY = "2026-11-05";

// Код ошибки, который бросила функция; null, если не бросила.
function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof KpiError) return `${e.status} ${e.code}`;
    throw e;
  }
}

describe("kpi выходные: диапазон дат", () => {
  it("раскрывает дни от и до включительно по возрастанию", () => {
    expect(expandRange("2026-11-03", "2026-11-05", TODAY)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(expandRange("2026-11-05", "2026-11-05", TODAY)).toEqual(["2026-11-05"]);
  });
  it("переходит через границу месяца и года", () => {
    expect(expandRange("2026-10-30", "2026-11-02", TODAY)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(expandRange("2026-12-31", "2027-01-01", "2026-12-20")).toEqual(["2026-12-31", "2027-01-01"]);
  });
  it("не дата, обратный порядок и несуществующие числа — bad_dates", () => {
    expect(codeOf(() => expandRange("2026-11-06", "2026-11-05", TODAY))).toBe("422 bad_dates");
    expect(codeOf(() => expandRange("2026-02-30", "2026-03-01", TODAY))).toBe("422 bad_dates");
    expect(codeOf(() => expandRange(undefined, "2026-11-05", TODAY))).toBe("422 bad_dates");
    expect(codeOf(() => expandRange("2026-11-05", 5, TODAY))).toBe("422 bad_dates");
    expect(codeOf(() => expandRange("05.11.2026", "05.11.2026", TODAY))).toBe("422 bad_dates");
  });
  it("не больше 31 дня за запрос", () => {
    expect(expandRange("2026-11-01", "2026-12-01", TODAY)).toHaveLength(31);
    expect(codeOf(() => expandRange("2026-11-01", "2026-12-02", TODAY))).toBe("422 bad_dates");
  });
  it("вперёд не дальше сегодня + 31 дня", () => {
    expect(codeOf(() => expandRange("2026-12-06", "2026-12-06", TODAY))).toBeNull();
    expect(codeOf(() => expandRange("2026-12-07", "2026-12-07", TODAY))).toBe("422 bad_dates");
  });
  it("назад не раньше сегодня − 366 дней", () => {
    expect(codeOf(() => expandRange("2025-11-04", "2025-11-04", TODAY))).toBeNull();
    expect(codeOf(() => expandRange("2025-11-03", "2025-11-03", TODAY))).toBe("422 bad_dates");
  });
});

describe("kpi выходные: причина", () => {
  it("известная причина без текста: текст отбрасывается", () => {
    expect(checkReason("sick", "что угодно")).toEqual({ reason_code: "sick", reason_text: null });
    for (const code of DAY_OFF_REASONS) expect(checkReason(code, "причина").reason_code).toBe(code);
  });
  it("«другая» требует текст от 3 букв или цифр, пробелы по краям срезаются", () => {
    expect(checkReason("other", "  по семейным  ")).toEqual({ reason_code: "other", reason_text: "по семейным" });
    expect(codeOf(() => checkReason("other", "ab"))).toBe("422 reason_text_required");
    expect(codeOf(() => checkReason("other", "  --  "))).toBe("422 reason_text_required");
    expect(codeOf(() => checkReason("other", undefined))).toBe("422 reason_text_required");
  });
  it("неизвестный код и не строка — bad_reason", () => {
    expect(codeOf(() => checkReason("holiday", "x"))).toBe("422 bad_reason");
    expect(codeOf(() => checkReason(5, null))).toBe("422 bad_reason");
    expect(codeOf(() => checkReason(undefined, null))).toBe("422 bad_reason");
  });
  it("шесть причин в порядке спеки", () => {
    expect([...DAY_OFF_REASONS]).toEqual(["sick", "family", "time_off", "vacation", "schedule", "other"]);
  });
});

describe("kpi выходные: даты", () => {
  it("addDays через границу года", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("periodOfDay — первое число месяца", () => {
    expect(periodOfDay("2026-11-17")).toBe("2026-11-01");
  });
});
