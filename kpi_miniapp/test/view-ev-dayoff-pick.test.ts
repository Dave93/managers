import { expect, it } from "bun:test";
import type { EvDayOffEmployees } from "@backend/modules/kpi/tg-app/ev-types";
import { DICT } from "../src/i18n";
import { dayOffPickView } from "../src/view/ev-dayoff-pick";

const counter = (shown: number, total: number) => DICT.ru.ev_counter.replace("{shown}", String(shown)).replace("{total}", String(total));

const E = (id: string, last: string, first: string, terminal: string, position: string | null) =>
  ({ id, last_name: last, first_name: first, terminal_id: terminal, terminal_name: terminal === "t1" ? "Филиал А" : "Филиал Б", position });
const D = (o: Partial<EvDayOffEmployees> = {}): EvDayOffEmployees => ({
  terminals: [{ id: "t1", name: "Филиал А" }, { id: "t2", name: "Филиал Б" }],
  items: [E("e1", "Алиев", "Ботир", "t1", "Повар"), E("e2", "Каримова", "Дилноза", "t1", null), E("e3", "Алиева", "Нодира", "t2", "Кассир")],
  ...o,
});
const ALL = { terminal_id: null, search: "" };

it("все сотрудники филиалов, в том числе без должности и карты; подпись и ссылка на форму выдачи", () => {
  const vm = dayOffPickView(D(), ALL, "ru");
  expect(vm.rows.map((r) => r.name)).toEqual(["Алиев Ботир", "Каримова Дилноза", "Алиева Нодира"]);
  expect(vm.rows[0]).toMatchObject({ sub: "Повар · Филиал А", hash: "#/ev/dayoff/e1" });
  expect(vm.rows[1]!.sub).toBe("Филиал А");
  expect(vm.counter).toBe(counter(3, 3));
  expect(vm.empty).toBeNull();
});
it("фильтр по филиалу и поиск по имени без регистра, слова в любом порядке", () => {
  expect(dayOffPickView(D(), { terminal_id: "t2", search: "" }, "ru").rows.map((r) => r.id)).toEqual(["e3"]);
  expect(dayOffPickView(D(), { terminal_id: null, search: "АЛИЕВ" }, "ru").rows.map((r) => r.id)).toEqual(["e1", "e3"]);
  expect(dayOffPickView(D(), { terminal_id: null, search: "дилноза каримова" }, "ru").rows.map((r) => r.id)).toEqual(["e2"]);
  expect(dayOffPickView(D(), { terminal_id: "t1", search: "алиева" }, "ru")).toMatchObject({ rows: [], empty: "ev_empty_filter", counter: counter(0, 3) });
});
it("выбор филиала виден только если филиалов больше одного; пустой список — своя подпись", () => {
  expect(dayOffPickView(D(), ALL, "ru").showBranch).toBe(true);
  expect(dayOffPickView(D({ terminals: [{ id: "t1", name: "Филиал А" }] }), ALL, "ru").showBranch).toBe(false);
  expect(dayOffPickView(D({ terminals: [], items: [] }), ALL, "ru").empty).toBe("ev_dayoff_pick_empty");
  expect(dayOffPickView(D(), ALL, "uz").title).toBe("Dam olish kuni kimga beriladi");
});
