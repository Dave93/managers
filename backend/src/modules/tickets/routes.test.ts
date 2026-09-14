import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// `bun test src/modules/tickets/` (задача 10 гоняет этот путь как общий
// gate поверх всего модуля — семь чисто-юнитовых файлов вроде state.test.ts,
// fields.test.ts, у которых тестовой БД нет и не должно быть) раньше
// безусловно тянул за собой ../../../tests/helpers/http статическим
// импортом. Его собственный fail-fast (см. tests/helpers/http.ts) абсолютно
// прав, что бросает исключение вне настоящего тестового окружения — гонять
// эти тесты по продовой базе было бы ровно той катастрофой, которую он
// предотвращает. Но бросать исключение — не то же самое, что молча ронять
// весь модульный прогон: "1 fail + 1 error" на голом bun test делает
// красными все 135 остальных честно зелёных тестов, у которых с этим файлом
// нет ничего общего.
//
// Поэтому решение "запускать по-настоящему или пропустить" принимается
// здесь, ДО импорта чего-либо, что бросает — а сам import harness/схемы/orm
// откладывается в динамический import() внутри ветки "запускать", чтобы
// голый bun test вообще не долетал до кода, который может упасть.
//
// Условие — ИЛИ, а не И: если хотя бы один из двух сигналов похож на
// тестовый (DATABASE_URL оканчивается на /managers_tickets_test, или
// PROJECT_PREFIX равен managers_test_ — второе test:http выставляет
// БЕЗУСЛОВНО, что бы ни случилось с DATABASE_URL снаружи), это значит, что
// кто-то целился в тестовый режим, и долг перед этим намерением — довести
// проверку до конца настоящим fail-fast, а не тихо съехать в skip. Проверено
// эмпирически: `DATABASE_URL=postgresql://.../managers bun run test:http` с
// НЕэкспортированным TEST_DATABASE_URL — ровно сценарий "кто-то по ошибке
// целился в тест, но что-то не так" — на деле доезжает до `bun test` с
// PROJECT_PREFIX=managers_test_ (test:http всегда так ставит) и
// DATABASE_URL="" (пустая строка — сам скрипт своим же
// `DATABASE_URL=$TEST_DATABASE_URL` затирает внешнее значение, если
// TEST_DATABASE_URL не экспортирован; внешний "managers" наружу не
// протекает вообще). PROJECT_PREFIX здесь равен managers_test_, то есть хотя
// бы один сигнал "похож на тест" есть — значит ветка "запускать" верна, а
// внутри неё уже helpers/http.ts бросает исключение на пустом DATABASE_URL с
// понятным сообщением. Только когда НИ ОДИН сигнал не похож на тестовый
// (это и есть голый `bun test src/modules/tickets/` без единого env
// override — состояние задачи 10) — тесты этого файла пропускаются.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("доступ к заявкам (пропущено: запускайте через bun run test:http)", () => {
    it("пропущено — нет тестового окружения (DATABASE_URL/PROJECT_PREFIX не похожи на тестовые)", () => {});
  });
} else {
  const { callApi, closeTestRedis, ensureApp, withSession } = await import("../../../tests/helpers/http");
  // Схема и БД оба через "голый" baseUrl-путь от корня репозитория (тот же
  // стиль, что и schema-импорт в controller.ts), а не через алиас
  // "@backend/*" для одного и не через него же для другого — "@backend/*"
  // (см. tsconfig.json репозитория) резолвится только внутрь backend/src/*, а
  // drizzle/schema.ts лежит вне src, так что смешивать стили означало бы, что
  // один из двух путей резолвится иначе, чем выглядит.
  const { drizzleDb } = await import("backend/src/lib/db");
  const { ticket_types, tickets } = await import("backend/drizzle/schema");
  const { eq, inArray } = await import("drizzle-orm");

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
          expect(ids).toContain(mineTicketId!);
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
          expect(ids).toContain(mineTicketId!);
          expect(ids).toContain(otherTicketId!);
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
}
