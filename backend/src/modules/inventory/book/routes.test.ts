import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest || !prefixLooksLikeTest) {
  describe.skip("book routes (пропущено: запускайте через bun run test:http:book)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, closeTestRedis, ensureApp, withSession, sweepTestRoles } = await import("../../../../tests/helpers/http");
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { bookQueue, closeBookQueue } = await import("./queue");
  const { setStockIikoRunner } = await import("./stock");

  type Session = Awaited<ReturnType<typeof withSession>>;

  async function api(s: Session | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = s ? { ...s.headers } : {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await callApi(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  async function setRule(rule: string | null) {
    await drizzleDb.delete(schema.settings).where(eq(schema.settings.key, "inventory.reopen_rule"));
    if (rule) await drizzleDb.insert(schema.settings).values({ key: "inventory.reopen_rule", value: rule });
  }

  async function seed() {
    const store = randomUUID();
    const other = randomUUID();
    const [p1, p2, p3] = [randomUUID(), randomUUID(), randomUUID()];
    const tag = randomUUID().slice(0, 6);
    await drizzleDb.insert(schema.corporation_store).values([
      { id: store, name: `Склад книжн ${tag}`, type: "STORE" },
      { id: other, name: `Чужой книжн ${tag}`, type: "STORE" },
    ]);
    await drizzleDb.insert(schema.nomenclature_element).values([
      { id: p1, name: `Сыр ${tag}`, num: `S${tag}`, type: "GOODS", deleted: false },
      { id: p2, name: `Мясо ${tag}`, num: `M${tag}`, type: "GOODS", deleted: false },
      { id: p3, name: `Фри ${tag}`, num: `F${tag}`, type: "GOODS", deleted: false },
    ]);
    const managerId = randomUUID();
    await drizzleDb.insert(schema.users_stores).values({ user_id: managerId, corporation_store_id: store });
    const [c] = await drizzleDb
      .insert(schema.inventory_counts)
      .values({ store_id: store, template_name: "10 kun", period: "2026-10-31", kind: "interim", count_date: "2026-10-07", status: "draft", created_by: managerId })
      .returning({ id: schema.inventory_counts.id });
    await drizzleDb.insert(schema.inventory_count_lines).values([
      { count_id: c.id, product_id: p1, product_name: `Сыр ${tag}`, unit_name: "кг", group_name: "Склад", source: "template", fact_qty: "9" },
      { count_id: c.id, product_id: p2, product_name: `Мясо ${tag}`, unit_name: "кг", group_name: "Склад", source: "template", skipped: true },
    ]);
    const z = { start_qty: "0", in_invoice: "0", out_sales: "0", transfer_in: "0", transfer_out: "0", out_writeoff: "0", other_net: "0", consistent: true };
    await drizzleDb.insert(schema.inventory_count_book).values([
      { count_id: c.id, product_id: p1, ...z, start_qty: "10", in_invoice: "5", out_sales: "3", book_qty: "12" },
      { count_id: c.id, product_id: p2, ...z, book_qty: "4" },
      { count_id: c.id, product_id: p3, ...z, book_qty: "2" },
    ]);
    async function submit() {
      await drizzleDb.update(schema.inventory_counts).set({ status: "submitted" }).where(eq(schema.inventory_counts.id, c.id));
    }
    async function cleanup() {
      await drizzleDb.delete(schema.inventory_counts).where(eq(schema.inventory_counts.id, c.id));
      await drizzleDb.delete(schema.users_stores).where(eq(schema.users_stores.user_id, managerId));
      await drizzleDb.delete(schema.nomenclature_element).where(inArray(schema.nomenclature_element.id, [p1, p2, p3]));
      await drizzleDb.delete(schema.corporation_store).where(inArray(schema.corporation_store.id, [store, other]));
      const job = await bookQueue().getJob(`book-${c.id}`);
      await job?.remove();
    }
    return { store, other, p1, p2, p3, tag, countId: c.id, managerId, submit, cleanup };
  }
  type World = Awaited<ReturnType<typeof seed>>;

  const manager = (w: World) => withSession({ permissions: ["inventory.count", "inventory.manage"], userId: w.managerId });
  const office = () => withSession({ permissions: ["inventory.count", "inventory.templates", "inventory.reconcile"] });

  beforeAll(async () => {
    await ensureApp();
  }, 300000);

  afterAll(async () => {
    await setRule(null);
    await bookQueue().obliterate({ force: true });
    await closeBookQueue();
    await sweepTestRoles();
    await closeTestRedis();
  });

  describe("book: «Сравнение с учётом»", () => {
    it("офис видит факт, книжное, разницу и код товара; разбивка в строке", async () => {
      const w = await seed();
      try {
        const r = await api(await office(), "GET", `/api/inventory/counts/${w.countId}/book`);
        expect(r.status).toBe(200);
        const by = new Map(r.body.lines.map((l: any) => [l.product_id, l]));
        expect(by.get(w.p1)).toMatchObject({ code: `S${w.tag}`, unit_name: "кг", fact_qty: "9", book_qty: "12", diff_qty: "-3", start_qty: "10", in_invoice: "5", out_sales: "3" });
        // «не считали» — факта нет, разницы нет
        expect(by.get(w.p2)).toMatchObject({ fact_qty: null, diff_qty: null, book_qty: "4" });
        // товар есть в учёте iiko, но не в пересчёте
        expect(by.get(w.p3)).toMatchObject({ fact_qty: null, book_qty: "2", in_count: false });
      } finally {
        await w.cleanup();
      }
    });

    it("филиал: черновик и отправленный, который можно вернуть, — 403; зафиксирован — 200; чужой склад — 403", async () => {
      const w = await seed();
      try {
        await setRule("until_accept");
        const m = await manager(w);
        expect((await api(m, "GET", `/api/inventory/counts/${w.countId}/book`)).status).toBe(403);
        await w.submit();
        const hidden = await api(m, "GET", `/api/inventory/counts/${w.countId}/book`);
        expect(hidden.status).toBe(403);
        expect(hidden.body.error).toBe("book_hidden");
        await setRule("office_only");
        expect((await api(m, "GET", `/api/inventory/counts/${w.countId}/book`)).status).toBe(200);

        const stranger = await withSession({ permissions: ["inventory.count", "inventory.manage"] });
        expect((await api(stranger, "GET", `/api/inventory/counts/${w.countId}/book`)).status).toBe(403);
      } finally {
        await setRule(null);
        await w.cleanup();
      }
    });

    it("«Обновить книжное»: офис ставит задачу для отправленного, филиал — 403, черновик — 409", async () => {
      const w = await seed();
      try {
        const o = await office();
        expect((await api(o, "POST", `/api/inventory/counts/${w.countId}/book/refresh`, {})).status).toBe(409);
        await w.submit();
        const ok = await api(o, "POST", `/api/inventory/counts/${w.countId}/book/refresh`, {});
        expect(ok.status).toBe(200);
        expect(ok.body.queued).toBe(true);
        expect((await api(await manager(w), "POST", `/api/inventory/counts/${w.countId}/book/refresh`, {})).status).toBe(403);
      } finally {
        await w.cleanup();
      }
    });
  });

  describe("book: «Остатки склада»", () => {
    function fakeIiko(w: World) {
      setStockIikoRunner(async (fn) =>
        fn({
          async inventoryDocs() { return []; },
          async corrections() { return []; },
          async balance(_s, at) {
            return at.endsWith("T00:00:00")
              ? [{ product_id: w.p1, amount: 10, sum: 0 }]
              : [{ product_id: w.p1, amount: 7.5, sum: 0 }, { product_id: w.p2, amount: -2, sum: 0 }, { product_id: w.p3, amount: 0, sum: 0 }];
          },
          async movements() {
            return [{ product_id: w.p1, type: "SESSION_WRITEOFF", in: 0, out: 2.5 }];
          },
        })
      );
    }

    it("офис: остатки по складу (ненулевые) с кодом и названием; движение по товару", async () => {
      const w = await seed();
      fakeIiko(w);
      try {
        const o = await office();
        const r = await api(o, "GET", `/api/inventory/stock?store_id=${w.store}`);
        expect(r.status).toBe(200);
        expect(r.body.hidden).toBe(false);
        const by = new Map(r.body.lines.map((l: any) => [l.product_id, l]));
        expect(by.get(w.p1)).toMatchObject({ code: `S${w.tag}`, qty: "7.5" });
        expect(by.get(w.p2)).toMatchObject({ qty: "-2" });
        expect(by.has(w.p3)).toBe(false);
        const mv = await api(o, "GET", `/api/inventory/stock/movements?store_id=${w.store}&product_id=${w.p1}`);
        expect(mv.status).toBe(200);
        expect(mv.body).toMatchObject({ start_qty: "10", out_sales: "2.5", book_qty: "7.5", consistent: true });
      } finally {
        await w.cleanup();
      }
    });

    it("филиал: пока пересчёт можно менять — скрыто; зафиксирован — видно; чужой склад — 403", async () => {
      const w = await seed();
      fakeIiko(w);
      try {
        await setRule("until_accept");
        const m = await manager(w);
        const draft = await api(m, "GET", `/api/inventory/stock?store_id=${w.store}`);
        expect(draft.status).toBe(200);
        expect(draft.body).toEqual({ hidden: true, at: null, lines: [] });
        expect((await api(m, "GET", `/api/inventory/stock/movements?store_id=${w.store}&product_id=${w.p1}`)).status).toBe(403);
        await w.submit();
        expect((await api(m, "GET", `/api/inventory/stock?store_id=${w.store}`)).body.hidden).toBe(true);
        await setRule("office_only");
        const open = await api(m, "GET", `/api/inventory/stock?store_id=${w.store}`);
        expect(open.body.hidden).toBe(false);
        expect(open.body.lines.length).toBe(2);
        expect((await api(m, "GET", `/api/inventory/stock?store_id=${w.other}`)).status).toBe(403);
      } finally {
        await setRule(null);
        await w.cleanup();
      }
    });
  });
}
