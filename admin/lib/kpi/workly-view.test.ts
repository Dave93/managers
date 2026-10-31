import { describe, expect, it } from "bun:test";
import type { PlanItem, PlanKind } from "@backend/modules/workly/plan";
import { KpiApiError } from "./errors";
import {
  CHANGE_TYPES,
  GROUP_PAGE,
  RUN_STATUSES,
  SKIPPED_PAGE,
  applyPreview,
  changeSummary,
  confirmSummary,
  impliedSkips,
  inWorkly,
  plannedRunId,
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

describe("resumeRunId / plannedRunId", () => {
  const entry = (last_run: { id: string; kind: "employees" | "attendance"; status: string } | null) => ({ last_run });

  it("идущая проверка сотрудников возобновляется после перезагрузки", () => {
    expect(resumeRunId(entry({ id: "r1", kind: "employees", status: "running" }))).toBe("r1");
  });

  it("посещаемость и законченные прогоны не опрашиваются", () => {
    expect(resumeRunId(entry({ id: "r2", kind: "attendance", status: "running" }))).toBeNull();
    expect(resumeRunId(entry({ id: "r3", kind: "employees", status: "planned" }))).toBeNull();
    expect(resumeRunId(entry(null))).toBeNull();
  });

  it("готовый план сотрудников можно открыть кнопкой", () => {
    expect(plannedRunId(entry({ id: "r3", kind: "employees", status: "planned" }))).toBe("r3");
    expect(plannedRunId(entry({ id: "r4", kind: "employees", status: "applied" }))).toBeNull();
    expect(plannedRunId(entry({ id: "r5", kind: "attendance", status: "planned" }))).toBeNull();
    expect(plannedRunId(entry(null))).toBeNull();
  });

  it("RUN_STATUSES — все статусы прогона", () => {
    expect([...RUN_STATUSES].sort()).toEqual(["applied", "blocked", "failed", "planned", "rolled_back", "running"]);
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
