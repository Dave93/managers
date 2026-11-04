import { describe, expect, it } from "bun:test";
import { foreignCleanerRole, planCleaners } from "./cleaner-plan";

const row = (id: string, position: string | null, staff_role_id: string | null) => ({ id, position, staff_role_id });

describe("planCleaners", () => {
  it("без роли и «Техничка» — назначить; регистр не важен; без роли и «Повар» — не трогать", () => {
    const p = planCleaners([row("a", "Техничка", null), row("b", "ТЕХНИЧКА 2 разряд", null), row("c", "Повар", null)], null);
    expect(p.assign).toEqual(["a", "b"]);
    expect(p.review).toEqual([]);
  });
  it("роль уже другая — в review, роль cleaner — пропуск", () => {
    const p = planCleaners([row("d", "Техничка зала", "hall"), row("e", "Техничка", "cl")], "cl");
    expect(p.assign).toEqual([]);
    expect(p.review).toEqual([{ id: "d", position: "Техничка зала", staff_role_id: "hall" }]);
  });
  it("стажёр-техничка без роли не получает cleaner, а уходит в review", () => {
    const p = planCleaners([row("f", "Стажёр техничка", null), row("g", "Стажер техничка", null)], null);
    expect(p.assign).toEqual([]);
    expect(p.review.map((x) => x.id)).toEqual(["f", "g"]);
  });
  it("пустая должность игнорируется", () => {
    expect(planCleaners([row("h", null, null)], null)).toEqual({ assign: [], review: [] });
  });
});

describe("foreignCleanerRole", () => {
  it("ручная роль «Техничка» с другим кодом находится, своя cleaner — нет", () => {
    expect(foreignCleanerRole([{ id: "1", code: "cleaner", name_ru: "Техничка" }])).toBeNull();
    expect(foreignCleanerRole([{ id: "2", code: "tech", name_ru: " техничка " }])?.id).toBe("2");
    expect(foreignCleanerRole([{ id: "3", code: "cook", name_ru: "Повар" }])).toBeNull();
  });
});
