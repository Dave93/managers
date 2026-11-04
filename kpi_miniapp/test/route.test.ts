import { expect, it } from "bun:test";
import { hashOf, isEvRoute, parseHash, routeAllowed } from "../src/route";

it("parseHash: экраны, параметры Telegram, мусор", () => {
  const H = { name: "home" };
  expect([parseHash(""), parseHash("#"), parseHash("#/")]).toEqual([H, H, H]);
  expect(parseHash("#/review/2026-10")).toEqual({ name: "review", period: "2026-10-01" });
  expect(parseHash("#/review/2026-10?tgWebAppData=abc&tgWebAppVersion=7.10")).toEqual({ name: "review", period: "2026-10-01" });
  expect(parseHash("#/violations/2026-09&tgWebAppData=abc")).toEqual({ name: "violations", period: "2026-09-01" });
  expect(parseHash("#/history")).toEqual({ name: "history" });
  for (const h of ["#tgWebAppData=abc&tgWebAppVersion=7.10", "#/review/2026-13", "#/review/26-10", "#/review/2026-10-01", "#/nope"]) expect(parseHash(h)).toEqual(H);
  expect([hashOf(H as any), hashOf({ name: "review", period: "2026-10-01" }), hashOf({ name: "history" })]).toEqual(["#/", "#/review/2026-10", "#/history"]);
});

it("hashOf: нарушения и круговой разбор", () => {
  expect(hashOf({ name: "violations", period: "2026-10-01" })).toBe("#/violations/2026-10");
  expect(parseHash(hashOf({ name: "violations", period: "2026-12-01" }))).toEqual({ name: "violations", period: "2026-12-01" });
  expect(parseHash("#/review/2026-00")).toEqual({ name: "home" });
});

const ID = "3f2b8c1e-5a4d-4e7f-9b21-0c6d8e9a1b23";
it("parseHash и hashOf: экраны оценщика, параметры Telegram, мусор", () => {
  expect(parseHash("#/ev")).toEqual({ name: "ev", period: null });
  expect(parseHash("#/ev/2026-10")).toEqual({ name: "ev", period: "2026-10-01" });
  expect(parseHash(`#/ev/review/2026-10/${ID}?tgWebAppData=abc&tgWebAppVersion=7.10`)).toEqual({ name: "ev_review", period: "2026-10-01", employee_id: ID });
  expect(parseHash(`#/ev/violation/${ID}`)).toEqual({ name: "ev_violation", employee_id: ID });
  expect(parseHash("#/ev/violations")).toEqual({ name: "ev_violations", period: null });
  expect(parseHash("#/ev/violations/2026-09")).toEqual({ name: "ev_violations", period: "2026-09-01" });
  expect(parseHash("#/ev/disputes")).toEqual({ name: "ev_disputes" });
  expect(parseHash(`#/ev/dispute/${ID}`)).toEqual({ name: "ev_dispute", id: ID });
  for (const bad of ["#/ev/2026-13", "#/ev/review/2026-10/x", "#/ev/review/2026-13/" + ID, "#/ev/violation/", "#/ev/dispute/zzz", "#/ev/other"]) expect(parseHash(bad)).toEqual({ name: "home" });
  const routes = [{ name: "ev", period: null }, { name: "ev", period: "2026-10-01" }, { name: "ev_review", period: "2026-10-01", employee_id: ID },
    { name: "ev_violation", employee_id: ID }, { name: "ev_violations", period: null }, { name: "ev_violations", period: "2026-09-01" }, { name: "ev_disputes" }, { name: "ev_dispute", id: ID }] as const;
  for (const r of routes) expect(parseHash(hashOf(r))).toEqual(r);
  expect(hashOf({ name: "ev_review", period: "2026-10-01", employee_id: ID })).toBe(`#/ev/review/2026-10/${ID}`);
});
it("routeAllowed: сотрудник не заходит на экраны оценщика и наоборот; главный всем", () => {
  expect(routeAllowed({ name: "home" }, [])).toBe(true);
  expect(routeAllowed({ name: "ev", period: null }, ["employee"])).toBe(false);
  expect(routeAllowed({ name: "ev_disputes" }, ["evaluator"])).toBe(true);
  expect(routeAllowed({ name: "review", period: "2026-10-01" }, ["evaluator"])).toBe(false);
  expect(routeAllowed({ name: "history" }, ["employee", "evaluator"])).toBe(true);
  expect([isEvRoute({ name: "ev_dispute", id: ID }), isEvRoute({ name: "history" })]).toEqual([true, false]);
});
