import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в reviews.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/branch (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { addAttendance, addCooking, addOrder, addReconciliation, addSanitaryRow, api, cleanupKpi, makeTerminal, setNow, setup } = await import("./fixtures");
  const { credentials, inventory_reconciliations, kpi_branch_scores, kpi_periods, kpi_revenue_plans } = await import("backend/drizzle/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const { SEED_BRANCH_INDICATORS } = await import("../seed-data");
  const { revenueByGroups, sumOver, terminalLinks } = await import("../branch-facts");
  type BranchBreakdown = import("../types").BranchBreakdown;
  type BranchNetwork = import("../types").BranchNetwork;

  const P = "2025-06-01";

  describe("kpi: балл филиала", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      setNow("2025-07-15T10:00:00+05:00");
    }, 30_000);
    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    const hr = () => withSession({ permissions: ["kpi.manage"] });
    const compute = (s: Awaited<ReturnType<typeof hr>>) => api(s, "POST", "/api/kpi/branch/compute", { period: P });
    const detail = (s: Awaited<ReturnType<typeof hr>>, id: string) => api(s, "GET", `/api/kpi/branch/${id}?period=${P}`);

    async function controlTerminal() {
      const t = await makeTerminal(db);
      await db.insert(kpi_revenue_plans).values({ terminal_id: t.id, period: P, amount: "1000000", updated_by: randomUUID() });
      // 10 заказов зала на 1 030 000; девять в норматив 8 минут, один — 10 минут
      for (let i = 0; i < 10; i++) {
        const id = await addOrder(db, { iiko_id: t.iiko_id!, day: "2025-06-10", sum: i === 0 ? 130_000 : 100_000 });
        await addCooking(db, { iiko_id: t.iiko_id!, order_id: id, day: "2025-06-10", waits: [i === 9 ? 600 : 400] });
      }
      // живая сумма разошлась после «принято»: берётся снимок
      await addReconciliation(db, { store_id: t.store_id!, period: P, status: "accepted", accepted_diff_bc: "-6180.00", live_diff_bc: "-50000.00" });
      await addSanitaryRow(db, { terminal_id: t.id, period: P, pct: 93 });
      await addAttendance(db, { terminal_id: t.id, day: "2025-06-05", on_time: 47, late: 3, absent: 0 });
      return t;
    }

    it("контрольный пример: 103 / 0,6 / 90 / 93 / 94 → 95,79, ступень 100 %", async () => {
      const t = await controlTerminal();
      const c = await compute(await hr());
      expect(c.status).toBe(200);
      expect(c.body.version).toBe(1);
      const r = (await detail(await hr(), t.id)).body as BranchBreakdown;
      expect(r.indicators.map((i) => [i.code, i.fact, i.points, i.weighted, i.data_status])).toEqual([
        ["sales", 103, 104, 31.2, "ok"], ["food_cost", 0.6, 90, 18, "ok"], ["service", 90, 91.67, 18.34, "ok"],
        ["sanitary", 93, 93.33, 14, "ok"], ["discipline", 94, 95, 14.25, "ok"],
      ]);
      expect([r.score, r.tier_pct, r.next_tier]).toEqual([95.79, 100, { tier_pct: 120, points_needed: 9.2 }]);
      expect(r.indicators[0].details).toEqual({ revenue: 1030000, plan: 1000000 });
      expect(r.indicators[1].details).toEqual({ revenue: 1030000, overspend: 6180, stores_total: 1, stores_reconciled: 1 });
      // посчитано 15 июля за июнь — версия окончательная
      expect(r.preliminary).toBe(false);
      const net = (await api(await hr(), "GET", `/api/kpi/branch?period=${P}`)).body as BranchNetwork;
      expect(net.preliminary).toBe(false);
      expect(net.columns).toEqual(["sales", "food_cost", "service", "sanitary", "discipline"]);
      expect(net.rows.find((x) => x.terminal_id === t.id)).toMatchObject({ score: 95.79, tier_pct: 100, cells: { food_cost: { fact: 0.6, points: 90, weight: 20, data_status: "ok" } } });
    });

    it("нет данных — не ноль: веса пересчитываются, пустой филиал в версию не попадает", async () => {
      const b = await makeTerminal(db);
      await addOrder(db, { iiko_id: b.iiko_id!, day: "2025-06-03", sum: 500_000 }); // выручка без плана и без замеров кухни
      await addReconciliation(db, { store_id: b.store_id!, period: P, status: "in_review", accepted_diff_bc: null });
      await addAttendance(db, { terminal_id: b.id, day: "2025-06-03", on_time: 19, late: 1, absent: 0 });
      const empty = await makeTerminal(db);
      await compute(await hr());
      const r = (await detail(await hr(), b.id)).body as BranchBreakdown;
      expect(r.indicators.map((i) => [i.code, i.data_status, i.reason])).toEqual([
        ["sales", "no_data", "no_plan"], ["food_cost", "no_data", "not_accepted"], ["service", "no_data", "no_cooking_rows"],
        ["sanitary", "no_data", "no_checks"], ["discipline", "ok", null],
      ]);
      expect([r.score, r.tier_pct]).toEqual([100, 100]);
      expect(r.indicators[1].details).toEqual({ stores_total: 1, stores_reconciled: 0 });
      const net = (await api(await hr(), "GET", `/api/kpi/branch?period=${P}`)).body as BranchNetwork;
      expect(net.rows.map((x) => x.terminal_id)).not.toContain(empty.id);
      // покрытие: в ячейках есть веса, данные только у дисциплины (15 из 100)
      const cells = net.rows.find((x) => x.terminal_id === b.id)!.cells;
      expect(net.columns.map((k) => [k, cells[k]!.weight, cells[k]!.data_status])).toEqual([
        ["sales", 30, "no_data"], ["food_cost", 20, "no_data"], ["service", 20, "no_data"], ["sanitary", 15, "no_data"], ["discipline", 15, "ok"],
      ]);
      const e = (await detail(await hr(), empty.id)).body as BranchBreakdown;
      expect(e.score).toBeNull();
      expect(e.indicators.every((i) => i.data_status === "no_data" && i.reason === "not_computed")).toBe(true);
    });

    it("себестоимость: склад без строки сверки — no_reconciliation, в деталях принято 0 из 1", async () => {
      const t = await makeTerminal(db);
      await addAttendance(db, { terminal_id: t.id, day: "2025-06-06", on_time: 1, late: 0, absent: 0 });
      await compute(await hr());
      const fc = (await detail(await hr(), t.id)).body.indicators.find((i: any) => i.code === "food_cost");
      expect(fc).toMatchObject({ data_status: "no_data", reason: "no_reconciliation", details: { stores_total: 1, stores_reconciled: 0 } });
    });

    it("кривой ключ iiko в credentials — расчёт 200, продажи без данных", async () => {
      const d = await makeTerminal(db, { iiko_id: "not-a-uuid" });
      await db.insert(kpi_revenue_plans).values({ terminal_id: d.id, period: P, amount: "1000000", updated_by: randomUUID() });
      await addAttendance(db, { terminal_id: d.id, day: "2025-06-04", on_time: 10, late: 0, absent: 0 });
      expect((await compute(await hr())).status).toBe(200);
      const r = (await detail(await hr(), d.id)).body as BranchBreakdown;
      expect(r.indicators.find((i) => i.code === "sales")).toMatchObject({ data_status: "no_data", reason: "no_iiko_link" });
    });

    it("сервис: нормативы зала и доставки, исключения", async () => {
      const t = await makeTerminal(db);
      const order = async (type: string | null, waits: number[], inOrders = true) => {
        const id = inOrders ? await addOrder(db, { iiko_id: t.iiko_id!, day: "2025-06-12", sum: 1000, service_type: type }) : randomUUID();
        await addCooking(db, { iiko_id: t.iiko_id!, order_id: id, day: "2025-06-12", waits });
      };
      await order("COMMON", [480]);                  // ровно 8 минут — в норматив
      await order("COMMON", [481]);
      await order("DELIVERY_PICKUP", [700]);         // самовывоз — норматив доставки
      await order("DELIVERY_BY_COURIER", [721]);
      await order(null, [500]);                      // тип не известен — норматив зала
      await order("COMMON", [0, 300]);               // ноль не замер, ожидание 300
      await order("COMMON", [0]);                    // не замерено — не считается
      await order("COMMON", [14401]);                // мусор — не считается
      await order("COMMON", [100], false);           // нет в orders — не считается
      await compute(await hr());
      const s = (await detail(await hr(), t.id)).body.indicators.find((i: any) => i.code === "service");
      expect(s).toMatchObject({ fact: 50, details: { orders: 6, on_time: 3, hall_min: 8, delivery_min: 12 } });
    });

    it("себестоимость: склады и снимок", async () => {
      // одна смена Workly: без показателя с данными филиал в версию не попадёт
      const present = (id: string) => addAttendance(db, { terminal_id: id, day: "2025-06-02", on_time: 1, late: 0, absent: 0 });
      const two = await makeTerminal(db);
      await present(two.id);
      const extra = randomUUID();
      await db.insert(credentials).values({ key: extra, model: "terminals", type: "iiko_store_id", model_id: two.id });
      await addOrder(db, { iiko_id: two.iiko_id!, day: "2025-06-02", sum: 100_000 });
      await addReconciliation(db, { store_id: two.store_id!, period: P, status: "accepted", accepted_diff_bc: "-1000.00" });
      await addReconciliation(db, { store_id: extra, period: P, status: "ready", accepted_diff_bc: null });
      const surplus = await makeTerminal(db);
      await addOrder(db, { iiko_id: surplus.iiko_id!, day: "2025-06-02", sum: 100_000 });
      await addReconciliation(db, { store_id: surplus.store_id!, period: P, status: "accepted", accepted_diff_bc: "500.00" });
      const noDoc = await makeTerminal(db);
      await present(noDoc.id);
      await addOrder(db, { iiko_id: noDoc.iiko_id!, day: "2025-06-02", sum: 100_000 });
      await addReconciliation(db, { store_id: noDoc.store_id!, period: P, status: "accepted", accepted_diff_bc: null });
      const noRevenue = await makeTerminal(db);
      await present(noRevenue.id);
      await addReconciliation(db, { store_id: noRevenue.store_id!, period: P, status: "accepted", accepted_diff_bc: "-100.00" });
      await compute(await hr());
      const fc = async (id: string) => (await detail(await hr(), id)).body.indicators.find((i: any) => i.code === "food_cost");
      expect(await fc(two.id)).toMatchObject({ data_status: "no_data", reason: "not_accepted" });
      expect(await fc(surplus.id)).toMatchObject({ fact: 0, points: 120 });
      expect(await fc(noDoc.id)).toMatchObject({ data_status: "no_data", reason: "no_iiko_document" });
      expect(await fc(noRevenue.id)).toMatchObject({ data_status: "no_data", reason: "no_orders" });
    });

    it("себестоимость: принят каждый привязанный склад, склад без строки сверки — не принят", async () => {
      const present = (id: string) => addAttendance(db, { terminal_id: id, day: "2025-06-02", on_time: 1, late: 0, absent: 0 });
      const withTwoStores = async (second: "none" | "accepted") => {
        const t = await makeTerminal(db);
        await present(t.id);
        const extra = randomUUID();
        await db.insert(credentials).values({ key: extra, model: "terminals", type: "iiko_store_id", model_id: t.id });
        await addOrder(db, { iiko_id: t.iiko_id!, day: "2025-06-02", sum: 100_000 });
        await addReconciliation(db, { store_id: t.store_id!, period: P, status: "accepted", accepted_diff_bc: "-1000.00" });
        if (second === "accepted") await addReconciliation(db, { store_id: extra, period: P, status: "accepted", accepted_diff_bc: "-500.00" });
        return t;
      };
      const partial = await withTwoStores("none");
      const both = await withTwoStores("accepted");
      await compute(await hr());
      const fc = async (id: string) => (await detail(await hr(), id)).body.indicators.find((i: any) => i.code === "food_cost");
      expect(await fc(partial.id)).toMatchObject({ data_status: "no_data", reason: "not_accepted", details: { stores_total: 2, stores_reconciled: 1 } });
      expect(await fc(both.id)).toMatchObject({ data_status: "ok", fact: 1.5, details: { overspend: 1500, stores_total: 2, stores_reconciled: 2 } });
    });

    it("общий ключ iiko: оба филиала в расчёте показывают полную выручку", async () => {
      const shared = randomUUID();
      const a = await makeTerminal(db, { iiko_id: shared });
      const b = await makeTerminal(db, { iiko_id: shared });
      for (const t of [a, b]) await db.insert(kpi_revenue_plans).values({ terminal_id: t.id, period: P, amount: "100000", updated_by: randomUUID() });
      await addOrder(db, { iiko_id: shared, day: "2025-06-09", sum: 80_000 });
      expect((await compute(await hr())).status).toBe(200);
      for (const t of [a, b]) {
        const r = (await detail(await hr(), t.id)).body as BranchBreakdown;
        expect(r.indicators.find((i) => i.code === "sales")).toMatchObject({ fact: 80, details: { revenue: 80000, plan: 100000 } });
      }
    });

    it("границы месяца в трёх базах времени", async () => {
      const t = await makeTerminal(db);
      await db.insert(kpi_revenue_plans).values({ terminal_id: t.id, period: P, amount: "100000", updated_by: randomUUID() });
      await addOrder(db, { iiko_id: t.iiko_id!, day: "2025-05-31", sum: 7_000 });
      await addOrder(db, { iiko_id: t.iiko_id!, day: "2025-06-01", sum: 50_000 });
      await addOrder(db, { iiko_id: t.iiko_id!, day: "2025-06-30", sum: 40_000 });
      await addOrder(db, { iiko_id: t.iiko_id!, day: "2025-07-01", sum: 9_000 });
      await addAttendance(db, { terminal_id: t.id, day: "2025-06-30", on_time: 1, late: 0, absent: 0 });
      await addAttendance(db, { terminal_id: t.id, day: "2025-07-01", on_time: 0, late: 0, absent: 5 });
      await compute(await hr());
      const r = (await detail(await hr(), t.id)).body as BranchBreakdown;
      expect(r.indicators.find((i) => i.code === "sales")!.details.revenue).toBe(90000);
      expect(r.indicators.find((i) => i.code === "discipline")).toMatchObject({ fact: 100, details: { days: 1 } });
    });

    it("общий ключ iiko у двух филиалов: каждому целиком, сеть — по различным группам", async () => {
      const shared = randomUUID();
      const a = await makeTerminal(db, { iiko_id: shared });
      const b = await makeTerminal(db, { iiko_id: shared });
      const own = await makeTerminal(db);
      await addOrder(db, { iiko_id: shared, day: "2025-06-08", sum: 80_000 });
      await addOrder(db, { iiko_id: own.iiko_id!, day: "2025-06-08", sum: 20_000 });
      // model_id в другом регистре находится при поиске по ids
      const upper = await makeTerminal(db, { iiko_id: null });
      await db.insert(credentials).values({ key: randomUUID(), model: "terminals", type: "iiko_id", model_id: upper.id.toUpperCase() });
      expect((await terminalLinks(db, [upper.id])).get(upper.id)?.iiko.length).toBe(1);
      const links = await terminalLinks(db, [a.id, b.id, own.id]);
      const by = await revenueByGroups(db, [...links.values()].flatMap((l) => l.iiko), P);
      expect(sumOver(links.get(a.id)!.iiko, by)).toBe(80_000);
      expect(sumOver(links.get(b.id)!.iiko, by)).toBe(80_000);
      // повтор ключа в списке не удваивает факт филиала
      expect(sumOver([shared, shared], by)).toBe(80_000);
      // сеть: сумма по различным группам, а не по филиалам (80 000 + 20 000, не 180 000)
      const distinct = [...new Set([...links.values()].flatMap((l) => l.iiko))];
      expect(sumOver(distinct, by)).toBe(100_000);
    });

    it("гонка расчёта и версии: две разные версии, старые хранятся, пороги — снимок", async () => {
      const t = await controlTerminal();
      const s = await hr();
      const before = (await api(s, "GET", `/api/kpi/branch?period=${P}`)).body.version ?? 0;
      const rs = await Promise.all([compute(s), compute(s)]);
      expect(rs.map((x) => x.status)).toEqual([200, 200]);
      expect(rs.map((x) => x.body.version).sort((p, q) => p - q)).toEqual([before + 1, before + 2]);
      const ind = SEED_BRANCH_INDICATORS.map((i) => ({ code: i.code, weight: i.code === "sales" ? 45 : i.code === "sanitary" ? 0 : i.weight, floor: i.floor, target: i.target, max: i.max, active: i.code !== "sanitary" }));
      expect((await api(s, "PUT", "/api/kpi/branch-indicators", { indicators: ind })).status).toBe(200);
      expect((await detail(s, t.id)).body.indicators[0].weight).toBe(30);   // посчитанная версия хранит старый вес
      // колонки сети — из строк версии, а не из текущих активных показателей
      expect(((await api(s, "GET", `/api/kpi/branch?period=${P}`)).body as BranchNetwork).columns).toEqual(["sales", "food_cost", "service", "sanitary", "discipline"]);
      await compute(s);
      const after = (await detail(s, t.id)).body as BranchBreakdown;
      expect(after.indicators.map((i) => i.code)).not.toContain("sanitary");
      expect(((await api(s, "GET", `/api/kpi/branch?period=${P}`)).body as BranchNetwork).columns).toEqual(["sales", "food_cost", "service", "discipline"]);
      expect(after.indicators[0].weight).toBe(45);
      const versions = await db.selectDistinct({ v: kpi_branch_scores.version }).from(kpi_branch_scores).where(and(eq(kpi_branch_scores.period, P), eq(kpi_branch_scores.terminal_id, t.id)));
      expect(versions.length).toBeGreaterThanOrEqual(3);
      await cleanupKpi(db);
    });

    it("права и видимость", async () => {
      const a = await controlTerminal();
      const b = await controlTerminal();
      const v = await withSession({ permissions: ["kpi.view"], terminals: [a.id] });
      expect((await compute(v)).status).toBe(403);
      const ap = await withSession({ permissions: ["kpi.approve"] });
      expect((await compute(ap)).status).toBe(200);
      const net = (await api(v, "GET", `/api/kpi/branch?period=${P}`)).body as BranchNetwork;
      expect(net.rows.map((x) => x.terminal_id)).toEqual([a.id]);
      expect((await detail(v, b.id)).body).toEqual({ error: "out_of_scope" });
      expect((await detail(v, "nope")).status).toBe(404);
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      expect((await api(ev, "GET", `/api/kpi/branch?period=${P}`)).status).toBe(403);
      expect((await api(await hr(), "POST", "/api/kpi/branch/compute", { period: "2025-08-01" })).body).toEqual({ error: "future_period" });
      expect((await api(await hr(), "POST", "/api/kpi/branch/compute", { period: "2025-07-01" })).status).toBe(200);
    });

    it("текущий месяц — версия предварительная", async () => {
      const t = await makeTerminal(db);
      await addAttendance(db, { terminal_id: t.id, day: "2025-07-03", on_time: 1, late: 0, absent: 0 });
      const s = await hr();
      expect((await api(s, "POST", "/api/kpi/branch/compute", { period: "2025-07-01" })).status).toBe(200);
      expect((await api(s, "GET", "/api/kpi/branch?period=2025-07-01")).body).toMatchObject({ preliminary: true });
      expect((await api(s, "GET", `/api/kpi/branch/${t.id}?period=2025-07-01`)).body).toMatchObject({ preliminary: true });
      // расчёта нет — и пометки нет
      expect((await api(s, "GET", "/api/kpi/branch?period=2025-03-01")).body).toMatchObject({ version: null, preliminary: false });
      expect((await api(s, "GET", `/api/kpi/branch/${t.id}?period=2025-03-01`)).body).toMatchObject({ version: null, preliminary: false });
    });

    it("пометка «есть новые данные»: ввод после расчёта включает её, ввод до расчёта, пересчёт и закрытый месяц — нет", async () => {
      // Часы базы, без подмены: created_at ставит база, и расчёт метит себя по тем же часам
      setNow(null);
      try {
        const Q = "2025-02-01";
        const t = await makeTerminal(db);
        const other = await makeTerminal(db);
        // весь ввод заведён до расчёта, без задних чисел и поддельных часов
        await addAttendance(db, { terminal_id: t.id, day: "2025-02-03", on_time: 1, late: 0, absent: 0 });
        await addSanitaryRow(db, { terminal_id: t.id, period: Q, pct: 70 });
        const s = await hr();
        const scoped = await withSession({ permissions: ["kpi.view"], terminals: [t.id] });
        const otherView = await withSession({ permissions: ["kpi.view"], terminals: [other.id] });
        const flags = async () => [
          (await api(s, "GET", `/api/kpi/branch/${t.id}?period=${Q}`)).body.inputs_newer,
          (await api(scoped, "GET", `/api/kpi/branch?period=${Q}`)).body.inputs_newer,
        ];
        // расчёта нет — пометки нет
        expect(await flags()).toEqual([false, false]);
        expect((await api(s, "POST", "/api/kpi/branch/compute", { period: Q })).body).toMatchObject({ version: 1 });
        // ввод был до расчёта: расчёт его прочитал, пометки нет
        expect(await flags()).toEqual([false, false]);

        // проверка после расчёта
        await addSanitaryRow(db, { terminal_id: t.id, period: Q, pct: 80 });
        expect(await flags()).toEqual([true, true]);
        // проверка чужого филиала в охват не входит
        expect((await api(otherView, "GET", `/api/kpi/branch?period=${Q}`)).body.inputs_newer).toBe(false);
        await addSanitaryRow(db, { terminal_id: other.id, period: Q, pct: 80 });
        expect((await api(otherView, "GET", `/api/kpi/branch?period=${Q}`)).body.inputs_newer).toBe(true);

        // пересчёт снимает пометку
        expect((await api(s, "POST", "/api/kpi/branch/compute", { period: Q })).body).toMatchObject({ version: 2 });
        expect(await flags()).toEqual([false, false]);

        // план тоже ввод
        await db.insert(kpi_revenue_plans).values({ terminal_id: t.id, period: Q, amount: "5", updated_by: randomUUID() });
        expect(await flags()).toEqual([true, true]);

        // сверка склада: решение после расчёта включает пометку, пересчёт снимает
        expect((await api(s, "POST", "/api/kpi/branch/compute", { period: Q })).body).toMatchObject({ version: 3 });
        expect(await flags()).toEqual([false, false]);
        await addReconciliation(db, { store_id: t.store_id!, period: Q, status: "accepted", accepted_diff_bc: "-100.00", reviewed_at: sql`now()` });
        expect(await flags()).toEqual([true, true]);
        expect((await api(s, "POST", "/api/kpi/branch/compute", { period: Q })).body).toMatchObject({ version: 4 });
        expect(await flags()).toEqual([false, false]);
        // решение по сверке чужого склада в охват не входит
        await addReconciliation(db, { store_id: other.store_id!, period: Q, status: "accepted", accepted_diff_bc: "-1.00", reviewed_at: sql`now()` });
        expect(await flags()).toEqual([false, false]);
        // снятие «принято» тоже решение: расчёт читает статус
        await db
          .update(inventory_reconciliations)
          .set({ status: "in_review", reviewed_at: sql`now()` })
          .where(and(eq(inventory_reconciliations.store_id, t.store_id!), eq(inventory_reconciliations.period, "2025-02-28")));
        expect(await flags()).toEqual([true, true]);

        // закрытый месяц заморожен: пометки нет
        await db.delete(kpi_periods).where(eq(kpi_periods.period, Q));
        await db.insert(kpi_periods).values({ period: Q, status: "closed" });
        expect(await flags()).toEqual([false, false]);
        await db.delete(kpi_periods).where(eq(kpi_periods.period, Q));
      } finally {
        setNow("2025-07-15T10:00:00+05:00");
      }
    });

    it("закрытый месяц KPI — расчёт 409 period_closed и ничего не пишет", async () => {
      const closed = "2025-04-01";
      const t = await makeTerminal(db);
      await addAttendance(db, { terminal_id: t.id, day: "2025-04-03", on_time: 1, late: 0, absent: 0 });
      await db.delete(kpi_periods).where(eq(kpi_periods.period, closed));
      await db.insert(kpi_periods).values({ period: closed, status: "closed" });
      expect((await api(await hr(), "POST", "/api/kpi/branch/compute", { period: closed })).body).toEqual({ error: "period_closed" });
      expect(await db.select().from(kpi_branch_scores).where(eq(kpi_branch_scores.period, closed))).toEqual([]);
      // пустой закрытый месяц — тоже 409, а не «данных нет»
      await db.insert(kpi_periods).values({ period: "2025-03-01", status: "closed" });
      const empty = await api(await hr(), "POST", "/api/kpi/branch/compute", { period: "2025-03-01" });
      expect([empty.status, empty.body]).toEqual([409, { error: "period_closed" }]);
      // открытый снова — считается
      await db.delete(kpi_periods).where(eq(kpi_periods.period, closed));
      expect((await api(await hr(), "POST", "/api/kpi/branch/compute", { period: closed })).body).toMatchObject({ version: 1 });
      expect(((await api(await hr(), "GET", `/api/kpi/branch/${t.id}?period=${closed}`)).body as BranchBreakdown).score).not.toBeNull();
    });
  });
}
