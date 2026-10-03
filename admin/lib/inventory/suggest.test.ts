import { describe, expect, test } from "bun:test";
import { suggestTerminal } from "./suggest";

const terminals = [
  { id: "c-chimgan", name: "Chopar pizza Chimgan" },
  { id: "c-bochka", name: "Chopar pizza Bochka" },
  { id: "l-bochka", name: "Les Ailes Bochka" },
  { id: "l-sampi", name: "Les Ailes Sampi" },
  { id: "l-srahimov", name: "Les Ailes S.Rahimov" },
  { id: "l-andijon", name: "Les Ailes Andijon Ekopark" },
];

describe("suggestTerminal", () => {
  test("кириллица в названии exord сопоставляется с латиницей в managers", () => {
    expect(suggestTerminal("Chopar-Чимган", terminals)?.id).toBe("c-chimgan");
  });
  test("бренд учитывается: les-bochka не уходит в Chopar Bochka", () => {
    expect(suggestTerminal("les-bochka", terminals)?.id).toBe("l-bochka");
    expect(suggestTerminal("chopar-bochka", terminals)?.id).toBe("c-bochka");
  });
  test("сокращения и опечатки", () => {
    expect(suggestTerminal("les-sampi", terminals)?.id).toBe("l-sampi");
    expect(suggestTerminal("les-srahimov", terminals)?.id).toBe("l-srahimov");
    expect(suggestTerminal("Les Andijon Ekoparl", terminals)?.id).toBe("l-andijon");
  });
  test("занятые филиалы не предлагаются, слабое сходство — null", () => {
    expect(suggestTerminal("les-sampi", terminals, new Set(["l-sampi"]))).toBeNull();
    expect(suggestTerminal("United C1", terminals)).toBeNull();
    expect(suggestTerminal("CallCenter", terminals)).toBeNull();
  });
});
