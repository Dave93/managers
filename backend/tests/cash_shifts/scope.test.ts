import { describe, test, expect } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { resolveTerminalScope, scopeFilter } from "../../src/modules/cash_shifts/scope";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const dialect = new PgDialect();

describe("resolveTerminalScope", () => {
  test("unrestricted admin without filter sees everything", () => {
    expect(resolveTerminalScope(undefined, [])).toEqual({ ids: [], restrict: false });
    expect(resolveTerminalScope(undefined, undefined)).toEqual({ ids: [], restrict: false });
  });
  test("filter narrows an unrestricted user", () => {
    expect(resolveTerminalScope(`${A},${B}`, [])).toEqual({ ids: [A, B], restrict: true });
  });
  test("restricted user without filter sees own terminals", () => {
    expect(resolveTerminalScope(undefined, [A, C])).toEqual({ ids: [A, C], restrict: true });
  });
  test("filter cannot widen a restricted user", () => {
    expect(resolveTerminalScope(`${A},${B}`, [A, C])).toEqual({ ids: [A], restrict: true });
    expect(resolveTerminalScope(B, [A, C])).toEqual({ ids: [], restrict: true });
  });
  test("garbage in the filter is ignored, but still restricts", () => {
    expect(resolveTerminalScope("1; drop table users", [])).toEqual({ ids: [], restrict: true });
  });
});

describe("scopeFilter", () => {
  test("no restriction adds nothing", () => {
    expect(dialect.sqlToQuery(scopeFilter({ ids: [], restrict: false })).sql).toBe("");
  });
  test("restricted with nothing resolved never leaks the network", () => {
    expect(dialect.sqlToQuery(scopeFilter({ ids: [], restrict: true })).sql).toBe("AND false");
  });
  test("restricted ids are bound as one jsonb parameter", () => {
    const q = dialect.sqlToQuery(scopeFilter({ ids: [A, C], restrict: true }));
    expect(q.sql).toContain("cs.terminal_id IN");
    expect(q.params).toEqual([JSON.stringify([A, C])]);
  });
});
