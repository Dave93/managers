import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { callApi, closeTestRedis, ensureApp, withSession } from "../../../tests/helpers/http";
// Схема и БД оба через "голый" baseUrl-путь от корня репозитория (тот же
// стиль, что и schema-импорт в controller.ts), а не через алиас
// "@backend/*" для одного и не через него же для другого — "@backend/*"
// (см. tsconfig.json репозитория) резолвится только внутрь backend/src/*, а
// drizzle/schema.ts лежит вне src, так что смешивать стили означало бы, что
// один из двух путей резолвится иначе, чем выглядит.
import { drizzleDb } from "backend/src/lib/db";
import { ticket_types, tickets } from "backend/drizzle/schema";
import { eq, inArray } from "drizzle-orm";

const call = (path: string, init: RequestInit = {}) => callApi(path, init);

describe("доступ к заявкам", () => {
  // ensureApp() (первый импорт src/app) поднимает весь Elysia-граф — по
  // отчёту задачи 1, холодный старт занимает ~30-35с на этой машине. Первый
  // тест ниже не проходит через withSession() (у него нет сессии вовсе), а
  // значит не получает бесплатный прогрев, который withSession() делает для
  // всех остальных тестов файла (она сама зовёт ensureApp() первой строкой).
  // Без явного прогрева здесь первый тест наткнулся бы на дефолтный
  // 5-секундный таймаут bun:test прямо на импорте приложения — не на
  // проверяемой логике. Прогреваем один раз здесь, с запасом по времени.
  beforeAll(async () => {
    await ensureApp();
  }, 60000);

  it("без сессии отдаёт 401", async () => {
    const res = await call("/api/tickets?limit=10&offset=0");
    expect(res.status).toBe(401);
  });

  it("с сессией без нужного права отдаёт 403", async () => {
    const s = await withSession({ permissions: ["users.list"] });
    try {
      const res = await call("/api/tickets?limit=10&offset=0", { headers: s.headers });
      expect(res.status).toBe(403);
    } finally {
      await s.cleanup();
    }
  });

  it("с правом tickets.list отдаёт список", async () => {
    const s = await withSession({ permissions: ["tickets.list"] });
    try {
      const res = await call("/api/tickets?limit=10&offset=0", { headers: s.headers });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("data");
      expect(Array.isArray(body.data)).toBe(true);
    } finally {
      await s.cleanup();
    }
  });

  it("несуществующая заявка отдаёт 404, а не 500", async () => {
    const s = await withSession({ permissions: ["tickets.list"] });
    try {
      const res = await call("/api/tickets/99999999-9999-9999-9999-999999999999", { headers: s.headers });
      expect(res.status).toBe(404);
    } finally {
      await s.cleanup();
    }
  });

  it("кривой id отдаёт 404, а не ошибку базы", async () => {
    const s = await withSession({ permissions: ["tickets.list"] });
    try {
      const res = await call("/api/tickets/not-a-uuid", { headers: s.headers });
      expect(res.status).toBe(404);
    } finally {
      await s.cleanup();
    }
  });

  it("утверждение сумм закрыто от роли без этого права", async () => {
    const s = await withSession({ permissions: ["tickets.list", "tickets.close"] });
    try {
      const res = await call("/api/tickets/payment/approve", {
        method: "POST",
        headers: { ...s.headers, "content-type": "application/json" },
        body: JSON.stringify({ ids: ["11111111-1111-1111-1111-111111111111"] }),
      });
      expect(res.status).toBe(403);
    } finally {
      await s.cleanup();
    }
  });

  it("справочники закрыты от менеджера", async () => {
    const s = await withSession({ permissions: ["tickets.create", "tickets.list"] });
    try {
      const res = await call("/api/ticket_contractors", { headers: s.headers });
      expect(res.status).toBe(403);
    } finally {
      await s.cleanup();
    }
  });

  it("список типов доступен по праву создания", async () => {
    const s = await withSession({ permissions: ["tickets.create"] });
    try {
      const res = await call("/api/ticket_types", { headers: s.headers });
      expect(res.status).toBe(200);
    } finally {
      await s.cleanup();
    }
  });

  // tickets.contractors.manage выше уже проверен на GET /ticket_contractors;
  // tickets.types.manage — отдельное право на том же справочном кластере
  // (управление типами заявок), и до фикса ревью его не проверял никто —
  // молчаливая дырка ровно того класса, ради которого существует этот файл.
  // Роль ниже — типичный менеджер филиала: может завести заявку (create) и
  // читать список (list), но не должен трогать конфигурацию типов. PUT, а
  // не POST — тело PUT/ticket_types/:id целиком опциональное, так что {}
  // проходит валидацию схемы без обвязки лишними полями, и единственная
  // причина отказа — сам macro-геймкип по permission, до того как хендлер
  // хоть раз посмотрит на id.
  it("управление типами заявок закрыто от менеджера", async () => {
    const s = await withSession({ permissions: ["tickets.create", "tickets.list"] });
    try {
      const res = await call(`/api/ticket_types/${randomUUID()}`, {
        method: "PUT",
        headers: { ...s.headers, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    } finally {
      await s.cleanup();
    }
  });

  // Пустая база не даёт проверить скоуп по терминалам на трюизме — цикл по
  // пустому data[] прошёл бы, даже если весь WHERE inArray(terminal_id, ...)
  // выпилить из контроллера. Поэтому заводим реальные строки в tickets
  // напрямую (в тестовую БД, не через API — вложения/файлы тут не нужны) в
  // двух разных филиалах, и проверяем, что чужая заявка не протекает ни в
  // список, ни в GET по id, ни в оплату. tickets.terminal_id/organization_id
  // не имеют FK (см. drizzle/schema.ts и миграцию 0024_tickets_core.sql —
  // только type_id и assigned_executor_id ссылаются наружу), поэтому
  // терминалы можно взять произвольными UUID, а не заводить реальные строки
  // terminals.
  describe("филиальный скоуп (с фикстурными заявками)", () => {
    const mineTerminal = randomUUID();
    const otherTerminal = randomUUID();
    let typeId: string | undefined;
    let mineTicketId: string | undefined;
    let otherTicketId: string | undefined;
    // Отдельно от mineTicketId/otherTicketId (те — для читаемости в текстах
    // тестов) — эта пара used-for-cleanup id собирается по ходу вставки, а
    // не постфактум из двух переменных. Если вторая вставка упадёт,
    // otherTicketId останется undefined, а inArray(..., [id, undefined])
    // либо не найдёт вторую строку (не страшно — её и не создали), либо (в
    // худшем случае — драйвер откажется биндить undefined) уронит сам DELETE
    // и оставит первую строку сиротой вместе с типом. Массив ниже копится по
    // мере успеха каждой вставки, так что afterAll убирает ровно то, что
    // реально создалось — ни больше (не упадёт на undefined), ни меньше
    // (не потеряет успешную первую вставку из-за провала второй).
    const createdTicketIds: string[] = [];

    beforeAll(async () => {
      const [type] = await drizzleDb
        .insert(ticket_types)
        .values({
          code: "test_scope_" + randomUUID().slice(0, 8),
          number_prefix: "TS",
          name_ru: "Тестовый тип (скоуп)",
          name_uz: "Test turi (scope)",
          executor_kind: "staff",
          fields_schema: [],
        })
        .returning({ id: ticket_types.id });
      typeId = type.id;

      const [mine] = await drizzleDb
        .insert(tickets)
        .values({
          type_id: typeId,
          terminal_id: mineTerminal,
          organization_id: randomUUID(),
          created_by: randomUUID(),
        })
        .returning({ id: tickets.id });
      mineTicketId = mine.id;
      createdTicketIds.push(mine.id);

      const [other] = await drizzleDb
        .insert(tickets)
        .values({
          type_id: typeId,
          terminal_id: otherTerminal,
          organization_id: randomUUID(),
          created_by: randomUUID(),
        })
        .returning({ id: tickets.id });
      otherTicketId = other.id;
      createdTicketIds.push(other.id);
    });

    afterAll(async () => {
      // Не зависит от того, сколько вставок в beforeAll реально дошло до
      // конца: пустой массив → delete .where(inArray(..., [])) — валидный
      // no-op запрос, а не ошибка биндинга. typeId проверяется отдельно —
      // если упала самая первая вставка (типа), убирать нечего вовсе.
      if (createdTicketIds.length > 0) {
        await drizzleDb.delete(tickets).where(inArray(tickets.id, createdTicketIds));
      }
      if (typeId) {
        await drizzleDb.delete(ticket_types).where(inArray(ticket_types.id, [typeId]));
      }
    });

    it("список видит только заявку своего филиала", async () => {
      const s = await withSession({ permissions: ["tickets.list"], terminals: [mineTerminal] });
      try {
        const res = await call("/api/tickets?limit=200&offset=0", { headers: s.headers });
        expect(res.status).toBe(200);
        const body = await res.json();
        const ids: string[] = body.data.map((r: { id: string }) => r.id);
        expect(ids).toContain(mineTicketId);
        expect(ids).not.toContain(otherTicketId);
      } finally {
        await s.cleanup();
      }
    });

    it("заявка чужого филиала отдаётся как 404, а не 200 с чужими данными", async () => {
      const s = await withSession({ permissions: ["tickets.list"], terminals: [mineTerminal] });
      try {
        const res = await call(`/api/tickets/${otherTicketId}`, { headers: s.headers });
        expect(res.status).toBe(404);
      } finally {
        await s.cleanup();
      }
    });

    it("офисная роль без ограничения по филиалу видит заявки обоих филиалов", async () => {
      const s = await withSession({ permissions: ["tickets.list"] });
      try {
        const res = await call("/api/tickets?limit=200&offset=0", { headers: s.headers });
        expect(res.status).toBe(200);
        const body = await res.json();
        const ids: string[] = body.data.map((r: { id: string }) => r.id);
        expect(ids).toContain(mineTicketId);
        expect(ids).toContain(otherTicketId);
      } finally {
        await s.cleanup();
      }
    });

    // Дешёвая проверка на пути создания: филиальная проверка в POST /tickets
    // читается из body.terminal_id/session.terminals ДО файловых проверок и
    // ДО любой записи на диск или в базу (см. controller.ts — она идёт сразу
    // после проверки типа заявки и раньше цикла checkUpload/saveAttachment).
    // Поэтому "чужой филиал" ловится без побочных эффектов: файл всё равно
    // нужен, чтобы пройти валидацию тела запроса (photos не Optional в
    // схеме), но его содержимое не важно — до saveAttachment хендлер не
    // дойдёт.
    it("создание заявки на чужой филиал закрыто 403 до записи на диск", async () => {
      const s = await withSession({ permissions: ["tickets.create"], terminals: [mineTerminal] });
      try {
        const form = new FormData();
        form.append("type_id", typeId!);
        form.append("terminal_id", otherTerminal);
        form.append("photos", new File([new Uint8Array([1, 2, 3, 4])], "probe.jpg", { type: "image/jpeg" }));
        const res = await call("/api/tickets", { method: "POST", headers: s.headers, body: form });
        expect(res.status).toBe(403);
      } finally {
        await s.cleanup();
      }
    });
  });

  // Скоуп по терминалам на GET-путях проверен выше; applyPaymentDecision
  // (POST /tickets/payment/approve) — отдельный WHERE в отдельной функции
  // (см. controller.ts) и легко может разойтись с GET-путями по одному полю,
  // как в этом плане уже случалось между close/reopen/cancel. Заявка ниже
  // сделана "к оплате" прямой вставкой — минуя жизненный цикл (claim/submit/
  // accept), потому что здесь проверяется не жизненный цикл, а то, что
  // approve не трогает деньги филиала, которого нет в сессии.
  describe("оплата — филиальный скоуп (с фикстурной заявкой)", () => {
    const myTerminal = randomUUID();
    const foreignTerminal = randomUUID();
    let typeId: string | undefined;
    let foreignTicketId: string | undefined;
    const createdTicketIds: string[] = [];

    beforeAll(async () => {
      const [type] = await drizzleDb
        .insert(ticket_types)
        .values({
          code: "test_pay_scope_" + randomUUID().slice(0, 8),
          number_prefix: "TP",
          name_ru: "Тестовый тип (оплата)",
          name_uz: "Test turi (to'lov)",
          executor_kind: "staff",
          fields_schema: [],
        })
        .returning({ id: ticket_types.id });
      typeId = type.id;

      const [ticket] = await drizzleDb
        .insert(tickets)
        .values({
          type_id: typeId,
          terminal_id: foreignTerminal,
          organization_id: randomUUID(),
          created_by: randomUUID(),
          status: "closed",
          payment_status: "pending",
          work_total_amount: "150.00",
        })
        .returning({ id: tickets.id });
      foreignTicketId = ticket.id;
      createdTicketIds.push(ticket.id);
    });

    afterAll(async () => {
      if (createdTicketIds.length > 0) {
        await drizzleDb.delete(tickets).where(inArray(tickets.id, createdTicketIds));
      }
      if (typeId) {
        await drizzleDb.delete(ticket_types).where(inArray(ticket_types.id, [typeId]));
      }
    });

    it("филиальная роль не может утвердить оплату заявки чужого филиала", async () => {
      const s = await withSession({ permissions: ["tickets.payment.approve"], terminals: [myTerminal] });
      try {
        const res = await call("/api/tickets/payment/approve", {
          method: "POST",
          headers: { ...s.headers, "content-type": "application/json" },
          body: JSON.stringify({ ids: [foreignTicketId] }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        // Ответ мог бы молчать о реальном исходе (например, всегда отвечать
        // approved:1, даже если WHERE ничего не задел) — поэтому решает не
        // тело ответа само по себе, а повторное чтение строки из тестовой
        // базы: если approve всё же прошёл, payment_status сменился бы на
        // "approved" независимо от того, что вернул HTTP-ответ.
        expect(body.approved).toBe(0);
        expect(body.skipped).toBe(1);

        const [row] = await drizzleDb
          .select({ payment_status: tickets.payment_status })
          .from(tickets)
          .where(eq(tickets.id, foreignTicketId!));
        expect(row?.payment_status).toBe("pending");
      } finally {
        await s.cleanup();
      }
    });
  });

  afterAll(async () => {
    await closeTestRedis();
  });
});
