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

  // Hardening: qty: null must error
  it("отвергает qty: null (явный null, не отсутствие)", () => {
    const r = normalizeWorkItems([{ title: "a", amount: "1000", qty: null }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some(e => e.includes("позиция #1"))).toBe(true);
      expect(r.errors.some(e => e.includes("количество"))).toBe(true);
    }
  });

  // Hardening: qty with wrong shapes
  it("отвергает qty неправильной формы", () => {
    expect(normalizeWorkItems([{ title: "a", amount: "1000", qty: {} }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: "1000", qty: [] }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: "1000", qty: true }]).ok).toBe(false);
  });

  // Hardening: unit with wrong shapes
  it("отвергает unit неправильной формы", () => {
    expect(normalizeWorkItems([{ title: "a", amount: "1000", unit: {} }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: "1000", unit: [] }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: "1000", unit: true }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: "1000", unit: null }]).ok).toBe(false);
  });

  // Hardening: unit longer than 20 characters errors
  it("отвергает unit длиннее 20 символов", () => {
    const r = normalizeWorkItems([{ title: "a", amount: "1000", unit: "x".repeat(21) }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some(e => e.includes("позиция #1"))).toBe(true);
    }
  });

  // Hardening: amount with wrong shapes
  it("отвергает amount неправильной формы", () => {
    expect(normalizeWorkItems([{ title: "a", amount: {} }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: [] }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: true }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: null }]).ok).toBe(false);
  });

  // Hardening: title with wrong shapes
  it("отвергает title неправильной формы", () => {
    expect(normalizeWorkItems([{ title: {} }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: [] }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: true }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: null }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: 123 }]).ok).toBe(false);
  });

  // Valid non-default qty survives
  it("сохраняет ненулевой количество", () => {
    const r = normalizeWorkItems([{ title: "Работа", amount: "1000", qty: "2.5" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items[0].qty).toBe("2.50");
  });

  // Exactly 50 items accepted, 51 rejected
  it("принимает ровно 50 позиций", () => {
    const fifty = Array.from({ length: 50 }, () => ({ title: "a", amount: "1" }));
    expect(normalizeWorkItems(fifty).ok).toBe(true);
  });

  // Two bad positions in one call, both errors present
  it("сообщает обе ошибки при двух плохих позициях", () => {
    const r = normalizeWorkItems([
      { title: "   ", amount: "1000" },
      { title: "b", amount: "плохо" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBe(2);
      expect(r.errors.some(e => e.includes("позиция #1"))).toBe(true);
      expect(r.errors.some(e => e.includes("позиция #2"))).toBe(true);
    }
  });

  // Amount exceeding destination column size
  it("отвергает сумму больше чем numeric(14,2) может хранить", () => {
    // numeric(14,2) max is 999999999999.99, so 1000000000000.00 exceeds it
    const r = normalizeWorkItems([{ title: "a", amount: "1000000000000.00" }]);
    expect(r.ok).toBe(false);
  });

  // Total exceeding column size
  it("отвергает итог больше чем numeric(14,2) может хранить", () => {
    // Two amounts that individually fit but sum exceeds numeric(14,2) max
    const r = normalizeWorkItems([
      { title: "a", amount: "500000000000" },
      { title: "b", amount: "500000000000" },
    ]);
    expect(r.ok).toBe(false);
  });
});
