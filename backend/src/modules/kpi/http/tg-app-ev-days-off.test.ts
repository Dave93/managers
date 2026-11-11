import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в tg-app-ev-violations.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app оценщик: выходные (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, ensureKpiOrg, evSession, KPI_TEST_ORG_ID, makeEmployee, makeEvaluator, makeScope, makeTerminal, setNow, setup, tgApi, TG_TEST_BOT_TOKEN } = await import("./fixtures");
  const { kpi_days_off, kpi_notifications, kpi_periods, kpi_reviews, organization } = await import("backend/drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const URL_GIVE = "/api/kpi/tg/ev/days-off";
  const OUT = { status: 403, body: { error: "out_of_scope" } };
  const NOT_FOUND = { status: 404, body: { error: "not_found" } };
  // «Сегодня» теста: 26 октября 2025, окно дат — с 25.10.2024 по 26.11.2025.
  const NOW = "2025-10-26T10:00:00+05:00";

  describe("kpi: оценщик в мини-приложении, выходные", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let cookCardId: string;
    let otherCardId: string;
    let prevToken: string | undefined;

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      prevToken = process.env.KPI_BOT_TOKEN;
      process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN;
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as { id: string; code: string }[];
      cookCardId = cards.find((c) => c.code === "cook")!.id;
      otherCardId = cards.find((c) => c.code !== "cook")!.id;
    }, 180000);

    afterAll(async () => {
      setNow(null);
      // undefined в process.env стал бы строкой "undefined": следующие файлы ходили бы в Telegram.
      if (prevToken === undefined) delete process.env.KPI_BOT_TOKEN;
      else process.env.KPI_BOT_TOKEN = prevToken;
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    // Оценщик с назначением на филиал и его сотрудник-повар.
    const world = async () => {
      const t = await makeTerminal(db);
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      return { t, ev, e, token: await evSession(db, ev.id) };
    };
    const give = (token: string, employee_id: string, from: string, to: string, extra: Record<string, unknown> = {}) =>
      tgApi(token, "POST", URL_GIVE, { employee_id, from, to, reason_code: "sick", ...extra });
    const rowsOf = (employee_id: string) => db.select().from(kpi_days_off).where(eq(kpi_days_off.employee_id, employee_id));
    const closeMonth = async (period: string) => {
      await db.insert(kpi_periods).values({ period, status: "closed" }).onConflictDoUpdate({ target: kpi_periods.period, set: { status: "closed" } });
    };
    const reopenMonth = async (period: string) => {
      await db.delete(kpi_periods).where(eq(kpi_periods.period, period));
    };

    describe("запрос замены у HR", () => {
      const CHOPAR_CHAT = -1001651101431;
      const LES_CHAT = -1001449886367;
      const hrRows = () => db.select().from(kpi_notifications).where(eq(kpi_notifications.kind, "replacement_needed"));
      // Строка организации тестов создаётся лениво (ensureKpiOrg), поэтому сначала гарантируем её.
      const setOrgCode = async (code: string | null) => {
        await ensureKpiOrg(db);
        await db.update(organization).set({ code }).where(eq(organization.id, KPI_TEST_ORG_ID));
      };
      beforeAll(async () => {
        await db.delete(kpi_notifications);
        await setOrgCode("chopar");
      });
      afterAll(async () => {
        await setOrgCode(null);
      });

      it("на позиции больше никого: одно сообщение в группу организации с филиалом, позицией, днями и именами", async () => {
        setNow(NOW);
        await db.delete(kpi_notifications);
        const { t, e, token } = await world();
        const r = await give(token, e.id, "2025-10-27", "2025-10-29");
        expect(r.status).toBe(200);
        const rows = await hrRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ recipient_kind: "chat", employee_id: null, user_id: null, status: "pending" });
        expect(rows[0].payload).toMatchObject({
          chat_id: CHOPAR_CHAT,
          terminal_name: t.name,
          days: ["2025-10-27", "2025-10-28", "2025-10-29"],
          no_cover: true,
          manual: false,
        });
        expect((rows[0].payload as { employee_name: string }).employee_name).toContain("Тест Повар");
      });

      it("организация Les: уходит в группу Les", async () => {
        setNow(NOW);
        await db.delete(kpi_notifications);
        await setOrgCode("les");
        try {
          const { e, token } = await world();
          expect((await give(token, e.id, "2025-10-27", "2025-10-27")).status).toBe(200);
          expect((await hrRows())[0].payload).toMatchObject({ chat_id: LES_CHAT });
        } finally {
          await setOrgCode("chopar");
        }
      });

      it("организация без группы HR: выходной выдаётся, сообщения нет", async () => {
        setNow(NOW);
        await db.delete(kpi_notifications);
        await setOrgCode(null);
        try {
          const { e, token } = await world();
          expect((await give(token, e.id, "2025-10-27", "2025-10-27")).status).toBe(200);
          expect(await hrRows()).toHaveLength(0);
        } finally {
          await setOrgCode("chopar");
        }
      });

      it("есть другой сотрудник той же позиции: сообщения нет; с галочкой — есть, причина «просьба», без «нет замены»", async () => {
        setNow(NOW);
        await db.delete(kpi_notifications);
        const { t, e, token } = await world();
        await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
        expect((await give(token, e.id, "2025-10-27", "2025-10-27")).status).toBe(200);
        expect(await hrRows()).toHaveLength(0);
        expect((await give(token, e.id, "2025-10-28", "2025-10-28", { request_replacement: true })).status).toBe(200);
        const rows = await hrRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toMatchObject({ days: ["2025-10-28"], no_cover: false, manual: true });
      });

      it("галочка только при === true: строка и 1 не считаются", async () => {
        setNow(NOW);
        await db.delete(kpi_notifications);
        const { t, e, token } = await world();
        await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
        expect((await give(token, e.id, "2025-10-27", "2025-10-27", { request_replacement: "true" })).status).toBe(200);
        expect((await give(token, e.id, "2025-10-28", "2025-10-28", { request_replacement: 1 })).status).toBe(200);
        expect(await hrRows()).toHaveLength(0);
      });

      it("замена сама в выходном в этот день: HR получает сообщение только про этот день", async () => {
        setNow(NOW);
        await db.delete(kpi_notifications);
        const { t, e, token } = await world();
        const other = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
        expect((await give(token, other.id, "2025-10-28", "2025-10-28")).status).toBe(200);
        // у other замена e: она работает 28-го, сообщения нет
        expect(await hrRows()).toHaveLength(0);
        await db.delete(kpi_notifications);
        expect((await give(token, e.id, "2025-10-27", "2025-10-28")).status).toBe(200);
        const rows = await hrRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toMatchObject({ days: ["2025-10-28"], no_cover: true });
      });

      it("другая позиция не заменяет; стажёр не заменяет; неактивный не заменяет", async () => {
        setNow(NOW);
        await db.delete(kpi_notifications);
        const { t, e, token } = await world();
        await makeEmployee(db, { role_code: "cashier", terminal_id: t.id });
        await makeEmployee(db, { role_code: "cook", terminal_id: t.id, is_trainee: true });
        await makeEmployee(db, { role_code: "cook", terminal_id: t.id, active: false });
        expect((await give(token, e.id, "2025-10-27", "2025-10-27")).status).toBe(200);
        expect(await hrRows()).toHaveLength(1);
      });

      it("сотрудник без карты и без роли: автоматически не проверяем, только по галочке", async () => {
        setNow(NOW);
        await db.delete(kpi_notifications);
        const { t, token } = await world();
        const bare = await makeEmployee(db, { terminal_id: t.id });
        expect((await give(token, bare.id, "2025-10-27", "2025-10-27")).status).toBe(200);
        expect(await hrRows()).toHaveLength(0);
        expect((await give(token, bare.id, "2025-10-28", "2025-10-28", { request_replacement: true })).status).toBe(200);
        const rows = await hrRows();
        expect(rows).toHaveLength(1);
        // Позиции нет — «нет замены» не утверждаем: уходит только просьба управляющего.
        expect(rows[0].payload).toMatchObject({ days: ["2025-10-28"], no_cover: false, manual: true, position: null, card: null });
      });

      it("только прошедшие дни: сообщения нет, даже с галочкой; в смешанном диапазоне уходят дни от сегодня", async () => {
        setNow(NOW);
        await db.delete(kpi_notifications);
        const { e, token } = await world();
        expect((await give(token, e.id, "2025-10-20", "2025-10-21", { request_replacement: true })).status).toBe(200);
        expect(await hrRows()).toHaveLength(0);
        expect((await give(token, e.id, "2025-10-25", "2025-10-27")).status).toBe(200);
        const rows = await hrRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toMatchObject({ days: ["2025-10-26", "2025-10-27"] });
      });

      it("повтор того же запроса (все дни пропущены) второго сообщения не создаёт", async () => {
        setNow(NOW);
        await db.delete(kpi_notifications);
        const { e, token } = await world();
        expect((await give(token, e.id, "2025-10-27", "2025-10-28", { request_replacement: true })).status).toBe(200);
        expect((await give(token, e.id, "2025-10-27", "2025-10-28", { request_replacement: true })).body.created).toEqual([]);
        expect(await hrRows()).toHaveLength(1);
      });
    });

    it("выдача на 3 дня: ответ и строки в базе (филиал сотрудника, автор, причина)", async () => {
      setNow(NOW);
      const { t, ev, e, token } = await world();
      const r = await give(token, e.id, "2025-10-27", "2025-10-29");
      expect(r.status).toBe(200);
      expect(r.body.skipped).toEqual([]);
      expect(r.body.created.map((x: { day: string }) => x.day)).toEqual(["2025-10-27", "2025-10-28", "2025-10-29"]);
      expect(r.body.created[0]).toMatchObject({ employee_id: e.id, reason_code: "sick", reason_text: null, status: "active", can_cancel: true });
      expect(r.body.created[0].employee_name).toContain("Тест Повар");
      const rows = await rowsOf(e.id);
      expect(rows).toHaveLength(3);
      expect(rows.every((x) => x.terminal_id === t.id && x.given_by === ev.id && x.cancelled_at === null)).toBe(true);
    });

    it("лимит 4 выходных в месяц мягкий: пятый и шестой выдаются, форма отдаёт лимит и все дни месяца от разных авторов", async () => {
      setNow(NOW);
      const { t, e, token } = await world();
      expect((await give(token, e.id, "2025-10-27", "2025-10-30")).body.created).toHaveLength(4);
      // пятый и шестой день сверх лимита: не запрет, оба записаны
      const over = await give(token, e.id, "2025-10-31", "2025-11-01");
      expect(over.status).toBe(200);
      expect(over.body.created).toHaveLength(2);
      expect(await rowsOf(e.id)).toHaveLength(6);
      // другой оценщик тоже выдаёт этому сотруднику: форма видит дни всех авторов, клиент считает по ним
      const ev2 = await makeEvaluator(db);
      await makeScope(db, ev2.id, { terminal_id: t.id });
      expect((await give(await evSession(db, ev2.id), e.id, "2025-11-02", "2025-11-02")).status).toBe(200);
      const f = await tgApi(token, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${e.id}`);
      expect(f.body.month_limit).toBe(4);
      expect(f.body.existing).toEqual(["2025-10-27", "2025-10-28", "2025-10-29", "2025-10-30", "2025-10-31", "2025-11-01", "2025-11-02"]);
    });

    it("«другая» причина хранит текст, остальные текст не хранят", async () => {
      setNow(NOW);
      const { e, token } = await world();
      expect((await give(token, e.id, "2025-10-27", "2025-10-27", { reason_code: "other", reason_text: "  Свадьба брата  " })).body.created[0]).toMatchObject({
        reason_code: "other",
        reason_text: "Свадьба брата",
      });
      expect((await give(token, e.id, "2025-10-28", "2025-10-28", { reason_code: "family", reason_text: "игнорируется" })).body.created[0]).toMatchObject({
        reason_code: "family",
        reason_text: null,
      });
    });

    it("повтор того же запроса ничего не ломает и перечисляет пропущенные; после отмены день выдаётся заново", async () => {
      setNow(NOW);
      const { e, token } = await world();
      const first = await give(token, e.id, "2025-10-27", "2025-10-29");
      const again = await give(token, e.id, "2025-10-27", "2025-10-29");
      expect(again.status).toBe(200);
      expect(again.body.created).toEqual([]);
      expect(again.body.skipped).toEqual(["2025-10-27", "2025-10-28", "2025-10-29"]);
      expect(await rowsOf(e.id)).toHaveLength(3);

      const cancelled = await tgApi(token, "POST", `${URL_GIVE}/${first.body.created[1].id}/cancel`);
      expect(cancelled.status).toBe(200);
      const regive = await give(token, e.id, "2025-10-27", "2025-10-29", { reason_code: "vacation" });
      expect(regive.body.created.map((x: { day: string }) => x.day)).toEqual(["2025-10-28"]);
      expect(regive.body.created[0].reason_code).toBe("vacation");
      expect(regive.body.skipped).toEqual(["2025-10-27", "2025-10-29"]);
      expect(await rowsOf(e.id)).toHaveLength(4); // три активных и одна отменённая
    });

    it("диапазон через границу с закрытым месяцем: 409, ни одной строки", async () => {
      setNow(NOW);
      const { e, token } = await world();
      await closeMonth("2025-09-01");
      try {
        const r = await give(token, e.id, "2025-09-29", "2025-10-02");
        expect(r).toEqual({ status: 409, body: { error: "period_closed" } });
        expect(await rowsOf(e.id)).toHaveLength(0);
        // Тот же диапазон без закрытой части проходит.
        expect((await give(token, e.id, "2025-10-01", "2025-10-02")).status).toBe(200);
      } finally {
        await reopenMonth("2025-09-01");
      }
    });

    it("неверная причина, текст и даты", async () => {
      setNow(NOW);
      const { e, token } = await world();
      expect((await give(token, e.id, "2025-10-27", "2025-10-27", { reason_code: "other" })).body).toEqual({ error: "reason_text_required" });
      expect((await give(token, e.id, "2025-10-27", "2025-10-27", { reason_code: "other", reason_text: "ab" })).body).toEqual({ error: "reason_text_required" });
      expect((await give(token, e.id, "2025-10-27", "2025-10-27", { reason_code: "holiday" })).body).toEqual({ error: "bad_reason" });
      expect((await give(token, e.id, "2025-10-29", "2025-10-27")).body).toEqual({ error: "bad_dates" });
      expect((await give(token, e.id, "2025-02-30", "2025-03-01")).body).toEqual({ error: "bad_dates" });
      expect((await give(token, e.id, "2025-10-01", "2025-11-05")).body).toEqual({ error: "bad_dates" }); // 36 дней
      expect((await give(token, e.id, "2025-12-01", "2025-12-01")).body).toEqual({ error: "bad_dates" }); // дальше сегодня + 31
      expect(await rowsOf(e.id)).toHaveLength(0);
    });

    it("чужой филиал, неактивный, не uuid, без employee_id; карта в назначении и у сотрудника не важна", async () => {
      setNow(NOW);
      const { t, ev, token } = await world();
      const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: (await makeTerminal(db)).id });
      expect(await give(token, foreign.id, "2025-10-27", "2025-10-27")).toEqual(OUT);
      const inactive = await makeEmployee(db, { role_code: "cook", terminal_id: t.id, active: false });
      expect(await give(token, inactive.id, "2025-10-27", "2025-10-27")).toEqual(NOT_FOUND);
      expect(await give(token, "x", "2025-10-27", "2025-10-27")).toEqual(NOT_FOUND);
      expect(await give(token, randomUUID(), "2025-10-27", "2025-10-27")).toEqual(NOT_FOUND);
      expect((await tgApi(token, "POST", URL_GIVE, { from: "2025-10-27", to: "2025-10-27", reason_code: "sick" })).body).toEqual({ error: "bad_id" });

      // Право по филиалу, а не по карте: оценщик, назначенный на филиал только по чужой карте, выдаёт выходные
      // повару, и сотруднику без карты тоже. Оценщик другого филиала не выдаёт никому.
      const evCard = await makeEvaluator(db);
      await makeScope(db, evCard.id, { terminal_id: t.id, card_id: otherCardId });
      const cook = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      const cardless = await makeEmployee(db, { terminal_id: t.id });
      const tokenCard = await evSession(db, evCard.id);
      expect((await give(tokenCard, cook.id, "2025-10-27", "2025-10-27")).status).toBe(200);
      expect((await give(tokenCard, cardless.id, "2025-10-27", "2025-10-27")).status).toBe(200);
      expect(await rowsOf(cardless.id)).toHaveLength(1);
      const evElsewhere = await makeEvaluator(db);
      await makeScope(db, evElsewhere.id, { terminal_id: (await makeTerminal(db)).id, card_id: cookCardId });
      expect(await give(await evSession(db, evElsewhere.id), cook.id, "2025-10-28", "2025-10-28")).toEqual(OUT);
      // Форма выдачи по тому же правилу
      expect((await tgApi(tokenCard, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${cardless.id}`)).status).toBe(200);
      expect(ev.id).toBeTruthy();
    });

    it("список для выдачи: все активные сотрудники филиалов оценщика, с картой и без, по фамилии; чужие и неактивные не видны", async () => {
      setNow(NOW);
      const { t, token } = await world();
      const t2 = await makeTerminal(db);
      const ev2 = await makeEvaluator(db);
      await makeScope(db, ev2.id, { terminal_id: t.id, card_id: otherCardId });
      await makeScope(db, ev2.id, { terminal_id: t2.id });
      const a = await makeEmployee(db, { role_code: "cook", terminal_id: t.id, first_name: "Тест Борис" });
      const b = await makeEmployee(db, { terminal_id: t.id, first_name: "Тест Аня" });
      const c = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
      const off = await makeEmployee(db, { role_code: "cook", terminal_id: t.id, active: false });
      const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: (await makeTerminal(db)).id });

      const one = await tgApi(token, "GET", "/api/kpi/tg/ev/days-off/employees");
      expect(one.status).toBe(200);
      const ids1 = one.body.items.map((x: { id: string }) => x.id);
      expect(ids1).toEqual(expect.arrayContaining([a.id, b.id]));
      expect(ids1).not.toContain(off.id);
      expect(ids1).not.toContain(foreign.id);
      expect(ids1).not.toContain(c.id);
      expect(one.body.items.find((x: { id: string }) => x.id === b.id)).toMatchObject({ terminal_id: t.id, position: null });
      expect(one.body.terminals.map((x: { id: string }) => x.id)).toEqual([t.id]);

      const two = await tgApi(await evSession(db, ev2.id), "GET", "/api/kpi/tg/ev/days-off/employees");
      const ids2 = two.body.items.map((x: { id: string }) => x.id);
      expect(ids2).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
      expect(ids2).not.toContain(foreign.id);
      expect(two.body.terminals.map((x: { id: string }) => x.id).sort()).toEqual([t.id, t2.id].sort());
      // Порядок по фамилии, затем имени
      const keys = two.body.items.map((x: { last_name: string; first_name: string }) => `${x.last_name} ${x.first_name}`);
      const sorted = two.body.items
        .slice()
        .sort((p: { last_name: string; first_name: string }, q: { last_name: string; first_name: string }) => p.last_name.localeCompare(q.last_name, "ru") || p.first_name.localeCompare(q.first_name, "ru"))
        .map((x: { last_name: string; first_name: string }) => `${x.last_name} ${x.first_name}`);
      expect(keys).toEqual(sorted);
      // Оценщик без назначений получает пустой список, а не чужих
      const none = await makeEvaluator(db);
      expect((await tgApi(await evSession(db, none.id), "GET", "/api/kpi/tg/ev/days-off/employees")).body).toEqual({ terminals: [], items: [] });
    });

    it("отмена: автор, чужой оценщик, повтор, закрытый месяц, мусорный id", async () => {
      setNow(NOW);
      const { t, e, token } = await world();
      const other = await makeEvaluator(db);
      await makeScope(db, other.id, { terminal_id: t.id });
      const otherToken = await evSession(db, other.id);

      const [d1, d2] = (await give(token, e.id, "2025-10-27", "2025-10-28")).body.created as { id: string }[];
      expect(await tgApi(otherToken, "POST", `${URL_GIVE}/${d1.id}/cancel`)).toEqual({ status: 403, body: { error: "forbidden" } });
      const ok = await tgApi(token, "POST", `${URL_GIVE}/${d1.id}/cancel`);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ id: d1.id, status: "cancelled", can_cancel: false });
      expect(await tgApi(token, "POST", `${URL_GIVE}/${d1.id}/cancel`)).toEqual({ status: 409, body: { error: "already_cancelled" } });
      expect(await tgApi(token, "POST", `${URL_GIVE}/x/cancel`)).toEqual(NOT_FOUND);
      expect(await tgApi(token, "POST", `${URL_GIVE}/${randomUUID()}/cancel`)).toEqual(NOT_FOUND);

      await closeMonth("2025-10-01");
      try {
        expect(await tgApi(token, "POST", `${URL_GIVE}/${d2.id}/cancel`)).toEqual({ status: 409, body: { error: "period_closed" } });
      } finally {
        await reopenMonth("2025-10-01");
      }
    });

    it("список месяца: только мои, отменённые видны, право отмены по закрытию месяца", async () => {
      setNow(NOW);
      const { t, e, token } = await world();
      const other = await makeEvaluator(db);
      await makeScope(db, other.id, { terminal_id: t.id });
      const mine = (await give(token, e.id, "2025-10-27", "2025-10-28")).body.created as { id: string }[];
      await give(await evSession(db, other.id), e.id, "2025-10-29", "2025-10-29"); // чужой выходной
      await tgApi(token, "POST", `${URL_GIVE}/${mine[0].id}/cancel`);

      const list = await tgApi(token, "GET", `${URL_GIVE}?period=2025-10-01`);
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ period: "2025-10-01", period_status: "open" });
      const byDay = new Map(list.body.items.map((x: { day: string }) => [x.day, x]));
      expect([...byDay.keys()].sort()).toEqual(["2025-10-27", "2025-10-28"]);
      expect(byDay.get("2025-10-27")).toMatchObject({ status: "cancelled", can_cancel: false });
      expect(byDay.get("2025-10-28")).toMatchObject({ status: "active", can_cancel: true });
      expect(list.body.items[0].day > list.body.items[1].day).toBe(true); // новые сверху

      await closeMonth("2025-10-01");
      try {
        const closed = await tgApi(token, "GET", `${URL_GIVE}?period=2025-10-01`);
        expect(closed.body.period_status).toBe("closed");
        expect(closed.body.items.every((x: { can_cancel: boolean }) => x.can_cancel === false)).toBe(true);
      } finally {
        await reopenMonth("2025-10-01");
      }
      // Без period — месяц «сейчас».
      expect((await tgApi(token, "GET", URL_GIVE)).body.period).toBe("2025-10-01");
      expect(await tgApi(token, "GET", `${URL_GIVE}?period=bad`)).toEqual({ status: 422, body: { error: "bad_period" } });
    });

    it("форма: месяцы окна, где оценка сотрудника уже отправлена (черновик, чужие и месяцы вне окна не в счёт)", async () => {
      setNow(NOW);
      const { t, ev, e, token } = await world();
      const other = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      const review = (employee_id: string, period: string, status: "draft" | "submitted") => ({
        employee_id, period, status, terminal_id: t.id, card_id: cookCardId, evaluator_user_id: ev.id,
        submitted_at: status === "submitted" ? "2025-10-20T10:00:00+05:00" : null,
      });
      await db.insert(kpi_reviews).values([
        review(e.id, "2025-10-01", "submitted"),
        review(e.id, "2025-08-01", "submitted"),
        review(e.id, "2025-09-01", "draft"), // черновик: балл ещё считается по живым данным
        review(e.id, "2024-09-01", "submitted"), // раньше окна (окно с 25.10.2024)
        review(other.id, "2025-07-01", "submitted"), // чужая оценка
      ]);
      const f = await tgApi(token, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${e.id}`);
      expect(f.body.submitted_months).toEqual(["2025-08-01", "2025-10-01"]);
      const none = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      expect((await tgApi(token, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${none.id}`)).body.submitted_months).toEqual([]);
    });

    it("форма: причины, окно, лимит диапазона, уже выданные дни; права и назначение", async () => {
      setNow(NOW);
      const { e, token } = await world();
      await give(token, e.id, "2025-10-30", "2025-10-31");
      await closeMonth("2025-09-01");
      try {
        const f = await tgApi(token, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${e.id}`);
        expect(f.status).toBe(200);
        expect(f.body).toMatchObject({
          employee: { id: e.id },
          reasons: ["sick", "family", "time_off", "vacation", "schedule", "other"],
          window: { min: "2025-10-01", max: "2025-11-26" },
          max_range_days: 31,
          month_limit: 4,
          existing: ["2025-10-30", "2025-10-31"],
        });
      } finally {
        await reopenMonth("2025-09-01");
      }
      // Без закрытых месяцев нижняя граница — сегодня минус 366 дней.
      expect((await tgApi(token, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${e.id}`)).body.window.min).toBe("2024-10-25");

      const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: (await makeTerminal(db)).id });
      expect(await tgApi(token, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${foreign.id}`)).toEqual(OUT);
      expect(await tgApi(token, "GET", "/api/kpi/tg/ev/day-off-form")).toEqual(NOT_FOUND);
      expect(await tgApi(token, "GET", "/api/kpi/tg/ev/day-off-form?employee_id=x")).toEqual(NOT_FOUND);

      const viewer = await makeEvaluator(db, { perms: ["kpi.view"] });
      const viewerToken = await evSession(db, viewer.id);
      expect((await tgApi(viewerToken, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${e.id}`)).body).toEqual({ error: "forbidden" });
      expect((await give(viewerToken, e.id, "2025-10-27", "2025-10-27")).body).toEqual({ error: "forbidden" });
    });
  });
}
