import { describe, expect, it } from "bun:test";
import { KPI_ERROR_TEXT, KpiApiError, codeText, kpiErrorText, outcomeKnown, shouldRetry, toKpiError } from "./errors";

const PLAN1_CODES = [
  "forbidden", "bad_period", "unknown_setting", "bad_day", "bad_value", "dispute_before_review", "code_taken", "bad_weight",
  "bad_source", "scope_exists", "out_of_scope", "no_card", "period_closed", "already_submitted", "too_early", "missing_items",
  "comment_required", "no_changes", "note_required", "bad_score", "unknown_item", "photo_required", "bad_photo_type",
  "photo_too_large", "too_many_photos", "bad_occurred_at", "already_cancelled", "not_found", "not_submitted",
  "dispute_window_closed", "dispute_exists", "dispute_closed", "dispute_window_open", "open_disputes", "already_closed",
  "bad_quarter", "periods_open", "bad_amount", "tier_pct_range", "tier_amount_range", "tier_amount_over_cap", "tier_pct_duplicate",
  "stale", "open_dispute", "cap_below_tiers", "no_items",
];

describe("тексты ошибок", () => {
  it("у каждого кода плана 1 и у запасных кодов есть русский текст", () => {
    for (const c of [...PLAN1_CODES, "unauthorized", "invalid_input", "server_error", "network"]) {
      expect(KPI_ERROR_TEXT[c]).toBeTruthy();
      expect(codeText(c)).toBe(KPI_ERROR_TEXT[c]);
    }
    expect(codeText("weird_code")).toBe("Ошибка сервера (weird_code)");
  });
  it("toKpiError: код из тела, иначе по статусу", () => {
    expect(toKpiError(409, { error: "dispute_exists" }).code).toBe("dispute_exists");
    expect(toKpiError(422, { type: "validation", on: "body" }).code).toBe("invalid_input");
    expect(toKpiError(401, "Unauthorized").code).toBe("unauthorized");
    expect(toKpiError(403, null).code).toBe("forbidden");
    expect(toKpiError(404, {}).code).toBe("not_found");
    expect(toKpiError(502, "<html>").code).toBe("server_error");
    expect(toKpiError(418, {}).code).toBe("http_418");
  });
  it("подробности", () => {
    expect(kpiErrorText(new KpiApiError(422, "missing_items", { error: "missing_items", items: ["a", "b"] }))).toBe("Не все обязательные пункты оценены (не хватает: 2)");
    expect(kpiErrorText(new KpiApiError(409, "open_disputes", { error: "open_disputes", ids: ["x"] }))).toBe("Есть неразобранные споры за месяц (1)");
    expect(kpiErrorText(new Error("boom"))).toBe("boom");
  });
  it("исход известен только для 4xx; 4xx не повторяем", () => {
    expect(outcomeKnown(new KpiApiError(422, "comment_required", {}))).toBe(true);
    expect(outcomeKnown(new KpiApiError(0, "network", {}))).toBe(false);
    expect(outcomeKnown(new KpiApiError(502, "server_error", {}))).toBe(false);
    expect(outcomeKnown(new Error("x"))).toBe(false);
    expect(shouldRetry(0, new KpiApiError(403, "forbidden", {}))).toBe(false);
    expect(shouldRetry(0, new KpiApiError(0, "network", {}))).toBe(true);
    expect(shouldRetry(1, new KpiApiError(502, "server_error", {}))).toBe(true);
    expect(shouldRetry(2, new KpiApiError(502, "server_error", {}))).toBe(false);
  });
});
