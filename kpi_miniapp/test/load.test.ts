import { expect, it } from "bun:test";
import type { ApiResult } from "../src/api";
import { createCache } from "../src/cache";
import { loadVia, resolveLoad } from "../src/load";

it("resolveLoad: ok — fresh; offline с кэшем — stale; прочие отказы и offline без кэша — fail; http без тела", () => {
  expect(resolveLoad({ kind: "ok", data: 1 }, null)).toEqual({ kind: "fresh", data: 1 });
  expect(resolveLoad({ kind: "fail", status: "offline" }, { data: 2, at: 5 })).toEqual({ kind: "stale", data: 2, at: 5 });
  expect(resolveLoad({ kind: "fail", status: "offline" }, null)).toEqual({ kind: "fail", status: "offline" });
  expect(resolveLoad({ kind: "fail", status: "expired" }, { data: 2, at: 5 })).toEqual({ kind: "fail", status: "expired" });
  expect(resolveLoad({ kind: "http", code: 404, error: "not_found", body: { error: "not_found" } }, { data: 2, at: 5 })).toEqual({
    kind: "http",
    code: 404,
    error: "not_found",
  });
});

const memKV = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    m,
  };
};
const answer = <T>(r: ApiResult<T>) => () => Promise.resolve(r);

it("loadVia: свежий ответ сохраняется в кэш по пути; offline отдаёт сохранённое с его временем", async () => {
  const cache = createCache(memKV(), 7);
  const fresh = await loadVia({ get: answer({ kind: "ok", data: { n: 1 } }), cache, now: () => 1000 }, "/home", () => {});
  expect(fresh).toEqual({ kind: "fresh", data: { n: 1 } });
  expect(cache.load("/home")).toEqual({ data: { n: 1 }, at: 1000 });
  const stale = await loadVia({ get: answer<{ n: number }>({ kind: "fail", status: "offline" }), cache, now: () => 5000 }, "/home", () => {});
  expect(stale).toEqual({ kind: "stale", data: { n: 1 }, at: 1000 });
  // Чужой путь в кэше не подставляется.
  const other = await loadVia({ get: answer({ kind: "fail", status: "offline" }), cache, now: () => 5000 }, "/history", () => {});
  expect(other).toEqual({ kind: "fail", status: "offline" });
});

it("loadVia: 403 not_bound и inactive посреди работы стирают кэш этого пользователя (решение 12)", async () => {
  for (const status of ["not_bound", "inactive"] as const) {
    const kv = memKV();
    const cache = createCache(kv, 7);
    cache.save("/home", { n: 1 }, 1);
    cache.save("/history", { q: [] }, 1);
    createCache(kv, 8).save("/home", { n: 2 }, 1);
    const r = await loadVia({ get: answer({ kind: "fail", status }), cache, now: () => 9 }, "/home", () => {});
    expect(r).toEqual({ kind: "fail", status });
    expect([cache.load("/home"), cache.load("/history")]).toEqual([null, null]);
    // Кэш другого человека на том же телефоне не трогаем.
    expect(createCache(kv, 8).load("/home")).toEqual({ data: { n: 2 }, at: 1 });
  }
});

it("loadVia: onSlow — только если ответа нет дольше порога, и не после ответа", async () => {
  const cache = createCache(null, null);
  let slow = 0;
  const late = (ms: number) => () => new Promise<ApiResult<number>>((res) => setTimeout(() => res({ kind: "ok", data: 1 }), ms));
  await loadVia({ get: late(40), cache, now: () => 0, slowMs: 10 }, "/a", () => slow++);
  expect(slow).toBe(1);
  slow = 0;
  await loadVia({ get: late(1), cache, now: () => 0, slowMs: 30 }, "/b", () => slow++);
  await new Promise((r) => setTimeout(r, 50));
  expect(slow).toBe(0);
});
