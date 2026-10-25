import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/external-id (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, setup } = await import("./fixtures");
  const { employees } = await import("backend/drizzle/schema");
  const { eq } = await import("drizzle-orm");
  type Session = Awaited<ReturnType<typeof withSession>>;

  describe("kpi: табельный номер", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];

    const put = (s: Session | null, id: string, v: unknown) =>
      api(s, "PUT", `/api/kpi/employees/${id}/external-id`, { external_id: v });
    const ext = () => "T-" + randomUUID().slice(0, 8);

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
    }, 180000);

    afterAll(async () => {
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("права: без сессии — 401, kpi.view и kpi.approve — 403", async () => {
      const e = await makeEmployee(db);
      expect((await put(null, e.id, "T-x")).status).toBe(401);
      const v = await withSession({ permissions: ["kpi.view", "kpi.approve"] });
      expect((await put(v, e.id, "T-x")).status).toBe(403);
    });
    it("обрезка пробелов, пустое — null", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const e = await makeEmployee(db);
      const x = ext();
      expect((await put(hr, e.id, `  ${x}  `)).body).toEqual({ id: e.id, external_id: x });
      const [row] = await db.select({ v: employees.external_id }).from(employees).where(eq(employees.id, e.id));
      expect(row.v).toBe(x);
      expect((await put(hr, e.id, "   ")).body).toEqual({ id: e.id, external_id: null });
      expect((await put(hr, e.id, null)).body).toEqual({ id: e.id, external_id: null });
    });
    it("дубликат среди активных — 409 с именем; свой номер и номер уволенного — можно", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const x = ext();
      const a = await makeEmployee(db, { external_id: x });
      const b = await makeEmployee(db);
      const r = await put(hr, b.id, ` ${x} `);
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ error: "external_id_taken", employee_id: a.id });
      expect(r.body.employee_name).toMatch(/^Фикстура .+ Тест Повар$/);
      expect((await put(hr, a.id, x)).status).toBe(200);
      const y = ext();
      await makeEmployee(db, { external_id: y, active: false });
      expect((await put(hr, b.id, y)).body).toEqual({ id: b.id, external_id: y });
    });
    it("неверный ввод: число и 101 символ — 422 bad_external_id; кривой id — 404", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const e = await makeEmployee(db);
      expect((await put(hr, e.id, 12345 as any)).body).toEqual({ error: "bad_external_id" });
      expect((await put(hr, e.id, "a".repeat(101))).body).toEqual({ error: "bad_external_id" });
      expect((await api(hr, "PUT", `/api/kpi/employees/${e.id}/external-id`, {})).body).toEqual({ error: "bad_external_id" });
      expect((await put(hr, "nope", "T-1")).status).toBe(404);
      expect((await put(hr, randomUUID(), "T-1")).status).toBe(404);
    });
    it("гонка: один номер двум сотрудникам одновременно — 200 и 409", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const a = await makeEmployee(db);
      const b = await makeEmployee(db);
      const x = ext();
      const rs = await Promise.all([put(hr, a.id, x), put(hr, b.id, x)]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    });
  });
}
