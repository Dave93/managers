import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;

if (!dbLooksLikeTest) {
  describe.skip("book service (пропущено: запускайте через bun run test:http:book)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const { fetchBook, bookTimestamp } = await import("./service");
  type IikoClient = import("../reconcile/iiko-client").IikoClient;

  async function seed(countDate: string, kind: "monthly" | "interim") {
    const store = randomUUID();
    const [p1, p2] = [randomUUID(), randomUUID()];
    await drizzleDb.insert(schema.corporation_store).values({ id: store, name: "Склад книжного", type: "STORE" });
    const [c] = await drizzleDb
      .insert(schema.inventory_counts)
      .values({
        store_id: store, template_name: "10 kun", period: `${countDate.slice(0, 8)}31`, kind, count_date: countDate,
        status: "submitted", created_by: randomUUID(),
      })
      .returning({ id: schema.inventory_counts.id });
    await drizzleDb.insert(schema.inventory_count_lines).values([
      { count_id: c.id, product_id: p1, product_name: "Сыр", group_name: "Склад", source: "template", fact_qty: "9" },
      { count_id: c.id, product_id: p2, product_name: "Мясо", group_name: "Склад", source: "template", fact_qty: "4" },
    ]);
    const calls: string[] = [];
    const iiko: IikoClient = {
      async inventoryDocs() { return []; },
      async corrections() { return []; },
      async balance(_s, at) {
        calls.push(`balance ${at}`);
        return at.endsWith("T00:00:00") ? [{ product_id: p1, amount: 10, sum: 0 }] : [{ product_id: p1, amount: 12, sum: 0 }];
      },
      async movements(_s, from, to) {
        calls.push(`movements ${from}..${to}`);
        return [
          { product_id: p1, type: "INVOICE", in: 5, out: 0 },
          { product_id: p1, type: "SESSION_WRITEOFF", in: 0, out: 3 },
        ];
      },
    };
    async function cleanup() {
      await drizzleDb.delete(schema.inventory_counts).where(eq(schema.inventory_counts.id, c.id));
      await drizzleDb.delete(schema.corporation_store).where(eq(schema.corporation_store.id, store));
    }
    return { countId: c.id, p1, p2, iiko, calls, cleanup };
  }

  describe("book: снимок книжного количества", () => {
    it("момент книжного: середина месяца — 23:59:59, последний день месяца — 23:58", () => {
      expect(bookTimestamp("2026-10-07")).toBe("2026-10-07T23:59:59");
      expect(bookTimestamp("2026-09-30")).toBe("2026-09-30T23:58:00");
    });

    it("промежуточный: остаток на 1-е, книжное на конец дня, движение с 1-го по дату; снимок пишется и заменяется", async () => {
      const w = await seed("2026-10-07", "interim");
      try {
        const r = await fetchBook(drizzleDb, w.iiko, w.countId);
        expect(r).toEqual({ lines: 2, inconsistent: 0 });
        expect(w.calls).toEqual(["balance 2026-10-01T00:00:00", "balance 2026-10-07T23:59:59", "movements 2026-10-01..2026-10-07"]);
        const rows = await drizzleDb.select().from(schema.inventory_count_book).where(eq(schema.inventory_count_book.count_id, w.countId));
        const p1 = rows.find((x) => x.product_id === w.p1)!;
        expect([p1.start_qty, p1.in_invoice, p1.out_sales, p1.book_qty].map(Number)).toEqual([10, 5, 3, 12]);
        expect(p1.consistent).toBe(true);
        const p2 = rows.find((x) => x.product_id === w.p2)!;
        expect(Number(p2.book_qty)).toBe(0);
        const [count] = await drizzleDb.select().from(schema.inventory_counts).where(eq(schema.inventory_counts.id, w.countId));
        expect(count.book_fetched_at).not.toBeNull();

        await fetchBook(drizzleDb, w.iiko, w.countId);
        const again = await drizzleDb.select().from(schema.inventory_count_book).where(eq(schema.inventory_count_book.count_id, w.countId));
        expect(again.length).toBe(2);
      } finally {
        await w.cleanup();
      }
    });

    it("черновик — снимок не берётся (409)", async () => {
      const w = await seed("2026-10-07", "interim");
      try {
        await drizzleDb.update(schema.inventory_counts).set({ status: "draft" }).where(eq(schema.inventory_counts.id, w.countId));
        await expect(fetchBook(drizzleDb, w.iiko, w.countId)).rejects.toThrow("not_submitted");
      } finally {
        await w.cleanup();
      }
    });
  });
}
