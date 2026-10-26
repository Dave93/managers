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
