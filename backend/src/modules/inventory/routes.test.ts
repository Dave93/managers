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

    // Товары склада storeId по exord (store_product_links, ключ — iiko store id).
    async function linkBranch(productIds: string[]) {
      await drizzleDb.insert(schema.store_product_links).values({ store_id: storeId, product_ids: productIds });
    }

    async function cleanup() {
      await drizzleDb.delete(schema.store_product_links).where(eq(schema.store_product_links.store_id, storeId));
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

    return { orgId, storeId, otherStoreId, unitId, groupId, p1, p2, p3, templateId, tag, bindUser, linkBranch, cleanup };
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
  // Офис, который сверяет и может вернуть отправленный пересчёт в черновик.
  const reconciler = (w: World) => sessionFor(w, ["inventory.count", "inventory.templates", "inventory.reconcile"], false);

  // Холодный старт приложения на этой машине бывает дольше 60 с (видели 68 и 89 с).
  beforeAll(async () => {
    await ensureApp();
  }, 180000);

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
        expect(r.body.templates.map((t: any) => t.id)).toContain(w.templateId);
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
  describe("inventory: синхронизация записей", () => {
    async function startedCount(w: World) {
      const m = await manager(w);
      const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
      const d = await api(m, "GET", `/api/inventory/counts/${c.body.id}`);
      const lineOf = (pid: string) => d.body.lines.find((l: any) => l.product_id === pid).id as string;
      return { m, countId: c.body.id as string, lineOf };
    }
    const add = (line_id: string, qty: number, id = randomUUID()) => ({
      op: "add" as const, id, line_id, qty, client_created_at: new Date().toISOString(),
    });

    it("повтор той же пачки не создаёт дублей, итог — сумма", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        const ops = [add(lineOf(w.p1), 2.5), add(lineOf(w.p1), 3)];
        const r1 = await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops });
        const r2 = await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops });
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(r1.body.applied.length).toBe(2);
        const d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        const line = d.body.lines.find((l: any) => l.product_id === w.p1);
        expect(line.entries.length).toBe(2);
        expect(line.total).toBe("5.5");
        expect(d.body.lines_done).toBe(1);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("add и delete одной записи в одной пачке — 0 живых записей", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        const a = add(lineOf(w.p1), 4);
        const r = await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [a, { op: "delete", id: a.id }] });
        expect(r.body.applied).toEqual([a.id, a.id]);
        const d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.lines.find((l: any) => l.product_id === w.p1).entries.length).toBe(0);
        const raw = await drizzleDb.select().from(schema.inventory_count_entries).where(eq(schema.inventory_count_entries.id, a.id));
        expect(raw[0].deleted_at).not.toBeNull();
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("плохое количество и чужая строка отклоняются по одной, остальное применяется", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        const good = add(lineOf(w.p1), 1);
        const neg = add(lineOf(w.p1), -1);
        const many = add(lineOf(w.p1), 1.23456);
        const foreign = add(randomUUID(), 1);
        const r = await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [good, neg, many, foreign] });
        expect(r.status).toBe(200);
        expect(r.body.applied).toEqual([good.id]);
        expect(r.body.rejected).toEqual([
          { id: neg.id, reason: "invalid_qty" },
          { id: many.id, reason: "invalid_qty" },
          { id: foreign.id, reason: "not_found_line" },
        ]);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("помощник не удаляет чужую запись, менеджер удаляет", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      const h = await helper(w);
      try {
        const mine = add(lineOf(w.p1), 2);
        await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [mine] });
        const hr = await api(h, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [{ op: "delete", id: mine.id }] });
        expect(hr.body.rejected).toEqual([{ id: mine.id, reason: "forbidden" }]);
        const theirs = add(lineOf(w.p2), 1);
        await api(h, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [theirs] });
        const mr = await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [{ op: "delete", id: theirs.id }] });
        expect(mr.body.applied).toEqual([theirs.id]);
      } finally {
        await m.cleanup();
        await h.cleanup();
        await w.cleanup();
      }
    });

    it("офис на чтении получает 403 на sync", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      const o = await office(w);
      try {
        const r = await api(o, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p1), 1)] });
        expect(r.status).toBe(403);
      } finally {
        await m.cleanup();
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("товар вне шаблона добавляется один раз и помечен added", async () => {
      const w = await seedWorld();
      const { m, countId } = await startedCount(w);
      const h = await helper(w);
      try {
        const a = await api(h, "POST", `/api/inventory/counts/${countId}/lines`, { product_id: w.p3 });
        expect(a.status).toBe(200);
        expect(a.body.created).toBe(true);
        const b = await api(h, "POST", `/api/inventory/counts/${countId}/lines`, { product_id: w.p3 });
        expect(b.body.created).toBe(false);
        expect(b.body.line_id).toBe(a.body.line_id);
        const d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        const line = d.body.lines.find((l: any) => l.product_id === w.p3);
        expect(line.source).toBe("added");
        expect(line.group_name).toBe("Склад / Мясные продукты");
        const unknown = await api(h, "POST", `/api/inventory/counts/${countId}/lines`, { product_id: randomUUID() });
        expect(unknown.status).toBe(404);
      } finally {
        await m.cleanup();
        await h.cleanup();
        await w.cleanup();
      }
    });

    it("«не считали» засчитывается в прогресс и снимается", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        const r = await api(m, "PATCH", `/api/inventory/counts/${countId}/lines/${lineOf(w.p2)}`, { skipped: true });
        expect(r.status).toBe(200);
        let d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.lines_done).toBe(1);
        await api(m, "PATCH", `/api/inventory/counts/${countId}/lines/${lineOf(w.p2)}`, { skipped: false });
        d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.lines_done).toBe(0);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("поиск товаров находит по части названия", async () => {
      const w = await seedWorld();
      const s = await helper(w);
      try {
        const r = await api(s, "GET", `/api/inventory/products?q=${encodeURIComponent("Перец " + w.tag)}&limit=10`);
        expect(r.status).toBe(200);
        expect(r.body.map((p: any) => p.id)).toEqual([w.p3]);
        expect(r.body[0].group_name).toBe("Склад / Мясные продукты");
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });
  });
  describe("inventory: отправка, возврат, отмена", () => {
    async function startedCount(w: World) {
      const m = await manager(w);
      const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
      const d = await api(m, "GET", `/api/inventory/counts/${c.body.id}`);
      const lineOf = (pid: string) => d.body.lines.find((l: any) => l.product_id === pid).id as string;
      return { m, countId: c.body.id as string, lineOf };
    }
    const add = (line_id: string, qty: number) => ({
      op: "add" as const, id: randomUUID(), line_id, qty, client_created_at: new Date().toISOString(),
    });

    it("незаполненные строки блокируют отправку, skip_incomplete их пропускает", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p1), 2.5), add(lineOf(w.p1), 3)] });
        const blocked = await api(m, "POST", `/api/inventory/counts/${countId}/submit`, {});
        expect(blocked.status).toBe(422);
        expect(blocked.body).toEqual({ error: "incomplete", incomplete: 1 });
        const ok = await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        expect(ok.status).toBe(200);
        const d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.status).toBe("submitted");
        expect(d.body.submitted_at).not.toBeNull();
        const p1 = d.body.lines.find((l: any) => l.product_id === w.p1);
        const p2 = d.body.lines.find((l: any) => l.product_id === w.p2);
        expect(Number(p1.fact_qty)).toBe(5.5);
        expect(p2.skipped).toBe(true);
        expect(p2.fact_qty).toBeNull();
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("после отправки sync — 409, помощник не может отправить", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      const h = await helper(w);
      try {
        const hs = await api(h, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        expect(hs.status).toBe(403);
        await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        const r = await api(h, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p1), 1)] });
        expect(r.status).toBe(409);
        expect(r.body).toEqual({ error: "not_draft", status: "submitted" });
      } finally {
        await m.cleanup();
        await h.cleanup();
        await w.cleanup();
      }
    });

    it("sync и submit одновременно: каждая принятая запись есть в fact_qty", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      const h = await helper(w);
      try {
        await api(m, "PATCH", `/api/inventory/counts/${countId}/lines/${lineOf(w.p2)}`, { skipped: true });
        await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p1), 1)] });
        const batches = Array.from({ length: 8 }, () => [add(lineOf(w.p1), 1), add(lineOf(w.p1), 1)]);
        await Promise.all([
          ...batches.map((ops) => api(h, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops })),
          api(m, "POST", `/api/inventory/counts/${countId}/submit`, {}),
        ]);
        const live = await drizzleDb.execute(sql`
          select coalesce(sum(qty), 0)::numeric as s from inventory_count_entries
          where count_id = ${countId} and deleted_at is null`);
        const [line] = await drizzleDb
          .select()
          .from(schema.inventory_count_lines)
          .where(eq(schema.inventory_count_lines.id, lineOf(w.p1)));
        expect(Number(line.fact_qty)).toBe(Number((live.rows[0] as any).s));
      } finally {
        await m.cleanup();
        await h.cleanup();
        await w.cleanup();
      }
    });

    it("возврат в черновик очищает fact_qty, отмена освобождает место для новой", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p1), 1)] });
        await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        const re = await api(await reconciler(w), "POST", `/api/inventory/counts/${countId}/reopen`, {});
        expect(re.status).toBe(200);
        let d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.status).toBe("draft");
        expect(d.body.submitted_at).toBeNull();
        expect(d.body.lines.every((l: any) => l.fact_qty === null)).toBe(true);
        const cancel = await api(m, "POST", `/api/inventory/counts/${countId}/cancel`, {});
        expect(cancel.status).toBe(200);
        const again = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        expect(again.status).toBe(200);
        expect(again.body.id).not.toBe(countId);
        const events = await drizzleDb
          .select({ type: schema.inventory_count_events.type })
          .from(schema.inventory_count_events)
          .where(eq(schema.inventory_count_events.count_id, countId));
        expect(events.map((e) => e.type).sort()).toEqual(["cancelled", "created", "reopened", "submitted"]);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("возврат в черновик снимает автоматическое «не считали», ручное оставляет", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        // p1 человек отметил сам, p2 пометит отправка (skip_incomplete).
        await api(m, "PATCH", `/api/inventory/counts/${countId}/lines/${lineOf(w.p1)}`, { skipped: true });
        await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        let d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.lines.every((l: any) => l.skipped)).toBe(true);
        await api(await reconciler(w), "POST", `/api/inventory/counts/${countId}/reopen`, {});
        d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.lines.find((l: any) => l.product_id === w.p1).skipped).toBe(true);
        expect(d.body.lines.find((l: any) => l.product_id === w.p2).skipped).toBe(false);
        expect(d.body.lines_done).toBe(1);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    // Правило возврата отправленного пересчёта филиалом — настройка inventory.reopen_rule.
    async function setRule(rule: string | null) {
      await drizzleDb.delete(schema.settings).where(eq(schema.settings.key, "inventory.reopen_rule"));
      if (rule) await drizzleDb.insert(schema.settings).values({ key: "inventory.reopen_rule", value: rule });
    }
    async function setRecon(w: World, fields: { status: string; iiko_doc_state: string | null }) {
      await drizzleDb.delete(schema.inventory_reconciliations).where(eq(schema.inventory_reconciliations.store_id, w.storeId));
      await drizzleDb.insert(schema.inventory_reconciliations).values({ store_id: w.storeId, period: PERIOD, ...fields });
    }
    async function submitted(w: World) {
      const { m, countId, lineOf } = await startedCount(w);
      await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p1), 1)] });
      await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
      return { m, countId, lineOf };
    }
    async function tryReopen(s: Session, countId: string) {
      const d = await api(s, "GET", `/api/inventory/counts/${countId}`);
      const r = await api(s, "POST", `/api/inventory/counts/${countId}/reopen`, {});
      return { canReopen: d.body.can_reopen, status: r.status };
    }

    it("по умолчанию (until_iiko): филиал возвращает, пока нет документа iiko и сверка не принята", async () => {
      const w = await seedWorld();
      await setRule(null);
      const { m, countId, lineOf } = await submitted(w);
      try {
        // правка отправленного без возврата закрыта всегда
        expect((await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p2), 5)] })).status).toBe(409);
        expect(await tryReopen(m, countId)).toEqual({ canReopen: true, status: 200 });

        await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        await setRecon(w, { status: "ready", iiko_doc_state: "posted" });
        expect(await tryReopen(m, countId)).toEqual({ canReopen: false, status: 403 });
        // документ распровели после загрузки — всё равно закрыто
        await setRecon(w, { status: "ready", iiko_doc_state: "unposted_after_fetch" });
        expect(await tryReopen(m, countId)).toEqual({ canReopen: false, status: 403 });
      } finally {
        await drizzleDb.delete(schema.inventory_reconciliations).where(eq(schema.inventory_reconciliations.store_id, w.storeId));
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("until_accept: филиал возвращает и после загрузки iiko, но не после «принято»", async () => {
      const w = await seedWorld();
      await setRule("until_accept");
      const { m, countId } = await submitted(w);
      try {
        await setRecon(w, { status: "ready", iiko_doc_state: "posted" });
        expect(await tryReopen(m, countId)).toEqual({ canReopen: true, status: 200 });
        await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        await setRecon(w, { status: "accepted", iiko_doc_state: "posted" });
        expect(await tryReopen(m, countId)).toEqual({ canReopen: false, status: 403 });
      } finally {
        await setRule(null);
        await drizzleDb.delete(schema.inventory_reconciliations).where(eq(schema.inventory_reconciliations.store_id, w.storeId));
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("office_only: филиал не возвращает никогда, офис с inventory.reconcile — всегда (даже после «принято»)", async () => {
      const w = await seedWorld();
      await setRule("office_only");
      const { m, countId } = await submitted(w);
      try {
        expect(await tryReopen(m, countId)).toEqual({ canReopen: false, status: 403 });
        await setRecon(w, { status: "accepted", iiko_doc_state: "posted" });
        expect(await tryReopen(await reconciler(w), countId)).toEqual({ canReopen: true, status: 200 });
      } finally {
        await setRule(null);
        await drizzleDb.delete(schema.inventory_reconciliations).where(eq(schema.inventory_reconciliations.store_id, w.storeId));
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("отменить отправленную нельзя — 409", async () => {
      const w = await seedWorld();
      const { m, countId } = await startedCount(w);
      try {
        await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        const r = await api(m, "POST", `/api/inventory/counts/${countId}/cancel`, {});
        expect(r.status).toBe(409);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });
  });
  describe("inventory: шаблоны и обзор", () => {
    it("CRUD шаблона и состав закрыты от менеджера", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      try {
        expect((await api(m, "GET", "/api/inventory/templates")).status).toBe(403);
        expect((await api(m, "POST", "/api/inventory/templates", { organization_id: w.orgId, name: "x" })).status).toBe(403);
        expect((await api(m, "GET", "/api/inventory/overview?period=" + PERIOD)).status).toBe(403);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("создание, состав, чтение, деактивация", async () => {
      const w = await seedWorld();
      const o = await office(w);
      try {
        const c = await api(o, "POST", "/api/inventory/templates", { organization_id: w.orgId, name: `Ежедневная ${w.tag}` });
        expect(c.status).toBe(200);
        const id = c.body.id;
        const put = await api(o, "PUT", `/api/inventory/templates/${id}/items`, { product_ids: [w.p1, w.p3, w.p1] });
        expect(put.body).toEqual({ items_count: 2 });
        const g = await api(o, "GET", `/api/inventory/templates/${id}`);
        expect(g.body.product_ids.sort()).toEqual([w.p1, w.p3].sort());
        expect(g.body.items_count).toBe(2);
        await api(o, "PATCH", `/api/inventory/templates/${id}`, { active: false });
        const list = await api(o, "GET", `/api/inventory/templates?organization_id=${w.orgId}`);
        expect(list.body.find((t: any) => t.id === id).active).toBe(false);
        const del = await api(o, "DELETE", `/api/inventory/templates/${id}`);
        expect(del.status).toBe(200);
      } finally {
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("шаблон с инвентаризациями не удаляется — 409", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      const o = await office(w);
      try {
        await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const r = await api(o, "DELETE", `/api/inventory/templates/${w.templateId}`);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("in_use");
      } finally {
        await m.cleanup();
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("подсказки — товары, добавленные при пересчёте и не входящие в шаблон", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      const o = await office(w);
      try {
        const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        await api(m, "POST", `/api/inventory/counts/${c.body.id}/lines`, { product_id: w.p3 });
        const s = await api(o, "GET", `/api/inventory/templates/${w.templateId}/suggestions`);
        expect(s.status).toBe(200);
        expect(s.body).toEqual([{ product_id: w.p3, product_name: `Перец ${w.tag}`, times: 1 }]);
      } finally {
        await m.cleanup();
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("организации для редактора шаблонов", async () => {
      const w = await seedWorld();
      const o = await office(w);
      try {
        const r = await api(o, "GET", "/api/inventory/organizations");
        expect(r.status).toBe(200);
        expect(Array.isArray(r.body)).toBe(true);
      } finally {
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("папки отдают группы и товары", async () => {
      const w = await seedWorld();
      const o = await office(w);
      try {
        const r = await api(o, "GET", "/api/inventory/folders");
        expect(r.status).toBe(200);
        expect(r.body.groups.find((g: any) => g.id === w.groupId).parent_id).not.toBeNull();
        expect(r.body.products.find((p: any) => p.id === w.p1).parent_id).toBe(w.groupId);
      } finally {
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("обзор показывает склад с инвентаризацией и склад без неё", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      const o = await office(w);
      try {
        const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const r = await api(o, "GET", `/api/inventory/overview?period=${PERIOD}&organization_id=${w.orgId}`);
        expect(r.status).toBe(200);
        const mine = r.body.find((x: any) => x.store_id === w.storeId);
        const other = r.body.find((x: any) => x.store_id === w.otherStoreId);
        expect(mine.counts.map((x: any) => x.id)).toEqual([c.body.id]);
        expect(other.counts).toEqual([]);
        const bad = await api(o, "GET", "/api/inventory/overview?period=2026-10-30");
        expect(bad.status).toBe(422);
      } finally {
        await m.cleanup();
        await o.cleanup();
        await w.cleanup();
      }
    });
  });

  describe("inventory: товары филиала из exord", () => {
    // Шаблон мира = [p1, p2]; филиал склада storeId по exord = [p1, p3].
    it("available считает позиции для склада и помечает фильтр exord", async () => {
      const w = await seedWorld();
      await w.linkBranch([w.p1, w.p3]);
      const m = await manager(w);
      try {
        await w.bindUser(m.userId, w.otherStoreId);
        const a = await api(m, "GET", `/api/inventory/templates/available?store_id=${w.storeId}`);
        const tpl = a.body.templates.find((t: any) => t.id === w.templateId);
        expect(tpl.items_for_store).toBe(1);
        expect(tpl.exord_filtered).toBe(true);
        const b = await api(m, "GET", `/api/inventory/templates/available?store_id=${w.otherStoreId}`);
        const tplB = b.body.templates.find((t: any) => t.id === w.templateId);
        expect(tplB.items_for_store).toBe(2);
        expect(tplB.exord_filtered).toBe(false);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("инвентаризация = шаблон ∩ товары филиала; без exord — весь шаблон", async () => {
      const w = await seedWorld();
      await w.linkBranch([w.p1, w.p3]);
      const m = await manager(w);
      try {
        await w.bindUser(m.userId, w.otherStoreId);
        const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const d = await api(m, "GET", `/api/inventory/counts/${c.body.id}`);
        expect(d.body.exord_filtered).toBe(true);
        expect(d.body.lines.map((l: any) => l.product_id)).toEqual([w.p1]);
        const c2 = await api(m, "POST", "/api/inventory/counts", { store_id: w.otherStoreId, template_id: w.templateId, period: PERIOD });
        const d2 = await api(m, "GET", `/api/inventory/counts/${c2.body.id}`);
        expect(d2.body.exord_filtered).toBe(false);
        expect(d2.body.lines.map((l: any) => l.product_id).sort()).toEqual([w.p1, w.p2].sort());
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("филиал без пересечения с шаблоном — инвентаризация с 0 строк", async () => {
      const w = await seedWorld();
      await w.linkBranch([w.p3]);
      const m = await manager(w);
      try {
        const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        expect(c.status).toBe(200);
        const d = await api(m, "GET", `/api/inventory/counts/${c.body.id}`);
        expect(d.body.exord_filtered).toBe(true);
        expect(d.body.lines).toEqual([]);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("пустой список товаров филиала в exord считается как «нет данных» — без фильтра", async () => {
      const w = await seedWorld();
      await w.linkBranch([]);
      const m = await manager(w);
      try {
        const a = await api(m, "GET", `/api/inventory/templates/available?store_id=${w.storeId}`);
        expect(a.body.templates.find((t: any) => t.id === w.templateId).exord_filtered).toBe(false);
        expect(a.body.branch).toEqual({ available: false, items_for_store: 0 });
        const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const d = await api(m, "GET", `/api/inventory/counts/${c.body.id}`);
        expect(d.body.exord_filtered).toBe(false);
        expect(d.body.lines.map((l: any) => l.product_id).sort()).toEqual([w.p1, w.p2].sort());
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("в отфильтрованную инвентаризацию можно добавить и товар не из exord", async () => {
      const w = await seedWorld();
      await w.linkBranch([w.p1, w.p3]);
      const m = await manager(w);
      try {
        const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const off = await api(m, "POST", `/api/inventory/counts/${c.body.id}/lines`, { product_id: w.p2 });
        expect(off.status).toBe(200);
        expect(off.body.created).toBe(true);
        const on = await api(m, "POST", `/api/inventory/counts/${c.body.id}/lines`, { product_id: w.p3 });
        expect(on.status).toBe(200);
        const d = await api(m, "GET", `/api/inventory/counts/${c.body.id}`);
        expect(d.body.lines.find((l: any) => l.product_id === w.p2).source).toBe("added");
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("поиск с count_id: сначала товары филиала, потом остальные с in_branch=false, без уже посчитанных", async () => {
      const w = await seedWorld();
      await w.linkBranch([w.p1, w.p3]);
      const m = await manager(w);
      try {
        const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const scoped = await api(m, "GET", `/api/inventory/products?q=${encodeURIComponent(w.tag)}&count_id=${c.body.id}`);
        expect(scoped.status).toBe(200);
        expect(scoped.body.map((p: any) => [p.id, p.in_branch])).toEqual([
          [w.p3, true],
          [w.p2, false],
        ]);
        const all = await api(m, "GET", `/api/inventory/products?q=${encodeURIComponent(w.tag)}`);
        expect(all.body.map((p: any) => p.id).sort()).toEqual([w.p1, w.p2, w.p3].sort());
        expect(all.body.every((p: any) => p.in_branch === null)).toBe(true);
        const stranger = await sessionFor(w, ["inventory.count"], false);
        try {
          const denied = await api(stranger, "GET", `/api/inventory/products?q=${encodeURIComponent(w.tag)}&count_id=${c.body.id}`);
          expect(denied.status).toBe(403);
        } finally {
          await stranger.cleanup();
        }
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("обзор помечает склады без данных exord", async () => {
      const w = await seedWorld();
      await w.linkBranch([w.p1, w.p3]);
      const o = await office(w);
      try {
        const r = await api(o, "GET", `/api/inventory/overview?period=${PERIOD}&organization_id=${w.orgId}`);
        expect(r.body.find((x: any) => x.store_id === w.storeId).exord).toBe(true);
        expect(r.body.find((x: any) => x.store_id === w.otherStoreId).exord).toBe(false);
      } finally {
        await o.cleanup();
        await w.cleanup();
      }
    });
  });

  describe("inventory: «Все товары филиала» без шаблона", () => {
    // Филиал склада storeId по exord = [p1, p3]; шаблон мира = [p1, p2].
    it("available отдаёт пункт «все товары филиала» с числом позиций", async () => {
      const w = await seedWorld();
      await w.linkBranch([w.p1, w.p3]);
      const m = await manager(w);
      try {
        await w.bindUser(m.userId, w.otherStoreId);
        const a = await api(m, "GET", `/api/inventory/templates/available?store_id=${w.storeId}`);
        expect(a.body.branch).toEqual({ available: true, items_for_store: 2 });
        const b = await api(m, "GET", `/api/inventory/templates/available?store_id=${w.otherStoreId}`);
        expect(b.body.branch).toEqual({ available: false, items_for_store: 0 });
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("создание без шаблона — все товары филиала, повтор не создаёт дубль, шаблонная живёт рядом", async () => {
      const w = await seedWorld();
      await w.linkBranch([w.p1, w.p3]);
      const m = await manager(w);
      try {
        const input = { store_id: w.storeId, period: PERIOD };
        const [x, y] = await Promise.all([
          api(m, "POST", "/api/inventory/counts", input),
          api(m, "POST", "/api/inventory/counts", input),
        ]);
        expect(x.status).toBe(200);
        expect(y.body.id).toBe(x.body.id);
        const d = await api(m, "GET", `/api/inventory/counts/${x.body.id}`);
        expect(d.body.template_id).toBeNull();
        expect(d.body.template_name).toBe("Все товары филиала");
        expect(d.body.exord_filtered).toBe(true);
        expect(d.body.lines.map((l: any) => l.product_id).sort()).toEqual([w.p1, w.p3].sort());
        expect(d.body.lines.find((l: any) => l.product_id === w.p1).group_name).toBe("Склад / Мясные продукты");
        const again = await api(m, "POST", "/api/inventory/counts", input);
        expect(again.body).toEqual({ id: x.body.id, existing: true });
        const tpl = await api(m, "POST", "/api/inventory/counts", { ...input, template_id: w.templateId });
        expect(tpl.status).toBe(200);
        expect(tpl.body.id).not.toBe(x.body.id);
        const list = await api(m, "GET", `/api/inventory/counts?store_id=${w.storeId}`);
        expect(list.body.length).toBe(2);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("без данных exord создать «все товары филиала» нельзя — 422", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      try {
        const r = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, period: PERIOD });
        expect(r.status).toBe(422);
        expect(r.body.error).toBe("no_branch_products");
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });
  });

  describe("inventory: прошлый период — без срока ввода", () => {
    const PAST = "2026-01-31";

    // Пересчёт за давний период вставляется напрямую: через API его не создать.
    async function pastCount(w: World, status: "draft" | "submitted", createdBy: string) {
      const [c] = await drizzleDb
        .insert(schema.inventory_counts)
        .values({
          store_id: w.storeId,
          organization_id: w.orgId,
          template_id: w.templateId,
          template_name: "Месячная",
          period: PAST, count_date: PAST,
          status,
          created_by: createdBy,
        })
        .returning({ id: schema.inventory_counts.id });
      const [line] = await drizzleDb
        .insert(schema.inventory_count_lines)
        .values({ count_id: c.id, product_id: w.p1, product_name: "Говядина", group_name: "Склад", source: "template" })
        .returning({ id: schema.inventory_count_lines.id });
      return { countId: c.id, lineId: line.id };
    }

    it("пересчёт прошлого периода: запись, отправка и возврат в черновик проходят", async () => {
      const w = await seedWorld();
      try {
        const m = await manager(w);
        const c = await pastCount(w, "draft", m.userId);
        const sync = await api(m, "POST", `/api/inventory/counts/${c.countId}/entries/sync`, {
          ops: [{ op: "add", id: randomUUID(), line_id: c.lineId, qty: 1, client_created_at: new Date().toISOString() }],
        });
        expect(sync.status).toBe(200);
        expect(sync.body.applied.length).toBe(1);
        expect((await api(m, "POST", `/api/inventory/counts/${c.countId}/submit`, {})).status).toBe(200);

        const detail = await api(m, "GET", `/api/inventory/counts/${c.countId}`);
        expect(detail.body.input_open).toBeUndefined();
        expect(detail.body.deadline).toBeUndefined();

        expect((await api(await reconciler(w), "POST", `/api/inventory/counts/${c.countId}/reopen`, {})).status).toBe(200);
      } finally {
        await w.cleanup();
      }
    });

    it("прошлый месяц можно начать в любой день", async () => {
      const w = await seedWorld();
      try {
        const m = await manager(w);
        const r = await api(m, "GET", "/api/inventory/periods");
        expect(r.body.periods.length).toBe(2);
      } finally {
        await w.cleanup();
      }
    });

    it("разблокировки больше нет — маршрут не существует", async () => {
      const w = await seedWorld();
      try {
        const o = await sessionFor(w, ["inventory.count", "inventory.reconcile"], false);
        const m = await manager(w);
        const c = await pastCount(w, "draft", m.userId);
        const r = await api(o, "POST", `/api/inventory/counts/${c.countId}/unlock`, {});
        expect(r.status).toBe(404);
      } finally {
        await w.cleanup();
      }
    });
  });

  describe("inventory: промежуточные пересчёты", () => {
    it("даты: вчера по умолчанию; промежуточный за вчера; сегодня и раньше 1-го числа прошлого месяца — 422", async () => {
      const w = await seedWorld();
      try {
        const m = await manager(w);
        const dates = await api(m, "GET", "/api/inventory/interim-dates");
        expect(dates.status).toBe(200);
        expect(dates.body.default).toBe(dates.body.max);
        const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
        expect(dates.body.max < today).toBe(true);

        const base = { store_id: w.storeId, template_id: w.templateId, kind: "interim" };
        expect((await api(m, "POST", "/api/inventory/counts", { ...base, count_date: today })).status).toBe(422);
        expect((await api(m, "POST", "/api/inventory/counts", { ...base, count_date: "2020-01-01" })).status).toBe(422);
        expect((await api(m, "POST", "/api/inventory/counts", { ...base })).status).toBe(422);

        const c = await api(m, "POST", "/api/inventory/counts", { ...base, count_date: dates.body.default });
        expect(c.status).toBe(200);
        const d = await api(m, "GET", `/api/inventory/counts/${c.body.id}`);
        expect(d.body.kind).toBe("interim");
        expect(d.body.count_date).toBe(dates.body.default);
        expect(d.body.period.slice(0, 7)).toBe(dates.body.default.slice(0, 7));
        expect(d.body.lines.length).toBe(2);
      } finally {
        await w.cleanup();
      }
    });

    it("один промежуточный на склад, дату и шаблон; другие даты и месячный за тот же месяц — отдельно", async () => {
      const w = await seedWorld();
      try {
        const m = await manager(w);
        const { body: dates } = await api(m, "GET", "/api/inventory/interim-dates");
        const base = { store_id: w.storeId, template_id: w.templateId, kind: "interim" };
        const a = await api(m, "POST", "/api/inventory/counts", { ...base, count_date: dates.max });
        const again = await api(m, "POST", "/api/inventory/counts", { ...base, count_date: dates.max });
        expect(again.body).toEqual({ id: a.body.id, existing: true });
        const other = await api(m, "POST", "/api/inventory/counts", { ...base, count_date: dates.min });
        expect(other.status).toBe(200);
        expect(other.body.id).not.toBe(a.body.id);
        const monthly = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        expect(monthly.status).toBe(200);
        expect(monthly.body.existing).toBe(false);
        const md = await api(m, "GET", `/api/inventory/counts/${monthly.body.id}`);
        expect(md.body.kind).toBe("monthly");
        expect(md.body.count_date).toBe(PERIOD);
        const list = await api(m, "GET", `/api/inventory/counts?store_id=${w.storeId}`);
        expect(list.body.filter((x: any) => x.kind === "interim").length).toBe(2);
      } finally {
        await w.cleanup();
      }
    });
  });
}
