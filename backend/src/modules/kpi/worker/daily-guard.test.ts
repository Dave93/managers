import { describe, expect, it } from "bun:test";
import { dailyDone, dailyKey, markDailyDone } from "./daily-guard";

function fakeRedis() {
  const store = new Map<string, { v: string; ttl: number }>();
  return {
    store,
    async get(k: string) { return store.get(k)?.v ?? null; },
    async set(k: string, v: string, _ex: "EX", ttl: number) { store.set(k, { v, ttl }); return "OK"; },
  };
}

describe("kpi daily guard", () => {
  it("ключ с префиксом проекта и датой", () => {
    expect(dailyKey("managers_test_", "2026-11-05")).toBe("managers_test_kpi_daily:2026-11-05");
    expect(dailyKey(undefined, "2026-11-05")).toBe("kpi_daily:2026-11-05");
  });
  it("отметка после прогона, TTL двое суток; другой день не затронут", async () => {
    const r = fakeRedis();
    expect(await dailyDone(r, "p_", "2026-11-05")).toBe(false);
    await markDailyDone(r, "p_", "2026-11-05");
    expect(await dailyDone(r, "p_", "2026-11-05")).toBe(true);
    expect(await dailyDone(r, "p_", "2026-11-06")).toBe(false);
    expect(r.store.get("p_kpi_daily:2026-11-05")!.ttl).toBe(172800);
  });
});
