import { describe, test, expect } from "bun:test";
import { checkGuard, mapToStores, normUuid, parsePayload } from "./parse";

const T1 = "8088a57a-59e4-455a-a44c-b8bf4f485832";
const S1 = "21006000-0000-4000-8000-000000000001";
const S2 = "21006000-0000-4000-8000-000000000002";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const store = (o: Record<string, unknown>) => ({
  user_id: 1,
  name: "A",
  store_iiko_id: S1,
  terminal_iiko_id: null,
  product_ids: [],
  ...o,
});

const payload = (stores: any[]) => ({
  version: "abc",
  generated_at: "2026-10-03T08:30:00+05:00",
  stores,
});

describe("parsePayload", () => {
  test("lowercases ids, keeps null store/terminal", () => {
    const p = parsePayload(
      payload([
        store({ store_iiko_id: S1.toUpperCase(), terminal_iiko_id: T1.toUpperCase(), product_ids: [P1.toUpperCase()] }),
        store({ user_id: 2, store_iiko_id: null }),
      ])
    );
    expect(p.stores[0].store_iiko_id).toBe(S1);
    expect(p.stores[0].terminal_iiko_id).toBe(T1);
    expect(p.stores[0].product_ids).toEqual([P1]);
    expect(p.stores[1].store_iiko_id).toBeNull();
  });
  test("store_iiko_id may be absent (old payload) and reads as null", () => {
    const { store_iiko_id, ...old } = store({});
    expect(parsePayload(payload([old])).stores[0].store_iiko_id).toBeNull();
  });
  test.each([
    [null],
    [{}],
    [{ version: "x" }],
    [payload([store({ store_iiko_id: "nope" })])],
    [payload([store({ terminal_iiko_id: "nope" })])],
    [payload([store({ product_ids: ["{bad}"] })])],
    [payload([store({ product_ids: "x" })])],
  ])("rejects broken payload %#", (raw) => {
    expect(() => parsePayload(raw)).toThrow();
  });
  test("normUuid rejects braces", () => {
    expect(normUuid(`{${P1}}`)).toBeNull();
  });
});

describe("mapToStores", () => {
  const known = new Set([S1, S2]);
  const parse = (stores: any[]) => parsePayload(payload(stores)).stores;

  test("maps known stores, counts no-store, lists unknown", () => {
    const unknownId = "99999999-0000-4000-8000-000000000000";
    const { rows, noStore, unknown } = mapToStores(
      parse([
        store({ product_ids: [P2, P1] }),
        store({ user_id: 3, name: "NoStore", store_iiko_id: null, product_ids: [P1] }),
        store({ user_id: 4, name: "Gone", store_iiko_id: unknownId, product_ids: [P1] }),
      ]),
      known
    );
    expect(rows).toEqual([{ store_id: S1, product_ids: [P1, P2] }]);
    expect(noStore).toBe(1);
    expect(unknown).toEqual([{ user_id: 4, name: "Gone", store_iiko_id: unknownId }]);
  });
  test("unions entries that share a store", () => {
    const { rows } = mapToStores(
      parse([store({ product_ids: [P1] }), store({ user_id: 2, product_ids: [P2, P1] })]),
      known
    );
    expect(rows).toEqual([{ store_id: S1, product_ids: [P1, P2] }]);
  });
  test("shared terminal does not merge different stores", () => {
    const { rows } = mapToStores(
      parse([
        store({ terminal_iiko_id: T1, product_ids: [P1] }),
        store({ user_id: 2, store_iiko_id: S2, terminal_iiko_id: T1, product_ids: [P2] }),
      ]),
      known
    );
    expect(rows.map((r) => r.store_id).sort()).toEqual([S1, S2]);
  });
});

describe("checkGuard", () => {
  const rows = [{ store_id: S1, product_ids: [P1, P2] }];
  test("empty is refused", () => {
    expect(checkGuard([], { stores: 0, links: 0 })).toMatch(/no exord stores/);
    expect(checkGuard([{ store_id: S1, product_ids: [] }], { stores: 0, links: 0 })).toMatch(/zero/);
  });
  test("first sync passes", () => {
    expect(checkGuard(rows, { stores: 0, links: 0 })).toBeNull();
  });
  test("big drop refused unless forced", () => {
    expect(checkGuard(rows, { stores: 1, links: 10 })).toMatch(/dropped/);
    expect(checkGuard(rows, { stores: 1, links: 10 }, true)).toBeNull();
  });
  test("small drop passes", () => {
    expect(checkGuard(rows, { stores: 1, links: 3 })).toBeNull();
  });
});
