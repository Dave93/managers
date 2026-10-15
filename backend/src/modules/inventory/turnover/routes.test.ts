import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest || !prefixLooksLikeTest) {
  describe.skip("turnover routes (пропущено: запускайте через bun run test:http:turnover)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, closeTestRedis, ensureApp, withSession, sweepTestRoles } = await import("../../../../tests/helpers/http");
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { allowedPeriods, lastDayOfMonth } = await import("../rules");
  const { closeTurnoverQueue, turnoverQueue } = await import("./queue");

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

  const [current, previous] = allowedPeriods(new Date());
  const [py, pm] = previous.split("-").map(Number);
  const older = pm === 1 ? lastDayOfMonth(py - 1, 12) : lastDayOfMonth(py, pm - 1);

  async function seed() {
    const store = randomUUID();
    const other = randomUUID();
    const p = randomUUID();
    const tag = randomUUID().slice(0, 6);
    const managerId = randomUUID();
    await drizzleDb.insert(schema.corporation_store).values([
      { id: store, name: `ОСВ ${tag}`, type: "STORE" },
      { id: other, name: `ОСВ чужой ${tag}`, type: "STORE" },
    ]);
    await drizzleDb.insert(schema.nomenclature_element).values({ id: p, name: `Курица ${tag}`, num: `K${tag}`, type: "GOODS", deleted: false });
    await drizzleDb.insert(schema.users_stores).values({ user_id: managerId, corporation_store_id: store });
    for (const period of [current, previous, older]) {
      for (const s of [store, other]) {
        await drizzleDb.insert(schema.inventory_turnover_balance).values({
          period, store_id: s, product_id: p, start_qty: "5", start_sum: "50", end_qty: "7", end_sum: "73", consistent: true,
        });
        await drizzleDb.insert(schema.inventory_turnover).values([
          { period, store_id: s, product_id: p, tx_type: "INVOICE", qty_in: "2", qty_out: "0", sum_in: "20", sum_out: "0" },
          { period, store_id: s, product_id: p, tx_type: "STORE_COST_CORRECTION", qty_in: "0", qty_out: "0", sum_in: "3", sum_out: "0" },
        ]);
        await drizzleDb.insert(schema.inventory_turnover_fetch).values({ period, store_id: s, data_through: period });
      }
    }
    async function monthly(period: string, status: "draft" | "submitted") {
      await drizzleDb.insert(schema.inventory_counts).values({
        store_id: store, template_name: "Месяц", period, kind: "monthly", count_date: period, status, created_by: managerId,
      });
    }
    async function cleanup() {
      for (const t of [schema.inventory_turnover, schema.inventory_turnover_balance, schema.inventory_turnover_fetch]) {
        await drizzleDb.delete(t).where(inArray(t.store_id, [store, other]));
      }
      await drizzleDb.delete(schema.inventory_counts).where(eq(schema.inventory_counts.store_id, store));
      await drizzleDb.delete(schema.inventory_reconciliations).where(eq(schema.inventory_reconciliations.store_id, store));
      await drizzleDb.delete(schema.users_stores).where(eq(schema.users_stores.user_id, managerId));
      await drizzleDb.delete(schema.nomenclature_element).where(eq(schema.nomenclature_element.id, p));
      await drizzleDb.delete(schema.corporation_store).where(inArray(schema.corporation_store.id, [store, other]));
    }
    return { store, other, p, managerId, monthly, cleanup };
  }
  type World = Awaited<ReturnType<typeof seed>>;

  const branch = (w: World) => withSession({ permissions: ["inventory.count", "inventory.manage"], userId: w.managerId });
  const office = () => withSession({ permissions: ["inventory.count", "inventory.templates", "inventory.reconcile"] });
  const url = (period: string, store: string) => `/api/inventory/turnover?period=${period}&store_id=${store}`;

  beforeAll(async () => {
    await ensureApp();
    await turnoverQueue().obliterate({ force: true });
  }, 300000);

  afterAll(async () => {
    await setRule(null);
    await turnoverQueue().obliterate({ force: true });
    await closeTurnoverQueue();
    await sweepTestRoles();
    await closeTestRedis();
  });

  describe("ведомость склада", () => {
    it("офис: количество и суммы, cost_correction только в суммах", async () => {
      const w = await seed();
      try {
        const r = await api(await office(), "GET", url(older, w.store));
        expect(r.status).toBe(200);
        expect(r.body.with_sums).toBe(true);
        const line = r.body.lines.find((l: any) => l.product_id === w.p);
        expect(line.qty).toMatchObject({ start: "5", invoice: "2", end: "7" });
        expect(line.qty.cost_correction).toBeUndefined();
        expect(line.sum).toMatchObject({ start: "50", invoice: "20", cost_correction: "3", end: "73" });
        expect(r.body.columns).toContainEqual({ key: "cost_correction", sum_only: true });
        expect(r.body.data_through).toBe(older);
      } finally {
        await w.cleanup();
      }
    });

    it("филиал: старый месяц — только количество; ключей сумм нет вовсе", async () => {
      const w = await seed();
      try {
        const r = await api(await branch(w), "GET", url(older, w.store));
        expect(r.status).toBe(200);
        expect(r.body.with_sums).toBe(false);
        const line = r.body.lines[0];
        expect("sum" in line).toBe(false);
        expect("sum_in" in line.transfer).toBe(false);
        expect(r.body.columns.map((c: any) => c.key)).not.toContain("cost_correction");
      } finally {
        await w.cleanup();
      }
    });

    it("товар, у которого менялась только сумма: офису — есть, филиалу — нет", async () => {
      const w = await seed();
      const p2 = randomUUID();
      try {
        await drizzleDb.insert(schema.inventory_turnover_balance).values({
          period: older, store_id: w.store, product_id: p2, start_qty: "0", start_sum: "0", end_qty: "0", end_sum: "4", consistent: true,
        });
        await drizzleDb.insert(schema.inventory_turnover).values({
          period: older, store_id: w.store, product_id: p2, tx_type: "STORE_COST_CORRECTION", qty_in: "0", qty_out: "0", sum_in: "4", sum_out: "0",
        });
        const o = await api(await office(), "GET", url(older, w.store));
        expect(o.body.lines.map((l: any) => l.product_id)).toContain(p2);
        const b = await api(await branch(w), "GET", url(older, w.store));
        expect(b.body.lines.map((l: any) => l.product_id)).toEqual([w.p]);
      } finally {
        await w.cleanup();
      }
    });

    it("филиал: текущий месяц — 403 current; чужой склад — 403", async () => {
      const w = await seed();
      try {
        const m = await branch(w);
        const r = await api(m, "GET", url(current, w.store));
        expect(r.status).toBe(403);
        expect(r.body).toMatchObject({ error: "month_closed", reason: "current" });
        expect((await api(m, "GET", url(older, w.other))).status).toBe(403);
      } finally {
        await w.cleanup();
      }
    });

    it("филиал: прошлый без пересчёта — 403; с отправленным, который нельзя вернуть, — 200; можно вернуть — 403", async () => {
      const w = await seed();
      try {
        const m = await branch(w);
        expect((await api(m, "GET", url(previous, w.store))).body).toMatchObject({ error: "month_closed", reason: "not_fixed" });
        await w.monthly(previous, "submitted");
        await setRule("office_only");
        expect((await api(m, "GET", url(previous, w.store))).status).toBe(200);
        await setRule("until_accept");
        expect((await api(m, "GET", url(previous, w.store))).body).toMatchObject({ error: "month_closed", reason: "not_fixed" });
      } finally {
        await setRule(null);
        await w.cleanup();
      }
    });

    it("филиал: прошлый без пересчёта, но с проведённым документом iiko — 200; документ не проведён — 403", async () => {
      const w = await seed();
      try {
        const m = await branch(w);
        await drizzleDb.insert(schema.inventory_reconciliations).values({ store_id: w.store, period: previous, iiko_doc_state: "unposted_after_fetch" });
        expect((await api(m, "GET", url(previous, w.store))).body).toMatchObject({ error: "month_closed", reason: "not_fixed" });
        await drizzleDb
          .update(schema.inventory_reconciliations)
          .set({ iiko_doc_state: "posted" })
          .where(and(eq(schema.inventory_reconciliations.store_id, w.store), eq(schema.inventory_reconciliations.period, previous)));
        expect((await api(m, "GET", url(previous, w.store))).status).toBe(200);
        const periods = await api(m, "GET", `/api/inventory/turnover/periods?store_id=${w.store}`);
        expect(periods.body[1]).toMatchObject({ period: previous, open: true });
      } finally {
        await w.cleanup();
      }
    });

    it("филиал: старый месяц с черновиком месячного пересчёта — 403", async () => {
      const w = await seed();
      try {
        await w.monthly(older, "draft");
        const r = await api(await branch(w), "GET", url(older, w.store));
        expect(r.status).toBe(403);
        expect(r.body).toMatchObject({ error: "month_closed", reason: "not_fixed" });
      } finally {
        await w.cleanup();
      }
    });
  });

  describe("месяцы, сводная, обновление", () => {
    it("филиал: месяцы своего склада с причинами; без склада — 422; чужой — 403", async () => {
      const w = await seed();
      try {
        const m = await branch(w);
        const r = await api(m, "GET", `/api/inventory/turnover/periods?store_id=${w.store}`);
        expect(r.status).toBe(200);
        expect(r.body[0]).toMatchObject({ period: current, open: false, reason: "current" });
        expect(r.body[1]).toMatchObject({ period: previous, open: false, reason: "not_fixed" });
        expect(r.body[2]).toMatchObject({ period: older, open: true, reason: null, data_through: older });
        expect(r.body[2].fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect((await api(m, "GET", `/api/inventory/turnover/periods`)).status).toBe(422);
        expect((await api(m, "GET", `/api/inventory/turnover/periods?store_id=${w.other}`)).status).toBe(403);
      } finally {
        await w.cleanup();
      }
    });

    it("офис: все месяцы открыты", async () => {
      const r = await api(await office(), "GET", `/api/inventory/turnover/periods`);
      expect(r.status).toBe(200);
      expect(r.body.every((p: any) => p.open)).toBe(true);
    });

    it("сводная: офис — строка склада в суммах; филиал — 403", async () => {
      const w = await seed();
      try {
        const r = await api(await office(), "GET", `/api/inventory/turnover/summary?period=${older}`);
        expect(r.status).toBe(200);
        const row = r.body.rows.find((x: any) => x.store_id === w.store);
        expect(row.sum).toMatchObject({ start: "50", invoice: "20", cost_correction: "3", end: "73" });
        expect(row.inconsistent).toBe(0);
        expect(r.body.columns.map((c: any) => c.key)).toContain("cost_correction");
        expect(Number(r.body.total.invoice)).toBeGreaterThanOrEqual(40);
        expect((await api(await branch(w), "GET", `/api/inventory/turnover/summary?period=${older}`)).status).toBe(403);
      } finally {
        await w.cleanup();
      }
    });

    it("обновление: ставит задачу, повтор — 409, будущий месяц — 422, филиал — 403", async () => {
      const w = await seed();
      try {
        const o = await office();
        const r1 = await api(o, "POST", `/api/inventory/turnover/refresh`, { period: older });
        expect(r1.status).toBe(200);
        expect(r1.body.state).toBe("queued");
        expect((await api(o, "POST", `/api/inventory/turnover/refresh`, { period: older })).status).toBe(409);
        // склад, пока идёт загрузка всего месяца, — тоже 409
        expect((await api(o, "POST", `/api/inventory/turnover/refresh`, { period: older, store_id: w.store })).status).toBe(409);
        expect((await api(o, "POST", `/api/inventory/turnover/refresh`, { period: "2099-12-31" })).status).toBe(422);
        expect((await api(await branch(w), "POST", `/api/inventory/turnover/refresh`, { period: older })).status).toBe(403);
        // филиал с правом обновления: чужой склад и весь месяц (все склады) — 403
        const br = await withSession({ permissions: ["inventory.count", "inventory.reconcile"], userId: w.managerId });
        expect((await api(br, "POST", `/api/inventory/turnover/refresh`, { period: older, store_id: w.other })).status).toBe(403);
        expect((await api(br, "POST", `/api/inventory/turnover/refresh`, { period: older })).status).toBe(403);
        const st = await api(o, "GET", `/api/inventory/turnover/status?period=${older}`);
        expect(st.body.state).toBe("queued");
      } finally {
        await turnoverQueue().obliterate({ force: true });
        await w.cleanup();
      }
    });
  });
}
