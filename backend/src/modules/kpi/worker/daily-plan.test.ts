import { describe, expect, it } from "bun:test";
import { dailyTargets, overdueNotifications, remindNotifications, tashkentHour } from "./daily-plan";

const S = { review_deadline_day: 7, reminder_days_before: 7 };
const at = (s: string) => new Date(s);
const OCT = { period: "2026-10-01", deadline: "2026-11-07T18:59:59.999Z" };

describe("dailyTargets", () => {
  it("до окна — ничего", () => {
    expect(dailyTargets(at("2026-10-30T10:00:00+05:00"), S)).toEqual({ today: "2026-10-30", remind: null, overdue: null });
  });
  it("окно с 31 октября по 7 ноября включительно", () => {
    for (const d of ["2026-10-31", "2026-11-03", "2026-11-07"]) expect(dailyTargets(at(`${d}T10:00:00+05:00`), S).remind).toEqual(OCT);
  });
  it("8 ноября — только сводка за октябрь, 9 ноября — ничего", () => {
    expect(dailyTargets(at("2026-11-08T10:00:00+05:00"), S)).toEqual({ today: "2026-11-08", remind: null, overdue: { period: "2026-10-01" } });
    expect(dailyTargets(at("2026-11-09T10:00:00+05:00"), S)).toEqual({ today: "2026-11-09", remind: null, overdue: null });
  });
  it("граница суток по Ташкенту, а не по UTC", () => {
    expect(dailyTargets(at("2026-11-07T18:30:00Z"), S).remind).toEqual(OCT);
    expect(dailyTargets(at("2026-11-07T19:30:00Z"), S)).toEqual({ today: "2026-11-08", remind: null, overdue: { period: "2026-10-01" } });
  });
  it("reminder_days_before = 0 — только в день срока", () => {
    const s0 = { review_deadline_day: 7, reminder_days_before: 0 };
    expect(dailyTargets(at("2026-11-06T10:00:00+05:00"), s0).remind).toBeNull();
    expect(dailyTargets(at("2026-11-07T10:00:00+05:00"), s0).remind).toEqual(OCT);
  });
  it("срок 28-го: январь напоминает 28 февраля, сводка 1 марта", () => {
    const s28 = { review_deadline_day: 28, reminder_days_before: 7 };
    expect(dailyTargets(at("2027-02-28T10:00:00+05:00"), s28).remind).toEqual({ period: "2027-01-01", deadline: "2027-02-28T18:59:59.999Z" });
    expect(dailyTargets(at("2027-03-01T10:00:00+05:00"), s28)).toEqual({ today: "2027-03-01", remind: null, overdue: { period: "2027-01-01" } });
  });
});

describe("строки уведомлений", () => {
  it("напоминание только при pending > 0, ключ с датой", () => {
    expect(remindNotifications(OCT, "2026-11-05", [{ user_id: "u1", pending: 3 }, { user_id: "u2", pending: 0 }])).toEqual([
      { recipient_kind: "user", user_id: "u1", kind: "remind_evaluate", payload: { period: "2026-10-01", pending: 3, deadline: "2026-11-07T18:59:59.999Z" }, dedupe_key: "remind:u1:2026-11-05" },
    ]);
  });
  it("сводка — каждому HR одна за месяц, список до 100", () => {
    const lag = [{ user_id: "u1", user_name: "Тест Оценщик", pending: 2 }];
    expect(overdueNotifications("2026-10-01", lag, ["h1", "h2"])).toEqual(["h1", "h2"].map((h) => ({
      recipient_kind: "user", user_id: h, kind: "overdue_summary",
      payload: { period: "2026-10-01", lagging: [{ user_name: "Тест Оценщик", pending: 2 }], lagging_total: 1 },
      dedupe_key: `overdue:2026-10-01:${h}`,
    })));
    expect(overdueNotifications("2026-10-01", lag, [])).toEqual([]);
    const many = Array.from({ length: 150 }, (_, i) => ({ user_id: `u${i}`, user_name: `Тест ${i}`, pending: 1 }));
    const p = overdueNotifications("2026-10-01", many, ["h1"])[0].payload as { lagging: unknown[]; lagging_total: number };
    expect([p.lagging.length, p.lagging_total]).toEqual([100, 150]);
  });
  it("tashkentHour", () => {
    expect([tashkentHour(at("2026-11-05T04:59:00Z")), tashkentHour(at("2026-11-05T05:00:00Z")), tashkentHour(at("2026-11-05T19:00:00Z"))]).toEqual([9, 10, 0]);
  });
});
