import { describe, expect, it } from "bun:test";
import { KPI_ERROR_TEXT, KpiApiError, codeText, kpiErrorText, loadErrors, outcomeKnown, shouldRetry, toKpiError } from "./errors";

const PLAN1_CODES = [
  "forbidden", "bad_period", "unknown_setting", "bad_day", "bad_value", "dispute_before_review", "code_taken", "bad_weight",
  "bad_source", "scope_exists", "out_of_scope", "no_card", "period_closed", "already_submitted", "too_early", "missing_items",
  "comment_required", "no_changes", "note_required", "bad_score", "unknown_item", "photo_required", "bad_photo_type",
  "photo_too_large", "too_many_photos", "bad_occurred_at", "already_cancelled", "not_found", "not_submitted",
  "dispute_window_closed", "dispute_exists", "dispute_closed", "dispute_window_open", "open_disputes", "already_closed",
  "bad_quarter", "periods_open", "bad_amount", "tier_pct_range", "tier_amount_range", "tier_amount_over_cap", "tier_pct_duplicate",
  "stale", "open_dispute", "cap_below_tiers", "no_items",
  "not_closed", "bad_code", "bad_title", "bad_hint", "items_required", "unknown_card", "bad_id", "bad_comment",
];

const PLAN3_CODES = ["file_required", "bad_file_type", "file_too_large", "bad_file", "empty_file", "upload_expired", "bad_sheet",
  "bad_header_row", "bad_mapping", "nothing_matched", "external_id_taken", "bad_external_id", "sheet_too_large", "bad_status"];

const PLAN4_CODES = ["bad_target", "bot_not_configured", "too_many_ids", "bad_id"];

// Все коды, которые отдают роуты и сервисы плана 5 (branch, branch-config, revenue-plans, sanitary, validate*).
const PLAN5_CODES = ["weights_sum", "bad_thresholds", "bad_indicator_weight", "unknown_indicator", "bad_sanitary_items", "unknown_terminal",
  "duplicate_terminal", "too_many_items", "bad_growth", "bad_items", "bad_checked_at", "comment_too_long", "future_period", "no_indicators"];
const PLAN5_SERVER_CODES = [...PLAN5_CODES, "out_of_scope", "bad_amount", "bad_id", "bad_period", "unknown_setting", "bad_value", "period_closed", "not_found", "forbidden"];

describe("тексты ошибок", () => {
  it("у каждого кода плана 1 и у запасных кодов есть русский текст", () => {
    for (const c of [...PLAN1_CODES, "unauthorized", "invalid_input", "server_error", "network"]) {
      expect(KPI_ERROR_TEXT[c]).toBeTruthy();
      expect(codeText(c)).toBe(KPI_ERROR_TEXT[c]);
    }
    expect(codeText("weird_code")).toBe("Ошибка сервера (weird_code)");
  });
  it("коды плана 3", () => {
    for (const c of PLAN3_CODES) {
      expect(KPI_ERROR_TEXT[c]).toBeTruthy();
      expect(codeText(c)).toBe(KPI_ERROR_TEXT[c]);
    }
    expect(KPI_ERROR_TEXT.sheet_too_large).toBe("Лист слишком большой: не больше 50 000 строк и 100 колонок");
  });
  it("коды плана 4", () => {
    for (const c of PLAN4_CODES) {
      expect(KPI_ERROR_TEXT[c]).toBeTruthy();
      expect(codeText(c)).toBe(KPI_ERROR_TEXT[c]);
    }
    expect(KPI_ERROR_TEXT.bot_not_configured).toBe("Бот KPI не настроен на сервере");
  });
  it("коды плана 5", () => {
    for (const c of PLAN5_CODES) expect(codeText(c)).toBe(KPI_ERROR_TEXT[c]);
    for (const c of PLAN5_SERVER_CODES) expect(KPI_ERROR_TEXT[c]).toBeTruthy();
    expect(KPI_ERROR_TEXT.out_of_scope).toBe("Нет доступа: не входит в ваши назначения");
    expect(KPI_ERROR_TEXT.no_indicators).toBe("Показатели балла не заведены: нужен запуск seed-cards");
    expect(KPI_ERROR_TEXT.bad_checked_at).toBe("Неверное время проверки");
    expect(KPI_ERROR_TEXT.period_closed).toBe("Месяц закрыт. Изменить может только HR");
  });
  it("спор после отказа (план 8)", () => {
    expect(kpiErrorText(new KpiApiError(409, "dispute_rejected", { error: "dispute_rejected" }))).toBe("Спор по этому уже отклонён. Повторно оспорить нельзя");
  });
  it("подробности плана 5", () => {
    expect(kpiErrorText(new KpiApiError(422, "weights_sum", { error: "weights_sum", sum: 99 }))).toBe("Сумма весов активных показателей должна быть 100 % (сейчас 99 %)");
    expect(kpiErrorText(new KpiApiError(422, "weights_sum", { error: "weights_sum" }))).toBe("Сумма весов активных показателей должна быть 100 %");
    expect(kpiErrorText(new KpiApiError(422, "bad_thresholds", { error: "bad_thresholds", code: "food_cost" }))).toBe("Порог, цель и максимум идут не по порядку (Себестоимость)");
    expect(kpiErrorText(new KpiApiError(422, "bad_thresholds", { error: "bad_thresholds", code: "zzz" }))).toBe("Порог, цель и максимум идут не по порядку");
  });
  it("подробности плана 3", () => {
    expect(kpiErrorText(new KpiApiError(409, "external_id_taken", { error: "external_id_taken", employee_id: "e1", employee_name: "Повар Тест" })))
      .toBe("Этот табельный номер уже у другого сотрудника (Повар Тест)");
    expect(kpiErrorText(new KpiApiError(409, "external_id_taken", { error: "external_id_taken" })))
      .toBe("Этот табельный номер уже у другого сотрудника");
    expect(kpiErrorText(new KpiApiError(422, "nothing_matched", { error: "nothing_matched", rows_total: 12 })))
      .toBe("Ни одна строка не сопоставлена с сотрудниками. Проверьте колонки и месяц (строк в файле: 12)");
    expect(kpiErrorText(new KpiApiError(422, "nothing_matched", { error: "nothing_matched" })))
      .toBe("Ни одна строка не сопоставлена с сотрудниками. Проверьте колонки и месяц");
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

describe("loadErrors", () => {
  const e1 = new KpiApiError(500, "server_error", {});
  const e2 = new KpiApiError(403, "forbidden", {});
  it("без данных — блокирует, с данными — только предупреждение", () => {
    expect(loadErrors({ error: e1, data: undefined })).toEqual({ blocking: e1, stale: null });
    expect(loadErrors({ error: e1, data: [] })).toEqual({ blocking: null, stale: e1 });
    expect(loadErrors({ error: null, data: undefined }, { error: null, data: [1] })).toEqual({ blocking: null, stale: null });
  });
  it("первая ошибка каждого вида", () => {
    const r = loadErrors({ error: e1, data: { ok: 1 } }, { error: e2, data: undefined }, { error: e1, data: undefined });
    expect(r.blocking).toBe(e2);
    expect(r.stale).toBe(e1);
  });
  it("null в данных — это данные", () => expect(loadErrors({ error: e1, data: null })).toEqual({ blocking: null, stale: e1 }));
});
