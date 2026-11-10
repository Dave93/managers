import { describe, expect, it } from "bun:test";
import { brandOf, buildDailyGrid, type GridCount, type GridStore } from "./pure";

// 10.11.2026 10:00 по Ташкенту: вчера — 09.11, его сегодня ещё вбивают.
const NOW = new Date("2026-11-10T05:00:00Z");
const NOV = "2026-11-30";

const store = (id: string, name: string | null, exord = true): GridStore => ({ id, name, exord });
let seq = 0;
const count = (store_id: string, count_date: string, status = "submitted", kind = "interim"): GridCount => ({
  id: `c${++seq}`,
  store_id,
  count_date,
  status,
  kind,
});

const grid = (stores: GridStore[], counts: GridCount[], period = NOV, now = NOW) =>
  buildDailyGrid({ period, now, stores, counts });
const rowOf = (g: ReturnType<typeof buildDailyGrid>, storeId: string) =>
  g.groups.flatMap((x) => x.rows).find((r) => r.store_id === storeId);

describe("brandOf", () => {
  it("19xxx — Les Ailes, 21xxx — Chopar, остальное — не склад филиала", () => {
    expect(brandOf("19001 - Склад Les Ойбек")).toBe("les");
    expect(brandOf("21030 - Склад Chopar Novza")).toBe("chopar");
    expect(brandOf("00000 - Тестирование склад")).toBeNull();
    expect(brandOf("Офис")).toBeNull();
    expect(brandOf("4000 - Склад Pizza Pizza")).toBeNull();
    expect(brandOf("6000 United Yunusobod")).toBeNull();
    expect(brandOf("190011 - шесть цифр")).toBeNull();
    expect(brandOf(null)).toBeNull();
  });
});

describe("дни в таблице", () => {
  it("текущий месяц 10-го: столбцы 01–09, 09 вбивают сегодня, полных дней 8", () => {
    const g = grid([], []);
    expect(g.days).toBe(9);
    expect(g.entering_day).toBe(9);
    expect(g.complete_days).toBe(8);
  });

  it("прошлый месяц — все дни, все полные", () => {
    const g = grid([], [], "2026-10-31");
    expect(g.days).toBe(31);
    expect(g.entering_day).toBeNull();
    expect(g.complete_days).toBe(31);
  });

  it("1-го числа прошлый месяц: последний день ещё вбивают", () => {
    const g = grid([], [], NOV, new Date("2026-12-01T05:00:00Z"));
    expect(g.days).toBe(30);
    expect(g.entering_day).toBe(30);
    expect(g.complete_days).toBe(29);
  });

  it("1-го числа текущий месяц — ещё ни одного дня", () => {
    const g = grid([], [], "2026-12-31", new Date("2026-12-01T05:00:00Z"));
    expect(g.days).toBe(0);
    expect(g.entering_day).toBeNull();
    expect(g.complete_days).toBe(0);
  });

  it("будущий месяц — пусто", () => {
    expect(grid([], [], "2027-01-31").days).toBe(0);
  });

  it("неверный период — ошибка", () => {
    expect(() => grid([], [], "2026-11-15")).toThrow();
  });
});

describe("строки", () => {
  it("только склады 19xxx / 21xxx, группы Les Ailes и Chopar, по коду", () => {
    const g = grid(
      [
        store("b", "21002 - Склад Chopar Новые сергили"),
        store("a2", "19019 - Склад Les Ko'kcha"),
        store("x", "Офис"),
        store("a1", "19001 - Склад Les Ойбек"),
        store("t", "00000 - Тестирование склад"),
      ],
      [count("x", "2026-11-03"), count("t", "2026-11-03")]
    );
    expect(g.groups.map((x) => x.brand)).toEqual(["les", "chopar"]);
    expect(g.groups[0].rows.map((r) => r.store_id)).toEqual(["a1", "a2"]);
    expect(g.groups[1].rows.map((r) => r.store_id)).toEqual(["b"]);
  });

  it("закрытый склад (нет товаров exord) без пересчётов — не показывается", () => {
    const g = grid([store("old", "19015 - Склад Les Депо", false), store("s", "19007 - Склад Les Азия")], []);
    expect(rowOf(g, "old")).toBeUndefined();
    expect(rowOf(g, "s")).toBeDefined();
  });

  it("склад без exord, но с пересчётом в этом месяце — показывается", () => {
    const g = grid([store("new", "19044 - Склад Les Aviasozlar", false)], [count("new", "2026-11-08", "draft")]);
    expect(rowOf(g, "new")!.cells[7]!.status).toBe("draft");
  });

  it("склад без exord с отменённым пересчётом — не показывается", () => {
    const g = grid([store("old", "19015 - Склад Les Депо", false)], [count("old", "2026-11-08", "cancelled")]);
    expect(rowOf(g, "old")).toBeUndefined();
  });

  it("склад без пересчётов — строка с пустыми ячейками и 0", () => {
    const g = grid([store("s", "19007 - Склад Les Азия")], []);
    const r = rowOf(g, "s")!;
    expect(r.cells).toHaveLength(9);
    expect(r.cells.every((c) => c === null)).toBe(true);
    expect(r.submitted).toBe(0);
  });
});

describe("ячейки", () => {
  const S = [store("s", "19002 - Склад Les Чиланзар")];

  it("отправленный — submitted с id пересчёта, черновик — draft", () => {
    const sub = count("s", "2026-11-03");
    const dr = count("s", "2026-11-04", "draft");
    const r = rowOf(grid(S, [sub, dr]), "s")!;
    expect(r.cells[2]).toEqual({ count_id: sub.id, status: "submitted", monthly: false });
    expect(r.cells[3]).toEqual({ count_id: dr.id, status: "draft", monthly: false });
  });

  it("отменённый не показывается", () => {
    const r = rowOf(grid(S, [count("s", "2026-11-03", "cancelled")]), "s")!;
    expect(r.cells[2]).toBeNull();
  });

  it("отправленный важнее черновика в тот же день, в любом порядке", () => {
    const dr = count("s", "2026-11-02", "draft");
    const sub = count("s", "2026-11-02");
    expect(rowOf(grid(S, [dr, sub]), "s")!.cells[1]!.count_id).toBe(sub.id);
    expect(rowOf(grid(S, [sub, dr]), "s")!.cells[1]!.count_id).toBe(sub.id);
  });

  it("Kunlik и «Все товары» в один день — одна отметка, день считается один раз", () => {
    const r = rowOf(grid(S, [count("s", "2026-11-03"), count("s", "2026-11-03")]), "s")!;
    expect(r.cells[2]!.status).toBe("submitted");
    expect(r.submitted).toBe(1);
  });

  it("месячный в последний день — отметка «М» и идёт в итог", () => {
    const m = count("s", "2026-10-31", "submitted", "monthly");
    const r = rowOf(grid(S, [m], "2026-10-31"), "s")!;
    expect(r.cells[30]).toEqual({ count_id: m.id, status: "submitted", monthly: true });
    expect(r.submitted).toBe(1);
  });

  it("пересчёты вне показанных дней игнорируются (месячный за ещё не наступившее 30-е)", () => {
    const r = rowOf(grid(S, [count("s", "2026-11-30", "submitted", "monthly"), count("s", "2026-10-31")]), "s")!;
    expect(r.cells).toHaveLength(9);
    expect(r.cells.every((c) => c === null)).toBe(true);
  });

  it("итог «из N» не считает день, который ещё вбивают", () => {
    const r = rowOf(grid(S, [count("s", "2026-11-01"), count("s", "2026-11-08"), count("s", "2026-11-09")]), "s")!;
    expect(r.cells[8]!.status).toBe("submitted");
    expect(r.submitted).toBe(2);
  });

  it("черновики в итог не идут", () => {
    expect(rowOf(grid(S, [count("s", "2026-11-03", "draft")]), "s")!.submitted).toBe(0);
  });
});

describe("итог по дням", () => {
  it("сколько складов группы отправили в каждый день; черновики не считаются", () => {
    const g = grid(
      [store("a", "19001 - Склад Les Ойбек"), store("b", "19002 - Склад Les Чиланзар"), store("c", "21002 - Склад Chopar Новые сергили")],
      [
        count("a", "2026-11-01"),
        count("b", "2026-11-01"),
        count("b", "2026-11-02", "draft"),
        count("c", "2026-11-01"),
        count("a", "2026-11-09"),
      ]
    );
    const les = g.groups.find((x) => x.brand === "les")!;
    expect(les.totals).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(g.groups.find((x) => x.brand === "chopar")!.totals[0]).toBe(1);
  });
});
