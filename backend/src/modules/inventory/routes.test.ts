import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в tickets/routes.test.ts: голый `bun test` этот файл
// пропускает, а запуск через test:http:inventory доходит до fail-fast хелпера.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("inventory (пропущено: запускайте через bun run test:http:inventory)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, closeTestRedis, ensureApp, withSession, sweepTestRoles } = await import("../../../tests/helpers/http");
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { eq, inArray, sql } = await import("drizzle-orm");
  const { allowedPeriods } = await import("./rules");

  type Session = Awaited<ReturnType<typeof withSession>>;

  const PERIOD = allowedPeriods(new Date())[0];

  async function api(s: Session | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = s ? { ...s.headers } : {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await callApi(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  // Мир для одного теста: склад, папки, единица, 3 товара, шаблон из 2 товаров.
  // Всё на случайных uuid, убирается в cleanup().
  async function seedWorld() {
    const orgId = randomUUID();
    const storeId = randomUUID();
    const otherStoreId = randomUUID();
    const unitId = randomUUID();
    const parentGroupId = randomUUID();
    const groupId = randomUUID();
    const p1 = randomUUID(); // в папке «Склад / Мясные продукты»
    const p2 = randomUUID(); // без папки
    const p3 = randomUUID(); // вне шаблона
    const templateId = randomUUID();
    const tag = randomUUID().slice(0, 8);

    await drizzleDb.insert(schema.corporation_store).values([
      { id: storeId, name: `Склад тест ${tag}`, organization_id: orgId, type: "STORE" },
      { id: otherStoreId, name: `Чужой склад ${tag}`, organization_id: orgId, type: "STORE" },
    ]);
    await drizzleDb.insert(schema.measure_unit).values({ id: unitId, name: "кг", code: `kg-${tag}` });
    await drizzleDb.insert(schema.nomenclature_group).values([
      { id: parentGroupId, name: "Склад", deleted: false },
      { id: groupId, name: "Мясные продукты", deleted: false, parent_id: parentGroupId },
    ]);
    await drizzleDb.insert(schema.nomenclature_element).values([
      { id: p1, name: `Говядина ${tag}`, type: "GOODS", mainUnit: unitId, parent_id: groupId, deleted: false },
      { id: p2, name: `Соль ${tag}`, type: "GOODS", mainUnit: unitId, deleted: false },
      { id: p3, name: `Перец ${tag}`, type: "GOODS", mainUnit: unitId, parent_id: groupId, deleted: false },
    ]);
    await drizzleDb.insert(schema.inventory_templates).values({ id: templateId, organization_id: orgId, name: `Месячная ${tag}` });
    await drizzleDb.insert(schema.inventory_template_items).values([
      { template_id: templateId, product_id: p1 },
      { template_id: templateId, product_id: p2 },
    ]);

    const userIds: string[] = [];
    async function bindUser(userId: string, store = storeId) {
      userIds.push(userId);
      await drizzleDb.insert(schema.users_stores).values({ user_id: userId, corporation_store_id: store });
    }

    async function cleanup() {
      const countIds = (
        await drizzleDb
          .select({ id: schema.inventory_counts.id })
          .from(schema.inventory_counts)
          .where(inArray(schema.inventory_counts.store_id, [storeId, otherStoreId]))
      ).map((r) => r.id);
      if (countIds.length) await drizzleDb.delete(schema.inventory_counts).where(inArray(schema.inventory_counts.id, countIds));
      await drizzleDb.delete(schema.inventory_templates).where(eq(schema.inventory_templates.organization_id, orgId));
      if (userIds.length) await drizzleDb.delete(schema.users_stores).where(inArray(schema.users_stores.user_id, userIds));
      await drizzleDb.delete(schema.nomenclature_element).where(inArray(schema.nomenclature_element.id, [p1, p2, p3]));
      await drizzleDb.delete(schema.nomenclature_group).where(inArray(schema.nomenclature_group.id, [groupId, parentGroupId]));
      await drizzleDb.delete(schema.measure_unit).where(eq(schema.measure_unit.id, unitId));
      await drizzleDb.delete(schema.corporation_store).where(inArray(schema.corporation_store.id, [storeId, otherStoreId]));
    }

    return { orgId, storeId, otherStoreId, unitId, groupId, p1, p2, p3, templateId, tag, bindUser, cleanup };
  }

  type World = Awaited<ReturnType<typeof seedWorld>>;

  // Роли. bindStore=true кладёт users_stores на склад мира.
  async function sessionFor(w: World, permissions: string[], bindStore = true) {
    const userId = randomUUID();
    if (bindStore) await w.bindUser(userId);
    return withSession({ permissions, userId });
  }
  const manager = (w: World) => sessionFor(w, ["inventory.count", "inventory.manage"]);
  const helper = (w: World) => sessionFor(w, ["inventory.count"]);
  const office = (w: World) => sessionFor(w, ["inventory.count", "inventory.templates"], false);

  beforeAll(async () => {
    await ensureApp();
  }, 60000);

  afterAll(async () => {
    await sweepTestRoles();
    await closeTestRedis();
  });

  describe("inventory: доступ и склады", () => {
    it("без сессии — 401", async () => {
      const r = await api(null, "GET", "/api/inventory/stores");
      expect(r.status).toBe(401);
    });

    it("без права inventory.count — 403", async () => {
      const s = await withSession({ permissions: ["users.list"] });
      try {
        const r = await api(s, "GET", "/api/inventory/stores");
        expect(r.status).toBe(403);
      } finally {
        await s.cleanup();
      }
    });

    it("отдаёт только свои склады", async () => {
      const w = await seedWorld();
      const s = await helper(w);
      try {
        const r = await api(s, "GET", "/api/inventory/stores");
        expect(r.status).toBe(200);
        expect(r.body.map((x: any) => x.id)).toEqual([w.storeId]);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });

    it("periods отдаёт текущий период первым", async () => {
      const w = await seedWorld();
      const s = await helper(w);
      try {
        const r = await api(s, "GET", "/api/inventory/periods");
        expect(r.status).toBe(200);
        expect(r.body.periods[0]).toBe(PERIOD);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });
  });

  describe("inventory: создание и чтение", () => {
    it("available отдаёт активные шаблоны организации склада", async () => {
      const w = await seedWorld();
      const s = await manager(w);
      try {
        const r = await api(s, "GET", `/api/inventory/templates/available?store_id=${w.storeId}`);
        expect(r.status).toBe(200);
        expect(r.body.map((t: any) => t.id)).toContain(w.templateId);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });

    it("создаёт инвентаризацию со строками из шаблона и снимками папок", async () => {
      const w = await seedWorld();
      const s = await manager(w);
      try {
        const c = await api(s, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        expect(c.status).toBe(200);
        expect(c.body.existing).toBe(false);
        const r = await api(s, "GET", `/api/inventory/counts/${c.body.id}`);
        expect(r.status).toBe(200);
        expect(r.body.status).toBe("draft");
        expect(r.body.access).toBe("write");
        expect(r.body.can_manage).toBe(true);
        expect(r.body.lines_total).toBe(2);
        expect(r.body.lines_done).toBe(0);
        const byProduct = Object.fromEntries(r.body.lines.map((l: any) => [l.product_id, l]));
        expect(byProduct[w.p1].group_name).toBe("Склад / Мясные продукты");
        expect(byProduct[w.p1].unit_name).toBe("кг");
        expect(byProduct[w.p2].group_name).toBe("Без группы");
        expect(byProduct[w.p1].total).toBe("0");
        expect(byProduct[w.p1].source).toBe("template");
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });

    it("повторное и параллельное создание дают одну инвентаризацию", async () => {
      const w = await seedWorld();
      const s = await manager(w);
      try {
        const input = { store_id: w.storeId, template_id: w.templateId, period: PERIOD };
        const [a, b] = await Promise.all([
          api(s, "POST", "/api/inventory/counts", input),
          api(s, "POST", "/api/inventory/counts", input),
        ]);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        expect(a.body.id).toBe(b.body.id);
        const again = await api(s, "POST", "/api/inventory/counts", input);
        expect(again.body.id).toBe(a.body.id);
        expect(again.body.existing).toBe(true);
        const rows = await drizzleDb.select().from(schema.inventory_counts).where(eq(schema.inventory_counts.store_id, w.storeId));
        expect(rows.length).toBe(1);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });

    it("недопустимый период — 422, чужой склад — 403, без inventory.manage — 403", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      const h = await helper(w);
      try {
        const bad = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: "2020-01-31" });
        expect(bad.status).toBe(422);
        expect(bad.body.error).toBe("invalid_period");
        const foreign = await api(m, "POST", "/api/inventory/counts", { store_id: w.otherStoreId, template_id: w.templateId, period: PERIOD });
        expect(foreign.status).toBe(403);
        const noManage = await api(h, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        expect(noManage.status).toBe(403);
      } finally {
        await m.cleanup();
        await h.cleanup();
        await w.cleanup();
      }
    });

    it("офис без привязки читает (access: read), чужой помощник получает 403", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      const o = await office(w);
      const stranger = await sessionFor(w, ["inventory.count"], false);
      try {
        const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const ro = await api(o, "GET", `/api/inventory/counts/${c.body.id}`);
        expect(ro.status).toBe(200);
        expect(ro.body.access).toBe("read");
        expect(ro.body.can_manage).toBe(false);
        const denied = await api(stranger, "GET", `/api/inventory/counts/${c.body.id}`);
        expect(denied.status).toBe(403);
        const list = await api(m, "GET", `/api/inventory/counts?store_id=${w.storeId}`);
        expect(list.status).toBe(200);
        expect(list.body.map((x: any) => x.id)).toEqual([c.body.id]);
      } finally {
        await m.cleanup();
        await o.cleanup();
        await stranger.cleanup();
        await w.cleanup();
      }
    });

    it("кривой и несуществующий id — 404", async () => {
      const w = await seedWorld();
      const s = await helper(w);
      try {
        expect((await api(s, "GET", "/api/inventory/counts/not-a-uuid")).status).toBe(404);
        expect((await api(s, "GET", `/api/inventory/counts/${randomUUID()}`)).status).toBe(404);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });

    it("в ответе нет учётных полей iiko", async () => {
      const w = await seedWorld();
      const s = await manager(w);
      try {
        const c = await api(s, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const r = await api(s, "GET", `/api/inventory/counts/${c.body.id}`);
        const text = JSON.stringify(r.body).toLowerCase();
        expect(text.includes("book")).toBe(false);
        expect(text.includes("iiko")).toBe(false);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });
  });

  // TASK-4-TESTS
  // TASK-5-TESTS
  // TASK-6-TESTS
  // TASK-7-TESTS
}
