import { describe, expect, it } from "bun:test";
import { resolveIssues, splitDisputes, subjectLabel } from "./disputes";

const d = (id: string, status: "open" | "accepted" | "rejected", created_at: string, resolved_at: string | null) => ({ id, status, created_at, resolved_at });

describe("disputes", () => {
  it("открытые — старые первыми, закрытые — свежие первыми", () => {
    const s = splitDisputes([
      d("a", "open", "2026-11-03T10:00:00.000Z", null),
      d("b", "accepted", "2026-11-01T10:00:00.000Z", "2026-11-04T10:00:00.000Z"),
      d("c", "open", "2026-11-02T10:00:00.000Z", null),
      d("e", "rejected", "2026-11-01T09:00:00.000Z", "2026-11-05T10:00:00.000Z"),
    ]);
    expect(s.open.map((x) => x.id)).toEqual(["c", "a"]);
    expect(s.closed.map((x) => x.id)).toEqual(["e", "b"]);
  });
  it("resolveIssues", () => {
    expect(resolveIssues("review", "accepted", "балл занижен", 1)).toEqual([]);
    expect(resolveIssues("review", "accepted", "балл занижен", 0)).toEqual(["Принятый спор по оценке должен менять баллы: поставьте новые"]);
    expect(resolveIssues("review", "rejected", "   ", 0)).toEqual(["Нужен комментарий к решению"]);
    expect(resolveIssues("violation", "accepted", "фото не того филиала", 0)).toEqual([]);
  });
  it("resolveIssues: минимум букв и цифр, как на сервере", () => {
    expect(resolveIssues("violation", "rejected", ".....", 0, 5)).toEqual(["Комментарий к решению — не меньше 5 символов без пробелов"]);
    expect(resolveIssues("violation", "rejected", "нет оснований", 0, 5)).toEqual([]);
    expect(resolveIssues("review", "accepted", "", 0, 5)).toEqual([
      "Комментарий к решению — не меньше 5 символов без пробелов",
      "Принятый спор по оценке должен менять баллы: поставьте новые",
    ]);
  });
  it("subjectLabel", () => {
    expect(subjectLabel({ subject_type: "review", period: "2026-10-01" })).toBe("Оценка за октябрь 2026");
    expect(subjectLabel({ subject_type: "violation", period: "2026-10-01" })).toBe("Нарушение, октябрь 2026");
  });
});
