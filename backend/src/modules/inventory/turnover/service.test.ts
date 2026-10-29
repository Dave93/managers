import { afterAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;

if (!dbLooksLikeTest) {
  describe.skip("turnover service (пропущено: запускайте через bun run test:http:turnover)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { fetchTurnover } = await import("./service");
  type TurnoverSource = import("../reconcile/iiko-client").TurnoverSource;

  const NOW = new Date("2026-10-14T05:00:00Z");

  async function seedStores(n: number) {
    const ids = Array.from({ length: n }, () => randomUUID());
    await drizzleDb.insert(schema.corporation_store).values(ids.map((id, i) => ({ id, name: `ОСВ склад ${i}`, type: "STORE" })));
    return {
      ids,
      async cleanup() {
        for (const t of [schema.inventory_turnover, schema.inventory_turnover_balance, schema.inventory_turnover_fetch]) {
          await drizzleDb.delete(t).where(inArray(t.store_id, ids));
        }
        await drizzleDb.delete(schema.corporation_store).where(inArray(schema.corporation_store.id, ids));
      },
    };
  }

  function fakeIiko(stores: string[], p: string, opts: { failStore?: string } = {}) {
    const calls: string[] = [];
    const iiko: TurnoverSource = {
      async balances(at, storeId) {
        calls.push(`balances ${at} ${storeId ?? "all"}`);
        const amount = at.startsWith("2026-09-01") ? 5 : 7;
        return (storeId ? [storeId] : stores).map((s) => ({ store_id: s, product_id: p, amount, sum: amount * 10 }));
      },
      async turnover(storeId, from, to) {
        calls.push(`turnover ${storeId} ${from}..${to}`);
        if (storeId === opts.failStore) throw new Error("iiko 500");
        return [{ store_id: storeId, product_id: p, type: "INVOICE", qty_in: 2, qty_out: 0, sum_in: 20, sum_out: 0 }];
      },
    };
    return { iiko, calls };
  }

  // «Все склады» пишет снимки по всем corporation_store тестовой БД — убираем по периодам тестов.
  afterAll(async () => {
    for (const t of [schema.inventory_turnover, schema.inventory_turnover_balance, schema.inventory_turnover_fetch]) {
      await drizzleDb.delete(t).where(inArray(t.period, ["2026-09-30", "2026-10-31"]));
    }
  });

  describe("fetchTurnover", () => {
    it("все склады: снимок, fetch, прогресс; склады из corporation_store тоже", async () => {
      const s = await seedStores(2);
      const p = randomUUID();
      // в балансах iiko только первый склад; второй — из corporation_store
      const { iiko, calls } = fakeIiko([s.ids[0]], p);
      const progress: any[] = [];
      try {
        const r = await fetchTurnover(drizzleDb, iiko, { period: "2026-09-30", storeId: null }, async (x) => { progress.push(x); }, NOW);
        expect(r.failed).toEqual([]);
        expect(calls).toContain("balances 2026-09-01T00:00:00 all");
        expect(calls).toContain("balances 2026-10-01T00:00:00 all");
        expect(calls).toContain(`turnover ${s.ids[1]} 2026-09-01..2026-09-30`);
        const bal = await drizzleDb.select().from(schema.inventory_turnover_balance).where(eq(schema.inventory_turnover_balance.store_id, s.ids[0]));
        expect(bal).toHaveLength(1);
        expect(bal[0]).toMatchObject({ period: "2026-09-30", product_id: p, start_qty: "5.0000", end_qty: "7.0000", consistent: true });
        const fetch = await drizzleDb.select().from(schema.inventory_turnover_fetch).where(inArray(schema.inventory_turnover_fetch.store_id, s.ids));
        expect(fetch.map((f) => f.data_through)).toEqual(["2026-09-30", "2026-09-30"]);
        expect(progress[progress.length - 1]).toMatchObject({ state: "done", failed: [] });
      } finally {
        await s.cleanup();
      }
    });

    it("повторная загрузка заменяет снимок склада, а не дописывает", async () => {
      const s = await seedStores(1);
      const p = randomUUID();
      const { iiko } = fakeIiko(s.ids, p);
      try {
        await fetchTurnover(drizzleDb, iiko, { period: "2026-09-30", storeId: s.ids[0] }, undefined, NOW);
        await fetchTurnover(drizzleDb, iiko, { period: "2026-09-30", storeId: s.ids[0] }, undefined, NOW);
        const tx = await drizzleDb.select().from(schema.inventory_turnover).where(eq(schema.inventory_turnover.store_id, s.ids[0]));
        expect(tx).toHaveLength(1);
      } finally {
        await s.cleanup();
      }
    });

    it("сбой iiko на складе: прежний снимок остаётся, остальные грузятся", async () => {
      const s = await seedStores(2);
      const p = randomUUID();
      try {
        await fetchTurnover(drizzleDb, fakeIiko(s.ids, p).iiko, { period: "2026-09-30", storeId: null }, undefined, NOW);
        const before = await drizzleDb.select().from(schema.inventory_turnover_fetch).where(eq(schema.inventory_turnover_fetch.store_id, s.ids[0]));
        const r = await fetchTurnover(drizzleDb, fakeIiko(s.ids, p, { failStore: s.ids[0] }).iiko, { period: "2026-09-30", storeId: null }, undefined, NOW);
        expect(r.failed).toEqual([s.ids[0]]);
        const after = await drizzleDb.select().from(schema.inventory_turnover_fetch).where(eq(schema.inventory_turnover_fetch.store_id, s.ids[0]));
        expect(after[0].fetched_at).toBe(before[0].fetched_at);
        const tx = await drizzleDb.select().from(schema.inventory_turnover).where(eq(schema.inventory_turnover.store_id, s.ids[0]));
        expect(tx).toHaveLength(1);
      } finally {
        await s.cleanup();
      }
    });

    it("1-е число текущего месяца — iiko не трогаем, статус done", async () => {
      const { iiko, calls } = fakeIiko([], randomUUID());
      const progress: any[] = [];
      const r = await fetchTurnover(drizzleDb, iiko, { period: "2026-10-31", storeId: null }, async (x) => { progress.push(x); }, new Date("2026-10-01T03:00:00Z"));
      expect(r).toEqual({ stores: 0, failed: [] });
      expect(calls).toEqual([]);
      expect(progress[progress.length - 1]).toMatchObject({ state: "done", total: 0 });
    });

    it("текущий месяц — по вчера", async () => {
      const s = await seedStores(1);
      const { iiko, calls } = fakeIiko(s.ids, randomUUID());
      try {
        await fetchTurnover(drizzleDb, iiko, { period: "2026-10-31", storeId: s.ids[0] }, undefined, NOW);
        expect(calls).toContain(`turnover ${s.ids[0]} 2026-10-01..2026-10-13`);
        expect(calls).toContain(`balances 2026-10-14T00:00:00 ${s.ids[0]}`);
        const [f] = await drizzleDb.select().from(schema.inventory_turnover_fetch).where(eq(schema.inventory_turnover_fetch.store_id, s.ids[0]));
        expect(f.data_through).toBe("2026-10-13");
      } finally {
        await s.cleanup();
      }
    });
  });
}
