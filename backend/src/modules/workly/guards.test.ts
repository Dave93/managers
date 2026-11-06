import { describe, expect, it } from "bun:test";
import { attendanceSnapshot, checkAttendanceGuards, checkGuards, previousApiWindowEnd } from "./guards";

// Нейтральная база: прошлый применённый прогон есть, обход полный, изменений нет.
// Каждый тест переопределяет только то, что проверяет.
type In = Parameters<typeof checkGuards>[0];
function input(over: Partial<In> = {}): In {
  return {
    deactivations: 0,
    creations: 0,
    orgActive: 358,
    activeFetched: 358,
    lastApplied: { activeFetched: 358 },
    ...over,
  };
}

describe("checkGuards: базовый случай", () => {
  it("спокойный прогон проходит", () => {
    expect(checkGuards(input())).toEqual({ ok: true });
  });
});

describe("checkGuards: first_run", () => {
  it("нет прошлого применённого прогона", () => {
    expect(checkGuards(input({ lastApplied: null }))).toEqual({ ok: false, reason: "first_run" });
  });

  it("first_run важнее empty_crawl: пустой обход без прошлого прогона всё равно first_run", () => {
    expect(checkGuards(input({ lastApplied: null, activeFetched: 0 }))).toEqual({ ok: false, reason: "first_run" });
  });

  it("first_run важнее лимитов деактиваций и созданий", () => {
    expect(checkGuards(input({ lastApplied: null, deactivations: 100, creations: 100 }))).toEqual({
      ok: false,
      reason: "first_run",
    });
  });
});

describe("checkGuards: empty_crawl", () => {
  it("activeFetched 0 при прошлом 358", () => {
    expect(checkGuards(input({ activeFetched: 0 }))).toEqual({ ok: false, reason: "empty_crawl" });
  });

  it("empty_crawl важнее crawl_short (0 тоже меньше порога)", () => {
    const r = checkGuards(input({ activeFetched: 0, lastApplied: { activeFetched: 358 } }));
    expect(r).toEqual({ ok: false, reason: "empty_crawl" });
  });

  it("empty_crawl важнее переполнения деактиваций и созданий", () => {
    const r = checkGuards(input({ activeFetched: 0, deactivations: 100, creations: 100 }));
    expect(r).toEqual({ ok: false, reason: "empty_crawl" });
  });

  it("прошлый прогон тоже был с нулём: пустой обход всё равно блокируется", () => {
    expect(checkGuards(input({ activeFetched: 0, lastApplied: { activeFetched: 0 } }))).toEqual({
      ok: false,
      reason: "empty_crawl",
    });
  });
});

describe("checkGuards: crawl_short (порог 0.9 от прошлого)", () => {
  it("300 при прошлом 358: crawl_short", () => {
    expect(checkGuards(input({ activeFetched: 300 }))).toEqual({ ok: false, reason: "crawl_short" });
  });

  it("323 при прошлом 358: ок (порог 322,2)", () => {
    expect(checkGuards(input({ activeFetched: 323 }))).toEqual({ ok: true });
  });

  it("322 при прошлом 358: crawl_short (ниже порога 322,2)", () => {
    expect(checkGuards(input({ activeFetched: 322 }))).toEqual({ ok: false, reason: "crawl_short" });
  });

  it("ровно на пороге: 90 при прошлом 100 проходит (строго меньше блокирует)", () => {
    expect(checkGuards(input({ activeFetched: 90, lastApplied: { activeFetched: 100 } }))).toEqual({ ok: true });
  });

  it("89 при прошлом 100: crawl_short", () => {
    expect(checkGuards(input({ activeFetched: 89, lastApplied: { activeFetched: 100 } }))).toEqual({
      ok: false,
      reason: "crawl_short",
    });
  });

  it("обход больше прошлого проходит", () => {
    expect(checkGuards(input({ activeFetched: 400 }))).toEqual({ ok: true });
  });

  it("crawl_short важнее переполнения деактиваций и созданий", () => {
    const r = checkGuards(input({ activeFetched: 300, deactivations: 100, creations: 100 }));
    expect(r).toEqual({ ok: false, reason: "crawl_short" });
  });
});

describe("checkGuards: too_many_deactivations (больше max(10, 0.1 * orgActive))", () => {
  it("27 при orgActive 271: ок (порог 27,1)", () => {
    expect(checkGuards(input({ deactivations: 27, orgActive: 271 }))).toEqual({ ok: true });
  });

  it("28 при orgActive 271: too_many_deactivations", () => {
    expect(checkGuards(input({ deactivations: 28, orgActive: 271 }))).toEqual({
      ok: false,
      reason: "too_many_deactivations",
    });
  });

  it("10 при orgActive 20: ок (действует нижняя граница 10)", () => {
    expect(checkGuards(input({ deactivations: 10, orgActive: 20 }))).toEqual({ ok: true });
  });

  it("11 при orgActive 20: too_many_deactivations", () => {
    expect(checkGuards(input({ deactivations: 11, orgActive: 20 }))).toEqual({
      ok: false,
      reason: "too_many_deactivations",
    });
  });

  it("orgActive 0: порог 10, 10 проходит, 11 блокируется", () => {
    expect(checkGuards(input({ deactivations: 10, orgActive: 0 }))).toEqual({ ok: true });
    expect(checkGuards(input({ deactivations: 11, orgActive: 0 }))).toEqual({
      ok: false,
      reason: "too_many_deactivations",
    });
  });

  it("деактиваций нет: ок", () => {
    expect(checkGuards(input({ deactivations: 0 }))).toEqual({ ok: true });
  });

  it("too_many_deactivations проверяется раньше too_many_creations", () => {
    const r = checkGuards(input({ deactivations: 100, creations: 100 }));
    expect(r).toEqual({ ok: false, reason: "too_many_deactivations" });
  });
});

describe("checkGuards: too_many_creations (больше 50)", () => {
  it("50 создаётся: ок", () => {
    expect(checkGuards(input({ creations: 50 }))).toEqual({ ok: true });
  });

  it("51 создаётся: too_many_creations", () => {
    expect(checkGuards(input({ creations: 51 }))).toEqual({ ok: false, reason: "too_many_creations" });
  });

  it("лимит созданий не зависит от orgActive", () => {
    expect(checkGuards(input({ creations: 51, orgActive: 5000 }))).toEqual({ ok: false, reason: "too_many_creations" });
  });
});

// ---------- защита ночной посещаемости ----------

describe("checkAttendanceGuards", () => {
  type A = Parameters<typeof checkAttendanceGuards>[0];
  // Нейтральная база: прошлый api-импорт 1000 дней, 300 с приходом; новый идентичен, плановых без строки 2%.
  const base = (over: Partial<A> = {}): A => ({
    previous: { rows: 1000, withCheckIn: 300 },
    next: { rows: 1000, withCheckIn: 300 },
    unknown: 20,
    rowsTotal: 1000,
    ...over,
  });

  it("спокойный прогон проходит, рост тоже", () => {
    expect(checkAttendanceGuards(base())).toEqual({ ok: true });
    expect(checkAttendanceGuards(base({ next: { rows: 1200, withCheckIn: 400 }, rowsTotal: 1200 }))).toEqual({ ok: true });
  });

  it("нет прошлого api-импорта или в нём меньше 50 строк — сравнивать не с чем, проходит даже обрезанный результат", () => {
    expect(checkAttendanceGuards(base({ previous: null, next: { rows: 1, withCheckIn: 0 } }))).toEqual({ ok: true });
    expect(checkAttendanceGuards(base({ previous: { rows: 49, withCheckIn: 10 }, next: { rows: 0, withCheckIn: 0 } }))).toEqual({ ok: true });
    expect(checkAttendanceGuards(base({ previous: { rows: 50, withCheckIn: 10 }, next: { rows: 0, withCheckIn: 0 } }))).toEqual({ ok: false, check: "rows" });
  });

  it("строк меньше 90% прежних — rows; ровно 90% проходит (строгое сравнение)", () => {
    expect(checkAttendanceGuards(base({ next: { rows: 899, withCheckIn: 300 }, rowsTotal: 899 }))).toEqual({ ok: false, check: "rows" });
    expect(checkAttendanceGuards(base({ next: { rows: 900, withCheckIn: 300 }, rowsTotal: 900 }))).toEqual({ ok: true });
  });

  it("приходов меньше 90% прежних — check_in (обрезанный late-in); ровно 90% проходит", () => {
    expect(checkAttendanceGuards(base({ next: { rows: 1000, withCheckIn: 269 } }))).toEqual({ ok: false, check: "check_in" });
    expect(checkAttendanceGuards(base({ next: { rows: 1000, withCheckIn: 270 } }))).toEqual({ ok: true });
  });

  it("плановых дней без строки больше 5% — unknown (обрезанный absence); ровно 5% проходит", () => {
    // 50 / (950 + 50) = 5%
    expect(checkAttendanceGuards(base({ unknown: 50, rowsTotal: 950, next: { rows: 950, withCheckIn: 300 } }))).toEqual({ ok: true });
    expect(checkAttendanceGuards(base({ unknown: 51, rowsTotal: 950, next: { rows: 950, withCheckIn: 300 } }))).toEqual({ ok: false, check: "unknown" });
  });

  it("порядок: rows важнее check_in, check_in важнее unknown", () => {
    expect(checkAttendanceGuards(base({ next: { rows: 500, withCheckIn: 0 }, unknown: 900, rowsTotal: 500 }))).toEqual({ ok: false, check: "rows" });
    expect(checkAttendanceGuards(base({ next: { rows: 1000, withCheckIn: 0 }, unknown: 900 }))).toEqual({ ok: false, check: "check_in" });
  });

  it("пустое окно без строк и без плановых дней не делит на ноль", () => {
    expect(checkAttendanceGuards(base({ previous: null, next: { rows: 0, withCheckIn: 0 }, unknown: 0, rowsTotal: 0 }))).toEqual({ ok: true });
  });
});

describe("attendanceSnapshot", () => {
  const rows = [
    { day: "2026-10-01", check_in: "2026-10-01T04:05:00.000Z" },
    { day: "2026-10-02", check_in: null },
    { day: "2026-10-03", check_in: "2026-10-03T04:00:00.000Z" },
    { day: "2026-10-04", check_in: null },
  ];

  it("считает строки и приходы только до дня to включительно", () => {
    expect(attendanceSnapshot(rows, "2026-10-03")).toEqual({ rows: 3, withCheckIn: 2 });
    expect(attendanceSnapshot(rows, "2026-10-04")).toEqual({ rows: 4, withCheckIn: 2 });
    expect(attendanceSnapshot(rows, "2026-09-30")).toEqual({ rows: 0, withCheckIn: 0 });
  });
});

describe("previousApiWindowEnd", () => {
  it("берёт окно только у api-импорта с настоящей датой, прочее — null", () => {
    expect(previousApiWindowEnd({ source: "api", window: { from: "2026-10-01", to: "2026-10-19" } })).toBe("2026-10-19");
    expect(previousApiWindowEnd({ source: "file", window: { to: "2026-10-19" } })).toBeNull();
    expect(previousApiWindowEnd({ source: "api", window: { to: "2026-13-40" } })).toBeNull();
    expect(previousApiWindowEnd({ source: "api" })).toBeNull();
    expect(previousApiWindowEnd(null)).toBeNull();
    expect(previousApiWindowEnd("api")).toBeNull();
  });
});
