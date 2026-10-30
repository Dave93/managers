import { describe, expect, it } from "bun:test";
import { qualityOf } from "./quality";

type Row = { employee_id: string; terminal_id: string; absent: boolean };

// `days` строк одного сотрудника в одном филиале, из них `absent` прогулов.
const person = (employee_id: string, terminal_id: string, days: number, absent: number): Row[] =>
  Array.from({ length: days }, (_, i) => ({ employee_id, terminal_id, absent: i < absent }));

// Филиал целиком: каждая строка — отдельный сотрудник с одним днём, так что «прогульщиков» тут нет.
const branch = (terminal_id: string, days: number, absent: number): Row[] =>
  Array.from({ length: days }, (_, i) => ({ employee_id: `${terminal_id}-e${i}`, terminal_id, absent: i < absent }));

const names = (entries: [string, string][] = []) => new Map<string, string>(entries);

describe("workly/quality: qualityOf, филиалы", () => {
  it("четыре филиала 0,1; 0,1; 0,12; 0,57: медиана 0,11, отмечен только последний", () => {
    const rows = [...branch("a", 100, 10), ...branch("b", 100, 10), ...branch("c", 100, 12), ...branch("d", 100, 57)];
    const q = qualityOf(
      rows,
      names([
        ["a", "Альфа"],
        ["b", "Бета"],
        ["c", "Гамма"],
        ["d", "Дельта"],
      ])
    );
    expect(q.median).toBeCloseTo(0.11, 10);
    expect(q.branches.map((b) => [b.terminal_id, b.flagged])).toEqual([
      ["d", true],
      ["c", false],
      ["a", false],
      ["b", false],
    ]);
    expect(q.heavy).toEqual([]);
  });

  it("поля филиала: дни, прогулы, доля, название", () => {
    const q = qualityOf([...branch("a", 8, 2)], names([["a", "Les Ailes Альфа"]]));
    expect(q.branches).toEqual([{ terminal_id: "a", terminal_name: "Les Ailes Альфа", days: 8, absent: 2, share: 0.25, flagged: false }]);
  });

  it("название неизвестно: подставляется id терминала", () => {
    const q = qualityOf(branch("t-99", 4, 1), names([["другой", "Другой"]]));
    expect(q.branches[0].terminal_name).toBe("t-99");
  });

  it("медиана: нечётное число филиалов — средний, чётное — среднее двух средних, ни одного — 0", () => {
    const odd = qualityOf([...branch("a", 10, 1), ...branch("b", 10, 2), ...branch("c", 10, 9)], names());
    expect(odd.median).toBeCloseTo(0.2, 10);
    const even = qualityOf([...branch("a", 10, 1), ...branch("b", 10, 2), ...branch("c", 10, 3), ...branch("d", 10, 9)], names());
    expect(even.median).toBeCloseTo(0.25, 10);
    expect(qualityOf([], names()).median).toBe(0);
  });

  it("один филиал: медиана равна его доле, отмечен не бывает", () => {
    const q = qualityOf(branch("a", 10, 9), names());
    expect(q.median).toBeCloseTo(0.9, 10);
    expect(q.branches[0].flagged).toBe(false);
  });

  it("flagged строго больше удвоенной медианы: ровно вдвое не отмечается", () => {
    // доли 0,1; 0,1; 0,2: медиана 0,1; 0,2 — ровно вдвое
    const eq = qualityOf([...branch("a", 10, 1), ...branch("b", 10, 1), ...branch("c", 10, 2)], names());
    expect(eq.branches.every((b) => !b.flagged)).toBe(true);
    // 0,3 — больше удвоенной
    const gt = qualityOf([...branch("a", 10, 1), ...branch("b", 10, 1), ...branch("c", 10, 3)], names());
    expect(gt.branches.filter((b) => b.flagged).map((b) => b.terminal_id)).toEqual(["c"]);
  });

  it("граница не зависит от плавающей точки: 5/6 при медиане (1/3 + 1/2) / 2 не отмечается", () => {
    // Доли 1/6, 1/3, 1/2, 5/6. Медиана 5/12, удвоенная ровно 5/6. В double 2 * ((1/3 + 1/2) / 2)
    // получается 0,8333333333333333, а 5/6 — 0,8333333333333334: наивное «>» отметило бы филиал.
    const rows = [...branch("a", 6, 1), ...branch("b", 3, 1), ...branch("c", 2, 1), ...branch("d", 6, 5)];
    const q = qualityOf(rows, names());
    expect(q.branches.map((b) => b.terminal_id)).toEqual(["d", "c", "b", "a"]);
    expect(q.branches.every((b) => !b.flagged)).toBe(true);
  });

  it("граница точна и при тысячах строк: превышение на 4e-10 над удвоенной медианой отмечается", () => {
    // Доли 0, 1/2000, 499/1999, 501/2003. Удвоенная медиана 1/2000 + 499/1999 = 0,25012481...,
    // у последнего филиала 501/2003 = 0,250124812780...: строго больше, но на 3,7e-10. Допуск вроде
    // 1e-9 «проглотил» бы такой филиал, целочисленное сравнение — нет.
    const rows = [...branch("a", 10, 0), ...branch("b", 2000, 1), ...branch("c", 1999, 499), ...branch("d", 2003, 501)];
    const q = qualityOf(rows, names());
    expect(q.branches.filter((b) => b.flagged).map((b) => b.terminal_id)).toEqual(["d"]);
  });

  it("медиана 0: отмечается только доля больше 0,5", () => {
    // доли 0; 0; X
    const flagged = (absent: number, days: number) =>
      qualityOf([...branch("a", 10, 0), ...branch("b", 10, 0), ...branch("c", days, absent)], names()).branches.find((b) => b.terminal_id === "c")!.flagged;
    expect(flagged(3, 10)).toBe(false); // 0,3
    expect(flagged(5, 10)).toBe(false); // ровно 0,5
    expect(flagged(51, 100)).toBe(true); // 0,51
    expect(flagged(10, 10)).toBe(true); // 1
    // филиалы с нулевой долей при нулевой медиане не отмечаются
    const q = qualityOf([...branch("a", 10, 0), ...branch("b", 10, 0), ...branch("c", 10, 6)], names());
    expect(q.median).toBe(0);
    expect(q.branches.filter((b) => b.flagged).map((b) => b.terminal_id)).toEqual(["c"]);
  });

  it("порядок: доля по убыванию, при равенстве — название по возрастанию", () => {
    const rows = [...branch("t1", 10, 3), ...branch("t2", 10, 5), ...branch("t3", 10, 3), ...branch("t4", 10, 3)];
    const q = qualityOf(
      rows,
      names([
        ["t1", "Бета"],
        ["t2", "Яблоко"],
        ["t3", "Альфа"],
        ["t4", "Бета"],
      ])
    );
    // t1 и t4 с одним названием — дальше по id
    expect(q.branches.map((b) => b.terminal_id)).toEqual(["t2", "t3", "t1", "t4"]);
  });

  it("филиал с неизвестным названием сортируется по id как по названию", () => {
    const q = qualityOf([...branch("zz", 10, 3), ...branch("aa", 10, 3)], names());
    expect(q.branches.map((b) => b.terminal_name)).toEqual(["aa", "zz"]);
  });
});

describe("workly/quality: qualityOf, прогульщики", () => {
  const heavyOf = (days: number, absent: number) =>
    qualityOf(person("e", "t", days, absent), names()).heavy;

  it("меньше 5 дней — не прогульщик, даже при 4 из 4", () => {
    expect(heavyOf(4, 4)).toEqual([]);
    expect(heavyOf(1, 1)).toEqual([]);
  });

  it("5 из 5 — прогульщик", () => {
    expect(heavyOf(5, 5)).toEqual([{ employee_id: "e", days: 5, absent: 5 }]);
  });

  it("порог строгий: 9 из 10 (0,9) — нет, 10 из 10 — да", () => {
    expect(heavyOf(10, 9)).toEqual([]);
    expect(heavyOf(10, 10)).toEqual([{ employee_id: "e", days: 10, absent: 10 }]);
  });

  it("ровно 0,9 при другом числе дней: 18 из 20 — нет, 19 из 20 — да, 27 из 30 — нет, 28 из 30 — да", () => {
    expect(heavyOf(20, 18)).toEqual([]);
    expect(heavyOf(20, 19)).toEqual([{ employee_id: "e", days: 20, absent: 19 }]);
    expect(heavyOf(30, 27)).toEqual([]);
    expect(heavyOf(30, 28)).toEqual([{ employee_id: "e", days: 30, absent: 28 }]);
  });

  it("5 дней и 4 прогула (0,8) — нет; 6 из 6 — да", () => {
    expect(heavyOf(5, 4)).toEqual([]);
    expect(heavyOf(6, 6)).toEqual([{ employee_id: "e", days: 6, absent: 6 }]);
  });

  it("дни и прогулы сотрудника суммируются по всем филиалам", () => {
    const rows = [...person("e", "t1", 3, 3), ...person("e", "t2", 3, 3)];
    expect(qualityOf(rows, names()).heavy).toEqual([{ employee_id: "e", days: 6, absent: 6 }]);
    // по отдельности каждая часть короче 5 дней
    expect(qualityOf(person("e", "t1", 3, 3), names()).heavy).toEqual([]);
  });

  it("порядок: прогулов больше — раньше, при равенстве — по employee_id", () => {
    const rows = [
      ...person("b", "t", 6, 6),
      ...person("c", "t", 20, 20),
      ...person("a", "t", 6, 6),
      ...person("z", "t", 10, 5), // не прогульщик
    ];
    expect(qualityOf(rows, names()).heavy).toEqual([
      { employee_id: "c", days: 20, absent: 20 },
      { employee_id: "a", days: 6, absent: 6 },
      { employee_id: "b", days: 6, absent: 6 },
    ]);
  });
});

describe("workly/quality: qualityOf, пустой вход", () => {
  it("пустой вход даёт пустой результат", () => {
    expect(qualityOf([], names())).toEqual({ branches: [], median: 0, heavy: [] });
    expect(qualityOf([], names([["a", "Альфа"]]))).toEqual({ branches: [], median: 0, heavy: [] });
  });
});
