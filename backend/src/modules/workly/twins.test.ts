import { describe, expect, it } from "bun:test";
import { MIN_REMOVE_LIMIT, matchTwins, pairKey, planTwins, removeAllowed, twinsOn, type TwinPerson, type TwinRow } from "./twins";

const P = (id: number, last: string, first: string, birth: string | null = null, patronymic: string | null = null): TwinPerson => ({
  id,
  last_name: last,
  first_name: first,
  patronymic,
  birth_date: birth,
});

describe("matchTwins", () => {
  it("точное имя и одинаковая дата рождения — name_birth; порядок слов и регистр не важны", () => {
    const r = matchTwins([P(1, "Karimov", "Bobur", "1990-05-01")], [P(7, "BOBUR", "karimov", "1990-05-01")]);
    expect(r).toEqual({ pairs: [{ a: 1, b: 7, rule: "name_birth" }], ambiguous: 0 });
  });

  it("точное имя при разных или пустых датах — name_only (его потом проверяет посещаемость)", () => {
    expect(matchTwins([P(1, "Karimov", "Bobur", "1990-05-01")], [P(7, "Karimov", "Bobur", "1990-05-10")]).pairs).toEqual([{ a: 1, b: 7, rule: "name_only" }]);
    expect(matchTwins([P(1, "Karimov", "Bobur", null)], [P(7, "Karimov", "Bobur", "1990-05-01")]).pairs).toEqual([{ a: 1, b: 7, rule: "name_only" }]);
    expect(matchTwins([P(1, "Karimov", "Bobur", "bad")], [P(7, "Karimov", "Bobur", "bad")]).pairs).toEqual([{ a: 1, b: 7, rule: "name_only" }]);
  });

  it("опечатка в имени с одинаковой датой — name_birth, без даты — не пара", () => {
    const a = P(1, "Abdullayeva", "Nodira", "1995-03-03", "Rustamovna");
    expect(matchTwins([a], [P(7, "Abdullaeva", "Nodira", "1995-03-03", "Rustamovna")]).pairs).toEqual([{ a: 1, b: 7, rule: "name_birth" }]);
    expect(matchTwins([a], [P(7, "Abdullaeva", "Nodira", null, "Rustamovna")]).pairs).toEqual([]);
    expect(matchTwins([a], [P(7, "Abdullaeva", "Nodira", "1995-03-04", "Rustamovna")]).pairs).toEqual([]);
  });

  it("одна дата рождения у разных людей — не пара; одинаковое имя у короткого слова с опечаткой — не пара", () => {
    expect(matchTwins([P(1, "Karimov", "Bobur", "1990-05-01")], [P(7, "Aliyev", "Sardor", "1990-05-01")]).pairs).toEqual([]);
    // «Ali» и «Ala» короче 5 букв: разница в одну букву слово не склеивает
    expect(matchTwins([P(1, "Ali", "Vali", "1990-05-01", "X")], [P(7, "Ala", "Vala", "1990-05-01", "X")]).pairs).toEqual([]);
  });

  it("человек в нескольких кандидатах пропускается с обеих сторон", () => {
    const first = [P(1, "Karimov", "Bobur", "1990-05-01"), P(2, "Karimov", "Bobur", "1991-01-01")];
    const second = [P(7, "Karimov", "Bobur", "1990-05-01")];
    // А1 (name_birth) и А2 (name_only) оба претендуют на Б7: пара не создаётся вообще
    expect(matchTwins(first, second)).toEqual({ pairs: [], ambiguous: 2 });
    // Независимая пара рядом не страдает
    const r = matchTwins([...first, P(3, "Saidov", "Anvar", "1980-01-01")], [...second, P(8, "Saidov", "Anvar", "1980-01-01")]);
    expect(r.pairs).toEqual([{ a: 3, b: 8, rule: "name_birth" }]);
    expect(r.ambiguous).toBe(2);
  });

  it("пустые имена и списки не дают пар", () => {
    expect(matchTwins([], [P(7, "Karimov", "Bobur")]).pairs).toEqual([]);
    expect(matchTwins([P(1, "", "")], [P(7, "", "")]).pairs).toEqual([]);
  });
});

describe("planTwins", () => {
  const row = (a: string, b: string, rule: TwinRow["rule"] = "name_birth", blocked = false): TwinRow => ({ a, b, rule, blocked });

  it("создаёт новые, обновляет сменившееся правило, удаляет пропавшие; совпавшие не трогает", () => {
    const existing = [row("a", "b"), row("c", "d", "name_only"), row("e", "f")];
    const desired = new Map([[pairKey("a", "b"), "name_birth" as const], [pairKey("c", "d"), "name_birth" as const], [pairKey("g", "h"), "name_only" as const]]);
    expect(planTwins(existing, desired)).toEqual({
      insert: [{ key: "g|h", rule: "name_only" }],
      update: [{ key: "c|d", rule: "name_birth" }],
      remove: ["e|f"],
      blocked: 0,
    });
  });

  it("разорванная человеком пара не удаляется, не обновляется и заново не создаётся", () => {
    const existing = [row("a", "b", "name_only", true)];
    const desired = new Map([[pairKey("a", "b"), "name_birth" as const]]);
    expect(planTwins(existing, desired)).toEqual({ insert: [], update: [], remove: [], blocked: 1 });
    expect(planTwins(existing, new Map())).toEqual({ insert: [], update: [], remove: [], blocked: 1 });
  });

  it("pairKey не зависит от порядка", () => {
    expect(pairKey("b", "a")).toBe("a|b");
    expect(pairKey("a", "b")).toBe("a|b");
  });
});

describe("removeAllowed и выключатель", () => {
  it("удалять можно до половины пар, но не меньше трёх", () => {
    expect(MIN_REMOVE_LIMIT).toBe(3);
    expect(removeAllowed(3, 4)).toBe(true);
    expect(removeAllowed(4, 4)).toBe(false); // потолок max(3, половина) = 3
    expect(removeAllowed(0, 0)).toBe(true);
    expect(removeAllowed(8, 15)).toBe(true);
    expect(removeAllowed(9, 15)).toBe(false);
    expect(removeAllowed(4, 5)).toBe(false);
  });
  it("WORKLY_TWINS=0 выключает, прочее включено", () => {
    expect(twinsOn({ WORKLY_TWINS: "0" })).toBe(false);
    expect(twinsOn({})).toBe(true);
    expect(twinsOn({ WORKLY_TWINS: "1" })).toBe(true);
  });
});
