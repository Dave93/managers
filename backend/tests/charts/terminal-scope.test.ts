import { describe, test, expect } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { resolveChartScope, terminalCondition } from "../../src/modules/charts/terminal-scope";

const dialect = new PgDialect();
const T = (id: string, iiko?: string) => ({
  id,
  credentials: iiko ? [{ type: "iiko_id", key: iiko }] : [{ type: "other", key: "x" }],
});
const cached = [T("a", "iiko-a"), T("b", "iiko-b"), T("c", "iiko-c"), T("noiiko"), T("ab", "iiko-ab")];
const render = (s: ReturnType<typeof resolveChartScope>, col?: any) =>
  dialect.sqlToQuery(terminalCondition(s, col));

describe("resolveChartScope", () => {
  test("admin without filter is unrestricted", () => {
    const s = resolveChartScope(cached, undefined, [], "admin");
    expect(s.restricted).toBe(false);
    expect(s.viewerRestricted).toBe(false);
    expect(s.ownIikoIds).toEqual([]);
    expect(render(s).sql).toBe("");
    expect(resolveChartScope(cached, undefined, undefined, null).restricted).toBe(false);
  });

  test("admin with filter gets IN over those ids", () => {
    const s = resolveChartScope(cached, "a, c", [], "admin");
    expect(s.restricted).toBe(true);
    expect(s.viewerRestricted).toBe(false);
    expect(s.iikoIds).toEqual(["iiko-a", "iiko-c"]);
    const q = render(s);
    expect(q.sql).toBe("AND restaurant_group_id IN ($1, $2)");
    expect(q.params).toEqual(["iiko-a", "iiko-c"]);
  });

  test("admin filter to a terminal without iiko id matches nothing", () => {
    const s = resolveChartScope(cached, "noiiko", [], "admin");
    expect(s.iikoIds).toEqual([]);
    expect(render(s).sql).toBe("AND false");
  });

  test("franchise with terminals sees own ids only; filter only narrows", () => {
    const own = resolveChartScope(cached, undefined, ["a", "b"], "franchise_manager");
    expect(own.viewerRestricted).toBe(true);
    expect(own.iikoIds).toEqual(["iiko-a", "iiko-b"]);
    expect(own.ownIikoIds).toEqual(["iiko-a", "iiko-b"]);

    const narrowed = resolveChartScope(cached, "b,c", ["a", "b"], "franchise_manager");
    expect(narrowed.iikoIds).toEqual(["iiko-b"]);
    expect(narrowed.ownIikoIds).toEqual(["iiko-b"]);

    const foreign = resolveChartScope(cached, "c", ["a", "b"], "franchise_manager");
    expect(foreign.iikoIds).toEqual([]);
    expect(foreign.ownIikoIds).toEqual([]);
    expect(render(foreign).sql).toBe("AND false");
  });

  test("franchise without terminals never falls back to the network", () => {
    const s = resolveChartScope(cached, undefined, [], "franchise_manager");
    expect(s.viewerRestricted).toBe(true);
    expect(s.restricted).toBe(true);
    expect(s.iikoIds).toEqual([]);
    expect(s.ownIikoIds).toEqual([]);
    expect(render(s).sql).toBe("AND false");
    expect(render(resolveChartScope(cached, "a", undefined, "franchise_manager")).sql).toBe("AND false");
  });

  test("user with terminals but another role is still restricted", () => {
    const s = resolveChartScope(cached, undefined, ["c"], "accountant");
    expect(s.viewerRestricted).toBe(true);
    expect(s.iikoIds).toEqual(["iiko-c"]);
    expect(s.ownIikoIds).toEqual(["iiko-c"]);
  });

  test("restricted viewer whose terminals have no iiko id gets nothing", () => {
    const s = resolveChartScope(cached, undefined, ["noiiko"], "franchise_manager");
    expect(render(s).sql).toBe("AND false");
  });

  test("ids are bound params, never inlined", () => {
    const s = resolveChartScope(cached, "a", [], "admin");
    const q = render(s);
    expect(q.params).toContain("iiko-a");
    expect(q.sql).not.toContain("iiko-a");
    const evil = resolveChartScope([T("x", "1') OR true --")], "x", [], "admin");
    const qe = render(evil);
    expect(qe.sql).toBe("AND restaurant_group_id IN ($1)");
    expect(qe.params).toEqual(["1') OR true --"]);
  });

  test("filter ids match exactly, not as substrings", () => {
    const s = resolveChartScope(cached, "ab", [], "admin");
    expect(s.iikoIds).toEqual(["iiko-ab"]);
    const empty = resolveChartScope(cached, " , ", [], "admin");
    expect(empty.restricted).toBe(false);
  });

  test("custom column is used", () => {
    const s = resolveChartScope(cached, "a", [], "admin");
    expect(render(s, sql`terminal_id`).sql).toBe("AND terminal_id IN ($1)");
  });

  test("ownIikoIds is empty for unrestricted viewers even with a filter", () => {
    expect(resolveChartScope(cached, "a", [], "admin").ownIikoIds).toEqual([]);
  });
});
