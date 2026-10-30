import { describe, expect, it } from "bun:test";
import type { StructuredPosition } from "../staff_roles/catalog";
import { buildPlan, countsOf, type OurEmployee, type PlanInput, type SyncPlan } from "./plan";
import type { WorklyDismissed, WorklyEmployee } from "./types";

const CO = 1;
let seq = 0;
let wseq = 0;

// Минимальный валидный сотрудник организации. Имя по умолчанию совпадает с w() и d(),
// должность тоже, поэтому «пустые» тесты не дают лишних update.
function ours(over: Partial<OurEmployee> = {}): OurEmployee {
  const e: OurEmployee = {
    id: `e${++seq}`,
    first_name: "Ali",
    last_name: "Valiyev",
    position: "Повар",
    terminal_id: "T0",
    active: true,
    workly_id: null,
    workly_company_id: null,
    ...over,
  };
  // Связь без компании не бывает: если не сказано иное, компания та же, что в плане.
  if (e.workly_id != null && !("workly_company_id" in over)) e.workly_company_id = CO;
  return e;
}

function w(over: Partial<WorklyEmployee> = {}): WorklyEmployee {
  return {
    id: 1000 + ++wseq,
    first_name: "Ali",
    last_name: "Valiyev",
    patronymic: "",
    tab_number: "T-1",
    start_date: "2025-01-01",
    positions: [{ id: 1, title: "Повар" }],
    locations: [],
    ...over,
  };
}

function d(over: Partial<WorklyDismissed> = {}): WorklyDismissed {
  return {
    id: 5000 + ++wseq,
    first_name: "Ali",
    last_name: "Valiyev",
    patronymic: "",
    tab_number: "T-1",
    start_date: "2024-01-01",
    end_date: "2026-01-01",
    ...over,
  };
}

const structure = (t: string | null): StructuredPosition => ({
  position: t,
  staff_role_id: null,
  grade: null,
  shift: null,
  is_trainee: null,
});

const loc = (id: number) => ({ id, title: `L${id}` });

function run(over: Partial<PlanInput>): SyncPlan {
  return buildPlan({
    companyId: CO,
    ours: [],
    active: [],
    dismissed: [],
    terminalByLocation: new Map(),
    structure,
    ...over,
  });
}

const kinds = (p: SyncPlan) => p.items.map((i) => i.kind);

// Применяет план к списку так, как это сделает синхронизация: create добавляет строку,
// остальное накладывает after на существующего сотрудника.
function apply(list: OurEmployee[], plan: SyncPlan): OurEmployee[] {
  const out = list.map((e) => ({ ...e }));
  for (const it of plan.items) {
    if (it.kind === "create") {
      const a = it.after;
      out.push({
        id: `new-${it.workly_id}`,
        first_name: a.first_name!,
        last_name: a.last_name!,
        position: a.position ?? null,
        terminal_id: a.terminal_id!,
        active: true,
        workly_id: a.workly_id ?? null,
        workly_company_id: a.workly_company_id ?? null,
        workly_tab_number: a.workly_tab_number ?? null,
      });
    } else {
      Object.assign(out.find((e) => e.id === it.employee_id)!, it.after);
    }
  }
  return out;
}

describe("workly/plan: link и relink", () => {
  it("link по уникальному имени", () => {
    const e = ours();
    const p = run({ ours: [e], active: [w({ id: 10 })] });
    expect(kinds(p)).toEqual(["link"]);
    const it = p.items[0]!;
    expect(it.key).toBe(`link:${e.id}`);
    expect(it.employee_id).toBe(e.id);
    expect(it.workly_id).toBe(10);
    expect(it.after.workly_id).toBe(10);
    expect(it.after.workly_company_id).toBe(CO);
    expect(it.after.workly_tab_number).toBe("T-1");
    expect(it.after.position).toBe("Повар");
    expect(it.after.active).toBe(true);
    expect(it.before).toMatchObject({ workly_id: null, active: true });
    expect("terminal_id" in it.after).toBe(false);
    expect(p.report).toEqual({ ambiguous: [], not_found: [], no_branch: [] });
  });

  it("link: before хранит текущее значение каждого поля из after", () => {
    const e = ours({
      workly_tab_number: "OLD",
      position: "Старое",
      staff_role_id: "role-x",
      grade: 1,
      shift: "night",
      is_trainee: true,
    });
    const p = run({ ours: [e], active: [w({ id: 10 })] });
    expect(kinds(p)).toEqual(["link"]);
    expect(p.items[0]!.before).toEqual({
      workly_id: null,
      workly_company_id: null,
      workly_tab_number: "OLD",
      position: "Старое",
      staff_role_id: "role-x",
      grade: 1,
      shift: "night",
      is_trainee: true,
      active: true,
    });
  });

  it("link: поля, которых загрузчик не передал, попадают в before как null", () => {
    const p = run({ ours: [ours()], active: [w({ id: 10 })] });
    expect(p.items[0]!.before).toEqual({
      workly_id: null,
      workly_company_id: null,
      workly_tab_number: null,
      position: "Повар",
      staff_role_id: null,
      grade: null,
      shift: null,
      is_trainee: null,
      active: true,
    });
  });

  it("link: имя сотрудника в плане не меняется", () => {
    const p = run({ ours: [ours({ first_name: "ALI", last_name: "VALIYEV" })], active: [w({ id: 10, first_name: "Ali", last_name: "Valiyev" })] });
    expect("first_name" in p.items[0]!.after).toBe(false);
    expect("last_name" in p.items[0]!.after).toBe(false);
  });

  it("link: регистр, апострофы и порядок слов не важны", () => {
    const p = run({
      ours: [ours({ first_name: "rahimov", last_name: "ozodbek" })],
      active: [w({ id: 10, first_name: "ozodbek", last_name: "rahimov" })],
    });
    expect(kinds(p)).toEqual(["link"]);
  });

  it("link: имя нашего сотрудника может совпасть с ключом имя+фамилия+отчество", () => {
    const p = run({
      ours: [ours({ first_name: "Ali", last_name: "Karim Valiyev" })],
      active: [w({ id: 10, first_name: "Ali", last_name: "Valiyev", patronymic: "Karim" })],
    });
    expect(kinds(p)).toEqual(["link"]);
  });

  it("link неактивного сотрудника возвращает active: true", () => {
    const p = run({ ours: [ours({ active: false })], active: [w({ id: 10 })] });
    expect(kinds(p)).toEqual(["link"]);
    expect(p.items[0]!.after.active).toBe(true);
    expect(p.items[0]!.before).toMatchObject({ active: false });
  });

  it("link и move вместе: основной пункт без terminal_id, терминал отдельным пунктом", () => {
    const e = ours({ terminal_id: "T0" });
    const p = run({
      ours: [e],
      active: [w({ id: 10, locations: [loc(7)] })],
      terminalByLocation: new Map([[7, "T1"]]),
    });
    expect(kinds(p)).toEqual(["link", "move"]);
    expect("terminal_id" in p.items[0]!.after).toBe(false);
    expect(p.items[1]!.key).toBe(`move:${e.id}`);
    expect(p.items[1]!.after).toEqual({ terminal_id: "T1" });
    expect(p.items[1]!.before).toEqual({ terminal_id: "T0" });
  });

  it("повторный приём: связан с уволенной записью, активна новая с тем же именем, relink", () => {
    const e = ours({ workly_id: 10 });
    const p = run({
      ours: [e],
      active: [w({ id: 20 })],
      dismissed: [d({ id: 10 })],
    });
    expect(kinds(p)).toEqual(["relink"]);
    const it = p.items[0]!;
    expect(it.key).toBe(`relink:${e.id}`);
    expect(it.after.workly_id).toBe(20);
    expect(it.after.active).toBe(true);
    expect(it.before).toMatchObject({ workly_id: 10 });
  });

  it("повторный приём: деактивированный сотрудник возвращается в работу", () => {
    const p = run({
      ours: [ours({ workly_id: 10, active: false })],
      active: [w({ id: 20 })],
      dismissed: [d({ id: 10 })],
    });
    expect(kinds(p)).toEqual(["relink"]);
    expect(p.items[0]!.after.active).toBe(true);
  });

  it("повторный приём: связан с АКТИВНОЙ записью 10, запись 20 создаётся, а не relink", () => {
    const e = ours({ workly_id: 10 });
    const p = run({
      ours: [e],
      active: [w({ id: 10 }), w({ id: 20, locations: [loc(7)] })],
      terminalByLocation: new Map([[7, "T1"]]),
    });
    expect(kinds(p)).toEqual(["create"]);
    expect(p.items[0]!.workly_id).toBe(20);
    expect(p.items[0]!.employee_id).toBeNull();
    expect(p.report.ambiguous).toEqual([]);
  });

  it("сотрудник другой компании не кандидат и не попадает в отчёт", () => {
    const foreign = ours({ workly_id: 10, workly_company_id: 2 });
    const p = run({ ours: [foreign], active: [w({ id: 10 })], dismissed: [d({ id: 99 })] });
    expect(p.items).toEqual([]);
    expect(p.report.not_found).toEqual([]);
    expect(p.report.ambiguous).toEqual([]);
    expect(p.report.no_branch.length).toBe(1);
  });

  it("сотрудник со связью на другую компанию не деактивируется, даже если id в уволенных", () => {
    const foreign = ours({ workly_id: 10, workly_company_id: 2 });
    const p = run({ ours: [foreign], dismissed: [d({ id: 10 })] });
    expect(p.items).toEqual([]);
    expect(p.report.not_found).toEqual([]);
  });
});

describe("workly/plan: неоднозначность", () => {
  it("тёзки в Workly: две активные записи с одним ключом и один наш", () => {
    const e = ours({ id: "only" });
    const p = run({ ours: [e], active: [w({ id: 11 }), w({ id: 10 })] });
    expect(p.items).toEqual([]);
    expect(p.report.ambiguous.length).toBe(1);
    expect(p.report.ambiguous[0]!.workly_id).toBe(10);
    expect(p.report.ambiguous[0]!.label).toContain("11");
    // Единственный наш кандидат назван в отчёте: иначе он не попал бы ни в одну корзину.
    expect(p.report.ambiguous[0]!.employee_ids).toEqual(["only"]);
    expect(p.report.not_found).toEqual([]);
  });

  it("тёзки в Workly и нет наших: create не выполняется", () => {
    const m = new Map([[7, "T1"]]);
    const p = run({
      active: [w({ id: 10, locations: [loc(7)] }), w({ id: 11, locations: [loc(7)] })],
      terminalByLocation: m,
    });
    expect(p.items).toEqual([]);
    expect(p.report.ambiguous.length).toBe(1);
    // Наших кандидатов нет вовсе: запись в отчёте остаётся, список пуст.
    expect(p.report.ambiguous[0]!.employee_ids).toEqual([]);
    expect(p.report.no_branch).toEqual([]);
  });

  it("два наших с одним именем", () => {
    const a = ours({ id: "e-b" });
    const b = ours({ id: "e-a" });
    const p = run({ ours: [a, b], active: [w({ id: 10 })] });
    expect(p.items).toEqual([]);
    expect(p.report.ambiguous.length).toBe(1);
    expect(p.report.ambiguous[0]!.employee_ids.length).toBe(2);
    expect(p.report.ambiguous[0]!.employee_ids).toEqual(["e-a", "e-b"]);
    expect(p.report.ambiguous[0]!.workly_id).toBe(10);
  });

  it("два наших, одна запись в Workly и две записи: одна группа, оба наших в списке", () => {
    const p = run({
      ours: [ours({ id: "e1" }), ours({ id: "e2" })],
      active: [w({ id: 10 }), w({ id: 11 })],
    });
    expect(p.items).toEqual([]);
    expect(p.report.ambiguous.length).toBe(1);
    expect(p.report.ambiguous[0]!.employee_ids).toEqual(["e1", "e2"]);
  });

  it("две активные и одна уволенная с тем же именем: неоднозначно, deactivate нет", () => {
    const p = run({
      ours: [ours()],
      active: [w({ id: 10 }), w({ id: 11 })],
      dismissed: [d({ id: 5 })],
    });
    expect(p.items).toEqual([]);
    expect(p.report.ambiguous.length).toBe(1);
    expect(kinds(p)).not.toContain("deactivate");
    expect(p.report.not_found).toEqual([]);
  });

  it("связан с уволенной записью, а в активных две записи с тем же именем: deactivate нет", () => {
    const p = run({
      ours: [ours({ workly_id: 5 })],
      active: [w({ id: 10 }), w({ id: 11 })],
      dismissed: [d({ id: 5 })],
    });
    expect(p.items).toEqual([]);
    expect(p.report.ambiguous.length).toBe(1);
  });

  it("двое наших связаны с уволенной записью, активная одна: deactivate нет ни у кого", () => {
    const p = run({
      ours: [ours({ id: "e1", workly_id: 5 }), ours({ id: "e2", workly_id: 6 })],
      active: [w({ id: 10 })],
      dismissed: [d({ id: 5 }), d({ id: 6 })],
    });
    expect(p.items).toEqual([]);
    expect(p.report.ambiguous.length).toBe(1);
    expect(p.report.ambiguous[0]!.employee_ids).toEqual(["e1", "e2"]);
  });

  it("запись без имени не сопоставляется и не создаётся", () => {
    const p = run({
      ours: [ours({ first_name: "", last_name: "" })],
      active: [w({ id: 10, first_name: " ", last_name: "-", locations: [loc(7)] })],
      terminalByLocation: new Map([[7, "T1"]]),
    });
    expect(p.items).toEqual([]);
    expect(p.report.ambiguous.length).toBe(1);
    expect(p.report.ambiguous[0]!.workly_id).toBe(10);
    // Наш сотрудник без имени не совпадает ни с чем.
    expect(p.report.not_found.length).toBe(1);
  });

  it("наш сотрудник с пустой частью имени не совпадает с полным именем", () => {
    const p = run({ ours: [ours({ first_name: "", last_name: "Valiyev" })], active: [w({ id: 10 })] });
    expect(p.items).toEqual([]);
    expect(p.report.not_found.length).toBe(1);
    expect(p.report.no_branch.length).toBe(1);
  });
});

describe("workly/plan: create", () => {
  it("create при одной сопоставленной локации", () => {
    const p = run({
      active: [w({ id: 10, first_name: " Ali ", last_name: "Valiyev", locations: [loc(7)] })],
      terminalByLocation: new Map([[7, "T1"]]),
    });
    expect(kinds(p)).toEqual(["create"]);
    const it = p.items[0]!;
    expect(it.key).toBe("create:w10");
    expect(it.employee_id).toBeNull();
    expect(it.before).toBeNull();
    expect(it.after.terminal_id).toBe("T1");
    expect(it.after.first_name).toBe("Ali");
    expect(it.after.last_name).toBe("Valiyev");
    expect(it.after.workly_id).toBe(10);
    expect(it.after.workly_company_id).toBe(CO);
    expect(it.after.workly_tab_number).toBe("T-1");
    expect(it.after.position).toBe("Повар");
    expect(it.after.active).toBe(true);
  });

  it("create без должности в Workly: структура пустая", () => {
    const p = run({
      active: [w({ id: 10, positions: [], locations: [loc(7)] })],
      terminalByLocation: new Map([[7, "T1"]]),
    });
    expect(kinds(p)).toEqual(["create"]);
    expect(p.items[0]!.after).toMatchObject({
      position: null,
      staff_role_id: null,
      grade: null,
      shift: null,
      is_trainee: null,
    });
  });

  it("create берёт первую должность из нескольких", () => {
    const p = run({
      active: [
        w({
          id: 10,
          positions: [
            { id: 1, title: "Повар" },
            { id: 2, title: "Кассир" },
          ],
          locations: [loc(7)],
        }),
      ],
      terminalByLocation: new Map([[7, "T1"]]),
    });
    expect(p.items[0]!.after.position).toBe("Повар");
  });

  it("create пропускается при двух сопоставленных локациях", () => {
    const p = run({
      active: [w({ id: 10, locations: [loc(7), loc(8)] })],
      terminalByLocation: new Map([
        [7, "T1"],
        [8, "T2"],
      ]),
    });
    expect(p.items).toEqual([]);
    expect(p.report.no_branch.length).toBe(1);
    expect(p.report.no_branch[0]!.workly_id).toBe(10);
  });

  it("create пропускается при несопоставленной локации (нет в карте и null)", () => {
    const absent = run({ active: [w({ id: 10, locations: [loc(7)] })] });
    expect(absent.items).toEqual([]);
    expect(absent.report.no_branch.length).toBe(1);

    const nul = run({
      active: [w({ id: 10, locations: [loc(7)] })],
      terminalByLocation: new Map<number, string | null>([[7, null]]),
    });
    expect(nul.items).toEqual([]);
    expect(nul.report.no_branch.length).toBe(1);
  });

  it("create пропускается без локаций", () => {
    const p = run({ active: [w({ id: 10, locations: [] })] });
    expect(p.items).toEqual([]);
    expect(p.report.no_branch.length).toBe(1);
  });

  it("create: из двух локаций терминал только у одной, берём его", () => {
    const p = run({
      active: [w({ id: 10, locations: [loc(7), loc(8)] })],
      terminalByLocation: new Map<number, string | null>([
        [7, "T1"],
        [8, null],
      ]),
    });
    expect(kinds(p)).toEqual(["create"]);
    expect(p.items[0]!.after.terminal_id).toBe("T1");
  });

  it("create: повтор одной локации в списке считается одной", () => {
    const p = run({
      active: [w({ id: 10, locations: [loc(7), loc(7)] })],
      terminalByLocation: new Map([[7, "T1"]]),
    });
    expect(kinds(p)).toEqual(["create"]);
  });

  it("одинаковая запись, пришедшая дважды в списке активных, не удваивается", () => {
    const rec = w({ id: 10, locations: [loc(7)] });
    const p = run({ active: [rec, { ...rec }], terminalByLocation: new Map([[7, "T1"]]) });
    expect(kinds(p)).toEqual(["create"]);
  });
});

describe("workly/plan: update, move, reactivate", () => {
  it("update только при изменении: те же табельный и должность, items пуст", () => {
    const p = run({
      ours: [ours({ workly_id: 10, workly_tab_number: "T-1", position: "Повар" })],
      active: [w({ id: 10, tab_number: "T-1" })],
    });
    expect(p.items).toEqual([]);
    expect(p.report).toEqual({ ambiguous: [], not_found: [], no_branch: [] });
  });

  it("update: другая должность", () => {
    const e = ours({ workly_id: 10, workly_tab_number: "T-1", position: "Повар" });
    const p = run({
      ours: [e],
      active: [w({ id: 10, positions: [{ id: 2, title: "Кассир" }] })],
    });
    expect(kinds(p)).toEqual(["update"]);
    const it = p.items[0]!;
    expect(it.key).toBe(`update:${e.id}`);
    // before хранит текущие значения всего, что меняет after, и закрепляет связь с Workly.
    expect(it.before).toEqual({
      position: "Повар",
      staff_role_id: null,
      grade: null,
      shift: null,
      is_trainee: null,
      workly_company_id: CO,
      workly_id: 10,
    });
    expect(it.after).toMatchObject({ position: "Кассир", staff_role_id: null, grade: null, shift: null, is_trainee: null });
    expect("workly_tab_number" in it.after).toBe(false);
    expect("terminal_id" in it.after).toBe(false);
  });

  it("update: другой табельный номер", () => {
    const p = run({
      ours: [ours({ workly_id: 10, workly_tab_number: "OLD" })],
      active: [w({ id: 10, tab_number: "NEW" })],
    });
    expect(kinds(p)).toEqual(["update"]);
    expect(p.items[0]!.before).toEqual({ workly_tab_number: "OLD", workly_company_id: CO, workly_id: 10 });
    expect(p.items[0]!.after).toEqual({ workly_tab_number: "NEW" });
  });

  it("update: before хранит текущую структуру должности, а не только строку", () => {
    const e = ours({
      workly_id: 10,
      workly_tab_number: "T-1",
      position: "Повар 2 разряд",
      staff_role_id: "role-cook",
      grade: 2,
      shift: "day",
      is_trainee: false,
    });
    const p = run({ ours: [e], active: [w({ id: 10, positions: [{ id: 2, title: "Кассир" }] })] });
    expect(p.items[0]!.before).toEqual({
      position: "Повар 2 разряд",
      staff_role_id: "role-cook",
      grade: 2,
      shift: "day",
      is_trainee: false,
      workly_company_id: CO,
      workly_id: 10,
    });
  });

  it("update: у нас табельного нет, в Workly появился", () => {
    const p = run({
      ours: [ours({ workly_id: 10, workly_tab_number: null })],
      active: [w({ id: 10, tab_number: "NEW" })],
    });
    expect(kinds(p)).toEqual(["update"]);
  });

  it("табельный номер не передан (undefined): не сравнивается", () => {
    const p = run({
      ours: [ours({ workly_id: 10 })],
      active: [w({ id: 10, tab_number: "ANY" })],
    });
    expect(p.items).toEqual([]);
  });

  it("пробелы в табельном номере не дают update", () => {
    const p = run({
      ours: [ours({ workly_id: 10, workly_tab_number: "T-1" })],
      active: [w({ id: 10, tab_number: " T-1 " })],
    });
    expect(p.items).toEqual([]);
  });

  it("у связанного в Workly нет должности: наша должность не стирается", () => {
    const p = run({
      ours: [ours({ workly_id: 10, position: "Повар" })],
      active: [w({ id: 10, positions: [] })],
    });
    expect(p.items).toEqual([]);
  });

  it("link без должности в Workly не трогает нашу должность", () => {
    const p = run({
      ours: [ours({ position: "Повар" })],
      active: [w({ id: 10, positions: [] })],
    });
    expect(kinds(p)).toEqual(["link"]);
    for (const f of ["position", "staff_role_id", "grade", "shift", "is_trainee"]) {
      expect(f in p.items[0]!.after).toBe(false);
    }
  });

  it("move: одна сопоставленная локация другого терминала", () => {
    const e = ours({ workly_id: 10, terminal_id: "T0" });
    const p = run({
      ours: [e],
      active: [w({ id: 10, locations: [loc(7)] })],
      terminalByLocation: new Map([[7, "T1"]]),
    });
    expect(kinds(p)).toEqual(["move"]);
    expect(p.items[0]!.key).toBe(`move:${e.id}`);
    expect(p.items[0]!.before?.terminal_id).toBe("T0");
    expect(p.items[0]!.after.terminal_id).toBe("T1");
  });

  it("move: тот же терминал не двигает", () => {
    const p = run({
      ours: [ours({ workly_id: 10, terminal_id: "T1" })],
      active: [w({ id: 10, locations: [loc(7)] })],
      terminalByLocation: new Map([[7, "T1"]]),
    });
    expect(p.items).toEqual([]);
  });

  it("move: две локации, терминал остаётся", () => {
    const p = run({
      ours: [ours({ workly_id: 10, terminal_id: "T0" })],
      active: [w({ id: 10, locations: [loc(7), loc(8)] })],
      terminalByLocation: new Map([
        [7, "T1"],
        [8, "T2"],
      ]),
    });
    expect(kinds(p)).not.toContain("move");
    expect(p.items).toEqual([]);
  });

  it("move: ни одной сопоставленной локации, терминал остаётся", () => {
    const p = run({
      ours: [ours({ workly_id: 10, terminal_id: "T0" })],
      active: [w({ id: 10, locations: [loc(7)] })],
      terminalByLocation: new Map<number, string | null>([[7, null]]),
    });
    expect(p.items).toEqual([]);
  });

  it("move: в одном плане у сотрудника основной пункт и move раздельно", () => {
    const e = ours({ workly_id: 10, terminal_id: "T0", position: "Повар" });
    const p = run({
      ours: [e],
      active: [w({ id: 10, positions: [{ id: 2, title: "Кассир" }], locations: [loc(7)] })],
      terminalByLocation: new Map([[7, "T1"]]),
    });
    expect(kinds(p)).toEqual(["update", "move"]);
    expect("terminal_id" in p.items[0]!.after).toBe(false);
  });

  it("reactivate: связанный неактивный, в Workly активен", () => {
    const e = ours({ workly_id: 10, active: false });
    const p = run({ ours: [e], active: [w({ id: 10 })] });
    expect(kinds(p)).toEqual(["reactivate"]);
    expect(p.items[0]!.key).toBe(`reactivate:${e.id}`);
    expect(p.items[0]!.after.active).toBe(true);
    expect(p.items[0]!.before).toMatchObject({ active: false });
  });

  it("reactivate вместе с изменением должности: один основной пункт", () => {
    const p = run({
      ours: [ours({ workly_id: 10, active: false, position: "Повар" })],
      active: [w({ id: 10, positions: [{ id: 2, title: "Кассир" }] })],
    });
    expect(kinds(p)).toEqual(["reactivate"]);
    expect(p.items[0]!.after).toMatchObject({ active: true, position: "Кассир" });
  });
});

describe("workly/plan: deactivate и not_found", () => {
  it("deactivate связанного, чья запись в списке уволенных", () => {
    const e = ours({ workly_id: 10 });
    const p = run({ ours: [e], dismissed: [d({ id: 10 })] });
    expect(kinds(p)).toEqual(["deactivate"]);
    expect(p.items[0]!.key).toBe(`deactivate:${e.id}`);
    expect(p.items[0]!.after).toEqual({ active: false, workly_company_id: CO, workly_id: 10 });
    expect(p.items[0]!.before).toMatchObject({ active: true, workly_id: 10 });
    expect(p.report.not_found).toEqual([]);
  });

  it("deactivate несвязанного с уникальным совпадением имени в уволенных", () => {
    const e = ours();
    const p = run({ ours: [e], dismissed: [d({ id: 77 })] });
    expect(kinds(p)).toEqual(["deactivate"]);
    expect(p.items[0]!.after.workly_id).toBe(77);
    expect(p.items[0]!.after.active).toBe(false);
    expect(p.items[0]!.after.workly_company_id).toBe(CO);
    expect(p.items[0]!.before).toMatchObject({ active: true, workly_id: null });
  });

  it("неактивных не деактивирует и не заносит в отчёт", () => {
    const p = run({
      ours: [ours({ active: false, workly_id: 10 }), ours({ active: false, first_name: "Bo", last_name: "Ba" })],
      dismissed: [d({ id: 10 }), d({ first_name: "Bo", last_name: "Ba" })],
    });
    expect(p.items).toEqual([]);
    expect(p.report.not_found).toEqual([]);
  });

  it("не найден: нигде нет", () => {
    const p = run({ ours: [ours()] });
    expect(p.items).toEqual([]);
    expect(p.report.not_found.length).toBe(1);
  });

  it("не найден: связан с записью, которой нет ни в одном списке", () => {
    const e = ours({ workly_id: 999 });
    const p = run({ ours: [e], active: [w({ first_name: "Other", last_name: "Person" })], dismissed: [d({ first_name: "Third", last_name: "One" })] });
    expect(kinds(p)).not.toContain("deactivate");
    expect(p.report.not_found).toEqual([{ employee_id: e.id, label: "Ali Valiyev" }]);
  });

  it("отчество только у уволенной записи, у активной без отчества: deactivate нет", () => {
    // Наш сотрудник хранит отчество внутри first_name (спека 5.3), в Workly старая
    // запись с отчеством уволена, а новая активная записана без него.
    const e = ours({ id: "karim", first_name: "Ali Karim", last_name: "Valiyev" });
    const p = run({
      ours: [e],
      active: [w({ id: 10, first_name: "Ali", last_name: "Valiyev", patronymic: "" })],
      dismissed: [d({ id: 5, first_name: "Ali", last_name: "Valiyev", patronymic: "Karim" })],
    });
    expect(kinds(p)).not.toContain("deactivate");
    expect(p.items).toEqual([]);
    expect(p.report.not_found).toEqual([{ employee_id: "karim", label: "Ali Karim Valiyev" }]);
    // Активная запись без кандидата и без филиала: сообщается, а не создаётся вслепую.
    expect(p.report.no_branch.map((n) => n.workly_id)).toEqual([10]);
  });

  it("имя в обоих списках: link на активную запись, deactivate нет", () => {
    const e = ours();
    const p = run({ ours: [e], active: [w({ id: 10 })], dismissed: [d({ id: 5 })] });
    expect(kinds(p)).toEqual(["link"]);
    expect(p.items[0]!.after.workly_id).toBe(10);
    expect(p.report.not_found).toEqual([]);
  });

  it("имя совпало с двумя уволенными: deactivate нет, не найден", () => {
    const p = run({ ours: [ours()], dismissed: [d({ id: 5 }), d({ id: 6 })] });
    expect(p.items).toEqual([]);
    expect(p.report.not_found.length).toBe(1);
  });

  it("уволенная запись уже занята другим нашим: тёзка без связи не деактивируется", () => {
    const linked = ours({ id: "linked", workly_id: 5 });
    const homonym = ours({ id: "homonym" });
    const p = run({ ours: [linked, homonym], dismissed: [d({ id: 5 })] });
    expect(p.items.map((i) => `${i.kind}:${i.employee_id}`)).toEqual(["deactivate:linked"]);
    expect(p.report.not_found.map((n) => n.employee_id)).toEqual(["homonym"]);
  });

  it("двое наших без связи с тем же именем и одна уволенная: никого не деактивируем", () => {
    const p = run({ ours: [ours({ id: "a" }), ours({ id: "b" })], dismissed: [d({ id: 5 })] });
    expect(p.items).toEqual([]);
    expect(p.report.not_found.map((n) => n.employee_id)).toEqual(["a", "b"]);
  });

  it("имя совпало с активной записью, уже связанной с другим нашим: без деактивации", () => {
    const a = ours({ id: "a", workly_id: 10 });
    const b = ours({ id: "b" });
    const p = run({ ours: [a, b], active: [w({ id: 10 })], dismissed: [d({ id: 5 })] });
    expect(p.items).toEqual([]);
    expect(p.report.not_found.map((n) => n.employee_id)).toEqual(["b"]);
  });

  it("связан с уволенной записью, а тёзка связан с активной: деактивируется только первый", () => {
    const alive = ours({ id: "alive", workly_id: 10 });
    const gone = ours({ id: "gone", workly_id: 5 });
    const p = run({ ours: [alive, gone], active: [w({ id: 10 })], dismissed: [d({ id: 5 })] });
    expect(p.items.map((i) => `${i.kind}:${i.employee_id}`)).toEqual(["deactivate:gone"]);
    expect(p.items[0]!.after).toEqual({ active: false, workly_company_id: CO, workly_id: 5 });
    expect(p.report).toEqual({ ambiguous: [], not_found: [], no_branch: [] });
  });

  it("неактивный, связанный с уволенной записью, и новый тёзка при одной активной записи: неоднозначно, ручная связка", () => {
    const old = ours({ id: "old", workly_id: 5, active: false });
    const fresh = ours({ id: "fresh" });
    const p = run({ ours: [old, fresh], active: [w({ id: 10 })], dismissed: [d({ id: 5 })] });
    expect(p.items).toEqual([]);
    expect(p.report.ambiguous.length).toBe(1);
    expect(p.report.ambiguous[0]!.workly_id).toBe(10);
    expect(p.report.ambiguous[0]!.employee_ids).toEqual(["fresh", "old"]);
  });

  it("id записи есть и в активных, и в уволенных: считается активной", () => {
    const p = run({ ours: [ours({ workly_id: 10 })], active: [w({ id: 10 })], dismissed: [d({ id: 10 })] });
    expect(p.items).toEqual([]);
  });

  it("пустой Workly (Review Focus 1): ни одной деактивации", () => {
    const list = Array.from({ length: 30 }, (_, i) => ours({ first_name: `N${i}`, last_name: `S${i}`, workly_id: 100 + i }));
    const p = run({ ours: list, active: [], dismissed: [] });
    expect(p.items).toEqual([]);
    expect(p.report.not_found.length).toBe(30);
    expect(kinds(p)).not.toContain("deactivate");
  });

  it("короткий обход: пропавшие из активных без записи в уволенных идут в not_found", () => {
    const list = Array.from({ length: 10 }, (_, i) => ours({ first_name: `N${i}`, last_name: `S${i}`, workly_id: 100 + i }));
    const p = run({
      ours: list,
      active: [w({ id: 100, first_name: "N0", last_name: "S0" })],
      dismissed: [d({ id: 101, first_name: "N1", last_name: "S1" })],
    });
    expect(p.items.map((i) => `${i.kind}:${i.workly_id}`)).toEqual(["deactivate:101"]);
    expect(p.report.not_found.length).toBe(8);
  });
});

describe("workly/plan: идемпотентность и счётчики", () => {
  function scenario() {
    const named = (n: string, over: Partial<OurEmployee> = {}) => ours({ first_name: n, last_name: "T", ...over });
    const nw = (n: string, over: Partial<WorklyEmployee> = {}) => w({ first_name: n, last_name: "T", ...over });
    const nd = (n: string, over: Partial<WorklyDismissed> = {}) => d({ first_name: n, last_name: "T", ...over });
    const list = [
      named("Aziz", { id: "link-move", terminal_id: "T0" }),
      named("Bobur", { id: "relink", workly_id: 5 }),
      named("Eldor", { id: "update", workly_id: 40, position: "Повар" }),
      named("Farhod", { id: "reactivate", workly_id: 50, active: false }),
      named("Gulnora", { id: "dismissed-linked", workly_id: 60 }),
      named("Hasan", { id: "dismissed-by-name" }),
      named("Iroda", { id: "not-found" }),
      named("Jasur", { id: "ambiguous" }),
    ];
    const input: Partial<PlanInput> = {
      ours: list,
      active: [
        nw("Aziz", { id: 10, locations: [loc(1)] }),
        nw("Bobur", { id: 20 }),
        nw("Dilnoza", { id: 30, locations: [loc(2)] }),
        nw("Eldor", { id: 40, positions: [{ id: 3, title: "Старший повар" }] }),
        nw("Farhod", { id: 50 }),
        nw("Jasur", { id: 80 }),
        nw("Jasur", { id: 81 }),
        nw("Kamola", { id: 90 }),
      ],
      dismissed: [nd("Bobur", { id: 5 }), nd("Gulnora", { id: 60 }), nd("Hasan", { id: 70 })],
      terminalByLocation: new Map([
        [1, "T1"],
        [2, "T2"],
      ]),
    };
    return { list, input };
  }

  it("смешанный сценарий: порядок и состав пунктов", () => {
    const { input } = scenario();
    const p = run(input);
    expect(p.items.map((i) => i.key)).toEqual([
      "link:link-move",
      "move:link-move",
      "relink:relink",
      "create:w30",
      "update:update",
      "reactivate:reactivate",
      "deactivate:dismissed-linked",
      "deactivate:dismissed-by-name",
    ]);
    expect(countsOf(p)).toEqual({
      link: 1,
      relink: 1,
      update: 1,
      move: 1,
      create: 1,
      deactivate: 2,
      reactivate: 1,
      ambiguous: 1,
      not_found: 1,
      no_branch: 1,
    });
    // На одного сотрудника не больше одного основного пункта.
    const main = p.items.filter((i) => i.kind !== "move" && i.employee_id).map((i) => i.employee_id);
    expect(new Set(main).size).toBe(main.length);
  });

  it("before каждого пункта, кроме create, хранит все поля after; у связанных — и пару Workly", () => {
    const { list, input } = scenario();
    const p = run(input);
    const byId = new Map(list.map((e) => [e.id, e]));
    for (const it of p.items) {
      if (it.kind === "create") continue;
      const e = byId.get(it.employee_id!)!;
      const cur = e as unknown as Record<string, unknown>;
      for (const k of Object.keys(it.after)) {
        expect(`${it.key}.${k} in before: ${k in it.before!}`).toBe(`${it.key}.${k} in before: true`);
        expect((it.before as Record<string, unknown>)[k]).toEqual(cur[k] ?? null);
      }
    }
    // Связанные с активной записью (update, reactivate, их move) и деактивация закрепляют пару.
    for (const key of ["update:update", "reactivate:reactivate", "deactivate:dismissed-linked"]) {
      const it = p.items.find((i) => i.key === key)!;
      const e = byId.get(it.employee_id!)!;
      expect(it.before).toMatchObject({ workly_company_id: e.workly_company_id, workly_id: e.workly_id });
    }
    // Перенос при связи по имени пару не закрепляет: связь меняет её раньше переноса.
    const move = p.items.find((i) => i.key === "move:link-move")!;
    expect(move.before).toEqual({ terminal_id: byId.get("link-move")!.terminal_id });
  });

  it("move уже связанного сотрудника закрепляет пару Workly", () => {
    const e = ours({ workly_id: 10, terminal_id: "T0" });
    const p = run({
      ours: [e],
      active: [w({ id: 10, locations: [loc(7)] })],
      terminalByLocation: new Map([[7, "T1"]]),
    });
    expect(kinds(p)).toEqual(["move"]);
    expect(p.items[0]!.before).toEqual({ terminal_id: "T0", workly_company_id: CO, workly_id: 10 });
  });

  it("второй проход после применения пуст", () => {
    const { list, input } = scenario();
    const first = run(input);
    expect(first.items.length).toBeGreaterThan(0);
    const applied = apply(list, first);
    const second = run({ ...input, ours: applied });
    expect(second.items).toEqual([]);
    // Отчёт о том, что человек не решает автоматически, остаётся прежним.
    expect(second.report.ambiguous.length).toBe(1);
    expect(second.report.not_found.map((n) => n.employee_id)).toEqual(["not-found"]);
    expect(second.report.no_branch.length).toBe(1);
  });

  it("план не меняет входные данные", () => {
    const { input } = scenario();
    const before = JSON.stringify(input.ours) + JSON.stringify(input.active) + JSON.stringify(input.dismissed);
    run(input);
    expect(JSON.stringify(input.ours) + JSON.stringify(input.active) + JSON.stringify(input.dismissed)).toBe(before);
  });

  it("план детерминирован: тот же вход, тот же результат", () => {
    const { input } = scenario();
    expect(run(input)).toEqual(run(input));
  });

  it("countsOf пустого плана: все нули", () => {
    expect(countsOf({ items: [], report: { ambiguous: [], not_found: [], no_branch: [] } })).toEqual({
      link: 0,
      relink: 0,
      update: 0,
      move: 0,
      create: 0,
      deactivate: 0,
      reactivate: 0,
      ambiguous: 0,
      not_found: 0,
      no_branch: 0,
    });
  });
});
