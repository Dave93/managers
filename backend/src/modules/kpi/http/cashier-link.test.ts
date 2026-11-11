import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в external-id.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/cashier-link (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, makeTerminal, setNow, setup } = await import("./fixtures");
  const { cash_shift_cashiers, cash_shifts, employees } = await import("backend/drizzle/schema");
  const { eq, inArray } = await import("drizzle-orm");
  type Session = Awaited<ReturnType<typeof withSession>>;

  describe("kpi: связь сотрудника с кассиром iiko", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    const shifts: string[] = [];

    // Смена на кассе филиала с набором кассиров: [uuid, имя, чеки, выручка].
    async function shift(terminal_id: string, day: string, rows: [string, string, number, number][]): Promise<void> {
      const id = randomUUID();
      shifts.push(id);
      await db.insert(cash_shifts).values({ id, terminal_id, point_of_sale_id: randomUUID(), cash_reg_number: 1, session_number: 1, open_at: `${day}T05:00:00+05:00`, business_date: day, status: "CLOSED" });
      await db.insert(cash_shift_cashiers).values(rows.map(([cashier_id, cashier_name, orders_count, revenue]) => ({ shift_id: id, cashier_id, cashier_name, orders_count, revenue: String(revenue) })));
    }

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
    }, 180000);

    beforeEach(() => setNow("2025-10-26T10:00:00+05:00"));

    afterAll(async () => {
      setNow(null);
      if (shifts.length) await db.delete(cash_shifts).where(inArray(cash_shifts.id, shifts));
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    const put = (s: Session | null, id: string, v: unknown) => api(s, "PUT", `/api/kpi/employees/${id}/cashier`, { cashier_id: v });
    const candidates = (s: Session | null, id: string) => api(s, "GET", `/api/kpi/employees/${id}/cashier-candidates`);

    it("права: без сессии — 401, kpi.view и kpi.approve — 403", async () => {
      const e = await makeEmployee(db);
      expect((await put(null, e.id, null)).status).toBe(401);
      expect((await candidates(null, e.id)).status).toBe(401);
      const v = await withSession({ permissions: ["kpi.view", "kpi.approve"] });
      expect((await put(v, e.id, null)).status).toBe(403);
      expect((await candidates(v, e.id)).status).toBe(403);
    });

    it("кандидаты: только кассиры филиала сотрудника за 60 дней, без «нет кассира», имя-подсказка и занятость", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const t = await makeTerminal(db), other = await makeTerminal(db);
      const bax = randomUUID(), ali = randomUUID(), old = randomUUID(), foreign = randomUUID();
      await shift(t.id, "2025-10-20", [[bax, "Baxrom", 40, 4_000_000], [ali, "Ali", 10, 500_000], ["00000000-0000-0000-0000-000000000000", "—", 3, 30_000]]);
      await shift(t.id, "2025-10-25", [[bax, "Baxrom", 20, 2_100_000]]);
      await shift(t.id, "2025-08-01", [[old, "Старый", 5, 100_000]]); // вне окна 60 дней
      await shift(other.id, "2025-10-20", [[foreign, "Чужой", 5, 100_000]]);
      const me = await makeEmployee(db, { terminal_id: t.id, first_name: "Baxrom" });
      const r = await candidates(hr, me.id);
      expect(r.status).toBe(200);
      expect(r.body.map((c: any) => c.cashier_id)).toEqual([bax, ali]); // свежие первыми
      expect(r.body[0]).toMatchObject({ name: "Baxrom", checks: 60, last_day: "2025-10-25", suggested: true, taken_by: null });
      expect(r.body[1]).toMatchObject({ suggested: false });
      // Али занят другим активным сотрудником — виден в подсказке, но свой выбор не мешает
      const holder = await makeEmployee(db, { terminal_id: t.id });
      expect((await put(hr, holder.id, ali)).status).toBe(200);
      const again = await candidates(hr, me.id);
      expect(again.body.find((c: any) => c.cashier_id === ali).taken_by).toMatch(/^Фикстура .+ Тест Повар$/);
      expect((await candidates(hr, holder.id)).body.find((c: any) => c.cashier_id === ali).taken_by).toBeNull();
      expect((await candidates(hr, randomUUID())).status).toBe(404);
    });

    it("связать, увидеть в списке сотрудников, снять", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const t = await makeTerminal(db);
      const c = randomUUID();
      await shift(t.id, "2025-10-20", [[c, "Dilnoza", 7, 700_000]]);
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      expect((await put(hr, e.id, c.toUpperCase())).body).toEqual({ id: e.id, cashier_id: c });
      const [row] = await db.select({ v: employees.iiko_cashier_id }).from(employees).where(eq(employees.id, e.id));
      expect(row.v).toBe(c);
      const list = await api(hr, "GET", `/api/kpi/employees?period=2025-10-01&terminal_id=${t.id}&include_uncarded=1`);
      expect(list.body.find((x: any) => x.id === e.id).cashier).toEqual({ id: c, name: "Dilnoza" });
      expect((await put(hr, e.id, null)).body).toEqual({ id: e.id, cashier_id: null });
      const list2 = await api(hr, "GET", `/api/kpi/employees?period=2025-10-01&terminal_id=${t.id}&include_uncarded=1`);
      expect(list2.body.find((x: any) => x.id === e.id).cashier).toBeNull();
    });

    it("один кассир — один активный сотрудник: 409 с именем; уволенный не мешает", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const t = await makeTerminal(db);
      const c = randomUUID();
      await shift(t.id, "2025-10-20", [[c, "Madina", 7, 700_000]]);
      const a = await makeEmployee(db, { terminal_id: t.id }), b = await makeEmployee(db, { terminal_id: t.id });
      expect((await put(hr, a.id, c)).status).toBe(200);
      const r = await put(hr, b.id, c);
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ error: "cashier_taken", employee_id: a.id });
      expect((await put(hr, a.id, c)).status).toBe(200); // свой же — можно
      await db.update(employees).set({ active: false }).where(eq(employees.id, a.id));
      expect((await put(hr, b.id, c)).body).toEqual({ id: b.id, cashier_id: c });
    });

    it("неверный ввод: не uuid, число и «нет кассира» — 422 bad_cashier; неизвестный — 422 unknown_cashier; кривой сотрудник — 404", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const e = await makeEmployee(db);
      for (const v of ["abc", 5, "00000000-0000-0000-0000-000000000000"]) expect((await put(hr, e.id, v as any)).body).toEqual({ error: "bad_cashier" });
      expect((await api(hr, "PUT", `/api/kpi/employees/${e.id}/cashier`, {})).body).toEqual({ error: "bad_cashier" });
      expect((await put(hr, e.id, randomUUID())).body).toEqual({ error: "unknown_cashier" });
      expect((await put(hr, "nope", null)).status).toBe(404);
      expect((await put(hr, randomUUID(), null)).status).toBe(404);
    });
  });
}
