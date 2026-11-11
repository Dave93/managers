import { describe, expect, it } from "bun:test";
import type { EmployeeCard } from "../types";
import { evCardOf } from "./ev-card";

const raise = { quarter_start: "2026-10-01", tiers: [{ min_pct: 85, amount: 150000 }], avg_pct: 92, months: [], hint: { kind: "decided", amount: 150000 } };

function card(over: Partial<EmployeeCard> = {}): EmployeeCard {
  return {
    employee: { id: "e1", first_name: "Шамсиддин", last_name: "Абдурахманов", position: "Повар", terminal_id: "t1", terminal_name: "Chopar pizza 40", organization_name: "ChoparPizza", tab_number: "1241", active: true, has_card: true, workly_linked: true, telegram_bound: false },
    period: "2026-11-01",
    home: { raise } as unknown as EmployeeCard["home"],
    review: null,
    violations: { period: "2026-11-01", items: [], reason_min: 10 },
    attendance: {
      month: "2026-11",
      prev: "2026-10",
      next: null,
      // как отдаёт сервер: новыми сверху
      days: [
        { day: "2026-11-04", check_in: "2026-11-04T03:12:00.000Z", check_out: "2026-11-04T12:00:00.000Z", late_minutes: 12, absent: false, day_off: false },
        { day: "2026-11-03", check_in: null, check_out: null, late_minutes: 0, absent: true, day_off: false },
        { day: "2026-11-02", check_in: null, check_out: null, late_minutes: 0, absent: false, day_off: true },
        { day: "2026-11-01", check_in: "2026-11-01T03:00:00.000Z", check_out: "2026-11-01T12:00:00.000Z", late_minutes: 0, absent: false, day_off: false },
      ],
    },
    history: { tiers: [{ min_pct: 85, amount: 150000 }], quarters: [{ quarter_start: "2026-10-01", avg_pct: 92, result: { kind: "decided", amount: 150000 }, months: [{ period: "2026-10-01", state: "scored", score_pct: 92, opens_at: "2026-11-01T00:00:00.000Z" }] }] },
    ...over,
  };
}

describe("evCardOf", () => {
  it("дни идут от старых к новым, время по Ташкенту, у прогула и выходного отметок нет", () => {
    const r = evCardOf(card());
    expect(r.days.map((d) => d.day)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(r.days.map((d) => d.status)).toEqual(["ontime", "dayoff", "absent", "late"]);
    expect(r.days[3]).toEqual({ day: "2026-11-04", status: "late", late_minutes: 12, check_in: "08:12", check_out: "17:00" });
    expect(r.days[2]).toEqual({ day: "2026-11-03", status: "absent", late_minutes: 0, check_in: null, check_out: null });
  });

  it("соседние месяцы переводятся в период «YYYY-MM-01»", () => {
    expect(evCardOf(card()).months).toEqual({ prev: "2026-10-01", next: null });
  });

  it("суммы прибавки и служебные признаки в ответ не попадают", () => {
    const r = evCardOf(card({ review: { score_pct: 96.5, status: "ready", items: [{ item_id: "i", title_ru: "Чистота", title_uz: "Tozalik", group_key: "base", score: 100, source: "manual", note: null }], changes: [], dispute: { state: "none" } as never, reason_min: 10, tiers: [{ min_pct: 85, amount: 150000 }], period: "2026-11-01", review_id: "r", submitted_at: "2026-11-30T00:00:00.000Z" } }));
    const json = JSON.stringify(r);
    expect(json).not.toContain("150000");
    expect(json).not.toContain("workly_linked");
    expect(json).not.toContain("telegram_bound");
    expect(json).not.toContain("organization_name");
    expect(json).not.toContain("raise");
    expect(r.review).toEqual({ score_pct: 96.5, status: "ready", items: [{ title_ru: "Чистота", title_uz: "Tozalik", score: 100, note: null }] });
    expect(r.history[0]).toEqual({ quarter_start: "2026-10-01", avg_pct: 92, months: [{ period: "2026-10-01", state: "scored", score_pct: 92 }] });
  });

  it("нет оценки за месяц — review равен null", () => {
    expect(evCardOf(card()).review).toBeNull();
  });
});
