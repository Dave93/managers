import { expect, it } from "bun:test";
import { createCache, lastWho, switchWho } from "../src/cache";

const memKV = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
  removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, m }; };
it("ключи по владельцу и who; clear стирает только своё; без kv и при сбое записи — память", () => {
  const kv = memKV();
  const a = createCache(kv, 1, "w1"); const b = createCache(kv, 2, "w2");
  a.save("/home", { n: 1 }, 100); b.save("/home", { n: 2 }, 200);
  expect([...kv.m.keys()].sort()).toEqual(["kpi_app:v1:1:w1:/home", "kpi_app:v1:2:w2:/home"]);
  expect(createCache(kv, 1, "w1").load("/home")).toEqual({ data: { n: 1 }, at: 100 });
  a.clear();
  expect([createCache(kv, 1, "w1").load("/home"), createCache(kv, 2, "w2").load("/home")]).toEqual([null, { data: { n: 2 }, at: 200 }]);
  const broken = { ...memKV(), setItem: () => { throw new Error("quota"); } };
  const c = createCache(broken, 3, "w");
  c.save("/x", 5, 1);
  expect(c.load("/x")).toEqual({ data: 5, at: 1 });
  const d = createCache(null, null, null); d.save("/y", 6, 2);
  expect(d.load("/y")).toEqual({ data: 6, at: 2 });
  // who неизвестен (сервер его не прислал) — в localStorage не пишем, только память.
  const e = createCache(kv, 4, null); e.save("/home", 7, 3);
  expect([e.load("/home"), [...kv.m.keys()].some((k) => k.startsWith("kpi_app:v1:4:"))]).toEqual([{ data: 7, at: 3 }, false]);
});

it("владелец 1 не задевает ключи владельца 12; мусор в хранилище — null; clear чистит и память", () => {
  const kv = memKV();
  createCache(kv, 12, "w").save("/home", 1, 1);
  const a = createCache(kv, 1, "w");
  a.save("/home", 2, 2);
  a.clear();
  expect([...kv.m.keys()]).toEqual(["kpi_app:v1:12:w:/home"]);
  kv.m.set("kpi_app:v1:1:w:/bad", "{не json");
  expect(createCache(kv, 1, "w").load("/bad")).toBeNull();
  const broken = { ...memKV(), setItem: () => { throw new Error("quota"); } };
  const c = createCache(broken, 3, "w");
  c.save("/x", 5, 1);
  c.clear();
  expect(c.load("/x")).toBeNull();
});

it("who: привязку того же Telegram переназначили — экраны прежнего человека стираются; тот же who — остаются", () => {
  const kv = memKV();
  createCache(kv, 12, "x").save("/home", 0, 1);
  kv.m.set("kpi_app:v1:1:/home", "{\"data\":1,\"at\":1}"); // ключ старого вида, без who
  expect(lastWho(kv, 1)).toBeNull();
  // Первый вход после обновления: who ещё не запомнен — всё прежнее под этим Telegram стирается.
  expect(switchWho(kv, 1, "aaaa")).toBe(true);
  expect([...kv.m.keys()].sort()).toEqual(["kpi_app:v1:12:x:/home", "kpi_app:v1:1:who"]);
  const a = createCache(kv, 1, "aaaa");
  a.save("/home", { who: "a" }, 5);
  a.save("/history", { q: [] }, 5);
  // Тот же человек вошёл снова: ничего не стирается.
  expect(switchWho(kv, 1, "aaaa")).toBe(false);
  expect([lastWho(kv, 1), createCache(kv, 1, "aaaa").load("/home")]).toEqual(["aaaa", { data: { who: "a" }, at: 5 }]);
  // Другой человек за тем же Telegram: экраны прежнего недоступны ни под каким who.
  expect(switchWho(kv, 1, "bbbb")).toBe(true);
  expect(lastWho(kv, 1)).toBe("bbbb");
  expect([createCache(kv, 1, "bbbb").load("/home"), createCache(kv, 1, "aaaa").load("/home"), createCache(kv, 1, "aaaa").load("/history")]).toEqual([null, null, null]);
  expect([...kv.m.keys()].sort()).toEqual(["kpi_app:v1:12:x:/home", "kpi_app:v1:1:who"]);
  // clear (403 not_bound/inactive) стирает и пометку who: следующий вход начнёт с чистого листа.
  createCache(kv, 1, "bbbb").save("/home", 1, 1);
  createCache(kv, 1, "bbbb").clear();
  expect([lastWho(kv, 1), [...kv.m.keys()]]).toEqual([null, ["kpi_app:v1:12:x:/home"]]);
  // Без хранилища и без владельца — ничего не помним и не падаем.
  expect([switchWho(null, 1, "c"), lastWho(null, 1), switchWho(kv, null, "c"), lastWho(kv, null)]).toEqual([false, null, false, null]);
});
