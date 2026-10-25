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
    expect(canOpen(["kpi_layout", "kpi.evaluate"], "raises")).toBe(false);
    expect(canOpen(undefined, "reviews")).toBe(false);
  });
  it("kpiAccess", () => {
    expect(kpiAccess(["kpi.view", "kpi.approve"])).toEqual({ evaluate: false, view: true, manage: false, approve: true });
    expect(kpiAccess(undefined)).toEqual({ evaluate: false, view: false, manage: false, approve: false });
  });
});
