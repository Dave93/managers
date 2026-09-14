import { describe, expect, it } from "bun:test";
import { normalizeWorkItems } from "./act";

describe("normalizeWorkItems", () => {
  it("нумерует позиции и считает итог", () => {
    const r = normalizeWorkItems([
      { title: "Замена блока питания", amount: "350000" },
      { title: "Выезд", amount: 100000 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => i.position)).toEqual([1, 2]);
    expect(r.total).toBe("450000.00");
  });

  it("складывает копейки без потерь на плавающей точке", () => {
    const r = normalizeWorkItems([
      { title: "a", amount: "0.10" },
      { title: "b", amount: "0.20" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBe("0.30");
  });

  it("подставляет количество 1 по умолчанию", () => {
    const r = normalizeWorkItems([{ title: "Работа", amount: "1000" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items[0]).toEqual({
      position: 1,
      title: "Работа",
      qty: "1.00",
      unit: null,
      amount: "1000.00",
    });
  });

  it("требует хотя бы одну позицию", () => {
    expect(normalizeWorkItems([]).ok).toBe(false);
    expect(normalizeWorkItems(null).ok).toBe(false);
  });

  it("отвергает нулевую и отрицательную сумму", () => {
    expect(normalizeWorkItems([{ title: "a", amount: "0" }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: "-5" }]).ok).toBe(false);
  });

  it("отвергает сумму не числом и с тремя знаками после точки", () => {
    expect(normalizeWorkItems([{ title: "a", amount: "много" }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: "1.005" }]).ok).toBe(false);
  });

  it("отвергает пустой и слишком длинный заголовок", () => {
    expect(normalizeWorkItems([{ title: "   ", amount: "1000" }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "x".repeat(201), amount: "1000" }]).ok).toBe(false);
  });

  it("ограничивает число позиций", () => {
    const many = Array.from({ length: 51 }, () => ({ title: "a", amount: "1" }));
    expect(normalizeWorkItems(many).ok).toBe(false);
  });
});
