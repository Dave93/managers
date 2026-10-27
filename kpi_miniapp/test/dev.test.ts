import { expect, it } from "bun:test";
import { DEV_MARKER, THEMES, devRequested } from "../src/dev/flag";

it("devRequested: init=, sdk=fail, noinit=1 — да; пусто и одна тема — нет", () => {
  expect([devRequested("?init=a"), devRequested("?sdk=fail"), devRequested("?noinit=1")]).toEqual([true, true, true]);
  expect([devRequested(""), devRequested("?theme=dark")]).toEqual([false, false]);
});

it("THEMES: у светлой и тёмной одни и те же 13 ключей", () => {
  const light = Object.keys(THEMES.light).sort();
  expect(light.length).toBe(13);
  expect(Object.keys(THEMES.dark).sort()).toEqual(light);
});

it("DEV_MARKER", () => {
  expect(DEV_MARKER).toBe("__KPI_DEV_FAKE_TELEGRAM__");
});
