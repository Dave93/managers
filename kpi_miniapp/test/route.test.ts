import { expect, it } from "bun:test";
import { hashOf, parseHash } from "../src/route";

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
