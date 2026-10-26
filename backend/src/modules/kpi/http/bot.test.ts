import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/bot (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, bindTelegram, cleanupKpi, fakeBotApi, makeEmployee, makeScope, makeUser, newTelegramId, setNow, setup } = await import("./fixtures");
  const { employees, kpi_disputes, kpi_notifications, kpi_reviews, kpi_tg_bindings, kpi_violations } = await import("backend/drizzle/schema");
  const { getKpiQueue } = await import("../queue");
  const { setTestBotApi } = await import("../tg/bot-api");
  const { LANG_KEYBOARD } = await import("../tg/messages");
  const { bindingOf, createInvite } = await import("../tg/bindings");
  const { disputeStateKey } = await import("../tg/bot");
  const { and, eq } = await import("drizzle-orm");
  type Card = import("../types").Card;

  const SECRET = process.env.KPI_WEBHOOK_SECRET!;
  const P10 = "2025-10-01";
  const hook = (update: unknown, secret: string | null = SECRET) =>
    callApi("/api/kpi/bot/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
      body: JSON.stringify(update),
    });
  const say = (tg: number, text: string, type = "private") => ({
    update_id: 1,
    message: { message_id: 1, chat: { id: tg, type }, from: { id: tg, is_bot: false }, text },
  });
  const press = (tg: number, data: string) => ({
    update_id: 2,
    callback_query: { id: `cb-${tg}`, from: { id: tg, is_bot: false }, data, message: { message_id: 2, chat: { id: tg, type: "private" } } },
  });

  describe("kpi: вебхук бота", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let redis: Redis;
    let cookItems: string[];
    let cookCardId: string;
    let f: ReturnType<typeof fakeBotApi>;
    const last = () => f.sent[f.sent.length - 1]!.msg;

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      redis = new Redis({ host: process.env.REDIS_HOST ?? "localhost", port: parseInt(process.env.REDIS_PORT ?? "6379") });
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
      const cook = cards.find((c) => c.code === "cook")!;
      cookItems = cook.items.map((i) => i.id);
      cookCardId = cook.id;
    }, 180000);

    beforeEach(() => {
      f = fakeBotApi();
      setTestBotApi(f.api);
    });

    afterAll(async () => {
      setTestBotApi(null);
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      await redis.quit();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    async function submittedReview() {
      setNow("2025-10-25T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, ev.userId, { terminal_id: e.terminal_id });
      const d = await api(ev, "PUT", "/api/kpi/reviews/draft", {
        period: P10,
        employee_id: e.id,
        items: cookItems.slice(1).map((item_id) => ({ item_id, score: 100 })),
      });
      await api(ev, "POST", `/api/kpi/reviews/${d.body.review.id}/submit`, {});
      return { reviewId: d.body.review.id as string, employee: e, evaluatorId: ev.userId };
    }

    it("секрет: без заголовка и чужой — 401; без KPI_WEBHOOK_SECRET — 200 и тишина", async () => {
      expect((await hook(say(1, "/my"), null)).status).toBe(401);
      expect((await hook(say(1, "/my"), "wrong")).status).toBe(401);
      delete process.env.KPI_WEBHOOK_SECRET;
      try {
        expect((await hook(say(1, "/my"))).status).toBe(200);
      } finally {
        process.env.KPI_WEBHOOK_SECRET = SECRET;
      }
      expect(f.sent).toHaveLength(0);
    });

    it("/start по приглашению: привязка и выбор языка; повтор апдейта — снова «Готово!»; чужой телефон — недействительно", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const e = await makeEmployee(db);
      const hr = await makeUser(db);
      const inv = await createInvite(db, hr.id, { employee_id: e.id });
      const tg = newTelegramId();
      expect((await hook(say(tg, `/start kpi_${inv.token}`))).status).toBe(200);
      expect(last().text).toContain("Готово!");
      expect(last().reply_markup).toEqual(LANG_KEYBOARD);
      const [emp] = await db.select().from(employees).where(eq(employees.id, e.id));
      expect(last().text).toContain(`Вы подключены как <b>Тест Повар ${emp.last_name}</b>. Если это не вы — сообщите HR.`);
      await hook(say(tg, `/start kpi_${inv.token}`));
      expect(last().text).toContain("Готово!");
      expect(last().text).toContain(`<b>Тест Повар ${emp.last_name}</b>`);
      const rows = await db.select().from(kpi_tg_bindings).where(eq(kpi_tg_bindings.telegram_id, tg));
      expect(rows.map((r) => [r.employee_id, r.active, r.lang])).toEqual([[e.id, true, "ru"]]);
      await hook(say(newTelegramId(), `/start kpi_${inv.token}`));
      expect(last().text).toContain("Ссылка недействительна");
    });

    it("просроченное приглашение и /start без кода", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const e = await makeEmployee(db);
      const hr = await makeUser(db);
      const inv = await createInvite(db, hr.id, { employee_id: e.id });
      setNow("2025-11-02T10:00:00+05:00");
      const tg = newTelegramId();
      await hook(say(tg, `/start kpi_${inv.token}`));
      expect(last().text).toContain("Ссылка недействительна");
      await hook(say(tg, "/start"));
      expect(last().text).toContain("Этот чат не подключён");
    });

    it("язык: lang:uz сохраняется, ответ по-узбекски", async () => {
      const e = await makeEmployee(db);
      const b = await bindTelegram(db, { employee_id: e.id });
      await hook(press(b.telegram_id, "lang:uz"));
      expect(f.answered).toContain(`cb-${b.telegram_id}`);
      expect(last().text).toBe("Til: oʻzbekcha. /my buyrugʻi — qisqacha maʼlumot.");
      expect((await bindingOf(db, b.telegram_id)).employee?.lang).toBe("uz");
    });

    it("/my при KPI_MINIAPP_URL — кнопка «Открыть Мой KPI»; lang:uz ставит свою кнопку меню, lang:ru возвращает кнопку по умолчанию", async () => {
      const URL_ = "https://x.test/kpi-app/";
      const saved = process.env.KPI_MINIAPP_URL;
      try {
        const e = await makeEmployee(db);
        const b = await bindTelegram(db, { employee_id: e.id });
        delete process.env.KPI_MINIAPP_URL;
        await hook(say(b.telegram_id, "/my"));
        expect(last().reply_markup).toBeUndefined();
        await hook(press(b.telegram_id, "lang:ru"));
        expect(f.menus).toEqual([]);
        process.env.KPI_MINIAPP_URL = URL_;
        await hook(say(b.telegram_id, "/my"));
        expect(last().reply_markup).toEqual({ inline_keyboard: [[{ text: "Открыть Мой KPI", web_app: { url: URL_ } }]] });
        await hook(press(b.telegram_id, "lang:uz"));
        expect(f.menus).toEqual([{ chatId: b.telegram_id, button: { type: "web_app", text: "Mening KPI", web_app: { url: URL_ } } }]);
        await hook(press(b.telegram_id, "lang:uz"));
        expect(f.menus).toHaveLength(1);
        await hook(press(b.telegram_id, "lang:ru"));
        // русский чат не держит свою кнопку: следует за глобальной и не устареет при смене KPI_MINIAPP_URL
        expect(f.menus[1]).toEqual({ chatId: b.telegram_id, button: { type: "default" } });
        // без переменной язык меняется, а Telegram за кнопкой меню не зовётся
        delete process.env.KPI_MINIAPP_URL;
        await hook(press(b.telegram_id, "lang:uz"));
        expect(f.menus).toHaveLength(2);
      } finally {
        if (saved === undefined) delete process.env.KPI_MINIAPP_URL; else process.env.KPI_MINIAPP_URL = saved;
      }
    });

    it("/my сотрудника: три последние оценки и нарушения текущего месяца", async () => {
      setNow("2025-11-05T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      const b = await bindTelegram(db, { employee_id: e.id });
      const base = {
        employee_id: e.id,
        terminal_id: e.terminal_id,
        card_id: cookCardId,
        evaluator_user_id: randomUUID(),
        status: "submitted",
        submitted_at: "2025-11-01T05:00:00.000Z",
      };
      await db.insert(kpi_reviews).values(
        [
          ["2025-07-01", "70.00"],
          ["2025-08-01", "80.00"],
          ["2025-09-01", "90.00"],
          ["2025-10-01", "83.33"],
        ].map(([period, score_pct]) => ({ ...base, period, score_pct }))
      );
      const v = { terminal_id: e.terminal_id, employee_id: e.id, card_item_id: null, item_title_ru: null, comment: "Тест", recorded_by: randomUUID() };
      await db.insert(kpi_violations).values([
        { ...v, period: "2025-11-01", occurred_at: "2025-11-03T05:00:00.000Z", status: "active" },
        { ...v, period: "2025-11-01", occurred_at: "2025-11-04T05:00:00.000Z", status: "cancelled" },
        { ...v, period: "2025-10-01", occurred_at: "2025-10-20T05:00:00.000Z", status: "active" },
      ]);
      await hook(say(b.telegram_id, "/my"));
      expect(last().text).toBe(
        "<b>Ваши оценки</b>\n• октябрь 2025 — 83,33 %\n• сентябрь 2025 — 90 %\n• август 2025 — 80 %\n\n<b>Нарушения в этом месяце</b>\n• 03.11.2025 без пункта карты"
      );
    });

    it("/my оценщика: сколько ждут оценки", async () => {
      setNow("2025-11-05T10:00:00+05:00");
      const ev = await makeUser(db);
      const e = await makeEmployee(db, { role_code: "cook" });
      await makeScope(db, ev.id, { terminal_id: e.terminal_id });
      const b = await bindTelegram(db, { user_id: ev.id });
      await hook(say(b.telegram_id, "/my"));
      expect(last().text).toBe("<b>Оценки за октябрь 2025</b>\nЖдут вашей оценки: 1 сотрудник.\nСрок: 07.11.2025 23:59.");
    });

    it("две привязки: /start второй ссылки — «Теперь здесь и…»; /my — сначала оценщик, потом сотрудник; спор работает", async () => {
      const { reviewId, employee } = await submittedReview();          // 2025-10-25, окно спора открыто
      const u = await makeUser(db);
      const b = await bindTelegram(db, { employee_id: employee.id });
      const inv = await createInvite(db, u.id, { user_id: u.id });
      await hook(say(b.telegram_id, `/start kpi_${inv.token}`));
      expect(last().text.startsWith("Готово. Теперь здесь и ваши оценки, и напоминания оценщика.\n")).toBe(true);
      await hook(say(b.telegram_id, "/my"));
      const t = last().text;
      expect(t.indexOf("<b>Оценки за")).toBeLessThan(t.indexOf("<b>Ваши оценки</b>"));
      expect(t).toContain("\n\n<b>Ваши оценки</b>");
      await hook(press(b.telegram_id, `dispute:review:${reviewId}`));
      expect(last().text).toBe("Напишите причину спора ответом на это сообщение, не короче 5 символов. Ждём 15 минут.");
    });

    it("спор из бота: кнопка → короткая причина → причина → спор opened_via telegram; повтор текста — подсказка", async () => {
      const { reviewId, employee, evaluatorId } = await submittedReview();
      const b = await bindTelegram(db, { employee_id: employee.id });
      setNow("2025-11-05T10:00:00+05:00");
      await hook(press(b.telegram_id, `dispute:review:${reviewId}`));
      expect(f.answered).toContain(`cb-${b.telegram_id}`);
      expect(last()).toEqual({
        text: "Напишите причину спора ответом на это сообщение, не короче 5 символов. Ждём 15 минут.",
        reply_markup: { force_reply: true },
      });
      await hook(say(b.telegram_id, "нет"));
      expect(last().text).toContain("Причина слишком короткая");
      expect(await redis.get(disputeStateKey(b.telegram_id))).not.toBeNull();
      await hook(say(b.telegram_id, "Не согласен с баллом за чистоту"));
      expect(last().text).toBe("Спор открыт. Решение придёт сюда.");
      const ds = await db.select().from(kpi_disputes).where(eq(kpi_disputes.subject_id, reviewId));
      expect(ds.map((d) => [d.opened_via, d.opened_by_user_id, d.status, d.reason])).toEqual([
        ["telegram", null, "open", "Не согласен с баллом за чистоту"],
      ]);
      const [n] = await db
        .select()
        .from(kpi_notifications)
        .where(and(eq(kpi_notifications.kind, "dispute_opened"), eq(kpi_notifications.user_id, evaluatorId)));
      expect(n.payload).toMatchObject({ subject_type: "review", subject_id: reviewId, period: P10, reason: "Не согласен с баллом за чистоту" });
      // доставка dispute_opened поставлена в очередь после коммита (fire-and-forget: ждём недолго)
      let job = await getKpiQueue().getJob(n.id);
      for (let i = 0; !job && i < 20; i++) {
        await new Promise((r) => setTimeout(r, 50));
        job = await getKpiQueue().getJob(n.id);
      }
      expect(job).toBeTruthy();
      expect(await redis.get(disputeStateKey(b.telegram_id))).toBeNull();
      await hook(say(b.telegram_id, "Не согласен с баллом за чистоту"));
      expect(last().text).toBe("Команда /my — ваша сводка.");
      await hook(press(b.telegram_id, `dispute:review:${reviewId}`));
      await hook(say(b.telegram_id, "Всё ещё не согласен"));
      expect(last().text).toBe("Спор по этой записи уже открыт.");
      expect(await db.select().from(kpi_disputes).where(eq(kpi_disputes.subject_id, reviewId))).toHaveLength(1);
    });

    it("/start: имя в ответе экранируется как HTML", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const e = await makeEmployee(db, { first_name: "Тест <b>&Повар" });
      const hr = await makeUser(db);
      const inv = await createInvite(db, hr.id, { employee_id: e.id });
      const [emp] = await db.select().from(employees).where(eq(employees.id, e.id));
      await hook(say(newTelegramId(), `/start kpi_${inv.token}`));
      expect(last().text).toContain(`<b>Тест &lt;b&gt;&amp;Повар ${emp.last_name}</b>`);
      expect(last().text).not.toContain("<b>Тест <b>");
    });

    it("уволенный сотрудник: /my и язык — «не подключён», причина спора не создаёт запись", async () => {
      const { reviewId, employee } = await submittedReview();
      const b = await bindTelegram(db, { employee_id: employee.id });
      setNow("2025-11-05T10:00:00+05:00");
      await hook(say(b.telegram_id, "/my"));
      expect(last().text).not.toContain("Этот чат не подключён");
      await hook(press(b.telegram_id, `dispute:review:${reviewId}`));
      expect(last().text).toContain("Напишите причину спора");
      expect(await redis.get(disputeStateKey(b.telegram_id))).not.toBeNull();
      await db.update(employees).set({ active: false }).where(eq(employees.id, employee.id));
      await hook(say(b.telegram_id, "Не согласен с баллом за чистоту"));
      expect(last().text).toBe("Эту запись оспорить нельзя.");
      expect(await db.select().from(kpi_disputes).where(eq(kpi_disputes.subject_id, reviewId))).toHaveLength(0);
      expect(await redis.get(disputeStateKey(b.telegram_id))).toBeNull();
      await hook(say(b.telegram_id, "/my"));
      expect(last().text).toContain("Этот чат не подключён");
      await hook(press(b.telegram_id, "lang:uz"));
      expect(last().text).toContain("Этот чат не подключён");
      const [row] = await db.select().from(kpi_tg_bindings).where(eq(kpi_tg_bindings.id, b.id));
      expect(row.lang).toBe("ru");
    });

    it("чужая оценка и смена привязки между кнопкой и причиной — «нельзя оспорить»", async () => {
      const { reviewId, employee } = await submittedReview();
      setNow("2025-11-05T10:00:00+05:00");
      const stranger = await makeEmployee(db);
      const s = await bindTelegram(db, { employee_id: stranger.id });
      await hook(press(s.telegram_id, `dispute:review:${reviewId}`));
      expect(last().text).toBe("Эту запись оспорить нельзя.");
      expect(await redis.get(disputeStateKey(s.telegram_id))).toBeNull();
      const b = await bindTelegram(db, { employee_id: employee.id });
      await hook(press(b.telegram_id, `dispute:review:${reviewId}`));
      // привязку сменили; сначала гасим старую привязку stranger, иначе сработает частичный уникальный индекс
      await db.update(kpi_tg_bindings).set({ active: false }).where(eq(kpi_tg_bindings.id, s.id));
      await db.update(kpi_tg_bindings).set({ employee_id: stranger.id }).where(eq(kpi_tg_bindings.id, b.id));
      await hook(say(b.telegram_id, "Не согласен с баллом за чистоту"));
      expect(last().text).toBe("Эту запись оспорить нельзя.");
      expect(await db.select().from(kpi_disputes).where(eq(kpi_disputes.subject_id, reviewId))).toHaveLength(0);
    });

    it("после срока споров — «срок прошёл», состояния нет", async () => {
      const { reviewId, employee } = await submittedReview();
      const b = await bindTelegram(db, { employee_id: employee.id });
      setNow("2025-11-11T10:00:00+05:00");
      await hook(press(b.telegram_id, `dispute:review:${reviewId}`));
      expect(last().text).toBe("Срок споров за этот месяц прошёл.");
      expect(await redis.get(disputeStateKey(b.telegram_id))).toBeNull();
    });

    it("группа — тишина; исключение в отправке — всё равно 200", async () => {
      const e = await makeEmployee(db);
      const b = await bindTelegram(db, { employee_id: e.id });
      expect((await hook(say(b.telegram_id, "/my", "group"))).status).toBe(200);
      expect(f.sent).toHaveLength(0);
      setTestBotApi({ send: async () => { throw new Error("boom"); }, answerCallback: async () => ({ ok: true, message_id: null }) });
      expect((await hook(say(b.telegram_id, "/my"))).status).toBe(200);
    });

    it("нарушение: спор владельца открывается, чужой — нельзя; мусорное состояние в Redis не роняет вебхук", async () => {
      setNow("2025-11-05T10:00:00+05:00");
      const e = await makeEmployee(db);
      const b = await bindTelegram(db, { employee_id: e.id });
      const stranger = await makeEmployee(db);
      const s = await bindTelegram(db, { employee_id: stranger.id });
      const [viol] = await db
        .insert(kpi_violations)
        .values({ terminal_id: e.terminal_id, employee_id: e.id, period: "2025-11-01", occurred_at: "2025-11-03T05:00:00.000Z", status: "active", comment: "Тест", recorded_by: randomUUID() })
        .returning();
      await hook(press(s.telegram_id, `dispute:violation:${viol.id}`));
      expect(last().text).toBe("Эту запись оспорить нельзя.");
      await hook(press(b.telegram_id, `dispute:violation:${viol.id}`));
      expect(last().text).toContain("Напишите причину спора");
      await hook(say(b.telegram_id, "Это было не моё дежурство"));
      expect(last().text).toBe("Спор открыт. Решение придёт сюда.");
      const ds = await db.select().from(kpi_disputes).where(eq(kpi_disputes.subject_id, viol.id));
      expect(ds.map((d) => [d.subject_type, d.opened_via])).toEqual([["violation", "telegram"]]);
      await redis.set(disputeStateKey(b.telegram_id), "{не json", "EX", 60);
      expect((await hook(say(b.telegram_id, "Причина после мусора"))).status).toBe(200);
      expect(last().text).toBe("Команда /my — ваша сводка.");
    });

    it("внутренняя ошибка: 200, в ответ — общее сообщение, токен приглашения в лог не попадает", async () => {
      const errors: string[] = [];
      const orig = console.error;
      console.error = (...a: unknown[]) => void errors.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : String(x))).join(" "));
      const token = "0123456789abcdef0123456789abcdef";
      const tg = newTelegramId();
      const sent: string[] = [];
      let calls = 0;
      setTestBotApi({
        send: async (_chat, msg) => {
          if (calls++ === 0) throw new Error(`boom kpi_${token}`);
          sent.push(msg.text);
          return { ok: true, message_id: 1 };
        },
        answerCallback: async () => ({ ok: true, message_id: null }),
      });
      try {
        expect((await hook(say(tg, `/start kpi_${token}`))).status).toBe(200);
      } finally {
        console.error = orig;
      }
      expect(sent).toEqual(["Не получилось. Попробуйте позже."]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).not.toContain(token);
    });
  });
}
