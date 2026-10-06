import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в inventory/routes.test.ts: голый `bun test` файл пропускает.
// Пул базы не закрываем: routes.test.ts идёт в том же процессе.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;

if (!dbLooksLikeTest) {
  describe.skip("reconcile service (пропущено: запускайте через bun run test:http:reconcile)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { eq, inArray, and } = await import("drizzle-orm");
  const { runReconcile, computeScope } = await import("./service");
  type IikoClient = import("./iiko-client").IikoClient;
  type IikoDoc = import("./pure").IikoDoc;
  type Correction = import("./pure").Correction;

  const PERIOD = "2026-08-31";
  const PREV = "2026-07-31";

  async function seed() {
    const org = randomUUID();
    const A = randomUUID(); // «Месяц» за период
    const B = randomUUID(); // «Месяц» только в прошлом месяце
    const C = randomUUID(); // документ без «Месяц», раньше «Месяц» не было — вне области
    const D = randomUUID(); // только пересчёт в админке
    const [p1, p2, p3] = [randomUUID(), randomUUID(), randomUUID()];
    const unit = randomUUID();
    const user = randomUUID();
    const tag = randomUUID().slice(0, 6);
    await drizzleDb.insert(schema.corporation_store).values(
      [A, B, C, D].map((id, i) => ({ id, name: `Склад ${"ABCD"[i]} ${tag}`, organization_id: org, type: "STORE" }))
    );
    await drizzleDb.insert(schema.measure_unit).values({ id: unit, name: "шт", code: `sht-${tag}` });
    await drizzleDb.insert(schema.nomenclature_element).values([
      { id: p1, name: `Вода ${tag}`, type: "GOODS", mainUnit: unit, deleted: false },
      { id: p2, name: `Соль ${tag}`, type: "GOODS", mainUnit: unit, deleted: false },
      { id: p3, name: `Стаканы ${tag}`, type: "GOODS", mainUnit: unit, deleted: false },
    ]);

    // Отправленный пересчёт на складе A: p1 = 20, p2 «не считали».
    async function submittedCount(store: string, qty: Record<string, number | null>) {
      const [c] = await drizzleDb
        .insert(schema.inventory_counts)
        .values({ store_id: store, organization_id: org, template_name: "Все товары филиала", period: PERIOD, status: "submitted", created_by: user })
        .returning({ id: schema.inventory_counts.id });
      for (const [pid, q] of Object.entries(qty)) {
        await drizzleDb.insert(schema.inventory_count_lines).values({
          count_id: c.id, product_id: pid, product_name: pid === p1 ? `Вода ${tag}` : `Соль ${tag}`, unit_name: "шт",
          group_name: "Склад", source: "template", skipped: q === null, fact_qty: q === null ? null : String(q),
        });
      }
      return c.id;
    }
    await submittedCount(A, { [p1]: 20, [p2]: null });
    await submittedCount(D, { [p1]: 5 });

    const doc = (id: string, store: string, num: string, comment: string | null): IikoDoc => ({
      id, num, comment, store_id: store, date: PERIOD, shortage_sum: -100, surplus_sum: 50,
    });
    const docA = doc(randomUUID(), A, `9${tag}`, "Месяц");
    const docC = doc(randomUUID(), C, `8${tag}`, null);
    const prevB = { ...doc(randomUUID(), B, `7${tag}`, "Месяц"), date: PREV };

    const state = {
      docs: { [PERIOD]: [docA, docC], [PREV]: [prevB] } as Record<string, IikoDoc[]>,
      corrections: [
        { store_id: A, doc_num: docA.num, at: `${PERIOD}T23:59:00`, product_id: p1, product_name: `Вода ${tag}`, qty: 9, sum: 900 },
        { store_id: A, doc_num: docA.num, at: `${PERIOD}T23:59:00`, product_id: p3, product_name: `Стаканы ${tag}`, qty: 43, sum: 0 },
      ] as Correction[],
      balance: {
        [A]: [{ product_id: p1, amount: 15, sum: 1500 }, { product_id: p3, amount: -43, sum: 0 }],
        [D]: [{ product_id: p1, amount: 7, sum: 700 }],
      } as Record<string, { product_id: string; amount: number; sum: number }[]>,
      balanceCalls: [] as { store: string; at: string }[],
    };

    const iiko: IikoClient = {
      async inventoryDocs(date) {
        return state.docs[date] ?? [];
      },
      async corrections() {
        return state.corrections;
      },
      async balance(store, at) {
        state.balanceCalls.push({ store, at });
        return state.balance[store] ?? [];
      },
    };

    async function recon(store: string) {
      const [r] = await drizzleDb
        .select()
        .from(schema.inventory_reconciliations)
        .where(and(eq(schema.inventory_reconciliations.store_id, store), eq(schema.inventory_reconciliations.period, PERIOD)));
      return r;
    }
    async function lines(reconId: string) {
      return drizzleDb.select().from(schema.inventory_reconciliation_lines).where(eq(schema.inventory_reconciliation_lines.reconciliation_id, reconId));
    }
    async function events(reconId: string) {
      return drizzleDb.select().from(schema.inventory_reconciliation_events).where(eq(schema.inventory_reconciliation_events.reconciliation_id, reconId));
    }

    async function cleanup() {
      const stores = [A, B, C, D];
      await drizzleDb.delete(schema.inventory_reconciliations).where(inArray(schema.inventory_reconciliations.store_id, stores));
      await drizzleDb.delete(schema.inventory_counts).where(inArray(schema.inventory_counts.store_id, stores));
      await drizzleDb.delete(schema.nomenclature_element).where(inArray(schema.nomenclature_element.id, [p1, p2, p3]));
      await drizzleDb.delete(schema.measure_unit).where(eq(schema.measure_unit.id, unit));
      await drizzleDb.delete(schema.corporation_store).where(inArray(schema.corporation_store.id, stores));
    }

    return { A, B, C, D, p1, p2, p3, docA, docC, state, iiko, recon, lines, events, cleanup };
  }

  describe("reconcile: область и этапы", () => {
    it("область: «Месяц» за период и за 3 прошлых месяца + пересчёты админки; без «Месяц» — вне области", async () => {
      const w = await seed();
      try {
        const { scope } = await computeScope(drizzleDb, w.iiko, { period: PERIOD });
        expect(scope).toContain(w.A);
        expect(scope).toContain(w.B);
        expect(scope).toContain(w.D);
        expect(scope).not.toContain(w.C);
      } finally {
        await w.cleanup();
      }
    });

    it("склад с документом: ready, корректировки сохранены, учёт за минуту до документа, строки и итоги", async () => {
      const w = await seed();
      try {
        const res = await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        expect(res.received).toContainEqual({ store_id: w.A, num: w.docA.num });
        expect(res.missing).toContain(w.B);

        const a = await w.recon(w.A);
        expect(a.status).toBe("ready");
        expect(a.iiko_document_num).toBe(w.docA.num);
        expect(a.iiko_doc_state).toBe("posted");
        expect(a.admin_state).toBe("submitted");
        expect(w.state.balanceCalls).toContainEqual({ store: w.A, at: `${PERIOD}T23:58:00` });

        const ls = await w.lines(a.id);
        const p1 = ls.find((l) => l.product_id === w.p1)!;
        expect(Number(p1.book_qty)).toBe(15);
        expect(Number(p1.iiko_fact_qty)).toBe(24);
        expect(Number(p1.admin_qty)).toBe(20);
        expect(Number(p1.diff_ab_qty)).toBe(-4);
        const p2 = ls.find((l) => l.product_id === w.p2)!;
        expect(p2.admin_state).toBe("skipped");
        const p3 = ls.find((l) => l.product_id === w.p3)!;
        expect(p3.admin_state).toBe("absent");
        expect(Number(p3.iiko_fact_qty)).toBe(0);
        expect(a.lines_total).toBe(3);
        expect(a.mismatch_ab_count).toBe(1);
        expect(Number(a.diff_bc_sum)).toBe(900);

        const ev = await w.events(a.id);
        expect(ev.map((e) => e.type).sort()).toEqual(["calculated", "fetched"]);
      } finally {
        await w.cleanup();
      }
    });

    it("склад без документа: waiting_iiko, A − C считается, B пусто", async () => {
      const w = await seed();
      try {
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        const d = await w.recon(w.D);
        expect(d.status).toBe("waiting_iiko");
        expect(d.diff_bc_sum).toBeNull();
        const [p1] = await w.lines(d.id);
        expect(p1.iiko_fact_qty).toBeNull();
        expect(Number(p1.diff_ac_sum)).toBe(-200); // (5 − 7) × 100
        expect(w.state.balanceCalls).toContainEqual({ store: w.D, at: `${PERIOD}T23:58:00` });
      } finally {
        await w.cleanup();
      }
    });

    it("повторная загрузка без изменений не пишет событий; изменение корректировки — fetched со списком и changed_after_accept", async () => {
      const w = await seed();
      try {
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        const a0 = await w.recon(w.A);
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        expect((await w.events(a0.id)).length).toBe(2);

        await drizzleDb
          .update(schema.inventory_reconciliations)
          .set({ status: "accepted", accepted_totals: { lines_total: a0.lines_total, mismatch_ab_count: a0.mismatch_ab_count, diff_ab_sum: a0.diff_ab_sum, diff_ac_sum: a0.diff_ac_sum, diff_bc_sum: a0.diff_bc_sum } })
          .where(eq(schema.inventory_reconciliations.id, a0.id));
        w.state.corrections[0] = { ...w.state.corrections[0], qty: 5, sum: 500 };
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });

        const a1 = await w.recon(w.A);
        expect(a1.status).toBe("accepted");
        expect(a1.changed_after_accept).toBe(true);
        const fetched = (await w.events(a1.id)).filter((e) => e.type === "fetched");
        expect(fetched.length).toBe(2);
        const last = fetched.map((e) => e.payload as any).find((p) => p.changed?.length);
        expect(last.changed).toEqual([{ product_id: w.p1, product_name: expect.any(String), qty_before: 9, qty_after: 5 }]);
      } finally {
        await w.cleanup();
      }
    });

    it("документ пропал (распровели): строки и корректировки остаются, doc_missing один раз", async () => {
      const w = await seed();
      try {
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        const a0 = await w.recon(w.A);
        const before = await w.lines(a0.id);

        w.state.docs[PERIOD] = [w.docC];
        w.state.corrections = [];
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });

        const a1 = await w.recon(w.A);
        expect(a1.iiko_doc_state).toBe("unposted_after_fetch");
        expect(a1.iiko_document_num).toBe(w.docA.num);
        expect(a1.status).toBe("ready");
        const after = await w.lines(a1.id);
        expect(after.length).toBe(before.length);
        expect(Number(after.find((l) => l.product_id === w.p1)!.iiko_fact_qty)).toBe(24);
        const missing = (await w.events(a1.id)).filter((e) => e.type === "doc_missing");
        expect(missing.length).toBe(1);
      } finally {
        await w.cleanup();
      }
    });

    it("выбор офиса без загрузки — не «загружен»: документа нет — B нет, не «распроведён»", async () => {
      const w = await seed();
      try {
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        const d0 = await w.recon(w.D);
        await drizzleDb
          .update(schema.inventory_reconciliations)
          .set({ iiko_document_id: randomUUID() })
          .where(eq(schema.inventory_reconciliations.id, d0.id));
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        const d1 = await w.recon(w.D);
        expect(d1.iiko_doc_state).toBeNull();
        expect(d1.status).toBe("waiting_iiko");
        expect(d1.diff_bc_sum).toBeNull();
        const [p1] = await w.lines(d1.id);
        expect(p1.iiko_fact_qty).toBeNull();
        expect((await w.events(d1.id)).some((e) => e.type === "doc_missing")).toBe(false);
      } finally {
        await w.cleanup();
      }
    });

    it("два «Месяц» — needs_choice с кандидатами; выбор офиса сохраняется при следующей загрузке", async () => {
      const w = await seed();
      try {
        const second = { ...w.docA, id: randomUUID(), num: `${w.docA.num}0` };
        w.state.docs[PERIOD] = [w.docA, second, w.docC];
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        const a0 = await w.recon(w.A);
        expect(a0.status).toBe("needs_choice");
        expect((a0.iiko_candidates as any[]).map((c) => c.id).sort()).toEqual([w.docA.id, second.id].sort());

        await drizzleDb
          .update(schema.inventory_reconciliations)
          .set({ iiko_document_id: w.docA.id })
          .where(eq(schema.inventory_reconciliations.id, a0.id));
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD, storeId: w.A });
        const a1 = await w.recon(w.A);
        expect(a1.status).toBe("ready");
        expect(a1.iiko_document_num).toBe(w.docA.num);
        expect(a1.iiko_candidates).toBeNull();
      } finally {
        await w.cleanup();
      }
    });
  });
}
