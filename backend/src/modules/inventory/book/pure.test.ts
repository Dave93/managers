import { describe, expect, it } from "bun:test";
import { buildBook } from "./pure";

describe("buildBook — книжное количество с разбивкой", () => {
  const start = [
    { product_id: "p1", amount: 10, sum: 0 },
    { product_id: "p2", amount: 5, sum: 0 },
  ];

  it("раскладывает движение по типам и сверяет тождество начало + движение = книжное", () => {
    const lines = buildBook({
      productIds: ["p1", "p3"],
      start,
      end: [
        { product_id: "p1", amount: 13.5, sum: 0 },
        { product_id: "p2", amount: 5, sum: 0 },
        { product_id: "p4", amount: 2, sum: 0 },
      ],
      movements: [
        { product_id: "p1", type: "INVOICE", in: 20, out: 0 },
        { product_id: "p1", type: "SESSION_WRITEOFF", in: 0, out: 15 },
        { product_id: "p1", type: "TRANSFER", in: 1, out: 2 },
        { product_id: "p1", type: "WRITEOFF", in: 0, out: 0.5 },
        { product_id: "p4", type: "PRODUCTION", in: 2, out: 0 },
      ],
    });
    const by = new Map(lines.map((l) => [l.product_id, l]));
    expect(by.get("p1")).toEqual({
      product_id: "p1", book_qty: 13.5, start_qty: 10, in_invoice: 20, out_sales: 15,
      transfer_in: 1, transfer_out: 2, out_writeoff: 0.5, other_net: 0, consistent: true,
    });
    // p2 — без движения, ненулевой остаток: строка есть
    expect(by.get("p2")!.book_qty).toBe(5);
    // p3 — только в пересчёте, нигде в iiko: нули, тождество сходится
    expect(by.get("p3")).toEqual({
      product_id: "p3", book_qty: 0, start_qty: 0, in_invoice: 0, out_sales: 0,
      transfer_in: 0, transfer_out: 0, out_writeoff: 0, other_net: 0, consistent: true,
    });
    // p4 — производство уходит в «прочее»
    expect(by.get("p4")!.other_net).toBe(2);
    expect(by.get("p4")!.consistent).toBe(true);
  });

  it("неожиданное направление у известного типа — в «прочее»; несходящееся тождество помечается", () => {
    const lines = buildBook({
      productIds: [],
      start: [{ product_id: "p1", amount: 1, sum: 0 }],
      end: [{ product_id: "p1", amount: 7, sum: 0 }],
      movements: [
        { product_id: "p1", type: "INVOICE", in: 5, out: 1 },
        { product_id: "p1", type: "SESSION_WRITEOFF", in: 0.5, out: 0 },
      ],
    });
    expect(lines[0].in_invoice).toBe(5);
    expect(lines[0].other_net).toBe(-0.5);
    // 1 + 5 − 0.5 = 5.5 ≠ 7
    expect(lines[0].consistent).toBe(false);
  });

  it("дроби без хвостов float", () => {
    const [l] = buildBook({
      productIds: ["p1"],
      start: [{ product_id: "p1", amount: 0.1, sum: 0 }],
      end: [{ product_id: "p1", amount: 0.3, sum: 0 }],
      movements: [{ product_id: "p1", type: "INVOICE", in: 0.2, out: 0 }],
    });
    expect(l.in_invoice).toBe(0.2);
    expect(l.consistent).toBe(true);
  });
});
