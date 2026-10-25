import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/cards (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, setNow, setup } = await import("./fixtures");
  const { seedCards } = await import("../seed-cards");
  const { employees, kpi_raise_tiers, kpi_reviews, users } = await import("backend/drizzle/schema");
  const { eq, like } = await import("drizzle-orm");
  type Card = import("../types").Card;
  type EmployeeRow = import("../types").EmployeeRow;

  describe("kpi: карты, оценщики, сотрудники", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];

    const cardId = async (code: string): Promise<string> => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
      return cards.find((c) => c.code === code)!.id;
    };
    const list = async (s: Awaited<ReturnType<typeof withSession>>, qs: string) =>
      (await api(s, "GET", `/api/kpi/employees?period=2026-10-01${qs}`)).body as EmployeeRow[];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await db.delete(users).where(like(users.login, "test_kpi_%"));
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("seedCards идемпотентна: 6 карт, у старшего повара 9 пунктов, у технички 3", async () => {
      await seedCards(db);
      await seedCards(db);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = ((await api(hr, "GET", "/api/kpi/cards")).body as Card[]).filter((c) => !c.code.startsWith("test_"));
      expect(cards.map((c) => c.code)).toEqual(["cook", "senior_cook", "cashier", "cashier_plus", "manager", "cleaner"]);
      expect(cards.find((c) => c.code === "senior_cook")!.items).toHaveLength(9);
      expect(cards.find((c) => c.code === "cleaner")!.items.map((i) => i.title_ru)).toEqual([
        "Приход и уход",
        "Своя гигиена",
        "Чистота зала и уборной",
      ]);
      expect(cards.find((c) => c.code === "cook")!.items[0].source).toBe("attendance");
      expect(cards.find((c) => c.code === "cook")!.staff_role_codes).toEqual(["cook", "universal_cook"]);
      expect(cards.find((c) => c.code === "manager")!.items.map((i) => i.group_key)).toEqual([
        "base", "base", "base", "base", "base", "base", "extra", "extra", "extra",
      ]);
      expect(cards.find((c) => c.code === "cook")!.items.map((i) => i.sort)).toEqual([10, 20, 30, 40, 50, 60, 70]);
      expect(cards.find((c) => c.code === "cashier_plus")!.title_uz).toBe("Kassir, maosh 4 000 000 soʻm");
      const tiers = await db.select().from(kpi_raise_tiers);
      expect(tiers.map((t) => [Number(t.min_pct), Number(t.amount)]).sort((a, b) => b[0] - a[0])).toEqual([
        [95, 500000],
        [90, 300000],
        [85, 150000],
      ]);
    });

    it("карты: чтение любым kpi.*, запись только manage", async () => {
      expect((await api(null, "GET", "/api/kpi/cards")).status).toBe(401);
      const nobody = await withSession({ permissions: ["medical.list"] });
      expect((await api(nobody, "GET", "/api/kpi/cards")).status).toBe(403);
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      expect((await api(ev, "GET", "/api/kpi/cards")).status).toBe(200);
      const body = { code: "test_nope", title_ru: "x", title_uz: "x", staff_role_codes: [] };
      expect((await api(ev, "POST", "/api/kpi/cards", body)).status).toBe(403);
    });

    it("карта и пункты: создание, дубль code, правка, отключение, порядок", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const mk = await api(hr, "POST", "/api/kpi/cards", {
        code: "test_card",
        title_ru: "Тест карта",
        title_uz: "Test karta",
        staff_role_codes: ["hall_worker"],
        sort: 900,
      });
      expect(mk.status).toBe(200);
      const id = mk.body.id as string;
      expect(mk.body.items).toEqual([]);
      const dup = await api(hr, "POST", "/api/kpi/cards", { code: "test_card", title_ru: "x", title_uz: "x", staff_role_codes: [] });
      expect(dup.status).toBe(409);
      expect(dup.body).toEqual({ error: "code_taken" });

      const base = { title_ru: "Пункт А", title_uz: "A", source: "manual", weight: 2, group_key: "base" };
      const i1 = await api(hr, "POST", `/api/kpi/cards/${id}/items`, base);
      expect(i1.status).toBe(200);
      expect(i1.body.sort).toBe(10);
      expect(i1.body.hint_ru).toBeNull();
      const i2 = await api(hr, "POST", `/api/kpi/cards/${id}/items`, { ...base, title_ru: "Пункт Б", group_key: "extra" });
      expect(i2.body.sort).toBe(20);

      expect((await api(hr, "POST", `/api/kpi/cards/${id}/items`, { ...base, weight: 0 })).body).toEqual({ error: "bad_weight" });
      expect((await api(hr, "POST", `/api/kpi/cards/${id}/items`, { ...base, weight: 101 })).status).toBe(422);
      expect((await api(hr, "POST", `/api/kpi/cards/${id}/items`, { ...base, weight: 1.5 })).body).toEqual({ error: "bad_weight" });
      expect((await api(hr, "POST", `/api/kpi/cards/${id}/items`, { ...base, source: "magic" })).body).toEqual({ error: "bad_source" });
      expect((await api(hr, "PUT", `/api/kpi/items/${i1.body.id}`, { weight: 500 })).body).toEqual({ error: "bad_weight" });
      expect((await api(hr, "POST", `/api/kpi/cards/00000000-0000-0000-0000-000000000000/items`, base)).status).toBe(404);

      const put = await api(hr, "PUT", `/api/kpi/items/${i1.body.id}`, { weight: 5, hint_ru: "подсказка", source: "attendance" });
      expect(put.status).toBe(200);
      expect(put.body.weight).toBe(5);
      expect(put.body.hint_ru).toBe("подсказка");
      expect((await api(hr, "PUT", `/api/kpi/items/${i2.body.id}`, { active: false })).body.active).toBe(false);

      const find = async (qs: string) =>
        ((await api(hr, "GET", `/api/kpi/cards${qs}`)).body as Card[]).find((c) => c.code === "test_card");
      expect((await find(""))!.items.map((i) => i.title_ru)).toEqual(["Пункт А"]);
      expect((await find("?include_inactive=1"))!.items.map((i) => i.title_ru)).toEqual(["Пункт А", "Пункт Б"]);

      const upd = await api(hr, "PUT", `/api/kpi/cards/${id}`, { title_ru: "Новая", active: false });
      expect(upd.body.title_ru).toBe("Новая");
      expect(await find("")).toBeUndefined();
      expect((await find("?include_inactive=1"))!.active).toBe(false);
      expect((await api(hr, "PUT", `/api/kpi/cards/00000000-0000-0000-0000-000000000000`, {})).status).toBe(404);
    });

    it("назначение: дубликат — 409 scope_exists; оценщик видит только своих", async () => {
      const cook = await makeEmployee(db, { role_code: "cook" });
      const cashier = await makeEmployee(db, { role_code: "cashier", terminal_id: cook.terminal_id });
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cookCard = await cardId("cook");
      const first = await api(hr, "POST", "/api/kpi/evaluators", { user_id: ev.userId, card_id: cookCard, terminal_id: null });
      expect(first.status).toBe(200);
      const dup = await api(hr, "POST", "/api/kpi/evaluators", { user_id: ev.userId, card_id: cookCard, terminal_id: null });
      expect(dup.status).toBe(409);
      expect(dup.body).toEqual({ error: "scope_exists" });
      // Другой охват (карта + филиал) — не дубль.
      expect(
        (await api(hr, "POST", "/api/kpi/evaluators", { user_id: ev.userId, card_id: cookCard, terminal_id: cook.terminal_id })).status
      ).toBe(200);
      // Параллельные одинаковые вставки: ровно одна проходит.
      const rs = await Promise.all(
        [1, 2, 3].map(() => api(hr, "POST", "/api/kpi/evaluators", { user_id: ev.userId, card_id: null, terminal_id: null }))
      );
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(2);

      const rows = await list(ev, `&terminal_id=${cook.terminal_id}`);
      expect(rows.map((e) => e.id).sort()).toEqual([cook.id, cashier.id].sort()); // шире — null/null
      expect(rows.every((e) => e.can_evaluate)).toBe(true);

      // Оценщик с ограниченным назначением (только карта cook) видит одного повара.
      const ev2 = await withSession({ permissions: ["kpi.evaluate"] });
      await api(hr, "POST", "/api/kpi/evaluators", { user_id: ev2.userId, card_id: cookCard, terminal_id: null });
      const mine = await list(ev2, `&terminal_id=${cook.terminal_id}`);
      expect(mine.map((e) => e.id)).toEqual([cook.id]);
      expect(mine[0].can_evaluate).toBe(true);
      expect(mine[0].card).toMatchObject({ id: cookCard, code: "cook" });
      expect(mine[0].card_source).toBe("role");

      const listed = (await api(hr, "GET", "/api/kpi/evaluators")).body as { id: string; user_id: string; card_title: string | null }[];
      const mineScope = listed.find((s) => s.user_id === ev2.userId)!;
      expect(mineScope.card_title).toBe("Повар (Chopar и Les Ailes)");
      expect((await api(hr, "DELETE", `/api/kpi/evaluators/${mineScope.id}`)).status).toBe(200);
      expect((await api(hr, "DELETE", `/api/kpi/evaluators/${mineScope.id}`)).status).toBe(404);
      expect(await list(ev2, `&terminal_id=${cook.terminal_id}`)).toEqual([]);

      expect((await api(ev, "GET", "/api/kpi/evaluators")).status).toBe(403);
      expect((await api(hr, "POST", "/api/kpi/evaluators", { user_id: "x", card_id: null, terminal_id: null })).body).toEqual({ error: "bad_id" });
    });

    it("ручная карта: техничка по назначению HR, стажёр без карты не виден, auto возвращает к роли", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cleaner = await makeEmployee(db, { role_code: "hall_worker" });
      const trainee = await makeEmployee(db, { role_code: "cook", is_trainee: true, terminal_id: cleaner.terminal_id });
      const cook = await makeEmployee(db, { role_code: "cook", terminal_id: cleaner.terminal_id });
      const q = `&terminal_id=${cleaner.terminal_id}`;
      expect((await list(hr, q)).map((e) => e.id)).toEqual([cook.id]); // hall_worker и стажёр без карты

      const cleanerCard = await cardId("cleaner");
      const set1 = await api(hr, "PUT", `/api/kpi/employees/${cleaner.id}/card`, { card_id: cleanerCard, comment: "техничка" });
      expect(set1.status).toBe(200);
      expect(set1.body).toMatchObject({ id: cleaner.id, card_id: cleanerCard, card_source: "override" });
      const rows = await list(hr, q);
      expect(rows.map((e) => e.id).sort()).toEqual([cleaner.id, cook.id].sort());
      expect(rows.find((e) => e.id === cleaner.id)!.card_source).toBe("override");

      // Повторный вызов заменяет; стажёру ручная карта делает его видимым.
      expect((await api(hr, "PUT", `/api/kpi/employees/${cleaner.id}/card`, { card_id: await cardId("cook") })).status).toBe(200);
      expect((await list(hr, q)).find((e) => e.id === cleaner.id)!.card!.code).toBe("cook");
      await api(hr, "PUT", `/api/kpi/employees/${trainee.id}/card`, { card_id: cleanerCard });
      expect((await list(hr, q)).map((e) => e.id)).toContain(trainee.id);

      // null — «не оценивается»: повар выпадает.
      const nul = await api(hr, "PUT", `/api/kpi/employees/${cook.id}/card`, { card_id: null });
      expect(nul.status).toBe(200);
      expect(nul.body).toMatchObject({ card_id: null, card_source: "override" });
      expect((await list(hr, q)).map((e) => e.id)).not.toContain(cook.id);

      // auto — вернуть к роли.
      expect((await api(hr, "PUT", `/api/kpi/employees/${cook.id}/card`, { card_id: "auto" })).body).toMatchObject({ card_source: "role" });
      expect((await list(hr, q)).map((e) => e.id)).toContain(cook.id);
      await api(hr, "PUT", `/api/kpi/employees/${trainee.id}/card`, { card_id: "auto" });
      expect((await list(hr, q)).map((e) => e.id)).not.toContain(trainee.id);

      // Ошибки.
      expect((await api(hr, "PUT", `/api/kpi/employees/${cook.id}/card`, { card_id: "00000000-0000-0000-0000-000000000000" })).body).toEqual({ error: "unknown_card" });
      expect((await api(hr, "PUT", `/api/kpi/employees/00000000-0000-0000-0000-000000000000/card`, { card_id: null })).status).toBe(404);
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      expect((await api(ev, "PUT", `/api/kpi/employees/${cook.id}/card`, { card_id: null })).status).toBe(403);
      // Неактивная карта назначить нельзя.
      await api(hr, "POST", "/api/kpi/cards", { code: "test_off", title_ru: "Выкл", title_uz: "Off", staff_role_codes: [] });
      const off = ((await api(hr, "GET", "/api/kpi/cards")).body as Card[]).find((c) => c.code === "test_off")!;
      await api(hr, "PUT", `/api/kpi/cards/${off.id}`, { active: false });
      expect((await api(hr, "PUT", `/api/kpi/employees/${cook.id}/card`, { card_id: off.id })).body).toEqual({ error: "unknown_card" });
    });

    it("kpi.view видит только свои филиалы", async () => {
      const a = await makeEmployee(db, { role_code: "cook" });
      const b = await makeEmployee(db, { role_code: "cook" });
      const v = await withSession({ permissions: ["kpi.view"], terminals: [a.terminal_id] });
      const ids = (await list(v, "")).map((e) => e.id);
      expect(ids).toContain(a.id);
      expect(ids).not.toContain(b.id);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const all = (await list(hr, "")).map((e) => e.id);
      expect(all).toContain(a.id);
      expect(all).toContain(b.id);
      // Без права kpi.* — 403; без сессии — 401; период обязателен.
      const nobody = await withSession({ permissions: ["medical.list"] });
      expect((await api(nobody, "GET", "/api/kpi/employees?period=2026-10-01")).status).toBe(403);
      expect((await api(null, "GET", "/api/kpi/employees?period=2026-10-01")).status).toBe(401);
      expect((await api(v, "GET", "/api/kpi/employees")).body).toEqual({ error: "bad_period" });
      expect((await api(v, "GET", "/api/kpi/employees?period=2026-10-15")).body).toEqual({ error: "bad_period" });
    });

    it("список: оценка за период, late, фильтры, неактивный с оценкой", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const e1 = await makeEmployee(db, { role_code: "cook" });
      const term = e1.terminal_id;
      const e2 = await makeEmployee(db, { role_code: "cook", terminal_id: term });
      const e3 = await makeEmployee(db, { role_code: "cook", terminal_id: term });
      const gone = await makeEmployee(db, { role_code: "cook", terminal_id: term });
      const gone2 = await makeEmployee(db, { role_code: "cook", terminal_id: term });
      const cook = await cardId("cook");
      await db.update(employees).set({ active: false }).where(eq(employees.id, gone.id));
      await db.update(employees).set({ active: false }).where(eq(employees.id, gone2.id));
      const base = { period: "2026-10-01", terminal_id: term, card_id: cook, evaluator_user_id: hr.userId };
      await db.insert(kpi_reviews).values([
        { ...base, employee_id: e1.id, status: "draft" },
        { ...base, employee_id: e2.id, status: "submitted", score_pct: "92.50", submitted_at: "2026-11-05T10:00:00+05:00" },
        { ...base, employee_id: e3.id, status: "submitted", score_pct: "80", submitted_at: "2026-11-09T10:00:00+05:00" },
        { ...base, employee_id: gone.id, status: "submitted", score_pct: "70", submitted_at: "2026-11-01T10:00:00+05:00" },
      ]);
      const q = `&terminal_id=${term}`;

      setNow("2026-11-06T10:00:00+05:00");
      let rows = await list(hr, q);
      const by = (id: string) => rows.find((e) => e.id === id)!;
      expect(rows).toHaveLength(4); // gone2 без оценки и неактивен — скрыт
      expect(rows.map((e) => e.id)).not.toContain(gone2.id);
      expect(by(e1.id).review).toMatchObject({ status: "draft", late: false, score_pct: null });
      expect(by(e2.id).review).toMatchObject({ status: "submitted", score_pct: 92.5, late: false });
      expect(by(e3.id).review!.late).toBe(true); // отправлена после срока 7-го
      expect(by(gone.id).active).toBe(false);
      expect(by(gone.id).open_dispute).toBe(false);

      setNow("2026-11-08T10:00:00+05:00"); // срок прошёл, черновик просрочен
      rows = await list(hr, q);
      expect(by(e1.id).review!.late).toBe(true);
      expect(by(e2.id).review!.late).toBe(false);

      expect((await list(hr, `${q}&status=draft`)).map((e) => e.id)).toEqual([e1.id]);
      expect((await list(hr, `${q}&status=submitted`)).map((e) => e.id).sort()).toEqual([e2.id, e3.id, gone.id].sort());
      expect(await list(hr, `${q}&status=disputed`)).toEqual([]);
      // Период без оценок: все с картой — «none».
      const other = (await api(hr, "GET", `/api/kpi/employees?period=2026-09-01${q}&status=none`)).body as EmployeeRow[];
      expect(other.map((e) => e.id).sort()).toEqual([e1.id, e2.id, e3.id].sort());
      expect((await list(hr, `${q}&card_id=${await cardId("cashier")}`))).toEqual([]);
      expect((await list(hr, `${q}&card_id=${cook}`))).toHaveLength(4); // и неактивный с оценкой
      expect((await list(hr, `${q}&search=фикстура`)).length).toBe(4);
      expect(await list(hr, `${q}&search=zzzнет`)).toEqual([]);
      expect((await api(hr, "GET", `/api/kpi/employees?period=2026-10-01&status=wat`)).status).toBe(422);
    });

    it("поиск пользователей: до 20 активных по login и имени", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const mk = (n: string, status: "active" | "blocked") => ({
        login: `test_kpi_${n}`,
        first_name: "Тест",
        last_name: `Юзер${n}`,
        password: "x",
        status,
      });
      await db.insert(users).values([mk("a", "active"), mk("b", "blocked")]);
      const r = await api(hr, "GET", "/api/kpi/users?search=test_kpi_");
      expect(r.status).toBe(200);
      expect(r.body.map((u: { login: string }) => u.login)).toEqual(["test_kpi_a"]);
      expect(r.body[0]).toMatchObject({ first_name: "Тест", last_name: "Юзерa", name: "Тест Юзерa" });
      expect((await api(hr, "GET", "/api/kpi/users?search=юзерa")).body).toHaveLength(1);
      expect((await api(hr, "GET", "/api/kpi/users?search=%25")).body.length).toBeLessThanOrEqual(20);
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      expect((await api(ev, "GET", "/api/kpi/users?search=a")).status).toBe(403);
    });
  });
}
