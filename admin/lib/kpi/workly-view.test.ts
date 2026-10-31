import { describe, expect, it } from "bun:test";
import type { PlanItem, PlanKind } from "@backend/modules/workly/plan";
import { KpiApiError } from "./errors";
import {
  CHANGE_TYPES,
  GROUP_PAGE,
  RUN_STATUSES,
  SKIPPED_PAGE,
  ATTENDANCE_ERROR_CODES,
  applyPreview,
  attendanceErrorKey,
  attendanceResultLines,
  lastRunErrorKey,
  changeSummary,
  confirmSummary,
  fileImportWarning,
  formatShare,
  impliedSkips,
  inWorkly,
  lastRunLines,
  plannedRunId,
  resultRunId,
  resumeAttendanceRun,
  resumeRunId,
  runStaleness,
  searchSeed,
  shortId,
  skippedGroups,
  visibleItems,
  worklyErrorKey,
} from "./workly-view";

const E1 = "8c1e6f0a-1111-4222-8333-0123456789ab";
const E2 = "0f00baaa-2222-4333-8444-fedcba987654";

const item = (p: Partial<PlanItem> & Pick<PlanItem, "kind">): PlanItem => ({
  key: `${p.kind}:${p.employee_id ?? E1}`,
  employee_id: E1,
  workly_id: 77,
  label: "Иван Иванов",
  before: null,
  after: {},
  ...p,
});

describe("visibleItems", () => {
  const many = Array.from({ length: 120 }, (_, i) => i);

  it("свёрнутый список: первые 50 по порядку", () => {
    const out = visibleItems(many, false);
    expect(GROUP_PAGE).toBe(50);
    expect(out.length).toBe(50);
    expect(out[0]).toBe(0);
    expect(out[49]).toBe(49);
  });

  it("«Показать все»: весь список", () => {
    expect(visibleItems(many, true).length).toBe(120);
  });

  it("короткий список отдаётся целиком в обоих режимах", () => {
    expect(visibleItems([1, 2, 3], false)).toEqual([1, 2, 3]);
    expect(visibleItems([], false)).toEqual([]);
  });

  it("свой предел: список пропущенных режется на SKIPPED_PAGE строк", () => {
    const rows = Array.from({ length: 130 }, (_, i) => i);
    expect(SKIPPED_PAGE).toBe(100);
    expect(visibleItems(rows, false, SKIPPED_PAGE).length).toBe(100);
    expect(visibleItems(rows, true, SKIPPED_PAGE).length).toBe(130);
    expect(visibleItems(rows.slice(0, 100), false, SKIPPED_PAGE).length).toBe(100);
  });
});

describe("skippedGroups", () => {
  it("move:X ставится рядом со своим link:X, остальные группы по первому появлению", () => {
    const out = skippedGroups([
      { key: `link:${E1}`, reason: "excluded" },
      { key: "create:w15", reason: "excluded" },
      { key: `deactivate:${E2}`, reason: "stale" },
      { key: `move:${E1}`, reason: "excluded" },
    ]);
    expect(out).toEqual([
      [
        { key: `link:${E1}`, reason: "excluded" },
        { key: `move:${E1}`, reason: "excluded" },
      ],
      [{ key: "create:w15", reason: "excluded" }],
      [{ key: `deactivate:${E2}`, reason: "stale" }],
    ]);
  });

  it("пары relink и reactivate; внутри группы исходный порядок", () => {
    const out = skippedGroups([
      { key: `move:${E2}`, reason: "conflict" },
      { key: `relink:${E1}`, reason: "stale" },
      { key: `reactivate:${E2}`, reason: "conflict" },
      { key: `move:${E1}`, reason: "stale" },
    ]);
    expect(out.map((g) => g.map((s) => s.key))).toEqual([
      [`move:${E2}`, `reactivate:${E2}`],
      [`relink:${E1}`, `move:${E1}`],
    ]);
  });

  it("ключ без двоеточия — отдельная группа; пустой список — пусто", () => {
    expect(skippedGroups([{ key: "odd", reason: "stale" }])).toEqual([[{ key: "odd", reason: "stale" }]]);
    expect(skippedGroups([])).toEqual([]);
  });
});

describe("impliedSkips", () => {
  const A = "emp-A";
  const B = "emp-B";
  const pi = (key: string, kind: PlanKind, employee_id: string | null): PlanItem => ({
    key,
    kind,
    employee_id,
    workly_id: 1,
    label: key,
    before: null,
    after: {},
  });
  const items = [
    pi(`link:${A}`, "link", A),
    pi(`move:${A}`, "move", A),
    pi(`link:${B}`, "link", B),
    pi(`move:${B}`, "move", B),
  ];

  it("исключённая связь тянет за собой перенос того же сотрудника", () => {
    expect([...impliedSkips(items, new Set([`link:${A}`]))]).toEqual([`move:${A}`]);
  });

  it("relink тоже тянет перенос", () => {
    const list = [pi(`relink:${A}`, "relink", A), pi(`move:${A}`, "move", A)];
    expect([...impliedSkips(list, new Set([`relink:${A}`]))]).toEqual([`move:${A}`]);
  });

  it("reactivate и update перенос не тянут (бэкенд связывает перенос только с link/relink)", () => {
    const list = [pi(`reactivate:${A}`, "reactivate", A), pi(`update:${B}`, "update", B), pi(`move:${A}`, "move", A), pi(`move:${B}`, "move", B)];
    expect([...impliedSkips(list, new Set([`reactivate:${A}`, `update:${B}`]))]).toEqual([]);
  });

  it("перенос, уже исключённый вручную, не повторяется", () => {
    expect([...impliedSkips(items, new Set([`link:${A}`, `move:${A}`]))]).toEqual([]);
  });

  it("пара ищется по employee_id, а не по ключу", () => {
    const list = [pi("link:odd-key", "link", A), pi("move:other-key", "move", A), pi("move:x", "move", null)];
    expect([...impliedSkips(list, new Set(["link:odd-key"]))]).toEqual(["move:other-key"]);
  });

  it("без исключений — пусто", () => {
    expect(impliedSkips(items, new Set()).size).toBe(0);
  });
});

describe("confirmSummary", () => {
  const counts: Record<PlanKind, number> = { link: 2, relink: 0, update: 1, move: 0, create: 3, deactivate: 4, reactivate: 0 };

  it("ненулевые виды в порядке групп, отдельно деактивации, исключённые и всего", () => {
    expect(confirmSummary(counts, 5)).toEqual({
      lines: [
        { kind: "deactivate", count: 4 },
        { kind: "link", count: 2 },
        { kind: "update", count: 1 },
        { kind: "create", count: 3 },
      ],
      deactivate: 4,
      excluded: 5,
      total: 10,
    });
  });

  it("всё исключено: строк нет, всего 0", () => {
    const zero: Record<PlanKind, number> = { link: 0, relink: 0, update: 0, move: 0, create: 0, deactivate: 0, reactivate: 0 };
    expect(confirmSummary(zero, 7)).toEqual({ lines: [], deactivate: 0, excluded: 7, total: 0 });
  });
});

describe("changeSummary", () => {
  it("deactivate связанного: станет неактивным (уволен в Workly)", () => {
    const it0 = item({
      kind: "deactivate",
      workly_id: 501,
      before: { active: true, workly_id: 501, workly_company_id: 9 },
      after: { active: false, workly_company_id: 9, workly_id: 501 },
    });
    expect(changeSummary(it0)).toEqual([{ type: "deactivate" }]);
  });

  it("deactivate по имени (у нас связи не было): видно, с какой записью Workly совпало имя", () => {
    const it0 = item({
      kind: "deactivate",
      workly_id: 502,
      before: { active: true, workly_id: null, workly_company_id: null },
      after: { active: false, workly_company_id: 9, workly_id: 502 },
    });
    expect(changeSummary(it0)).toEqual([{ type: "deactivateByName", workly_id: 502 }]);
  });

  it("move: смена терминала из before в after", () => {
    const it0 = item({ kind: "move", before: { terminal_id: "t-old" }, after: { terminal_id: "t-new" } });
    expect(changeSummary(it0)).toEqual([{ type: "terminal", from: "t-old", to: "t-new" }]);
  });

  it("update: только изменившаяся должность", () => {
    const it0 = item({
      kind: "update",
      before: { position: "Повар", staff_role_id: "r1", grade: 1, shift: null, is_trainee: false, workly_company_id: 9, workly_id: 77 },
      after: { position: "Старший повар", staff_role_id: "r2", grade: 2, shift: null, is_trainee: false },
    });
    expect(changeSummary(it0)).toEqual([{ type: "position", from: "Повар", to: "Старший повар" }]);
  });

  it("update: табельный номер", () => {
    const it0 = item({ kind: "update", before: { workly_tab_number: "12" }, after: { workly_tab_number: "13" } });
    expect(changeSummary(it0)).toEqual([{ type: "tab", from: "12", to: "13" }]);
  });

  it("create: должность и филиал нового сотрудника", () => {
    const it0 = item({
      kind: "create",
      key: "create:w900",
      employee_id: null,
      workly_id: 900,
      before: null,
      after: { first_name: "Анна", last_name: "Петрова", position: "Кассир", terminal_id: "t-9", active: true },
    });
    expect(changeSummary(it0)).toEqual([{ type: "create", position: "Кассир", terminal_id: "t-9" }]);
  });

  it("create без должности: position null", () => {
    const it0 = item({ kind: "create", employee_id: null, after: { position: null, terminal_id: "t-9" } });
    expect(changeSummary(it0)).toEqual([{ type: "create", position: null, terminal_id: "t-9" }]);
  });

  it("link: связь с записью Workly, должность та же — только связь", () => {
    const it0 = item({
      kind: "link",
      workly_id: 77,
      before: { workly_company_id: null, workly_id: null, workly_tab_number: null, position: "Кассир", active: true },
      after: { workly_company_id: 9, workly_id: 77, workly_tab_number: "0042", position: "Кассир", active: true },
    });
    expect(changeSummary(it0)).toEqual([{ type: "link", workly_id: 77 }]);
  });

  it("link неактивного с новой должностью: связь, станет активным, должность", () => {
    const it0 = item({
      kind: "link",
      workly_id: 78,
      before: { workly_id: null, position: null, active: false },
      after: { workly_id: 78, position: "Курьер", active: true },
    });
    expect(changeSummary(it0)).toEqual([
      { type: "link", workly_id: 78 },
      { type: "activate" },
      { type: "position", from: null, to: "Курьер" },
    ]);
  });

  it("relink: прежняя и новая запись Workly", () => {
    const it0 = item({ kind: "relink", workly_id: 80, before: { workly_id: 12, active: true }, after: { workly_id: 80, active: true } });
    expect(changeSummary(it0)).toEqual([{ type: "relink", from: 12, to: 80 }]);
  });

  it("reactivate: станет активным и новая должность", () => {
    const it0 = item({
      kind: "reactivate",
      before: { active: false, position: "Повар", workly_id: 77 },
      after: { active: true, position: "Су-шеф" },
    });
    expect(changeSummary(it0)).toEqual([{ type: "activate" }, { type: "position", from: "Повар", to: "Су-шеф" }]);
  });

  it("у каждого вида части только из CHANGE_TYPES", () => {
    expect([...CHANGE_TYPES].sort()).toEqual([
      "activate",
      "create",
      "deactivate",
      "deactivateByName",
      "link",
      "position",
      "relink",
      "tab",
      "terminal",
    ]);
  });
});

// Запись статуса: last_run — последний любого вида, last_employees_run и last_attendance_run —
// последний своего вида (R35). Время в тестах не нужно: какой прогон новее, видно по last_run.
type Ref = { id: string; kind: "employees" | "attendance"; status: string; period: string | null };
const emp = (id: string, status: string): Ref => ({ id, kind: "employees", status, period: null });
const att = (id: string, status: string, period: string | null = "2026-10-01"): Ref => ({ id, kind: "attendance", status, period });
const statusEntry = (runs: { employees?: Ref; attendance?: Ref; newest?: "employees" | "attendance" }) => {
  const e = runs.employees ?? null;
  const a = runs.attendance ?? null;
  const newest = runs.newest === "attendance" ? a ?? e : e ?? a;
  return { last_run: newest, last_employees_run: e, last_attendance_run: a };
};

describe("resumeRunId / plannedRunId", () => {
  it("идущая проверка сотрудников возобновляется после перезагрузки", () => {
    expect(resumeRunId(statusEntry({ employees: emp("r1", "running") }))).toBe("r1");
  });

  it("законченные проверки и одна только посещаемость не опрашиваются", () => {
    expect(resumeRunId(statusEntry({ attendance: att("r2", "running") }))).toBeNull();
    expect(resumeRunId(statusEntry({ employees: emp("r3", "planned") }))).toBeNull();
    expect(resumeRunId(statusEntry({}))).toBeNull();
  });

  it("синхронизация посещаемости новее идущей проверки: проверка всё равно возобновляется", () => {
    const e = statusEntry({ employees: emp("r6", "running"), attendance: att("a6", "applied"), newest: "attendance" });
    expect(e.last_run?.id).toBe("a6");
    expect(resumeRunId(e)).toBe("r6");
  });

  it("готовый план сотрудников можно открыть кнопкой", () => {
    expect(plannedRunId(statusEntry({ employees: emp("r3", "planned") }))).toBe("r3");
    expect(plannedRunId(statusEntry({ employees: emp("r4", "applied") }))).toBeNull();
    expect(plannedRunId(statusEntry({ attendance: att("r5", "applied") }))).toBeNull();
    expect(plannedRunId(statusEntry({}))).toBeNull();
  });

  it("синхронизация посещаемости новее готового плана: «Открыть план» остаётся", () => {
    for (const status of ["running", "applied", "failed"]) {
      const e = statusEntry({ employees: emp("r7", "planned"), attendance: att("a7", status), newest: "attendance" });
      expect(e.last_run?.kind).toBe("attendance");
      expect(plannedRunId(e)).toBe("r7");
    }
  });

  it("RUN_STATUSES — все статусы прогона", () => {
    expect([...RUN_STATUSES].sort()).toEqual(["applied", "blocked", "failed", "planned", "rolled_back", "running"]);
  });
});

describe("resultRunId", () => {
  it("применённый или откатанный последний прогон сотрудников открывается кнопкой «Открыть итог»", () => {
    expect(resultRunId(statusEntry({ employees: emp("r1", "applied") }))).toBe("r1");
    expect(resultRunId(statusEntry({ employees: emp("r2", "rolled_back") }))).toBe("r2");
  });

  it("прочие статусы, одна посещаемость и пустой статус — null", () => {
    for (const status of ["running", "planned", "failed", "blocked"]) expect(resultRunId(statusEntry({ employees: emp("r3", status) }))).toBeNull();
    expect(resultRunId(statusEntry({ attendance: att("a1", "applied") }))).toBeNull();
    expect(resultRunId(statusEntry({}))).toBeNull();
  });

  it("синхронизация посещаемости новее применённого плана: итог по-прежнему открывается", () => {
    const e = statusEntry({ employees: emp("r4", "applied"), attendance: att("a4", "failed"), newest: "attendance" });
    expect(e.last_run?.kind).toBe("attendance");
    expect(resultRunId(e)).toBe("r4");
  });
});

describe("lastRunLines", () => {
  type Full = {
    id: string;
    kind: "employees" | "attendance";
    status: string;
    error: string | null;
    block_reason: string | null;
    created_at: string;
  };
  const run = (p: Partial<Full> & Pick<Full, "id" | "kind" | "status">): Full => ({
    error: null,
    block_reason: null,
    created_at: "2026-10-31T08:00:00.000Z",
    ...p,
  });
  // last_run — новейший прогон любого вида, как в GET /workly/status.
  const entry = (e: Full | null, a: Full | null) => {
    const newest = [e, a].filter((r): r is Full => r != null).sort((x, y) => y.created_at.localeCompare(x.created_at))[0] ?? null;
    return { last_run: newest, last_employees_run: e, last_attendance_run: a };
  };
  const nightly = run({ id: "e1", kind: "employees", status: "blocked", block_reason: "too_many_deactivations", created_at: "2026-10-30T22:30:00.000Z" });
  const synced = run({ id: "a1", kind: "attendance", status: "applied", created_at: "2026-10-31T09:00:00.000Z" });

  it("blocked employees run older than applied attendance run still shown", () => {
    const ent = entry(nightly, synced);
    expect(ent.last_run?.id).toBe("a1");
    const lines = lastRunLines(ent, null);
    expect(lines.map((l) => [l.kind, l.run.id])).toEqual([
      ["employees", "e1"],
      ["attendance", "a1"],
    ]);
    expect(lines[0]!.note).toEqual({ type: "blocked", key: "blocked.too_many_deactivations" });
    expect(lines[1]!.note).toBeNull();
  });

  it("failed attendance run older than a ready employees plan still shown, with the attendance text", () => {
    const failed = run({ id: "a2", kind: "attendance", status: "failed", error: "empty_crawl", created_at: "2026-10-31T07:00:00.000Z" });
    const planned = run({ id: "e2", kind: "employees", status: "planned", created_at: "2026-10-31T10:00:00.000Z" });
    const lines = lastRunLines(entry(planned, failed), null);
    expect(lines.map((l) => l.kind)).toEqual(["employees", "attendance"]);
    expect(lines[0]!.note).toBeNull();
    expect(lines[1]!.note).toEqual({ type: "error", key: "attendance.errors.empty_crawl" });
  });

  it("a kind with no run shows nothing for that kind", () => {
    expect(lastRunLines(entry(null, null), null)).toEqual([]);
    expect(lastRunLines(entry(null, synced), null).map((l) => l.kind)).toEqual(["attendance"]);
    expect(lastRunLines(entry(nightly, null), null).map((l) => l.kind)).toEqual(["employees"]);
  });

  it("ошибку и причину прогона сотрудников, за которым следит карточка, строка не повторяет", () => {
    const failed = run({ id: "e3", kind: "employees", status: "failed", error: "company_mismatch" });
    expect(lastRunLines(entry(failed, null), null)[0]!.note).toEqual({ type: "error", key: "errors.company_mismatch" });
    expect(lastRunLines(entry(failed, null), "e3")[0]!.note).toBeNull();
    expect(lastRunLines(entry(nightly, null), "e1")[0]!.note).toBeNull();
    // Карточка следит только за проверкой сотрудников: id чужого вида ничего не прячет.
    const attFailed = run({ id: "a3", kind: "attendance", status: "failed", error: "stale" });
    expect(lastRunLines(entry(null, attFailed), "a3")[0]!.note).toEqual({ type: "error", key: "attendance.errors.stale" });
  });

  it("идущая синхронизация посещаемости, ошибка без кода и незнакомая причина остановки", () => {
    expect(lastRunLines(entry(null, run({ id: "a4", kind: "attendance", status: "running" })), null)[0]!.note).toEqual({
      type: "attendanceRunning",
    });
    expect(lastRunLines(entry(run({ id: "e4", kind: "employees", status: "failed" }), null), null)[0]!.note).toEqual({
      type: "error",
      key: "errors.unknown",
    });
    expect(
      lastRunLines(entry(run({ id: "e5", kind: "employees", status: "blocked", block_reason: "что-то новое" }), null), null)[0]!.note
    ).toEqual({ type: "blocked", key: "blocked.unknown" });
    for (const status of ["running", "planned", "applied", "rolled_back"]) {
      expect(lastRunLines(entry(run({ id: "e6", kind: "employees", status }), null), null)[0]!.note).toBeNull();
    }
  });
});

describe("inWorkly", () => {
  it("ключ от kpiScreens переводится в ключ от kpiScreens.workly", () => {
    expect(inWorkly("workly.errors.run_superseded")).toBe("errors.run_superseded");
    expect(inWorkly("workly.blocked.unknown")).toBe("blocked.unknown");
  });

  it("ключ без префикса не меняется", () => {
    expect(inWorkly("errors.stale")).toBe("errors.stale");
  });
});

describe("worklyErrorKey", () => {
  it("известный код ответа → errors.<код> от kpiScreens.workly", () => {
    expect(worklyErrorKey(new KpiApiError(409, "run_superseded", {}))).toBe("errors.run_superseded");
    expect(worklyErrorKey(new KpiApiError(409, "workly_id_taken", {}))).toBe("errors.workly_id_taken");
    expect(worklyErrorKey(new KpiApiError(422, "bad_tab_number", {}))).toBe("errors.bad_tab_number");
  });

  it("422 company_mismatch (ключи от другой компании Workly) — свой текст", () => {
    expect(worklyErrorKey(new KpiApiError(422, "company_mismatch", { error: "company_mismatch" }))).toBe("errors.company_mismatch");
  });

  it("сеть, права, 5xx и прочее — null: текст даёт общий kpiErrorText", () => {
    expect(worklyErrorKey(new KpiApiError(0, "network", {}))).toBeNull();
    expect(worklyErrorKey(new KpiApiError(403, "forbidden", {}))).toBeNull();
    expect(worklyErrorKey(new Error("boom"))).toBeNull();
    expect(worklyErrorKey(null)).toBeNull();
  });
});

describe("runStaleness", () => {
  const created = "2026-10-31T05:00:00.000Z";
  const t0 = Date.parse(created);
  const MIN = 60_000;

  it("до 4 минут — ok", () => {
    expect(runStaleness(created, t0)).toBe("ok");
    expect(runStaleness(created, t0 + 4 * MIN - 1)).toBe("ok");
  });

  it("с 4 минут — slow (дольше обычного)", () => {
    expect(runStaleness(created, t0 + 4 * MIN)).toBe("slow");
    expect(runStaleness(created, t0 + 4 * MIN + 1)).toBe("slow");
    expect(runStaleness(created, t0 + 16 * MIN - 1)).toBe("slow");
  });

  it("с 16 минут — stuck: бэкенд закрывает брошенную строку после 15 минут, минута на расхождение часов", () => {
    expect(runStaleness(created, t0 + 16 * MIN)).toBe("stuck");
    expect(runStaleness(created, t0 + 16 * MIN + 1)).toBe("stuck");
    expect(runStaleness(created, t0 + 3 * 60 * MIN)).toBe("stuck");
  });

  it("часы клиента отстают (возраст отрицательный) — ok; непонятная дата — ok", () => {
    expect(runStaleness(created, t0 - 10 * MIN)).toBe("ok");
    expect(runStaleness("не дата", t0 + 60 * MIN)).toBe("ok");
  });
});

describe("applyPreview", () => {
  const pi = (key: string, kind: PlanKind, employee_id: string | null): PlanItem => ({
    key,
    kind,
    employee_id,
    workly_id: 1,
    label: key,
    before: null,
    after: {},
  });
  const items = [
    pi("deactivate:d1", "deactivate", "d1"),
    pi("deactivate:d2", "deactivate", "d2"),
    pi("link:A", "link", "A"),
    pi("move:A", "move", "A"),
    pi("create:w5", "create", null),
  ];

  it("связь исключена: её перенос не считается, но в excluded только то, что исключил человек", () => {
    expect(applyPreview(items, new Set(["link:A"]))).toEqual({
      counts: { link: 0, relink: 0, update: 0, move: 0, create: 1, deactivate: 2, reactivate: 0 },
      lines: [
        { kind: "deactivate", count: 2 },
        { kind: "create", count: 1 },
      ],
      deactivate: 2,
      excluded: 1,
      implied: new Set(["move:A"]),
      total: 3,
    });
  });

  it("ничего не исключено: всё идёт в применение, деактивации отдельно", () => {
    expect(applyPreview(items, new Set())).toEqual({
      counts: { link: 1, relink: 0, update: 0, move: 1, create: 1, deactivate: 2, reactivate: 0 },
      lines: [
        { kind: "deactivate", count: 2 },
        { kind: "link", count: 1 },
        { kind: "move", count: 1 },
        { kind: "create", count: 1 },
      ],
      deactivate: 2,
      excluded: 0,
      implied: new Set(),
      total: 5,
    });
  });

  it("исключены деактивации: строки деактивации нет, остальное идёт", () => {
    const out = applyPreview(items, new Set(["deactivate:d1", "deactivate:d2"]));
    expect(out.deactivate).toBe(0);
    expect(out.excluded).toBe(2);
    expect(out.total).toBe(3);
    expect(out.lines).toEqual([
      { kind: "link", count: 1 },
      { kind: "move", count: 1 },
      { kind: "create", count: 1 },
    ]);
  });

  it("всё исключено: применять нечего", () => {
    const all = new Set(items.map((i) => i.key));
    expect(applyPreview(items, all)).toEqual({
      counts: { link: 0, relink: 0, update: 0, move: 0, create: 0, deactivate: 0, reactivate: 0 },
      lines: [],
      deactivate: 0,
      excluded: 5,
      implied: new Set(),
      total: 0,
    });
  });
});

describe("shortId / searchSeed", () => {
  it("короткий хвост id с многоточием", () => {
    expect(shortId(E1)).toBe("…6789ab");
    expect(shortId("abc")).toBe("abc");
  });

  it("подпись неоднозначной строки без хвоста «(Workly: …)»", () => {
    expect(searchSeed("Иван Иванов (Workly: 12, 15)")).toBe("Иван Иванов");
    expect(searchSeed("  Анна Петрова  ")).toBe("Анна Петрова");
    expect(searchSeed("без имени (Workly: 3)")).toBe("без имени");
  });
});

describe("resumeAttendanceRun", () => {
  it("идущая синхронизация посещаемости возобновляется вместе со своим месяцем", () => {
    expect(resumeAttendanceRun(statusEntry({ attendance: att("a1", "running") }))).toEqual({ id: "a1", period: "2026-10-01" });
  });

  it("месяца нет — id без месяца", () => {
    expect(resumeAttendanceRun(statusEntry({ attendance: att("a2", "running", null) }))).toEqual({ id: "a2", period: null });
  });

  it("проверка сотрудников новее идущей синхронизации: синхронизация всё равно возобновляется", () => {
    const e = statusEntry({ employees: emp("e9", "running"), attendance: att("a9", "running"), newest: "employees" });
    expect(e.last_run?.id).toBe("e9");
    expect(resumeAttendanceRun(e)).toEqual({ id: "a9", period: "2026-10-01" });
    const planned = statusEntry({ employees: emp("e8", "planned"), attendance: att("a8", "running"), newest: "employees" });
    expect(resumeAttendanceRun(planned)).toEqual({ id: "a8", period: "2026-10-01" });
  });

  it("одна только проверка сотрудников и законченная синхронизация не возобновляются", () => {
    expect(resumeAttendanceRun(statusEntry({ employees: emp("e1", "running") }))).toBeNull();
    expect(resumeAttendanceRun(statusEntry({ attendance: att("a3", "applied") }))).toBeNull();
    expect(resumeAttendanceRun(statusEntry({ attendance: att("a4", "failed") }))).toBeNull();
    expect(resumeAttendanceRun(statusEntry({}))).toBeNull();
  });
});

describe("formatShare", () => {
  it("процент с одним знаком после запятой, по-русски, без пробела перед %", () => {
    expect(formatShare(0.1234)).toBe("12,3%");
    expect(formatShare(0.25)).toBe("25,0%");
    expect(formatShare(2 / 3)).toBe("66,7%");
    expect(formatShare(0)).toBe("0,0%");
    expect(formatShare(1)).toBe("100,0%");
  });

  it("явная локаль ru даёт то же, en — точку", () => {
    expect(formatShare(0.1234, "ru")).toBe("12,3%");
    expect(formatShare(0.1234, "en")).toBe("12.3%");
  });

  it("не число — прочерк", () => {
    expect(formatShare(Number.NaN)).toBe("—");
    expect(formatShare(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("fileImportWarning", () => {
  const ORG = "6b1f0a52-9c3e-4d0b-8a57-4c2f1e9d7a10";
  const OTHER = "0d2c5e7a-1b3f-4a6d-9e8c-7f5a3b1d2c4e";
  type Row = NonNullable<Parameters<typeof fileImportWarning>[0]>[number];
  const row = (p: Partial<Row>): Row => ({ source: "file", status: "committed", organization_id: ORG, ...p });

  it("действующий файловый импорт этой организации — предупреждение", () => {
    expect(fileImportWarning([row({})], ORG)).toBe(true);
    expect(fileImportWarning([row({ source: "api" }), row({ status: "replaced" }), row({})], ORG)).toBe(true);
  });

  it("импорт из API, заменённый файл, другая организация или прежний импорт без организации — нет", () => {
    expect(fileImportWarning([row({ source: "api" })], ORG)).toBe(false);
    expect(fileImportWarning([row({ status: "replaced" })], ORG)).toBe(false);
    expect(fileImportWarning([row({ organization_id: OTHER })], ORG)).toBe(false);
    expect(fileImportWarning([row({ organization_id: null })], ORG)).toBe(false);
  });

  it("пустой или ещё не загруженный список, организация не выбрана — нет", () => {
    expect(fileImportWarning([], ORG)).toBe(false);
    expect(fileImportWarning(undefined, ORG)).toBe(false);
    expect(fileImportWarning([row({ organization_id: null })], null)).toBe(false);
  });
});

describe("attendanceResultLines", () => {
  it("три строки в порядке days, unknown, carried с ключами текста и пояснения", () => {
    expect(attendanceResultLines({ days: 412, unknown: 7, carried: 3, import_id: "i1" })).toEqual([
      { key: "days", label: "attendance.result.days", hint: "attendance.result.daysHint", value: 412 },
      { key: "unknown", label: "attendance.result.unknown", hint: "attendance.result.unknownHint", value: 7 },
      { key: "carried", label: "attendance.result.carried", hint: "attendance.result.carriedHint", value: 3 },
    ]);
  });

  it("нет поля, не число или нет counts — 0; числовая строка — число", () => {
    expect(attendanceResultLines({ days: "15", unknown: "мусор" }).map((l) => l.value)).toEqual([15, 0, 0]);
    expect(attendanceResultLines({}).map((l) => l.value)).toEqual([0, 0, 0]);
    expect(attendanceResultLines(null).map((l) => l.value)).toEqual([0, 0, 0]);
    expect(attendanceResultLines(undefined).map((l) => l.value)).toEqual([0, 0, 0]);
  });
});

describe("attendanceErrorKey", () => {
  it("коды, у которых в блоке посещаемости свой текст", () => {
    expect([...ATTENDANCE_ERROR_CODES].sort()).toEqual(["empty_crawl", "period_not_started", "run_in_progress", "stale"]);
    expect(attendanceErrorKey("empty_crawl")).toBe("attendance.errors.empty_crawl");
    expect(attendanceErrorKey("stale")).toBe("attendance.errors.stale");
    expect(attendanceErrorKey("period_not_started")).toBe("attendance.errors.period_not_started");
    expect(attendanceErrorKey("run_in_progress")).toBe("attendance.errors.run_in_progress");
  });

  it("прочие коды и пустой код — null: для них общий текст errors.*", () => {
    expect(attendanceErrorKey("period_closed")).toBeNull();
    expect(attendanceErrorKey("crawl_failed")).toBeNull();
    expect(attendanceErrorKey("не код")).toBeNull();
    expect(attendanceErrorKey(null)).toBeNull();
    expect(attendanceErrorKey(undefined)).toBeNull();
  });
});

describe("lastRunErrorKey", () => {
  const run = (kind: "employees" | "attendance", error: string | null) => ({ kind, error });

  it("упавшая синхронизация посещаемости — тексты блока посещаемости", () => {
    expect(lastRunErrorKey(run("attendance", "empty_crawl"))).toBe("attendance.errors.empty_crawl");
    expect(lastRunErrorKey(run("attendance", "stale"))).toBe("attendance.errors.stale");
    expect(lastRunErrorKey(run("attendance", "period_not_started"))).toBe("attendance.errors.period_not_started");
  });

  it("код посещаемости без своего текста — общий текст errors.*", () => {
    expect(lastRunErrorKey(run("attendance", "client_invalid"))).toBe("errors.client_invalid");
    expect(lastRunErrorKey(run("attendance", "не код"))).toBe("errors.unknown");
  });

  it("проверка сотрудников — всегда общий текст errors.*", () => {
    expect(lastRunErrorKey(run("employees", "company_mismatch"))).toBe("errors.company_mismatch");
    expect(lastRunErrorKey(run("attendance", "company_mismatch"))).toBe("errors.company_mismatch");
    expect(lastRunErrorKey(run("employees", "empty_crawl"))).toBe("errors.empty_crawl");
    expect(lastRunErrorKey(run("employees", "stale"))).toBe("errors.stale");
  });

  it("нет кода или нет прогона — null", () => {
    expect(lastRunErrorKey(run("attendance", null))).toBeNull();
    expect(lastRunErrorKey(run("employees", null))).toBeNull();
    expect(lastRunErrorKey(null)).toBeNull();
  });
});
