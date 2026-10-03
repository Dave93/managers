import { describe, test, expect } from "bun:test";
import { checkGuard, mapToTerminals, normUuid, parsePayload } from "./parse";

const T1 = "8088a57a-59e4-455a-a44c-b8bf4f485832";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const payload = (stores: any[]) => ({
  version: "abc",
  generated_at: "2026-10-03T08:30:00+05:00",
  stores,
});

describe("parsePayload", () => {
  test("lowercases ids, keeps null terminals", () => {
    const p = parsePayload(
      payload([
        { user_id: 1, name: "A", terminal_iiko_id: T1.toUpperCase(), product_ids: [P1.toUpperCase()] },
        { user_id: 2, name: "B", terminal_iiko_id: null, product_ids: [] },
      ])
    );
    expect(p.stores[0].terminal_iiko_id).toBe(T1);
    expect(p.stores[0].product_ids).toEqual([P1]);
    expect(p.stores[1].terminal_iiko_id).toBeNull();
  });
  test.each([
    [null],
    [{}],
    [{ version: "x" }],
    [payload([{ user_id: 1, name: "A", terminal_iiko_id: "nope", product_ids: [] }])],
    [payload([{ user_id: 1, name: "A", terminal_iiko_id: T1, product_ids: ["{bad}"] }])],
    [payload([{ user_id: 1, name: "A", terminal_iiko_id: T1, product_ids: "x" }])],
  ])("rejects broken payload %#", (raw) => {
    expect(() => parsePayload(raw)).toThrow();
  });
  test("normUuid rejects braces", () => {
    expect(normUuid(`{${P1}}`)).toBeNull();
  });
});

describe("mapToTerminals", () => {
  const map = new Map([[T1, "term-1"]]);
  test("unions duplicates, skips unknown", () => {
    const { rows, skipped } = mapToTerminals(
      [
        { user_id: 1, name: "A", terminal_iiko_id: T1, product_ids: [P2, P1] },
        { user_id: 2, name: "A2", terminal_iiko_id: T1, product_ids: [P1] },
        { user_id: 3, name: "C", terminal_iiko_id: null, product_ids: [P1] },
        { user_id: 4, name: "D", terminal_iiko_id: "9".repeat(8) + "-0000-4000-8000-000000000000", product_ids: [P1] },
      ],
      map
    );
    expect(rows).toEqual([{ terminal_id: "term-1", product_ids: [P1, P2] }]);
    expect(skipped).toBe(2);
  });
});

describe("checkGuard", () => {
  const rows = [{ terminal_id: "t", product_ids: [P1, P2] }];
  test("empty is refused", () => {
    expect(checkGuard([], { terminals: 0, links: 0 })).toMatch(/no stores/);
    expect(checkGuard([{ terminal_id: "t", product_ids: [] }], { terminals: 0, links: 0 })).toMatch(/zero/);
  });
  test("first sync passes", () => {
    expect(checkGuard(rows, { terminals: 0, links: 0 })).toBeNull();
  });
  test("big drop refused unless forced", () => {
    expect(checkGuard(rows, { terminals: 1, links: 10 })).toMatch(/dropped/);
    expect(checkGuard(rows, { terminals: 1, links: 10 }, true)).toBeNull();
  });
  test("small drop passes", () => {
    expect(checkGuard(rows, { terminals: 1, links: 3 })).toBeNull();
  });
});
