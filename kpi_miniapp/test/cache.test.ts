import { expect, it } from "bun:test";
import { createCache } from "../src/cache";

const memKV = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
  removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, m }; };
it("ключи по владельцу; clear стирает только своё; без kv и при сбое записи — память", () => {
  const kv = memKV();
  const a = createCache(kv, 1); const b = createCache(kv, 2);
  a.save("/home", { n: 1 }, 100); b.save("/home", { n: 2 }, 200);
  expect([...kv.m.keys()].sort()).toEqual(["kpi_app:v1:1:/home", "kpi_app:v1:2:/home"]);
  expect(createCache(kv, 1).load("/home")).toEqual({ data: { n: 1 }, at: 100 });
  a.clear();
  expect([createCache(kv, 1).load("/home"), createCache(kv, 2).load("/home")]).toEqual([null, { data: { n: 2 }, at: 200 }]);
  const broken = { ...memKV(), setItem: () => { throw new Error("quota"); } };
  const c = createCache(broken, 3);
  c.save("/x", 5, 1);
  expect(c.load("/x")).toEqual({ data: 5, at: 1 });
  const d = createCache(null, null); d.save("/y", 6, 2);
  expect(d.load("/y")).toEqual({ data: 6, at: 2 });
});

it("владелец 1 не задевает ключи владельца 12; мусор в хранилище — null; clear чистит и память", () => {
  const kv = memKV();
  createCache(kv, 12).save("/home", 1, 1);
  const a = createCache(kv, 1);
  a.save("/home", 2, 2);
  a.clear();
  expect([...kv.m.keys()]).toEqual(["kpi_app:v1:12:/home"]);
  kv.m.set("kpi_app:v1:1:/bad", "{не json");
  expect(createCache(kv, 1).load("/bad")).toBeNull();
  const broken = { ...memKV(), setItem: () => { throw new Error("quota"); } };
  const c = createCache(broken, 3);
  c.save("/x", 5, 1);
  c.clear();
  expect(c.load("/x")).toBeNull();
});
