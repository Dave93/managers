import { describe, expect, it } from "bun:test";
import { activityCursorKey, activityPollOn, activityWindow, decide, RELEVANT_ACTIONS, WORKLY_ACTIVITY_JOB } from "./activity";

const ev = (id: number, action_name: string) => ({ id, action_name });

describe("workly: действия пользователей — decide", () => {
  it("имя задачи расписания", () => {
    expect(WORKLY_ACTIVITY_JOB).toBe("workly-activity");
  });

  it("нет курсора — init: курсор встаёт на максимальный id, прогона нет, даже если событие нужное", () => {
    expect(decide([ev(10, "addEmployee"), ev(9, "clockInManual")], null)).toEqual({ action: "init", cursor: 10, relevant: 0 });
  });

  it("нет курсора и нет событий — init с курсором 0: первое же новое событие запустит сверку", () => {
    expect(decide([], null)).toEqual({ action: "init", cursor: 0, relevant: 0 });
  });

  it("новых событий нет — idle, курсор прежний", () => {
    expect(decide([ev(10, "addEmployee"), ev(9, "dismissEmployee")], 10)).toEqual({ action: "idle", cursor: 10, relevant: 0 });
    expect(decide([], 10)).toEqual({ action: "idle", cursor: 10, relevant: 0 });
  });

  it("новые события только ненужных видов — idle, но курсор уходит вперёд", () => {
    expect(decide([ev(12, "clockOutManual"), ev(11, "clockInManual"), ev(10, "addEmployee")], 10)).toEqual({
      action: "idle",
      cursor: 12,
      relevant: 0,
    });
  });

  it("новое нужное событие — sync, курсор на максимальном id, считается число нужных", () => {
    expect(decide([ev(14, "clockInManual"), ev(13, "dismissEmployee"), ev(12, "assignedLocation"), ev(11, "assignedRole")], 10)).toEqual({
      action: "sync",
      cursor: 14,
      relevant: 2,
    });
  });

  it("событие со старым id не запускает сверку, курсор не откатывается", () => {
    expect(decide([ev(5, "addEmployee")], 10)).toEqual({ action: "idle", cursor: 10, relevant: 0 });
  });

  it("порядок записей не важен", () => {
    const a = decide([ev(11, "addEmployee"), ev(12, "clockInManual")], 10);
    const b = decide([ev(12, "clockInManual"), ev(11, "addEmployee")], 10);
    expect(a).toEqual(b);
    expect(a.action).toBe("sync");
  });
});

describe("workly: действия пользователей — виды событий", () => {
  it("сверку запускают действия, которые меняют то, что читает план сотрудников", () => {
    for (const a of [
      "addEmployee",
      "dismissEmployee",
      "cancelDismissEmployee",
      "recoverEmployee",
      "editPersonProfile",
      "editEmployeeCode",
      "assignedLocation",
      "deletedLocationEmployee",
      "assignedPosition",
      "deletedAssignedPosition",
      "transferEmpDep",
      "updatedPosition",
      "deletedPosition",
    ]) {
      expect(RELEVANT_ACTIONS.has(a)).toBe(true);
    }
  });

  it("ручные отметки прихода и ухода, роли и графики сверку не запускают", () => {
    for (const a of ["clockInManual", "clockOutManual", "assignedRole", "updateAssignedRole", "assignedSchedule", "assignNewSalaryRate", "createdTimeoff"]) {
      expect(RELEVANT_ACTIONS.has(a)).toBe(false);
    }
  });
});

describe("workly: действия пользователей — окно и настройки", () => {
  it("окно — со вчерашнего дня по завтрашний по Ташкенту (end_date не входит в выборку)", () => {
    expect(activityWindow(new Date("2026-11-05T07:00:00Z"))).toEqual({ from: "2026-11-04", to: "2026-11-06" });
  });

  it("после полуночи по Ташкенту день уже следующий", () => {
    // 20:30 UTC 5 ноября — 01:30 6 ноября в Ташкенте
    expect(activityWindow(new Date("2026-11-05T20:30:00Z"))).toEqual({ from: "2026-11-05", to: "2026-11-07" });
  });

  it("граница месяца и года", () => {
    expect(activityWindow(new Date("2026-12-31T10:00:00Z"))).toEqual({ from: "2026-12-30", to: "2027-01-01" });
  });

  it("выключается только значением 0", () => {
    expect(activityPollOn({})).toBe(true);
    expect(activityPollOn({ WORKLY_ACTIVITY_POLL: "1" })).toBe(true);
    expect(activityPollOn({ WORKLY_ACTIVITY_POLL: "" })).toBe(true);
    expect(activityPollOn({ WORKLY_ACTIVITY_POLL: "0" })).toBe(false);
  });

  it("ключ курсора в Redis зависит от префикса проекта и подключения", () => {
    const saved = process.env.PROJECT_PREFIX;
    process.env.PROJECT_PREFIX = "p_";
    try {
      expect(activityCursorKey("LES")).toBe("p_workly_activity_cursor:LES");
      expect(activityCursorKey("CHOPAR")).toBe("p_workly_activity_cursor:CHOPAR");
    } finally {
      if (saved === undefined) delete process.env.PROJECT_PREFIX;
      else process.env.PROJECT_PREFIX = saved;
    }
  });
});
