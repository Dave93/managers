import { expect, it } from "bun:test";
import type { EvEmployee, EvEmployees } from "@backend/modules/kpi/tg-app/ev-types";
import { type EvFilter, evListView } from "../src/view/ev-list";

const uid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const row = (n: number, last: string, first: string, t: string, tn: string, c: string, ct: string, st: EvEmployee["review_status"], o: Partial<EvEmployee> = {}): EvEmployee =>
  ({ id: uid(n), first_name: first, last_name: last, terminal_id: t, terminal_name: tn, position: "Повар", card_id: c, card_title: ct, review_status: st, score_pct: null, late: false, open_dispute: false, can_evaluate: true, ...o });
const D: EvEmployees = {
  period: "2026-10-01", period_status: "open", submit_opens_at: "2026-10-19T19:00:00.000Z", review_deadline: "2026-11-07T18:59:59.999Z",
  terminals: [{ id: "t1", name: "Филиал А" }, { id: "t2", name: "Филиал Б" }], cards: [{ id: "c1", title: "Повар" }, { id: "c2", title: "Кассир" }],
  items: [
    row(1, "Алиев", "Ботир", "t1", "Филиал А", "c1", "Повар", "submitted", { score_pct: 91.4 }),
    row(2, "Каримов", "Али", "t1", "Филиал А", "c1", "Повар", "none"),
    row(3, "Умаров", "Санжар", "t2", "Филиал Б", "c2", "Кассир", "draft"),
    row(4, "Абдуллаев", "Тимур", "t2", "Филиал Б", "c1", "Повар", "submitted", { open_dispute: true, score_pct: 80, late: true }),
  ],
};
const ALL: EvFilter = { terminal_id: null, card_id: null, status: "all", search: "" };
const NOW = Date.parse("2026-10-26T10:00:00+05:00");
const ids = (f: EvFilter) => evListView(D, f, "ru", NOW).rows.map((r) => r.id);

it("порядок: не оценённые и черновики первыми, отправленные потом, внутри — как прислал сервер", () => {
  expect(ids(ALL)).toEqual([uid(2), uid(3), uid(1), uid(4)]);
});
it("фильтры: филиал, карта, статус, поиск по словам без учёта регистра и порядка", () => {
  expect(ids({ ...ALL, terminal_id: "t2" })).toEqual([uid(3), uid(4)]);
  expect(ids({ ...ALL, card_id: "c2" })).toEqual([uid(3)]);
  expect(ids({ ...ALL, status: "none" })).toEqual([uid(2)]);
  expect(ids({ ...ALL, status: "submitted" })).toEqual([uid(1), uid(4)]);
  expect(ids({ ...ALL, status: "disputed" })).toEqual([uid(4)]);
  expect(ids({ ...ALL, search: "ботир алиев" })).toEqual([uid(1)]);
  expect(ids({ ...ALL, search: "ЛИЕВ" })).toEqual([uid(1)]);
  expect(ids({ ...ALL, search: "x" })).toEqual([]);
});
it("счётчики статусов — после филиала и поиска, до статуса; пустые состояния", () => {
  expect(evListView(D, { ...ALL, terminal_id: "t2" }, "ru", NOW).statuses.map((s) => [s.value, s.count]))
    .toEqual([["all", 2], ["none", 0], ["draft", 1], ["submitted", 1], ["disputed", 1]]);
  expect(evListView(D, { ...ALL, search: "x" }, "ru", NOW).empty).toBe("ev_empty_filter");
  expect(evListView({ ...D, items: [] }, ALL, "ru", NOW).empty).toBe("ev_empty");
  expect(evListView(D, ALL, "ru", NOW).empty).toBeNull();
});
it("строка: чип, балл, опоздание, ссылка; справочники и подписи", () => {
  const vm = evListView(D, ALL, "ru", NOW);
  const byId = new Map(vm.rows.map((r) => [r.id, r]));
  expect(byId.get(uid(1))).toMatchObject({ name: "Алиев Ботир", sub: "Повар · Филиал А", chip: { text: "Отправлена", tone: "ok" }, score: "91,4 %", late: null, hash: `#/ev/review/2026-10/${uid(1)}` });
  expect(byId.get(uid(2))!.chip).toEqual({ text: "Не оценён", tone: "wait" });
  expect(byId.get(uid(3))!.chip).toEqual({ text: "Черновик", tone: "wait" });
  expect(byId.get(uid(4))).toMatchObject({ chip: { text: "Спор", tone: "warn" }, late: "с опозданием" });
  expect([vm.showBranch, vm.showCard, vm.branches[0], vm.cards[0]]).toEqual([true, true, { id: null, label: "Все филиалы" }, { id: null, label: "Все карты" }]);
  expect(evListView({ ...D, terminals: [D.terminals[0]!] }, ALL, "ru", NOW).showBranch).toBe(false);
  expect(vm.counter).toBe("4 из 4");
});
it("info: срок оценок, начало отправки, закрытый месяц; заголовок на двух языках", () => {
  expect(evListView(D, ALL, "ru", NOW).info).toBe("Оценки до 7 ноября");
  expect(evListView(D, ALL, "ru", Date.parse("2026-10-10T10:00:00+05:00")).info).toBe("Отправка оценок с 20 октября");
  expect(evListView({ ...D, period_status: "closed" }, ALL, "ru", NOW)).toMatchObject({ info: "Месяц закрыт, оценки не меняются.", closed: true });
  expect(evListView(D, ALL, "ru", NOW).title).toBe("Мои сотрудники · октябрь");
  expect(evListView(D, ALL, "uz", NOW).title).toContain("oktabr");
});
