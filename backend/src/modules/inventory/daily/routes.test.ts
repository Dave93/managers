import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest || !prefixLooksLikeTest) {
  describe.skip("daily grid routes (пропущено: запускайте через bun run test:http:daily)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, closeTestRedis, ensureApp, withSession, sweepTestRoles } = await import("../../../../tests/helpers/http");
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { inArray } = await import("drizzle-orm");
  const { lastDayOfMonth, previousPeriod } = await import("../rules");

  type Session = Awaited<ReturnType<typeof withSession>>;

  async function api(s: Session | null, path: string) {
    const res = await callApi(path, { method: "GET", headers: s ? { ...s.headers } : {} });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  // Прошлый месяц — все дни полные при любой дате запуска.
  const period = previousPeriod(new Date());
  const day = (d: number) => `${period.slice(0, 8)}${String(d).padStart(2, "0")}`;
  const lastDay = Number(period.slice(8, 10));

  async function seed() {
    const les = randomUUID();
    const chopar = randomUUID();
    const office = randomUUID();
    const userId = randomUUID();
    const tag = randomUUID().slice(0, 6);
    await drizzleDb.insert(schema.corporation_store).values([
      { id: les, name: `19998 - Склад Les Тест ${tag}`, type: "STORE" },
      { id: chopar, name: `21998 - Склад Chopar Тест ${tag}`, type: "STORE" },
      { id: office, name: `Офис ${tag}`, type: "STORE" },
    ]);
    // Работающий склад — с товарами из exord; без них и без пересчётов склад в таблицу не попадает.
    await drizzleDb.insert(schema.store_product_links).values([
      { store_id: les, product_ids: [randomUUID()] },
      { store_id: chopar, product_ids: [randomUUID()] },
    ]);
    const base = { template_name: "Kunlik", period, created_by: userId };
    const [sub] = await drizzleDb
      .insert(schema.inventory_counts)
      .values({ ...base, store_id: les, kind: "interim", count_date: day(1), status: "submitted" })
      .returning({ id: schema.inventory_counts.id });
    await drizzleDb.insert(schema.inventory_counts).values([
      { ...base, store_id: les, kind: "interim", count_date: day(2), status: "draft" },
      { ...base, store_id: les, kind: "interim", count_date: day(3), status: "cancelled" },
      { ...base, store_id: les, template_name: "Все товары филиала", kind: "monthly", count_date: period, status: "submitted" },
      { ...base, store_id: office, kind: "interim", count_date: day(1), status: "submitted" },
    ]);
    async function cleanup() {
      await drizzleDb.delete(schema.inventory_counts).where(inArray(schema.inventory_counts.store_id, [les, chopar, office]));
      await drizzleDb.delete(schema.store_product_links).where(inArray(schema.store_product_links.store_id, [les, chopar]));
      await drizzleDb.delete(schema.corporation_store).where(inArray(schema.corporation_store.id, [les, chopar, office]));
    }
    return { les, chopar, office, subId: sub.id, cleanup };
  }

  const url = (p: string) => `/api/inventory/daily-grid?period=${p}`;
  const rowsOf = (body: any) => body.groups.flatMap((g: any) => g.rows);

  beforeAll(async () => {
    await ensureApp();
  }, 300000);

  afterAll(async () => {
    await sweepTestRoles();
    await closeTestRedis();
  });

  it("филиалу без inventory.templates — 403", async () => {
    const s = await withSession({ permissions: ["inventory.count", "inventory.manage"] });
    try {
      expect((await api(s, url(period))).status).toBe(403);
    } finally {
      await s.cleanup();
    }
  });

  it("без сессии — 401", async () => {
    expect((await api(null, url(period))).status).toBe(401);
  });

  it("неверный период — 422", async () => {
    const s = await withSession({ permissions: ["inventory.templates"] });
    try {
      expect((await api(s, url("2026-11-15"))).status).toBe(422);
    } finally {
      await s.cleanup();
    }
  });

  it("офис: склады филиалов по брендам, ячейки по дням, без «Офиса»", async () => {
    const w = await seed();
    const s = await withSession({ permissions: ["inventory.count", "inventory.templates"] });
    try {
      const r = await api(s, url(period));
      expect(r.status).toBe(200);
      expect(r.body.days).toBe(lastDay);
      expect(r.body.complete_days).toBe(lastDay);
      expect(r.body.entering_day).toBeNull();

      const rows = rowsOf(r.body);
      expect(rows.some((x: any) => x.store_id === w.office)).toBe(false);
      const les = r.body.groups.find((g: any) => g.brand === "les").rows.find((x: any) => x.store_id === w.les);
      const chopar = r.body.groups.find((g: any) => g.brand === "chopar").rows.find((x: any) => x.store_id === w.chopar);

      expect(les.cells[0]).toEqual({ count_id: w.subId, status: "submitted", monthly: false });
      expect(les.cells[1].status).toBe("draft");
      expect(les.cells[2]).toBeNull();
      expect(les.cells[lastDay - 1].monthly).toBe(true);
      expect(les.submitted).toBe(2);

      expect(chopar.cells).toHaveLength(lastDay);
      expect(chopar.cells.every((c: any) => c === null)).toBe(true);
      expect(chopar.submitted).toBe(0);
    } finally {
      await s.cleanup();
      await w.cleanup();
    }
  });

  it("пересчёты чужого месяца в ячейки не попадают", async () => {
    const w = await seed();
    const s = await withSession({ permissions: ["inventory.templates"] });
    try {
      const [y, m] = period.split("-").map(Number);
      const older = m === 1 ? lastDayOfMonth(y - 1, 12) : lastDayOfMonth(y, m - 1);
      const r = await api(s, url(older));
      expect(r.status).toBe(200);
      const les = rowsOf(r.body).find((x: any) => x.store_id === w.les);
      expect(les.cells.every((c: any) => c === null)).toBe(true);
    } finally {
      await s.cleanup();
      await w.cleanup();
    }
  });
}
