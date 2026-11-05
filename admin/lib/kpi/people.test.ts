import { describe, expect, it } from "bun:test";
import type { PeopleRow } from "@admin/lib/kpi-api";
import { filterPeople, matchesPeopleTab, peopleTabCounts, scoreOf, sortPeople, summarizePeople } from "./people";

function row(id: string, o: Partial<PeopleRow> = {}): PeopleRow {
  return {
    id,
    first_name: "Имя",
    last_name: id,
    terminal_id: "t1",
    terminal_name: "T1",
    staff_role_code: null,
    staff_role_name: null,
    active: true,
    external_id: null,
    card: { id: "c", code: "cook", title_ru: "Повар" },
    card_source: "role",
    review: null,
    open_dispute: false,
    can_evaluate: false,
    attendance: { ontime: 0, late: 0, absent: 0 },
    violations: 0,
    ...o,
  };
}
const scored = (pct: number | null): PeopleRow["review"] => ({ id: "r", status: "submitted", score_pct: pct, submitted_at: null, late: false });

describe("people: вкладки", () => {
  it("«Ждут оценки»: есть карта, нет отправленной оценки; без карты не ждёт", () => {
    expect(matchesPeopleTab(row("a"), "none")).toBe(true);
    expect(matchesPeopleTab(row("a", { review: { id: "r", status: "draft", score_pct: null, submitted_at: null, late: false } }), "none")).toBe(true);
    expect(matchesPeopleTab(row("a", { review: scored(80) }), "none")).toBe(false);
    expect(matchesPeopleTab(row("a", { card: null }), "none")).toBe(false);
  });
  it("счётчики и отбор", () => {
    const rows = [
      row("1", { review: scored(90), attendance: { ontime: 20, late: 1, absent: 0 } }),
      row("2", { open_dispute: true, review: scored(70), violations: 2 }),
      row("3", { attendance: { ontime: 5, late: 0, absent: 3 } }),
    ];
    expect(peopleTabCounts(rows)).toEqual({ all: 3, none: 1, disputed: 1, violations: 1, absent: 1 });
    expect(filterPeople(rows, { tab: "violations", terminal: null, query: "" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterPeople(rows, { tab: "all", terminal: "other", query: "" })).toEqual([]);
    expect(filterPeople(rows, { tab: "all", terminal: null, query: "3" }).map((r) => r.id)).toEqual(["3"]);
  });
});

describe("people: сортировка и итоги", () => {
  const rows = [
    row("a", { review: scored(90), violations: 1 }),
    row("b", { review: scored(60), violations: 3, attendance: { ontime: 1, late: 0, absent: 4 } }),
    row("c"),
    row("d", { review: scored(60), attendance: { ontime: 1, late: 5, absent: 0 } }),
  ];
  it("балл: меньший выше, без балла в конце, равные — порядок сервера", () => {
    expect(sortPeople(rows, "score").map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
  });
  it("прогулы и нарушения: больший выше", () => {
    expect(sortPeople(rows, "absent").map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
    expect(sortPeople(rows, "violations").map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
    expect(sortPeople(rows, "late")[0].id).toBe("d");
  });
  it("default не меняет порядок и не мутирует вход", () => {
    expect(sortPeople(rows, "default").map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    sortPeople(rows, "score");
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("scoreOf: балл только у отправленной оценки", () => {
    expect(scoreOf(row("x", { review: scored(75) }))).toBe(75);
    expect(scoreOf(row("x", { review: { id: "r", status: "draft", score_pct: 50, submitted_at: null, late: false } }))).toBeNull();
    expect(scoreOf(row("x"))).toBeNull();
  });
  it("итоги: оценено, споры, нарушения, прогулы", () => {
    expect(summarizePeople(rows)).toEqual({ total: 4, scored: 3, disputed: 0, violations: 4, absent: 4 });
  });
});
