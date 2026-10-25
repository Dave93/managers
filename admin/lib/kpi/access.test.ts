import { describe, expect, it } from "bun:test";
import { KPI_SCREEN_TITLE, canOpen, kpiAccess } from "./access";

describe("canOpen", () => {
  it("нужен kpi_layout и любое право экрана", () => {
    expect(canOpen(["kpi_layout", "kpi.evaluate"], "reviews")).toBe(true);
    expect(canOpen(["kpi.evaluate"], "reviews")).toBe(false);
    expect(canOpen(["kpi_layout", "kpi.view"], "settings")).toBe(false);
    expect(canOpen(["kpi_layout", "kpi.manage"], "month")).toBe(true);
    expect(canOpen(["kpi_layout", "kpi.approve"], "raises")).toBe(true);
    expect(canOpen(["kpi_layout", "kpi.approve"], "disputes")).toBe(true);
    // HR только с kpi.approve: форма оценки и журнал нарушений, как READ_PERMS на сервере.
    expect(canOpen(["kpi_layout", "kpi.approve"], "reviews")).toBe(true);
    expect(canOpen(["kpi_layout", "kpi.approve"], "violations")).toBe(true);
    expect(canOpen(["kpi_layout", "kpi.approve"], "settings")).toBe(false);
    expect(canOpen(["kpi.approve"], "reviews")).toBe(false);
    expect(canOpen(["kpi_layout", "kpi.evaluate"], "raises")).toBe(false);
    expect(canOpen(undefined, "reviews")).toBe(false);
  });
  it("загрузка Workly — только kpi.manage", () => {
    expect(canOpen(["kpi_layout", "kpi.manage"], "attendance")).toBe(true);
    expect(canOpen(["kpi_layout", "kpi.view", "kpi.approve", "kpi.evaluate"], "attendance")).toBe(false);
  });
  it("экраны балла филиала", () => {
    expect(canOpen(["kpi_layout", "kpi.view"], "network")).toBe(true);
    expect(canOpen(["kpi_layout", "kpi.evaluate"], "network")).toBe(false);
    expect(canOpen(["kpi_layout", "kpi.approve"], "branch")).toBe(true);
    expect(canOpen(["kpi_layout", "kpi.manage"], "revenue_plans")).toBe(true);
    expect(canOpen(["kpi_layout", "kpi.view", "kpi.approve"], "revenue_plans")).toBe(false);
    expect(canOpen(["kpi_layout", "kpi.evaluate"], "sanitary")).toBe(true);
    expect(canOpen(["kpi_layout", "kpi.view"], "sanitary")).toBe(false);
  });
  it("заголовки новых экранов", () => {
    expect([KPI_SCREEN_TITLE.network, KPI_SCREEN_TITLE.branch, KPI_SCREEN_TITLE.revenue_plans, KPI_SCREEN_TITLE.sanitary]).toEqual(["Сеть", "Филиал", "План выручки", "Санитарная проверка"]);
  });
  it("kpiAccess", () => {
    expect(kpiAccess(["kpi.view", "kpi.approve"])).toEqual({ evaluate: false, view: true, manage: false, approve: true });
    expect(kpiAccess(undefined)).toEqual({ evaluate: false, view: false, manage: false, approve: false });
  });
});
