import { describe, expect, test } from "bun:test";
import { pickTerminalPerStore } from "./pick";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const G1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const G2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const G3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T1 = "t1000000-0000-4000-8000-000000000001";
const T2 = "t2000000-0000-4000-8000-000000000002";

const terminals = new Map([
  [G1, T1],
  [G2, T2],
]);

describe("pickTerminalPerStore", () => {
  test("для склада берётся группа с наибольшим числом заказов", () => {
    const r = pickTerminalPerStore(
      [
        { store_id: S1, restaurant_group_id: G1, orders: 10, last_order_at: "2026-10-01T10:00:00Z" },
        { store_id: S1, restaurant_group_id: G2, orders: 500, last_order_at: "2026-09-01T10:00:00Z" },
        { store_id: S2, restaurant_group_id: G1, orders: 7, last_order_at: "2026-10-02T10:00:00Z" },
      ],
      terminals
    );
    expect(r.links).toEqual([
      { store_id: S1, terminal_id: T2, orders_90d: 500, last_order_at: "2026-09-01T10:00:00Z" },
      { store_id: S2, terminal_id: T1, orders_90d: 7, last_order_at: "2026-10-02T10:00:00Z" },
    ]);
    expect(r.unmapped).toBe(0);
  });

  test("при равенстве заказов побеждает более поздний последний заказ, независимо от порядка строк", () => {
    const rows = [
      { store_id: S1, restaurant_group_id: G1, orders: 5, last_order_at: "2026-09-01T00:00:00Z" },
      { store_id: S1, restaurant_group_id: G2, orders: 5, last_order_at: "2026-10-01T00:00:00Z" },
    ];
    expect(pickTerminalPerStore(rows, terminals).links[0].terminal_id).toBe(T2);
    expect(pickTerminalPerStore([...rows].reverse(), terminals).links[0].terminal_id).toBe(T2);
  });

  test("группа без терминала пропускается и считается, регистр uuid не важен", () => {
    const r = pickTerminalPerStore(
      [
        { store_id: S1, restaurant_group_id: G3, orders: 999, last_order_at: null },
        { store_id: S1, restaurant_group_id: G1.toUpperCase(), orders: 3, last_order_at: null },
      ],
      terminals
    );
    expect(r.links).toEqual([{ store_id: S1, terminal_id: T1, orders_90d: 3, last_order_at: null }]);
    expect(r.unmapped).toBe(1);
  });

  test("пустой вход — пустой результат", () => {
    expect(pickTerminalPerStore([], terminals)).toEqual({ links: [], unmapped: 0 });
  });
});
