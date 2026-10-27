import { expect, it } from "bun:test";
import type { Route } from "../src/route";
import { back, navigate, provideNav, rerender, useLang } from "../src/nav";

it("без роутера переход не теряется молча, а с роутером уходит в него", () => {
  expect(() => navigate({ name: "history" })).toThrow("provideNav");
  const calls: string[] = [];
  provideNav({
    navigate: (r: Route) => calls.push(`navigate ${r.name}`),
    back: () => calls.push("back"),
    rerender: () => calls.push("rerender"),
    useLang: (l) => calls.push(`lang ${l}`),
  });
  navigate({ name: "review", period: "2026-10-01" });
  back();
  rerender();
  useLang("uz");
  expect(calls).toEqual(["navigate review", "back", "rerender", "lang uz"]);
});
