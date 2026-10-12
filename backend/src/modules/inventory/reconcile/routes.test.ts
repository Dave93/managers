import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest || !prefixLooksLikeTest) {
  describe.skip("reconcile routes (пропущено: запускайте через bun run test:http:reconcile)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, closeTestRedis, ensureApp, withSession, sweepTestRoles } = await import("../../../../tests/helpers/http");
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { closeReconcileQueue, reconcileQueue, statusKey } = await import("./queue");

  type Session = Awaited<ReturnType<typeof withSession>>;
  const PERIOD = "2026-08-31";

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

  async function seed() {
    const storeId = randomUUID();
    const tag = randomUUID().slice(0, 6);
    await drizzleDb.insert(schema.corporation_store).values({ id: storeId, name: `Склад сверки ${tag}`, type: "STORE" });
    const candA = { id: randomUUID(), num: "100", comment: "Месяц", date: PERIOD, shortage_sum: -10, surplus_sum: 5 };
    const candB = { id: randomUUID(), num: "101", comment: "Месяц", date: PERIOD, shortage_sum: -1, surplus_sum: 0 };
    const [ready] = await drizzleDb
      .insert(schema.inventory_reconciliations)
      .values({
        store_id: storeId, period: PERIOD, status: "ready", iiko_document_id: randomUUID(), iiko_document_num: "2115",
        iiko_document_comment: "Месяц", iiko_doc_state: "posted", lines_total: 1, mismatch_ab_count: 1,
        diff_ab_sum: "-100.00", diff_ac_sum: "50.00", diff_bc_sum: "-150.00", admin_state: "submitted",
      })
      .returning({ id: schema.inventory_reconciliations.id });
    const waterId = randomUUID();
    await drizzleDb.insert(schema.inventory_reconciliation_lines).values({
      reconciliation_id: ready.id, product_id: waterId, product_name: "Вода", unit_name: "шт", group_name: "Напитки",
      admin_state: "counted", admin_qty: "20", admin_counts_n: 1, book_qty: "15", book_sum: "1500",
      iiko_correction_qty: "9", iiko_correction_sum: "900", iiko_fact_qty: "24", unit_cost: "100", cost_source: "correction",
      diff_ab_qty: "-4", diff_ab_sum: "-400", diff_ac_sum: "500",
    });
    const otherStore = randomUUID();
    await drizzleDb.insert(schema.corporation_store).values({ id: otherStore, name: `Склад выбора ${tag}`, type: "STORE" });
    const [choice] = await drizzleDb
      .insert(schema.inventory_reconciliations)
      .values({ store_id: otherStore, period: PERIOD, status: "needs_choice", iiko_candidates: [candA, candB] })
      .returning({ id: schema.inventory_reconciliations.id });
    const waitingStore = randomUUID();
    await drizzleDb.insert(schema.corporation_store).values({ id: waitingStore, name: `Склад ожидания ${tag}`, type: "STORE" });
    const [waiting] = await drizzleDb
      .insert(schema.inventory_reconciliations)
      .values({ store_id: waitingStore, period: PERIOD, status: "waiting_iiko" })
      .returning({ id: schema.inventory_reconciliations.id });

    // Пересчёт склада: отправлен, после отправки добавлена запись — правка филиала.
    const author = randomUUID();
    const [count] = await drizzleDb
      .insert(schema.inventory_counts)
      .values({ store_id: storeId, template_name: "Все товары филиала", period: PERIOD, status: "submitted", created_by: author })
      .returning({ id: schema.inventory_counts.id });
    const [line] = await drizzleDb
      .insert(schema.inventory_count_lines)
      .values({ count_id: count.id, product_id: randomUUID(), product_name: "Соль", group_name: "Склад", source: "template" })
      .returning({ id: schema.inventory_count_lines.id });
    await drizzleDb.insert(schema.inventory_count_events).values({
      count_id: count.id, type: "submitted", user_id: author, created_at: "2026-08-31T10:00:00Z",
    });
    await drizzleDb.insert(schema.inventory_count_entries).values({
      id: randomUUID(), count_id: count.id, line_id: line.id, qty: "3", created_by: author,
      client_created_at: "2026-08-31T11:00:00Z", created_at: "2026-08-31T11:00:01Z",
    });

    async function cleanup() {
      const stores = [storeId, otherStore, waitingStore];
      await drizzleDb.delete(schema.inventory_reconciliations).where(inArray(schema.inventory_reconciliations.store_id, stores));
      await drizzleDb.delete(schema.inventory_counts).where(inArray(schema.inventory_counts.store_id, stores));
      await drizzleDb.delete(schema.corporation_store).where(inArray(schema.corporation_store.id, stores));
      const job = await reconcileQueue().getJob(`reconcile-${PERIOD}`);
      await job?.remove();
    }
    return { storeId, readyId: ready.id, choiceId: choice.id, waitingId: waiting.id, candA, countId: count.id, waterId, cleanup };
  }

  const office = () => withSession({ permissions: ["inventory.count", "inventory.reconcile"] });
  const branch = () => withSession({ permissions: ["inventory.count", "inventory.manage"] });

  beforeAll(async () => {
    await ensureApp();
  }, 180000);

  afterAll(async () => {
    await reconcileQueue().obliterate({ force: true });
    await closeReconcileQueue();
    await sweepTestRoles();
    await closeTestRedis();
  });

  describe("reconcile: доступ", () => {
    it("филиал (count + manage) — 403 на всех маршрутах сверки", async () => {
      const w = await seed();
      try {
        const b = await branch();
        const calls: [string, string, unknown?][] = [
          ["GET", `/api/inventory/reconciliations?period=${PERIOD}`],
          ["GET", `/api/inventory/reconciliations/${w.readyId}`],
          ["GET", `/api/inventory/reconciliations/fetch-status?period=${PERIOD}`],
          ["POST", "/api/inventory/reconciliations/fetch", { period: PERIOD }],
          ["POST", `/api/inventory/reconciliations/${w.readyId}/refresh`, {}],
          ["POST", `/api/inventory/reconciliations/${w.choiceId}/document`, { document_id: w.candA.id }],
          ["POST", `/api/inventory/reconciliations/${w.readyId}/status`, { status: "accepted" }],
          ["POST", `/api/inventory/reconciliations/${w.readyId}/lines/${w.waterId}/mark`, { checked: true }],
          ["GET", "/api/inventory/settings/reopen-rule"],
          ["PUT", "/api/inventory/settings/reopen-rule", { rule: "office_only" }],
        ];
        for (const [m, p, body] of calls) {
          const r = await api(b, m, p, body);
          expect(`${m} ${p} ${r.status}`).toBe(`${m} ${p} 403`);
        }
      } finally {
        await w.cleanup();
      }
    });
  });

  describe("reconcile: правило возврата пересчёта филиалом", () => {
    it("по умолчанию until_iiko; офис меняет; кривое значение — 422", async () => {
      const o = await office();
      await drizzleDb.delete(schema.settings).where(eq(schema.settings.key, "inventory.reopen_rule"));
      try {
        expect((await api(o, "GET", "/api/inventory/settings/reopen-rule")).body).toEqual({ rule: "until_iiko" });
        expect((await api(o, "PUT", "/api/inventory/settings/reopen-rule", { rule: "whatever" })).status).toBe(422);
        expect((await api(o, "PUT", "/api/inventory/settings/reopen-rule", { rule: "until_accept" })).status).toBe(200);
        expect((await api(o, "PUT", "/api/inventory/settings/reopen-rule", { rule: "office_only" })).status).toBe(200);
        expect((await api(o, "GET", "/api/inventory/settings/reopen-rule")).body).toEqual({ rule: "office_only" });
        const rows = await drizzleDb.select().from(schema.settings).where(eq(schema.settings.key, "inventory.reopen_rule"));
        expect(rows.length).toBe(1);
      } finally {
        await drizzleDb.delete(schema.settings).where(eq(schema.settings.key, "inventory.reopen_rule"));
      }
    });

    it("в обзоре — число возвратов отправленного пересчёта в черновик", async () => {
      const w = await seed();
      try {
        const o = await office();
        const author = randomUUID();
        await drizzleDb.insert(schema.inventory_count_events).values([
          { count_id: w.countId, type: "reopened", user_id: author },
          { count_id: w.countId, type: "reopened", user_id: author },
        ]);
        const r = await api(o, "GET", `/api/inventory/reconciliations?period=${PERIOD}`);
        expect(r.body.find((x: any) => x.id === w.readyId).reopen_count).toBe(2);
        expect(r.body.find((x: any) => x.id === w.waitingId).reopen_count).toBe(0);
      } finally {
        await w.cleanup();
      }
    });
  });

  describe("reconcile: отметка строк «проверено»", () => {
    it("отметить и снять отметку; в деталях — кто и когда; чужой товар — 404", async () => {
      const w = await seed();
      try {
        const o = await office();
        const before = await api(o, "GET", `/api/inventory/reconciliations/${w.readyId}`);
        expect(before.body.lines[0].checked).toBe(false);
        expect(before.body.lines[0].checked_by_name).toBeNull();

        const on = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/lines/${w.waterId}/mark`, { checked: true });
        expect(on.status).toBe(200);
        const after = await api(o, "GET", `/api/inventory/reconciliations/${w.readyId}`);
        expect(after.body.lines[0].checked).toBe(true);
        expect(typeof after.body.lines[0].checked_by_name).toBe("string");
        expect(Date.parse(after.body.lines[0].checked_at)).toBeGreaterThan(0);

        const again = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/lines/${w.waterId}/mark`, { checked: true });
        expect(again.status).toBe(200);

        const off = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/lines/${w.waterId}/mark`, { checked: false });
        expect(off.status).toBe(200);
        const cleared = await api(o, "GET", `/api/inventory/reconciliations/${w.readyId}`);
        expect(cleared.body.lines[0].checked).toBe(false);

        const nf = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/lines/${randomUUID()}/mark`, { checked: true });
        expect(nf.status).toBe(404);
      } finally {
        await w.cleanup();
      }
    });
  });

  describe("reconcile: чтение", () => {
    it("список за месяц; кривой период — 422", async () => {
      const w = await seed();
      try {
        const o = await office();
        const bad = await api(o, "GET", "/api/inventory/reconciliations?period=2026-08-30");
        expect(bad.status).toBe(422);
        const r = await api(o, "GET", `/api/inventory/reconciliations?period=${PERIOD}`);
        expect(r.status).toBe(200);
        const row = r.body.find((x: any) => x.id === w.readyId);
        expect(row.store_name).toContain("Склад сверки");
        expect(row.admin_state).toBe("submitted");
        expect(row.deadline).toBeUndefined();
        expect(row.diff_ab_sum).toBe("-100.00");
      } finally {
        await w.cleanup();
      }
    });

    it("пересчёт филиала изменён после расчёта — детали показывают свежую админку (A)", async () => {
      const w = await seed();
      try {
        const o = await office();
        // расчёт был давно, пересчёт склада отправлен позже (в seed — сейчас)
        await drizzleDb
          .update(schema.inventory_reconciliations)
          .set({ calculated_at: "2026-09-01T00:00:00Z" })
          .where(eq(schema.inventory_reconciliations.id, w.readyId));
        const r = await api(o, "GET", `/api/inventory/reconciliations/${w.readyId}`);
        expect(r.status).toBe(200);
        expect(r.body.lines.map((l: any) => l.product_name).sort()).toEqual(["Вода", "Соль"]);
        const salt = r.body.lines.find((l: any) => l.product_name === "Соль");
        expect(salt.admin_state).toBe("counted");
        const water = r.body.lines.find((l: any) => l.product_name === "Вода");
        expect(water.admin_state).toBe("absent");
        expect(water.book_qty).toBe("15.0000");
      } finally {
        await w.cleanup();
      }
    });

    it("детали: строки, пересчёты, правки филиала после отправки", async () => {
      const w = await seed();
      try {
        const o = await office();
        const r = await api(o, "GET", `/api/inventory/reconciliations/${w.readyId}`);
        expect(r.status).toBe(200);
        expect(r.body.lines.length).toBe(1);
        expect(r.body.lines[0].iiko_fact_qty).toBe("24.0000");
        expect(r.body.counts).toEqual([
          { id: w.countId, template_name: "Все товары филиала", status: "submitted" },
        ]);
        expect(r.body.branch_edits).toEqual([
          expect.objectContaining({ kind: "entry_added", count_id: w.countId, product_name: "Соль", qty: "3.0000" }),
        ]);
        const nf = await api(o, "GET", `/api/inventory/reconciliations/${randomUUID()}`);
        expect(nf.status).toBe(404);
      } finally {
        await w.cleanup();
      }
    });
  });

  describe("reconcile: действия", () => {
    it("статусы: без комментария «на разбор» — 422; ready → in_review → accepted фиксирует итоги; waiting — 409", async () => {
      const w = await seed();
      try {
        const o = await office();
        const noComment = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/status`, { status: "in_review" });
        expect(noComment.status).toBe(422);
        expect(noComment.body.error).toBe("comment_required");
        const review = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/status`, { status: "in_review", comment: "Проверить воду" });
        expect(review.status).toBe(200);
        const accept = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/status`, { status: "accepted" });
        expect(accept.status).toBe(200);
        const [row] = await drizzleDb.select().from(schema.inventory_reconciliations).where(eq(schema.inventory_reconciliations.id, w.readyId));
        expect(row.status).toBe("accepted");
        expect(row.review_comment).toBe("Проверить воду");
        expect(row.accepted_totals).toEqual({ lines_total: 1, mismatch_ab_count: 1, diff_ab_sum: "-100.00", diff_ac_sum: "50.00", diff_bc_sum: "-150.00" });
        expect(row.changed_after_accept).toBe(false);

        const waiting = await api(o, "POST", `/api/inventory/reconciliations/${w.waitingId}/status`, { status: "accepted" });
        expect(waiting.status).toBe(409);
        expect(waiting.body.error).toBe("not_ready");
      } finally {
        await w.cleanup();
      }
    });

    it("выбор документа: не из кандидатов — 422; из кандидатов — сохраняется и ставится загрузка склада", async () => {
      const w = await seed();
      try {
        const o = await office();
        const bad = await api(o, "POST", `/api/inventory/reconciliations/${w.choiceId}/document`, { document_id: randomUUID() });
        expect(bad.status).toBe(422);
        expect(bad.body.error).toBe("not_a_candidate");
        const ok = await api(o, "POST", `/api/inventory/reconciliations/${w.choiceId}/document`, { document_id: w.candA.id });
        expect(ok.status).toBe(200);
        expect(ok.body.state).toBe("queued");
        const [row] = await drizzleDb.select().from(schema.inventory_reconciliations).where(eq(schema.inventory_reconciliations.id, w.choiceId));
        expect(row.iiko_document_id).toBe(w.candA.id);
      } finally {
        await w.cleanup();
      }
    });

    it("выбор документа во время загрузки месяца — 409, выбор не сохраняется", async () => {
      const w = await seed();
      try {
        const o = await office();
        expect((await api(o, "POST", "/api/inventory/reconciliations/fetch", { period: PERIOD })).status).toBe(200);
        const r = await api(o, "POST", `/api/inventory/reconciliations/${w.choiceId}/document`, { document_id: w.candA.id });
        expect(r.status).toBe(409);
        const [row] = await drizzleDb.select().from(schema.inventory_reconciliations).where(eq(schema.inventory_reconciliations.id, w.choiceId));
        expect(row.iiko_document_id).toBeNull();
      } finally {
        await w.cleanup();
      }
    });

    it("зависший статус без задачи в очереди (воркер упал) — failed/stale, загрузку можно запустить снова", async () => {
      const o = await office();
      const Redis = (await import("ioredis")).default;
      const r = new Redis({ host: process.env.REDIS_HOST ?? "localhost", port: parseInt(process.env.REDIS_PORT ?? "6379") });
      const period = "2026-07-31";
      try {
        await r.set(
          statusKey(period),
          JSON.stringify({ period, store_id: null, state: "stage1", started_at: "2026-08-01T00:00:00Z", stage1_done_at: null, finished_at: null, received: [], missing: [], error: null }),
          "EX",
          60
        );
        const st = await api(o, "GET", `/api/inventory/reconciliations/fetch-status?period=${period}`);
        expect(st.status).toBe(200);
        expect(st.body.state).toBe("failed");
        expect(st.body.error).toBe("stale");
      } finally {
        await r.del(statusKey(period));
        r.disconnect();
      }
    });

    it("загрузка: вторая во время первой — 409 already_running; статус — queued", async () => {
      const w = await seed();
      try {
        const o = await office();
        const first = await api(o, "POST", "/api/inventory/reconciliations/fetch", { period: PERIOD });
        expect(first.status).toBe(200);
        expect(first.body.state).toBe("queued");
        const second = await api(o, "POST", "/api/inventory/reconciliations/fetch", { period: PERIOD });
        expect(second.status).toBe(409);
        expect(second.body.error).toBe("already_running");
        const one = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/refresh`, {});
        expect(one.status).toBe(409);
        const st = await api(o, "GET", `/api/inventory/reconciliations/fetch-status?period=${PERIOD}`);
        expect(st.status).toBe(200);
        expect(st.body.state).toBe("queued");
      } finally {
        await w.cleanup();
      }
    });
  });
}
