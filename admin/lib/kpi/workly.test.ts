import { describe, expect, it } from "bun:test";
import type { PlanItem, PlanKind } from "@backend/modules/workly/plan";
import {
  PLAN_GROUP_ORDER,
  WORKLY_BLOCK_REASONS,
  WORKLY_ERROR_CODES,
  applyBody,
  blockReasonKey,
  canApply,
  connectionErrorKey,
  effectiveCounts,
  groupPlan,
  isFailed,
  isRunning,
  pollInterval,
  toggleExclusion,
} from "./workly";

const item = (key: string, kind: PlanKind): PlanItem => ({
  key,
  kind,
  employee_id: kind === "create" ? null : "e-" + key,
  workly_id: 1,
  label: key,
  before: null,
  after: {},
});

describe("groupPlan", () => {
  it("порядок deactivate, link, create; пустые группы пропускаются", () => {
    const groups = groupPlan([item("c1", "create"), item("d1", "deactivate"), item("l1", "link"), item("c2", "create")]);
    expect(groups.map((g) => g.kind)).toEqual(["deactivate", "link", "create"]);
    expect(groups[2].items.map((i) => i.key)).toEqual(["c1", "c2"]);
  });
  it("пустой план — пустой список", () => {
    expect(groupPlan([])).toEqual([]);
  });
  it("все виды идут в порядке PLAN_GROUP_ORDER", () => {
    const all = [...PLAN_GROUP_ORDER].reverse().map((k) => item("k-" + k, k));
    expect(groupPlan(all).map((g) => g.kind)).toEqual([...PLAN_GROUP_ORDER]);
  });
  it("PLAN_GROUP_ORDER: порядок из задачи", () => {
    expect([...PLAN_GROUP_ORDER]).toEqual(["deactivate", "link", "relink", "update", "move", "reactivate", "create"]);
  });
});

describe("виды пунктов", () => {
  it("PLAN_GROUP_ORDER покрывает каждый вид из effectiveCounts ровно один раз", () => {
    expect([...PLAN_GROUP_ORDER].map(String).sort()).toEqual(Object.keys(effectiveCounts([], new Set())).sort());
    expect(new Set(PLAN_GROUP_ORDER).size).toBe(PLAN_GROUP_ORDER.length);
  });
});

describe("toggleExclusion", () => {
  it("добавляет и снимает ключ, исходное множество не меняется", () => {
    const empty = new Set<string>();
    const one = toggleExclusion(empty, "a");
    expect([...one]).toEqual(["a"]);
    expect(empty.size).toBe(0);
    const two = toggleExclusion(one, "b");
    expect([...two].sort()).toEqual(["a", "b"]);
    expect([...one]).toEqual(["a"]);
    const back = toggleExclusion(two, "a");
    expect([...back]).toEqual(["b"]);
    expect([...two].sort()).toEqual(["a", "b"]);
  });
});

describe("effectiveCounts", () => {
  const items = [item("c1", "create"), item("c2", "create"), item("d1", "deactivate"), item("l1", "link")];
  it("считает все виды, отсутствующие — нулём", () => {
    expect(effectiveCounts(items, new Set())).toEqual({
      link: 1, relink: 0, update: 0, move: 0, create: 2, deactivate: 1, reactivate: 0,
    });
  });
  it("исключённые не считаются", () => {
    const c = effectiveCounts(items, new Set(["c1", "d1"]));
    expect(c.create).toBe(1);
    expect(c.deactivate).toBe(0);
    expect(c.link).toBe(1);
  });
  it("лишний ключ в исключениях ничего не ломает", () => {
    expect(effectiveCounts(items, new Set(["нет-такого"])).create).toBe(2);
  });
});

describe("canApply", () => {
  it("только planned", () => {
    expect(canApply({ status: "planned" })).toBe(true);
    for (const status of ["applied", "blocked", "failed", "running", "rolled_back"]) expect(canApply({ status })).toBe(false);
    expect(canApply(null)).toBe(false);
    expect(canApply(undefined)).toBe(false);
  });
});

describe("connectionErrorKey", () => {
  it("известные коды из задачи", () => {
    expect(connectionErrorKey("force_update")).toBe("workly.errors.force_update");
    expect(connectionErrorKey("stale")).toBe("workly.errors.stale");
    for (const c of ["client_invalid", "auth_failed", "not_configured", "crawl_failed"]) {
      expect(connectionErrorKey(c)).toBe(`workly.errors.${c}`);
    }
  });
  it("неизвестный код — unknown, null — null", () => {
    expect(connectionErrorKey("xyz")).toBe("workly.errors.unknown");
    expect(connectionErrorKey("")).toBe("workly.errors.unknown");
    expect(connectionErrorKey(null)).toBe(null);
  });
  it("служебные имена объекта не считаются кодами", () => {
    for (const c of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(connectionErrorKey(c)).toBe("workly.errors.unknown");
    }
  });
  it("каждый код бэкенда (R19 и коды проверки входа) получает свой ключ", () => {
    expect(WORKLY_ERROR_CODES).toHaveLength(29);
    expect(new Set(WORKLY_ERROR_CODES).size).toBe(WORKLY_ERROR_CODES.length);
    for (const c of WORKLY_ERROR_CODES) expect(connectionErrorKey(c)).toBe(`workly.errors.${c}`);
    for (const c of [
      "empty_crawl", "crawl_failed", "crawl_short", "apply_failed", "client_invalid", "force_update", "auth_failed",
      "http_error", "not_configured", "period_closed", "period_not_started", "enqueue_failed", "stale",
      "run_in_progress", "run_not_planned", "run_superseded", "run_not_found", "queue_unavailable",
      "organization_not_connected", "employee_not_found", "workly_employee_not_found", "workly_id_taken",
      "terminal_other_org", "location_not_found", "organization_required", "bad_organization",
      "bad_tab_number", "bad_workly_id", "bad_period",
    ]) {
      expect((WORKLY_ERROR_CODES as readonly string[]).includes(c)).toBe(true);
    }
  });
});

describe("isRunning / pollInterval / isFailed", () => {
  it("isRunning", () => {
    expect(isRunning({ status: "running" })).toBe(true);
    expect(isRunning({ status: "planned" })).toBe(false);
    expect(isRunning(null)).toBe(false);
    expect(isRunning(undefined)).toBe(false);
  });
  it("pollInterval: 2000, пока идёт обход, иначе false", () => {
    expect(pollInterval({ status: "running" })).toBe(2000);
    expect(pollInterval({ status: "planned" })).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
    expect(pollInterval(null)).toBe(false);
  });
  it("isFailed: только failed", () => {
    expect(isFailed({ status: "failed" })).toBe(true);
    for (const status of ["running", "planned", "applied", "blocked", "rolled_back"]) expect(isFailed({ status })).toBe(false);
    expect(isFailed(null)).toBe(false);
    expect(isFailed(undefined)).toBe(false);
  });
});

describe("blockReasonKey", () => {
  it("причины ночного прогона", () => {
    expect(WORKLY_BLOCK_REASONS).toEqual(["crawl_short", "too_many_deactivations", "too_many_creations", "empty_crawl", "first_run"]);
    for (const r of WORKLY_BLOCK_REASONS) expect(blockReasonKey(r)).toBe(`workly.blocked.${r}`);
  });
  it("другая причина — unknown, null — null", () => {
    expect(blockReasonKey("что-то новое")).toBe("workly.blocked.unknown");
    expect(blockReasonKey("")).toBe("workly.blocked.unknown");
    expect(blockReasonKey("constructor")).toBe("workly.blocked.unknown");
    expect(blockReasonKey(null)).toBe(null);
  });
});

describe("applyBody", () => {
  it("без исключений exclude — пустой массив, а не пропущенное поле (R27)", () => {
    const body = applyBody("run-1", new Set());
    expect(body).toEqual({ run_id: "run-1", exclude: [] });
    expect("exclude" in body).toBe(true);
    expect(Array.isArray(body.exclude)).toBe(true);
    expect(JSON.parse(JSON.stringify(body))).toEqual({ run_id: "run-1", exclude: [] });
  });
  it("множество и массив превращаются в массив ключей", () => {
    expect(applyBody("r", new Set(["b", "a"])).exclude).toEqual(["b", "a"]);
    expect(applyBody("r", ["x", "y"]).exclude).toEqual(["x", "y"]);
  });
  it("повторы схлопываются", () => {
    expect(applyBody("r", ["x", "x", "y"]).exclude).toEqual(["x", "y"]);
  });
  it("тело не делит массив с аргументом", () => {
    const src = ["x"];
    const body = applyBody("r", src);
    src.push("y");
    expect(body.exclude).toEqual(["x"]);
  });
});
