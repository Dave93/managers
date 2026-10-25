import { describe, expect, it } from "bun:test";
import { draftPct, emptySanitary, failedTitles, inspectableTerminals, sanitaryBody, sanitaryIssues } from "./sanitary";

const all = [{ id: "t2", name: "Б филиал" }, { id: "t1", name: "А филиал" }, { id: "t3", name: "В филиал" }];
const TITLES = ["Чистота", "Санитария", "Форма персонала"];

describe("санитарная проверка", () => {
  it("филиалы проверяющего", () => {
    expect(inspectableTerminals([{ terminal_id: "t2" }, { terminal_id: "t2" }], all, false)).toEqual([{ id: "t2", name: "Б филиал" }]);
    expect(inspectableTerminals([{ terminal_id: null }], all, false).map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(inspectableTerminals([], all, true)).toHaveLength(3);
    expect(inspectableTerminals([], all, false)).toEqual([]);
  });
  it("проверки, процент и тело", () => {
    const d = emptySanitary(3, null);
    expect(sanitaryIssues(d)).toEqual(["Выберите филиал", "Отметьте все пункты: осталось 3"]);
    const full = { terminal_id: "t1", answers: [true, false, true], comment: "  маркировка  " };
    expect(sanitaryIssues(full)).toEqual([]);
    expect(draftPct(full)).toBe(66.67);
    expect(draftPct(d)).toBeNull();
    expect(sanitaryBody(full, TITLES)).toEqual({ terminal_id: "t1", items: [{ title: "Чистота", ok: true }, { title: "Санитария", ok: false }, { title: "Форма персонала", ok: true }], comment: "маркировка" });
    expect("comment" in sanitaryBody({ ...full, comment: "  " }, TITLES)).toBe(false);
    expect(sanitaryIssues({ ...full, comment: "x".repeat(1001) })).toEqual(["Комментарий — до 1000 символов"]);
    // пункты в теле — ровно заголовки шаблона, в его порядке
    expect(sanitaryBody({ ...full, answers: [false, true, false] }, TITLES).items.map((i) => i.title)).toEqual(TITLES);
    expect(failedTitles({ items: [{ title: "Чистота", ok: true }, { title: "Маркировка", ok: false }] })).toEqual(["Маркировка"]);
  });
});
