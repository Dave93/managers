import { describe, expect, it } from "bun:test";
import { canOpen, kpiAccess } from "./access";

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
  it("kpiAccess", () => {
    expect(kpiAccess(["kpi.view", "kpi.approve"])).toEqual({ evaluate: false, view: true, manage: false, approve: true });
    expect(kpiAccess(undefined)).toEqual({ evaluate: false, view: false, manage: false, approve: false });
  });
});
