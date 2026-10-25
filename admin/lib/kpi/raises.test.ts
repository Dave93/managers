import { describe, expect, it } from "bun:test";
import { commentReason, decisionBody, decisionIssues } from "./raises";

const cap = 500000;
const proposed = { status: "proposed" as const, suggested_amount: 300000, periods_closed: true, stale: false };

describe("решение по повышению", () => {
  it("утвердить предложенное без комментария", () => {
    expect(decisionIssues(proposed, { status: "approved", amount: "300 000", comment: "" }, cap)).toEqual([]);
    expect(commentReason(proposed, { status: "approved", amount: "300000" })).toBeNull();
  });
  it("сумма от 0 до потолка", () => {
    expect(decisionIssues(proposed, { status: "approved", amount: "600000", comment: "наставник" }, cap)).toEqual(["bad_amount"]);
    expect(decisionIssues(proposed, { status: "approved", amount: "", comment: "наставник" }, cap)).toEqual(["bad_amount"]);
  });
  it("когда нужен комментарий", () => {
    expect(decisionIssues(proposed, { status: "approved", amount: "250000", comment: " " }, cap)).toEqual(["comment_required"]);
    expect(commentReason(proposed, { status: "approved", amount: "250000" })).toBe("сумма отличается от предложения");
    expect(decisionIssues(proposed, { status: "rejected", amount: "", comment: "" }, cap)).toEqual(["comment_required"]);
    expect(commentReason(proposed, { status: "rejected", amount: "" })).toBe("отказ от предложенной суммы");
    expect(commentReason({ status: "insufficient", suggested_amount: 0 }, { status: "approved", amount: "0" })).toBe("мало оценённых месяцев");
    expect(commentReason({ status: "approved", suggested_amount: 300000 }, { status: "approved", amount: "300000" })).toBe("решение меняется повторно");
  });
  it("комментарий из одной пунктуации не засчитывается (как на сервере)", () => {
    expect(decisionIssues(proposed, { status: "rejected", amount: "", comment: "..." }, cap)).toEqual(["comment_required"]);
    expect(decisionIssues(proposed, { status: "rejected", amount: "", comment: "мало смен" }, cap)).toEqual([]);
  });
  it("открытые месяцы — первым", () => {
    expect(decisionIssues({ ...proposed, periods_closed: false }, { status: "approved", amount: "600000", comment: "наставник" }, cap)).toEqual(["periods_open", "bad_amount"]);
  });
  it("устаревший расчёт — самым первым, только у нерешённой строки", () => {
    const stale = { ...proposed, stale: true };
    expect(decisionIssues(stale, { status: "approved", amount: "300000", comment: "" }, cap)).toEqual(["stale"]);
    expect(decisionIssues({ ...stale, periods_closed: false }, { status: "approved", amount: "600000", comment: "наставник" }, cap)).toEqual(["stale", "periods_open", "bad_amount"]);
    expect(decisionIssues({ ...stale, status: "insufficient", suggested_amount: 0 }, { status: "approved", amount: "0", comment: "наставник" }, cap)).toEqual(["stale"]);
    // решённая строка: stale — лишь предупреждение, сохранить повторное решение можно
    expect(decisionIssues({ ...stale, status: "approved" }, { status: "approved", amount: "300000", comment: "пересмотр" }, cap)).toEqual([]);
    expect(decisionIssues({ ...stale, status: "rejected" }, { status: "approved", amount: "300000", comment: "пересмотр" }, cap)).toEqual([]);
  });
  it("decisionBody", () => {
    expect(decisionBody({ status: "approved", amount: "300 000", comment: "" })).toEqual({ status: "approved", amount: 300000 });
    expect(decisionBody({ status: "rejected", amount: "300000", comment: " мало смен " })).toEqual({ status: "rejected", comment: "мало смен" });
  });
});
