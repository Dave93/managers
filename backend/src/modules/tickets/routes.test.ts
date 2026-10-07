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
  const {
    terminals,
    ticket_comments,
    ticket_contractors,
    ticket_events,
    ticket_executors,
    ticket_types,
    tickets,
    users,
  } = await import("backend/drizzle/schema");
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
    // Узкий помощник вместо `!`: `beforeAll` ниже гарантирует, что
    // mineTicketId/otherTicketId определены к моменту любого it(), но эта
    // гарантия рвётся между областью видимости beforeAll и it() — TypeScript
    // не умеет проносить сужение через границу двух отдельных колбэков. `!`
    // заставил бы компилятор молчать и на настоящей регрессии (например,
    // если будущий рефакторинг beforeAll сломает порядок присваивания);
    // must() вместо этого либо реально сужает тип, либо падает явной
    // ошибкой "fixture … не создана", а не непонятным toContain(undefined).
    function must<T>(v: T | undefined, name: string): T {
      if (v === undefined) throw new Error(`fixture ${name} не создана`);
      return v;
    }

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
        const mine = must(mineTicketId, "mineTicketId");
        const s = await withSession({ permissions: ["tickets.list"], terminals: [mineTerminal] });
        try {
          const res = await call("/api/tickets?limit=200&offset=0", { headers: s.headers });
          expect(res.status).toBe(200);
          const body = await res.json();
          const ids: string[] = body.data.map((r: { id: string }) => r.id);
          expect(ids).toContain(mine);
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
        const mine = must(mineTicketId, "mineTicketId");
        const other = must(otherTicketId, "otherTicketId");
        const s = await withSession({ permissions: ["tickets.list"] });
        try {
          const res = await call("/api/tickets?limit=200&offset=0", { headers: s.headers });
          expect(res.status).toBe(200);
          const body = await res.json();
          const ids: string[] = body.data.map((r: { id: string }) => r.id);
          expect(ids).toContain(mine);
          expect(ids).toContain(other);
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

    // Карточке нужны имена филиала, исполнителя и автора, и все три приходят с
    // сервера: второго запроса из браузера нет. Фикстуры настоящие (строки
    // terminals/users/ticket_executors), потому что на пустой связи тест
    // прошёл бы и при выкинутом join-е — null он и есть null.
    describe("карточка заявки — имена и скрытые поля (с фикстурами)", () => {
      const suffix = randomUUID().slice(0, 8);
      let typeId: string | undefined;
      let terminalId: string | undefined;
      let contractorId: string | undefined;
      let executorId: string | undefined;
      let namedUserId: string | undefined;
      let loginOnlyUserId: string | undefined;
      let fullTicketId: string | undefined;
      let loginOnlyTicketId: string | undefined;
      let danglingTicketId: string | undefined;
      const loginOnly = "card_login_only_" + suffix;
      // Заведомо узнаваемое значение вместо "x": по нему утечку видно и тогда,
      // когда колонка попала в ответ под другим именем.
      const passwordSentinel = "SENTINEL-PASSWORD-" + suffix;
      const createdTicketIds: string[] = [];
      const createdExecutorIds: string[] = [];

      beforeAll(async () => {
        const [type] = await drizzleDb
          .insert(ticket_types)
          .values({
            code: "test_card_" + suffix,
            number_prefix: "TC",
            name_ru: "Тестовый тип (карточка)",
            name_uz: "Test turi (karta)",
            executor_kind: "external",
            fields_schema: [],
          })
          .returning({ id: ticket_types.id });
        typeId = type.id;

        const [terminal] = await drizzleDb
          .insert(terminals)
          .values({
            name: "Тестовый филиал " + suffix,
            latitude: 41.3,
            longitude: 69.2,
            organization_id: randomUUID(),
          })
          .returning({ id: terminals.id });
        terminalId = terminal.id;

        const [contractor] = await drizzleDb
          .insert(ticket_contractors)
          .values({ name: "Тестовая фирма " + suffix })
          .returning({ id: ticket_contractors.id });
        contractorId = contractor.id;

        const [executor] = await drizzleDb
          .insert(ticket_executors)
          .values({ kind: "external", contractor_id: contractorId, full_name: "Мастер Тестов " + suffix })
          .returning({ id: ticket_executors.id });
        executorId = executor.id;
        createdExecutorIds.push(executor.id);

        const [named] = await drizzleDb
          .insert(users)
          .values({
            login: "card_named_" + suffix,
            password: passwordSentinel,
            status: "active",
            first_name: "Иван",
            last_name: "Петров",
          })
          .returning({ id: users.id });
        namedUserId = named.id;

        const [bare] = await drizzleDb
          .insert(users)
          .values({ login: loginOnly, password: passwordSentinel, status: "active" })
          .returning({ id: users.id });
        loginOnlyUserId = bare.id;

        const insertTicket = async (v: {
          terminal_id: string;
          created_by: string;
          assigned_executor_id?: string;
        }) => {
          const [row] = await drizzleDb
            .insert(tickets)
            .values({ type_id: typeId!, organization_id: randomUUID(), ...v })
            .returning({ id: tickets.id });
          createdTicketIds.push(row.id);
          return row.id;
        };
        fullTicketId = await insertTicket({
          terminal_id: terminalId,
          created_by: namedUserId,
          assigned_executor_id: executorId,
        });
        loginOnlyTicketId = await insertTicket({ terminal_id: terminalId, created_by: loginOnlyUserId });
        // Ни филиала, ни автора в справочниках нет (FK на эти колонки нет).
        danglingTicketId = await insertTicket({ terminal_id: randomUUID(), created_by: randomUUID() });
      }, 30000);

      afterAll(async () => {
        if (createdTicketIds.length > 0) {
          await drizzleDb.delete(tickets).where(inArray(tickets.id, createdTicketIds));
        }
        if (createdExecutorIds.length > 0) {
          await drizzleDb.delete(ticket_executors).where(inArray(ticket_executors.id, createdExecutorIds));
        }
        if (contractorId) await drizzleDb.delete(ticket_contractors).where(eq(ticket_contractors.id, contractorId));
        const userIds = [namedUserId, loginOnlyUserId].filter((v): v is string => v !== undefined);
        if (userIds.length > 0) await drizzleDb.delete(users).where(inArray(users.id, userIds));
        if (terminalId) await drizzleDb.delete(terminals).where(eq(terminals.id, terminalId));
        if (typeId) await drizzleDb.delete(ticket_types).where(eq(ticket_types.id, typeId));
      });

      const getCard = async (id: string) => {
        const s = await withSession({ permissions: ["tickets.list"] });
        try {
          const res = await call(`/api/tickets/${id}`, { headers: s.headers });
          return { status: res.status, body: await res.json() };
        } finally {
          await s.cleanup();
        }
      };

      it("отдаёт имена филиала, исполнителя и автора", async () => {
        const { status, body } = await getCard(must(fullTicketId, "fullTicketId"));
        expect(status).toBe(200);
        expect(body.terminal_name).toBe("Тестовый филиал " + suffix);
        expect(body.executor_name).toBe("Мастер Тестов " + suffix);
        expect(body.author_name).toBe("Иван Петров");
        expect(body.type.name_ru).toBe("Тестовый тип (карточка)");
      });

      it("у автора без имени подставляет login", async () => {
        const { status, body } = await getCard(must(loginOnlyTicketId, "loginOnlyTicketId"));
        expect(status).toBe(200);
        expect(body.author_name).toBe(loginOnly);
        expect(body.executor_name).toBeNull();
      });

      it("повисший id филиала и автора даёт null, а не 404", async () => {
        const { status, body } = await getCard(must(danglingTicketId, "danglingTicketId"));
        expect(status).toBe(200);
        expect(body.terminal_name).toBeNull();
        expect(body.executor_name).toBeNull();
        expect(body.author_name).toBeNull();
      });

      // join с users не должен втащить в ответ строку пользователя. Голый
      // .select() с join-ом отдаёт вложенные объекты ({ tickets, users: {...} }),
      // поэтому проверяется сериализованный ответ целиком, а не список верхних
      // ключей: на верхнем уровне password не появился бы никогда. Колонки —
      // те, что реально есть в схеме users: учётные данные и токены (password,
      // salt, api_token, fcm_token, attestation_pin_hash, tg_id) и личные
      // данные (phone, email, birth_date, doc_files, is_super_user, role_id,
      // department). author_name при этом собирается из них, но сам исходный
      // login у автора с именем в ответ попасть не должен.
      it("не отдаёт ничего лишнего из users", async () => {
        const { body } = await getCard(must(fullTicketId, "fullTicketId"));
        const json = JSON.stringify(body);
        const forbidden = [
          "password",
          "salt",
          "api_token",
          "fcm_token",
          "attestation_pin_hash",
          "tg_id",
          "phone",
          "email",
          "birth_date",
          "doc_files",
          "is_super_user",
          "role_id",
          "department",
          "author_first_name",
          "author_last_name",
          "author_login",
        ];
        for (const key of forbidden) {
          expect(json).not.toContain(`"${key}"`);
        }
        expect(json).not.toContain(passwordSentinel);
        expect(json).not.toContain("card_named_" + suffix);
      });

      // Одноразовый токен приглашения нужен ровно одному роуту — выдаче ссылки.
      // Список, создание и правка отдают справочник всем, у кого есть право
      // читать его, и токен там лежать не должен.
      it("справочник исполнителей не отдаёт invite_code", async () => {
        const s = await withSession({ permissions: ["tickets.contractors.manage"] });
        const json = { ...s.headers, "content-type": "application/json" };
        const prevBot = process.env.TICKETS_BOT_USERNAME;
        try {
          const list = await call(`/api/ticket_executors?contractor_id=${must(contractorId, "contractorId")}`, {
            headers: s.headers,
          });
          expect(list.status).toBe(200);
          const listBody = await list.json();
          expect(listBody.data.length).toBeGreaterThan(0);
          for (const row of listBody.data) expect(row).not.toHaveProperty("invite_code");

          const created = await call("/api/ticket_executors", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ kind: "external", contractor_id: contractorId, full_name: "Создан " + suffix }),
          });
          expect(created.status).toBe(200);
          const createdBody = await created.json();
          createdExecutorIds.push(createdBody.id);
          expect(createdBody).not.toHaveProperty("invite_code");

          const updated = await call(`/api/ticket_executors/${createdBody.id}`, {
            method: "PUT",
            headers: json,
            body: JSON.stringify({ phone: "+998900000000" }),
          });
          expect(updated.status).toBe(200);
          const updatedBody = await updated.json();
          expect(updatedBody.phone).toBe("+998900000000");
          expect(updatedBody).not.toHaveProperty("invite_code");

          // Выдача ссылки по-прежнему возвращает код: это единственное место.
          process.env.TICKETS_BOT_USERNAME = "test_bot";
          const invite = await call(`/api/ticket_executors/${createdBody.id}/invite`, {
            method: "POST",
            headers: s.headers,
          });
          expect(invite.status).toBe(200);
          const inviteBody = await invite.json();
          expect(typeof inviteBody.invite_code).toBe("string");
          expect(inviteBody.link).toContain(inviteBody.invite_code);
        } finally {
          if (prevBot === undefined) delete process.env.TICKETS_BOT_USERNAME;
          else process.env.TICKETS_BOT_USERNAME = prevBot;
          await s.cleanup();
        }
      });
    });

    // Роуты комментария и смены статуса общие для планшета филиала и карточки
    // офиса. Кто нажал, должно остаться в строке комментария и в событии:
    // офисная сессия (terminals: []) подписывается «office», сессия со скоупом
    // филиала остаётся «manager».
    describe("комментарий — кто автор (офис или филиал)", () => {
      const branchTerminal = randomUUID();
      let typeId: string | undefined;
      let ticketId: string | undefined;

      beforeAll(async () => {
        const [type] = await drizzleDb
          .insert(ticket_types)
          .values({
            code: "test_actor_" + randomUUID().slice(0, 8),
            number_prefix: "TA",
            name_ru: "Тестовый тип (актор)",
            name_uz: "Test turi (aktor)",
            executor_kind: "staff",
            fields_schema: [],
          })
          .returning({ id: ticket_types.id });
        typeId = type.id;
        const [row] = await drizzleDb
          .insert(tickets)
          .values({
            type_id: typeId,
            terminal_id: branchTerminal,
            organization_id: randomUUID(),
            created_by: randomUUID(),
          })
          .returning({ id: tickets.id });
        ticketId = row.id;
      });

      afterAll(async () => {
        // Каскада у FK нет: сначала дочерние строки, потом заявка.
        if (ticketId) {
          await drizzleDb.delete(ticket_comments).where(eq(ticket_comments.ticket_id, ticketId));
          await drizzleDb.delete(ticket_events).where(eq(ticket_events.ticket_id, ticketId));
          await drizzleDb.delete(tickets).where(eq(tickets.id, ticketId));
        }
        if (typeId) await drizzleDb.delete(ticket_types).where(eq(ticket_types.id, typeId));
      });

      const comment = async (opts: { terminals?: string[] }, text: string) => {
        const s = await withSession({ permissions: ["tickets.list"], ...opts });
        try {
          const res = await call(`/api/tickets/${must(ticketId, "ticketId")}/comments`, {
            method: "POST",
            headers: { ...s.headers, "content-type": "application/json" },
            body: JSON.stringify({ body: text }),
          });
          expect(res.status).toBe(200);
          const created = await res.json();
          const events = await drizzleDb
            .select({ actor_kind: ticket_events.actor_kind, payload: ticket_events.payload })
            .from(ticket_events)
            .where(eq(ticket_events.ticket_id, ticketId!));
          const ev = events.find((e) => (e.payload as { comment_id?: string }).comment_id === created.id);
          const [row] = await drizzleDb
            .select({ author_kind: ticket_comments.author_kind })
            .from(ticket_comments)
            .where(eq(ticket_comments.id, created.id));
          return { returned: created.author_kind, row: row?.author_kind, event: ev?.actor_kind };
        } finally {
          await s.cleanup();
        }
      };

      it("офисная сессия без филиалов пишет office в комментарий и событие", async () => {
        const r = await comment({}, "от офиса");
        expect(r.returned).toBe("office");
        expect(r.row).toBe("office");
        expect(r.event).toBe("office");
      });

      it("сессия со скоупом филиала пишет manager", async () => {
        const r = await comment({ terminals: [branchTerminal] }, "от филиала");
        expect(r.returned).toBe("manager");
        expect(r.row).toBe("manager");
        expect(r.event).toBe("manager");
      });
    });

    // Экран «К оплате» показывает дату закрытия и фирму прямо из списка. Фирма —
    // от исполнителя, который делал работу, а не от нынешней фирмы типа.
    describe("список заявок — closed_at и фирма (с фикстурами)", () => {
      const suffix = randomUUID().slice(0, 8);
      const createdTicketIds: string[] = [];
      const createdExecutorIds: string[] = [];
      const createdContractorIds: string[] = [];
      const createdTypeIds: string[] = [];
      let typeWithFirmId: string | undefined;
      let typeNoFirmId: string | undefined;
      let closedWithExecutorId: string | undefined;
      let newNoExecutorId: string | undefined;
      let noFirmAnywhereId: string | undefined;
      let staffExecutorId: string | undefined;

      beforeAll(async () => {
        // Фирма типа и фирма исполнителя разные: типу фирму «переназначили»
        // после того, как исполнитель из другой фирмы закрыл заявку.
        const [typeFirm] = await drizzleDb
          .insert(ticket_contractors)
          .values({ name: "Нынешняя фирма типа " + suffix })
          .returning({ id: ticket_contractors.id });
        createdContractorIds.push(typeFirm.id);
        const [workFirm] = await drizzleDb
          .insert(ticket_contractors)
          .values({ name: "Фирма исполнителя " + suffix })
          .returning({ id: ticket_contractors.id });
        createdContractorIds.push(workFirm.id);

        const [typeWithFirm] = await drizzleDb
          .insert(ticket_types)
          .values({
            code: "test_firm_" + suffix,
            number_prefix: "TF",
            name_ru: "Тип с фирмой",
            name_uz: "Firma bilan tur",
            executor_kind: "external",
            contractor_id: typeFirm.id,
            fields_schema: [],
          })
          .returning({ id: ticket_types.id });
        typeWithFirmId = typeWithFirm.id;
        createdTypeIds.push(typeWithFirm.id);

        const [typeNoFirm] = await drizzleDb
          .insert(ticket_types)
          .values({
            code: "test_nofirm_" + suffix,
            number_prefix: "TN",
            name_ru: "Тип без фирмы",
            name_uz: "Firmasiz tur",
            executor_kind: "external",
            fields_schema: [],
          })
          .returning({ id: ticket_types.id });
        typeNoFirmId = typeNoFirm.id;
        createdTypeIds.push(typeNoFirm.id);

        const [executor] = await drizzleDb
          .insert(ticket_executors)
          .values({ kind: "external", contractor_id: workFirm.id, full_name: "Мастер фирмы " + suffix })
          .returning({ id: ticket_executors.id });
        createdExecutorIds.push(executor.id);
        // Сотрудник без фирмы: ticket_executors_kind_target требует ровно одно
        // из contractor_id и user_id, FK на user_id нет.
        const [staff] = await drizzleDb
          .insert(ticket_executors)
          .values({ kind: "staff", user_id: randomUUID(), full_name: "Сотрудник " + suffix })
          .returning({ id: ticket_executors.id });
        createdExecutorIds.push(staff.id);

        const insertTicket = async (v: {
          type_id: string;
          status?: "new" | "closed";
          closed_at?: string;
          assigned_executor_id?: string;
        }) => {
          const [row] = await drizzleDb
            .insert(tickets)
            .values({ organization_id: randomUUID(), terminal_id: randomUUID(), created_by: randomUUID(), ...v })
            .returning({ id: tickets.id });
          createdTicketIds.push(row.id);
          return row.id;
        };
        closedWithExecutorId = await insertTicket({
          type_id: typeWithFirm.id,
          status: "closed",
          closed_at: "2026-10-05T12:00:00.000Z",
          assigned_executor_id: executor.id,
        });
        newNoExecutorId = await insertTicket({ type_id: typeWithFirm.id });
        noFirmAnywhereId = await insertTicket({ type_id: typeNoFirm.id });
        staffExecutorId = await insertTicket({
          type_id: typeWithFirm.id,
          status: "closed",
          closed_at: "2026-10-05T12:00:00.000Z",
          assigned_executor_id: staff.id,
        });
      }, 30000);

      afterAll(async () => {
        // Заявки раньше всего остального: на них ссылаются исполнители и типы.
        // Комментариев и событий фикстуры не создают, поэтому сирот нет.
        if (createdTicketIds.length > 0) {
          await drizzleDb.delete(tickets).where(inArray(tickets.id, createdTicketIds));
        }
        if (createdExecutorIds.length > 0) {
          await drizzleDb.delete(ticket_executors).where(inArray(ticket_executors.id, createdExecutorIds));
        }
        if (createdTypeIds.length > 0) {
          await drizzleDb.delete(ticket_types).where(inArray(ticket_types.id, createdTypeIds));
        }
        if (createdContractorIds.length > 0) {
          await drizzleDb.delete(ticket_contractors).where(inArray(ticket_contractors.id, createdContractorIds));
        }
      });

      const listMine = async () => {
        const s = await withSession({ permissions: ["tickets.list"] });
        try {
          const filters = JSON.stringify([
            { field: "type_id", operator: "in", value: [must(typeWithFirmId, "typeWithFirmId"), must(typeNoFirmId, "typeNoFirmId")] },
          ]);
          const res = await call(`/api/tickets?limit=50&offset=0&filters=${encodeURIComponent(filters)}`, {
            headers: s.headers,
          });
          expect(res.status).toBe(200);
          const body = await res.json();
          const byId = new Map<string, any>(body.data.map((r: any) => [r.id, r]));
          return (id: string | undefined, name: string) => {
            const row = byId.get(must(id, name));
            if (!row) throw new Error(`заявка ${name} не вернулась в списке`);
            return row;
          };
        } finally {
          await s.cleanup();
        }
      };

      it("закрытая заявка с исполнителем: closed_at и фирма исполнителя, а не нынешняя фирма типа", async () => {
        const row = (await listMine())(closedWithExecutorId, "closedWithExecutorId");
        expect(row.closed_at).not.toBeNull();
        // Postgres отдаёт timestamptz строкой вида «2026-10-05 17:00:00+05»:
        // часовой пояс сессии БД, не обязательно UTC. Смещение дописывается до
        // «+05:00», и сравнивается момент времени, а не текст.
        const iso = row.closed_at.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
        expect(Date.parse(iso)).toBe(Date.parse("2026-10-05T12:00:00.000Z"));
        expect(row.contractor_name).toBe("Фирма исполнителя " + suffix);
      });

      it("без исполнителя берёт фирму типа, closed_at пуст", async () => {
        const row = (await listMine())(newNoExecutorId, "newNoExecutorId");
        expect(row.closed_at).toBeNull();
        expect(row.contractor_name).toBe("Нынешняя фирма типа " + suffix);
      });

      it("ни у исполнителя, ни у типа нет фирмы: null", async () => {
        const row = (await listMine())(noFirmAnywhereId, "noFirmAnywhereId");
        expect(row.contractor_name).toBeNull();
      });

      it("исполнитель-сотрудник без фирмы даёт null, а не фирму типа", async () => {
        const row = (await listMine())(staffExecutorId, "staffExecutorId");
        expect(row.contractor_name).toBeNull();
      });
    });

    afterAll(async () => {
      await closeTestRedis();
    });
  });
}
