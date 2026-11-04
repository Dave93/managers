import { describe, expect, it } from "bun:test";
import type { ReviewForm } from "../types";
import { evFormOf } from "./ev-review";

// Отправленная оценка с id оценщика и автором нарушения: наружу они не должны уйти.
const VIOLATION = {
  id: "viol-1",
  terminal_id: "term-1",
  terminal_name: "Чиланзар",
  employee_id: "emp-1",
  employee_name: "Иван Петров",
  card_item_id: "item-1",
  item_title_ru: "Чистота",
  period: "2025-10-01",
  occurred_at: "2025-10-12T08:00:00.000Z",
  comment: "Грязный стол",
  recorded_by: "U1",
  recorded_by_name: "Оценщик Один",
  status: "active" as const,
  cancel_reason: null,
  photos: [{ id: "photo-1" }],
  open_dispute: false,
  dispute_rejected: false,
  created_at: "2025-10-12T08:00:00.000Z",
};

const SUBMITTED: ReviewForm = {
  period: "2025-10-01",
  period_status: "open",
  employee: { id: "emp-1", first_name: "Иван", last_name: "Петров", terminal_id: "term-1", terminal_name: "Чиланзар" },
  card: { id: "card-1", code: "cook", title_ru: "Повар (Chopar и Les Ailes)" },
  review: {
    id: "rev-1",
    status: "submitted",
    score_pct: 80,
    version: 1,
    submitted_at: "2025-10-26T05:00:00.000Z",
    evaluator_user_id: "U1",
    late: false,
  },
  items: [
    {
      item_id: "item-1",
      title_ru: "Чистота",
      title_uz: "Toza",
      hint_ru: "Рабочее место",
      weight: 10,
      source: "manual",
      group_key: "base",
      score: 80,
      note: null,
      suggestion: null,
      violations: [VIOLATION],
      violation_hint: 70,
    },
  ],
  other_violations: [{ ...VIOLATION, id: "viol-2", card_item_id: null, item_title_ru: null }],
  can_edit: true,
  needs_comment: true,
  open_dispute: false,
  dispute_rejected: false,
  deadlines: {
    period: "2025-10-01",
    submit_opens_at: "2025-10-19T19:00:00.000Z",
    review_deadline: "2025-11-07T18:59:59.999Z",
    dispute_deadline: "2025-11-10T18:59:59.999Z",
  },
};

describe("kpi/tg-app: форма оценки оценщика", () => {
  it("evFormOf: отправленная только читается, ids оценщика не уходят, сроки плоскими полями", () => {
    const out = evFormOf(SUBMITTED);
    expect(out.can_edit).toBe(false);
    expect(out.submit_opens_at).toBe("2025-10-19T19:00:00.000Z");
    expect(out.review_deadline).toBe("2025-11-07T18:59:59.999Z");
    expect(out.card_title).toBe("Повар (Chopar и Les Ailes)");
    expect(JSON.stringify(out)).not.toContain("U1");
    expect(evFormOf({ ...SUBMITTED, review: { ...SUBMITTED.review!, status: "draft" } }).can_edit).toBe(true);
    expect(evFormOf({ ...SUBMITTED, review: null }).can_edit).toBe(true);
    expect(evFormOf({ ...SUBMITTED, can_edit: false, review: null }).can_edit).toBe(false);
  });

  it("evFormOf: поля формы переносятся, нарушения сужаются до id, времени и текста", () => {
    const out = evFormOf(SUBMITTED);
    expect(out.period).toBe("2025-10-01");
    expect(out.period_status).toBe("open");
    expect(out.employee).toEqual({ id: "emp-1", first_name: "Иван", last_name: "Петров", terminal_name: "Чиланзар" });
    expect(out.review).toEqual({ id: "rev-1", status: "submitted", score_pct: 80, version: 1, submitted_at: "2025-10-26T05:00:00.000Z", late: false });
    expect(out.items[0]).toMatchObject({ item_id: "item-1", title_uz: "Toza", weight: 10, source: "manual", group_key: "base", score: 80, violation_hint: 70 });
    expect(out.items[0]!.violations).toEqual([{ id: "viol-1", occurred_at: "2025-10-12T08:00:00.000Z", comment: "Грязный стол" }]);
    expect(out.other_violations).toEqual([{ id: "viol-2", occurred_at: "2025-10-12T08:00:00.000Z", comment: "Грязный стол" }]);
    expect(out.open_dispute).toBe(false);
    expect(out.dispute_rejected).toBe(false);
  });
});
