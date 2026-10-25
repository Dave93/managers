import { describe, expect, it } from "bun:test";
import { ROW_STATUS, SOURCE_LABEL, eventKindLabel, rowStatus } from "./status";

const review = (status: "draft" | "submitted") => ({ id: "r", status, score_pct: null, submitted_at: null, late: false });

describe("status", () => {
  it("rowStatus: спор важнее статуса оценки", () => {
    expect(rowStatus({ review: null, open_dispute: false })).toBe("none");
    expect(rowStatus({ review: review("draft"), open_dispute: false })).toBe("draft");
    expect(rowStatus({ review: review("submitted"), open_dispute: false })).toBe("submitted");
    expect(rowStatus({ review: review("submitted"), open_dispute: true })).toBe("disputed");
  });
  it("подписи", () => {
    expect(Object.fromEntries(Object.entries(ROW_STATUS).map(([k, v]) => [k, v.label]))).toEqual({ none: "Нет оценки", draft: "Черновик", submitted: "Отправлена", disputed: "Спор" });
    expect(Object.keys(SOURCE_LABEL).sort()).toEqual(["attendance", "cooking_speed", "food_cost", "manual", "sales_plan"]);
    expect(eventKindLabel("hr_adjusted")).toBe("Правка HR");
    expect(eventKindLabel("something_new")).toBe("something_new");
  });
});
