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

it("parseHash и hashOf: посещаемость", () => {
  expect(parseHash("#/attendance")).toEqual({ name: "attendance", month: null });
  expect(parseHash("#/attendance/2026-10")).toEqual({ name: "attendance", month: "2026-10" });
  expect(parseHash("#/attendance/2026-10?tgWebAppData=abc&tgWebAppVersion=7.10")).toEqual({ name: "attendance", month: "2026-10" });
  for (const h of ["#/attendance/2026-13", "#/attendance/2026-10-01", "#/attendance/26-10", "#/attendance/", "#/attendance/0000-05", "#/attendance/0999-12"]) expect(parseHash(h)).toEqual({ name: "home" });
  expect([hashOf({ name: "attendance", month: null }), hashOf({ name: "attendance", month: "2026-10" })]).toEqual(["#/attendance", "#/attendance/2026-10"]);
  for (const month of [null, "2026-10"]) expect(parseHash(hashOf({ name: "attendance", month }))).toEqual({ name: "attendance", month });
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

it("parseHash и hashOf: выходные оценщика", () => {
  expect(parseHash(`#/ev/dayoff/${ID}`)).toEqual({ name: "ev_dayoff", employee_id: ID });
  expect(parseHash(`#/ev/dayoff/${ID}?tgWebAppData=abc&tgWebAppVersion=7.10`)).toEqual({ name: "ev_dayoff", employee_id: ID });
  expect(parseHash("#/ev/daysoff")).toEqual({ name: "ev_daysoff", period: null });
  expect(parseHash("#/ev/daysoff/2026-11")).toEqual({ name: "ev_daysoff", period: "2026-11-01" });
  for (const bad of ["#/ev/dayoff/x", "#/ev/dayoff/", "#/ev/daysoff/2026-13", "#/ev/daysoff/2026-11/x", "#/ev/daysoff/abc"]) expect(parseHash(bad)).toEqual({ name: "home" });
  expect(hashOf({ name: "ev_dayoff", employee_id: ID })).toBe(`#/ev/dayoff/${ID}`);
  expect([hashOf({ name: "ev_daysoff", period: null }), hashOf({ name: "ev_daysoff", period: "2026-11-01" })]).toEqual(["#/ev/daysoff", "#/ev/daysoff/2026-11"]);
  for (const r of [{ name: "ev_dayoff", employee_id: ID }, { name: "ev_daysoff", period: null }, { name: "ev_daysoff", period: "2026-11-01" }] as const) {
    expect(parseHash(hashOf(r))).toEqual(r);
    expect(isEvRoute(r)).toBe(true);
    expect(routeAllowed(r, ["evaluator"])).toBe(true);
    expect(routeAllowed(r, ["employee"])).toBe(false);
  }
});

it("ev_dayoff_pick: экран выбора сотрудника для выходного разбирается и собирается обратно", () => {
  expect(parseHash("#/ev/dayoff")).toEqual({ name: "ev_dayoff_pick" });
  expect(hashOf({ name: "ev_dayoff_pick" })).toBe("#/ev/dayoff");
  expect(parseHash(hashOf({ name: "ev_dayoff_pick" }))).toEqual({ name: "ev_dayoff_pick" });
  // Роль: экран оценщика, сотруднику недоступен
  expect(routeAllowed({ name: "ev_dayoff_pick" }, ["evaluator"])).toBe(true);
  expect(routeAllowed({ name: "ev_dayoff_pick" }, ["employee"])).toBe(false);
});

it("parseHash и hashOf: карточка сотрудника оценщика", () => {
  const H = { name: "home" };
  expect(parseHash(`#/ev/card/${ID}`)).toEqual({ name: "ev_card", employee_id: ID, period: null });
  expect(parseHash(`#/ev/card/${ID}/2026-10`)).toEqual({ name: "ev_card", employee_id: ID, period: "2026-10-01" });
  expect(parseHash(`#/ev/card/${ID}/2026-10?tgWebAppData=abc&tgWebAppVersion=7.10`)).toEqual({ name: "ev_card", employee_id: ID, period: "2026-10-01" });
  for (const h of ["#/ev/card", "#/ev/card/abc", `#/ev/card/${ID}/2026-13`, `#/ev/card/${ID}/2026-10-01`, `#/ev/card/${ID}/2026-10/x`]) expect(parseHash(h)).toEqual(H);
  for (const period of [null, "2026-10-01"]) expect(parseHash(hashOf({ name: "ev_card", employee_id: ID, period }))).toEqual({ name: "ev_card", employee_id: ID, period });
  const r = parseHash(`#/ev/card/${ID}`);
  expect([isEvRoute(r), routeAllowed(r, ["evaluator"]), routeAllowed(r, ["employee"])]).toEqual([true, true, false]);
});
