import { afterAll, beforeAll, describe, expect, it, setSystemTime } from "bun:test";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    ticket_attachments,
    ticket_comments,
    ticket_contractors,
    ticket_events,
    ticket_executors,
    ticket_types,
    tickets,
    users,
  } = await import("backend/drizzle/schema");
  const { eq, inArray, sql } = await import("drizzle-orm");

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

      it("офисная роль (tickets.list_all) без снимка филиалов видит заявки обоих филиалов", async () => {
        const mine = must(mineTicketId, "mineTicketId");
        const other = must(otherTicketId, "otherTicketId");
        const s = await withSession({ permissions: ["tickets.list", "tickets.list_all"] });
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

    // GET /users/me отдаёт терминалы сессии: экран создания заявки решает по
    // ним, сколько у менеджера филиалов и какой id слать, а сервер при создании
    // сверяется с тем же снимком. Тест живёт здесь, потому что test:http гоняет
    // только этот файл, а отдельного HTTP-набора у модуля users нет.
    describe("GET /users/me — терминалы сессии", () => {
      it("отдаёт снимок терминалов сессии как есть", async () => {
        const a = randomUUID();
        const b = randomUUID();
        const s = await withSession({ permissions: [], terminals: [a, b] });
        try {
          const res = await call("/api/users/me", { headers: s.headers });
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.terminals).toEqual([a, b]);
          expect(body.role?.id).toBe(s.roleId);
          expect(body.user).toBeTruthy();
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок читается пустым массивом, а не «всеми» и не отсутствует", async () => {
        const s = await withSession({ permissions: [], terminals: [] });
        try {
          const res = await call("/api/users/me", { headers: s.headers });
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(Array.isArray(body.terminals)).toBe(true);
          expect(body.terminals).toEqual([]);
        } finally {
          await s.cleanup();
        }
      });

      it("без сессии — не 200", async () => {
        const res = await call("/api/users/me");
        expect(res.status).not.toBe(200);
      });
    });

    // Создание заявки при пустом снимке терминалов сессии. Раньше пустой снимок
    // значил «проверять нечего», и terminal_id из тела долетал до базы
    // непроверенным: сессия без филиалов заводила заявку в любой. Теперь пустой
    // снимок пускает только с правом tickets.list_all (офис), как и остальной
    // модуль. Тип staff без подрядной фирмы: уведомлений и очереди нет, так что
    // успешный POST пишет лишь строки заявки, события и вложения. Файлы идут в
    // отдельный временный каталог (TICKETS_UPLOADS_DIR), а не в боевой
    // uploads/tickets. У ticket_attachments, ticket_comments и ticket_events нет
    // каскада по FK: уборка снимает детей раньше заявки.
    describe("создание заявки — пустой снимок терминалов (с фикстурами)", () => {
      const suffix = randomUUID().slice(0, 8);
      let typeId: string | undefined;
      let ownTerminal: string | undefined;
      let foreignTerminal: string | undefined;
      const createdTerminalIds: string[] = [];
      const createdTicketIds: string[] = [];
      const uploadsDir = join(tmpdir(), "tickets_create_empty_snapshot_" + randomUUID());
      const prevUploadsDir = process.env.TICKETS_UPLOADS_DIR;

      beforeAll(async () => {
        process.env.TICKETS_UPLOADS_DIR = uploadsDir;
        const [type] = await drizzleDb
          .insert(ticket_types)
          .values({
            code: "test_create_empty_" + suffix,
            number_prefix: "TE",
            name_ru: "Тестовый тип (пустой снимок)",
            name_uz: "Test turi (bo'sh snapshot)",
            executor_kind: "staff",
            fields_schema: [],
          })
          .returning({ id: ticket_types.id });
        typeId = type.id;

        const insertTerminal = async (label: string) => {
          const [row] = await drizzleDb
            .insert(terminals)
            .values({ name: `Тестовый филиал ${label} ${suffix}`, latitude: 41.3, longitude: 69.2, organization_id: randomUUID() })
            .returning({ id: terminals.id });
          createdTerminalIds.push(row.id);
          return row.id;
        };
        ownTerminal = await insertTerminal("свой");
        foreignTerminal = await insertTerminal("чужой");
      }, 30000);

      afterAll(async () => {
        if (createdTicketIds.length > 0) {
          await drizzleDb.delete(ticket_attachments).where(inArray(ticket_attachments.ticket_id, createdTicketIds));
          await drizzleDb.delete(ticket_comments).where(inArray(ticket_comments.ticket_id, createdTicketIds));
          await drizzleDb.delete(ticket_events).where(inArray(ticket_events.ticket_id, createdTicketIds));
          await drizzleDb.delete(tickets).where(inArray(tickets.id, createdTicketIds));
        }
        // Заявки, которые тест мог завести при регрессии, но не успел записать
        // в createdTicketIds: добираем по филиалам фикстуры.
        if (createdTerminalIds.length > 0) {
          const stray = await drizzleDb
            .select({ id: tickets.id })
            .from(tickets)
            .where(inArray(tickets.terminal_id, createdTerminalIds));
          const strayIds = stray.map((r) => r.id);
          if (strayIds.length > 0) {
            await drizzleDb.delete(ticket_attachments).where(inArray(ticket_attachments.ticket_id, strayIds));
            await drizzleDb.delete(ticket_comments).where(inArray(ticket_comments.ticket_id, strayIds));
            await drizzleDb.delete(ticket_events).where(inArray(ticket_events.ticket_id, strayIds));
            await drizzleDb.delete(tickets).where(inArray(tickets.id, strayIds));
          }
          await drizzleDb.delete(terminals).where(inArray(terminals.id, createdTerminalIds));
        }
        if (typeId) await drizzleDb.delete(ticket_types).where(eq(ticket_types.id, typeId));
        await rm(uploadsDir, { recursive: true, force: true });
        if (prevUploadsDir === undefined) delete process.env.TICKETS_UPLOADS_DIR;
        else process.env.TICKETS_UPLOADS_DIR = prevUploadsDir;
      });

      const postTicket = (headers: Record<string, string>, terminalId?: string) => {
        const form = new FormData();
        form.append("type_id", must(typeId, "typeId"));
        if (terminalId) form.append("terminal_id", terminalId);
        form.append("photos", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "probe.jpg", { type: "image/jpeg" }));
        return call("/api/tickets", { method: "POST", headers, body: form });
      };
      const rowsAt = async (terminalId: string) =>
        (await drizzleDb.select({ id: tickets.id }).from(tickets).where(eq(tickets.terminal_id, terminalId))).length;

      // Главный отрицательный тест: старое условие пропускало эту сессию в чужой
      // филиал и заводило заявку (200).
      it("пустой снимок без tickets.list_all: чужой terminal_id — 403, заявки нет", async () => {
        const foreign = must(foreignTerminal, "foreignTerminal");
        const s = await withSession({ permissions: ["tickets.create"], terminals: [] });
        try {
          const res = await postTicket(s.headers, foreign);
          expect(res.status).toBe(403);
          expect(await rowsAt(foreign)).toBe(0);
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок без tickets.list_all и без terminal_id — 403", async () => {
        const s = await withSession({ permissions: ["tickets.create"], terminals: [] });
        try {
          const res = await postTicket(s.headers);
          expect(res.status).toBe(403);
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок с tickets.list_all: явный terminal_id принят, заявка в этом филиале", async () => {
        const foreign = must(foreignTerminal, "foreignTerminal");
        const s = await withSession({ permissions: ["tickets.create", "tickets.list_all"], terminals: [] });
        try {
          const res = await postTicket(s.headers, foreign);
          const body = await res.json();
          if (body?.id) createdTicketIds.push(body.id);
          expect(res.status).toBe(200);
          expect(body.terminal_id).toBe(foreign);
          expect(await rowsAt(foreign)).toBe(1);
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок с tickets.list_all, но без terminal_id — по-прежнему 403", async () => {
        const s = await withSession({ permissions: ["tickets.create", "tickets.list_all"], terminals: [] });
        try {
          const res = await postTicket(s.headers);
          expect(res.status).toBe(403);
        } finally {
          await s.cleanup();
        }
      });

      it("непустой снимок: чужой terminal_id — 403, заявки нет; свой — 200", async () => {
        const own = must(ownTerminal, "ownTerminal");
        const foreign = must(foreignTerminal, "foreignTerminal");
        const before = await rowsAt(foreign);
        const s = await withSession({ permissions: ["tickets.create"], terminals: [own] });
        try {
          const denied = await postTicket(s.headers, foreign);
          expect(denied.status).toBe(403);
          expect(await rowsAt(foreign)).toBe(before);

          const ok = await postTicket(s.headers, own);
          const body = await ok.json();
          if (body?.id) createdTicketIds.push(body.id);
          expect(ok.status).toBe(200);
          expect(body.terminal_id).toBe(own);
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
          // Утверждение пишет событие; без каскада по FK оно держало бы заявку.
          await drizzleDb.delete(ticket_events).where(inArray(ticket_events.ticket_id, createdTicketIds));
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

    // tickets.list_all снимает скоуп по филиалам во всём модуле: в чтении
    // (список и тот же count, на котором стоят очередь «К оплате» и
    // предупреждение редактора типов, карточка, файл вложения) и в записи
    // (оплата, close, reopen, cancel, comments); исключение — seen, он остаётся
    // на терминалах сессии. Первая пара заявок
    // ниже служит чтению; каждой записи заводится своя свежая заявка. Дочерние строки (комментарий, событие, вложение) заведены
    // нарочно: у ticket_comments, ticket_events и ticket_attachments нет
    // каскада по FK, и уборка обязана снять их раньше заявки.
    describe("tickets.list_all — снятие скоупа в чтении (с фикстурами)", () => {
      const terminalA = randomUUID();
      const terminalB = randomUUID();
      let typeId: string | undefined;
      let ticketA: string | undefined;
      let ticketB: string | undefined;
      let attachmentB: string | undefined;
      const attachmentFile = join(tmpdir(), "list_all_probe_" + randomUUID() + ".jpg");
      const createdTicketIds: string[] = [];

      beforeAll(async () => {
        const [type] = await drizzleDb
          .insert(ticket_types)
          .values({
            code: "test_list_all_" + randomUUID().slice(0, 8),
            number_prefix: "TL",
            name_ru: "Тестовый тип (list_all)",
            name_uz: "Test turi (list_all)",
            executor_kind: "staff",
            fields_schema: [],
          })
          .returning({ id: ticket_types.id });
        typeId = type.id;

        const insertTicket = async (terminal_id: string) => {
          const [row] = await drizzleDb
            .insert(tickets)
            .values({
              type_id: typeId!,
              terminal_id,
              organization_id: randomUUID(),
              created_by: randomUUID(),
              status: "closed",
              payment_status: "pending",
              work_total_amount: "150.00",
            })
            .returning({ id: tickets.id });
          createdTicketIds.push(row.id);
          return row.id;
        };
        ticketA = await insertTicket(terminalA);
        ticketB = await insertTicket(terminalB);

        await drizzleDb
          .insert(ticket_comments)
          .values({ ticket_id: ticketB, author_kind: "manager", author_user_id: randomUUID(), body: "фикстура" });
        await drizzleDb
          .insert(ticket_events)
          .values({ ticket_id: ticketB, type: "created", actor_kind: "manager", actor_user_id: randomUUID() });

        await writeFile(attachmentFile, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
        const [att] = await drizzleDb
          .insert(ticket_attachments)
          .values({
            ticket_id: ticketB,
            phase: "problem",
            file_path: attachmentFile,
            mime: "image/jpeg",
            size_bytes: 4,
            uploaded_by_kind: "manager",
          })
          .returning({ id: ticket_attachments.id });
        attachmentB = att.id;
      });

      afterAll(async () => {
        // Дети раньше заявки: каскада по FK нет. Условие по createdTicketIds,
        // а не по ticketA/ticketB — если вторая вставка упала, убирается ровно
        // то, что создалось.
        if (createdTicketIds.length > 0) {
          await drizzleDb.delete(ticket_attachments).where(inArray(ticket_attachments.ticket_id, createdTicketIds));
          await drizzleDb.delete(ticket_comments).where(inArray(ticket_comments.ticket_id, createdTicketIds));
          await drizzleDb.delete(ticket_events).where(inArray(ticket_events.ticket_id, createdTicketIds));
          await drizzleDb.delete(tickets).where(inArray(tickets.id, createdTicketIds));
        }
        if (typeId) {
          await drizzleDb.delete(ticket_types).where(inArray(ticket_types.id, [typeId]));
        }
        await rm(attachmentFile, { force: true });
      });

      // Фильтр по type_id отсекает всё, что лежит в тестовой базе кроме двух
      // заявок выше, поэтому total можно сравнивать точно.
      const typeFilter = () => [{ field: "type_id", operator: "eq", value: must(typeId, "typeId") }];
      // Ровно то, что спрашивает экран «К оплате» (use-payments.ts).
      const queueFilter = () => [
        ...typeFilter(),
        { field: "status", operator: "eq", value: "closed" },
        { field: "payment_status", operator: "eq", value: "pending" },
        { field: "work_total_amount", operator: "gt", value: "0" },
      ];
      const listAs = async (headers: Record<string, string>, filters: unknown[]) => {
        const q = encodeURIComponent(JSON.stringify(filters));
        const res = await call(`/api/tickets?limit=200&offset=0&filters=${q}`, { headers });
        expect(res.status).toBe(200);
        const body = await res.json();
        return { total: Number(body.total), ids: body.data.map((r: { id: string }) => r.id) as string[] };
      };

      // Отрицательный тест — главный: если условие list_all перевернуть или
      // выбросить проверку права, этот тест падает, потому что сессия без права
      // увидела бы обе заявки.
      it("без tickets.list_all список и total остаются в скоупе своего филиала", async () => {
        const a = must(ticketA, "ticketA");
        const s = await withSession({ permissions: ["tickets.list"], terminals: [terminalA] });
        try {
          const list = await listAs(s.headers, typeFilter());
          expect(list.ids).toEqual([a]);
          expect(list.total).toBe(1);
        } finally {
          await s.cleanup();
        }
      });

      it("с tickets.list_all список и total охватывают оба филиала", async () => {
        const a = must(ticketA, "ticketA");
        const b = must(ticketB, "ticketB");
        const s = await withSession({ permissions: ["tickets.list", "tickets.list_all"], terminals: [terminalA] });
        try {
          const list = await listAs(s.headers, typeFilter());
          expect([...list.ids].sort()).toEqual([a, b].sort());
          expect(list.total).toBe(2);
        } finally {
          await s.cleanup();
        }
      });

      it("очередь «К оплате»: total по всем филиалам с tickets.list_all и по своим без него", async () => {
        const narrow = await withSession({ permissions: ["tickets.list"], terminals: [terminalA] });
        const wide = await withSession({ permissions: ["tickets.list", "tickets.list_all"], terminals: [terminalA] });
        try {
          expect((await listAs(narrow.headers, queueFilter())).total).toBe(1);
          expect((await listAs(wide.headers, queueFilter())).total).toBe(2);
        } finally {
          await narrow.cleanup();
          await wide.cleanup();
        }
      });

      it("сессия без филиалов: с правом обе заявки, без права ни одной (пустой снимок не значит «все»)", async () => {
        const b = must(ticketB, "ticketB");
        const plain = await withSession({ permissions: ["tickets.list"] });
        const wide = await withSession({ permissions: ["tickets.list", "tickets.list_all"] });
        try {
          const none = await listAs(plain.headers, typeFilter());
          expect(none.ids).toEqual([]);
          expect(none.total).toBe(0);
          expect((await listAs(wide.headers, typeFilter())).ids).toContain(b);
          expect((await listAs(wide.headers, typeFilter())).total).toBe(2);
        } finally {
          await plain.cleanup();
          await wide.cleanup();
        }
      });

      it("одно tickets.list_all без tickets.list не открывает ничего: 403", async () => {
        const s = await withSession({ permissions: ["tickets.list_all"], terminals: [terminalA] });
        try {
          const res = await call("/api/tickets?limit=10&offset=0", { headers: s.headers });
          expect(res.status).toBe(403);
        } finally {
          await s.cleanup();
        }
      });

      it("без tickets.list_all заявка чужого филиала по id — 404", async () => {
        const s = await withSession({ permissions: ["tickets.list"], terminals: [terminalA] });
        try {
          const res = await call(`/api/tickets/${must(ticketB, "ticketB")}`, { headers: s.headers });
          expect(res.status).toBe(404);
        } finally {
          await s.cleanup();
        }
      });

      it("с tickets.list_all заявка чужого филиала по id — 200 с комментарием и событием", async () => {
        const b = must(ticketB, "ticketB");
        const s = await withSession({ permissions: ["tickets.list", "tickets.list_all"], terminals: [terminalA] });
        try {
          const res = await call(`/api/tickets/${b}`, { headers: s.headers });
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.id).toBe(b);
          expect(body.comments).toHaveLength(1);
          expect(body.events).toHaveLength(1);
          expect(body.attachments).toHaveLength(1);
        } finally {
          await s.cleanup();
        }
      });

      it("файл вложения чужого филиала: 404 без tickets.list_all, 200 с ним", async () => {
        const path = `/api/tickets/attachments/${must(attachmentB, "attachmentB")}/file`;
        const narrow = await withSession({ permissions: ["tickets.list"], terminals: [terminalA] });
        const wide = await withSession({ permissions: ["tickets.list", "tickets.list_all"], terminals: [terminalA] });
        try {
          expect((await call(path, { headers: narrow.headers })).status).toBe(404);
          expect((await call(path, { headers: wide.headers })).status).toBe(200);
        } finally {
          await narrow.cleanup();
          await wide.cleanup();
        }
      });

      // Запись: то же правило, что в чтении. С tickets.list_all действие над
      // заявкой чужого филиала проходит; без права остаётся прежний 404 (или
      // approved: 0, skipped: 1 у оплаты), и строка в базе не меняется. Для
      // каждой записи берётся своя свежая заявка в чужом филиале: действие
      // меняет состояние, и общая пара фикстур поплыла бы от теста к тесту.
      // Негативная половина (без права) главная: если условие в
      // effectiveTerminals перевернуть или выбросить, она краснеет.
      const freshTicket = async (status: "new" | "done" | "closed", extra: Partial<typeof tickets.$inferInsert> = {}) => {
        const [row] = await drizzleDb
          .insert(tickets)
          .values({
            type_id: must(typeId, "typeId"),
            terminal_id: terminalB,
            organization_id: randomUUID(),
            created_by: randomUUID(),
            status,
            ...extra,
          })
          .returning({ id: tickets.id });
        createdTicketIds.push(row.id);
        return row.id;
      };
      const officeSession = (wide: boolean) =>
        withSession({
          permissions: [
            "tickets.list",
            "tickets.close",
            "tickets.cancel",
            "tickets.payment.approve",
            ...(wide ? ["tickets.list_all"] : []),
          ],
          terminals: [terminalA],
        });
      const post = (headers: Record<string, string>, path: string, body?: unknown) =>
        call(path, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      const stateOf = async (id: string) => {
        const [row] = await drizzleDb
          .select({
            status: tickets.status,
            payment_status: tickets.payment_status,
            manager_seen_at: tickets.manager_seen_at,
          })
          .from(tickets)
          .where(eq(tickets.id, id));
        return row;
      };

      it("без tickets.list_all утверждение оплаты по чужому филиалу пропускается", async () => {
        const id = await freshTicket("closed", { payment_status: "pending", work_total_amount: "150.00" });
        const s = await officeSession(false);
        try {
          const res = await post(s.headers, "/api/tickets/payment/approve", { ids: [id] });
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.approved).toBe(0);
          expect(body.skipped).toBe(1);
          expect((await stateOf(id)).payment_status).toBe("pending");
        } finally {
          await s.cleanup();
        }
      });

      it("с tickets.list_all утверждение оплаты по чужому филиалу проходит", async () => {
        const id = await freshTicket("closed", { payment_status: "pending", work_total_amount: "150.00" });
        const s = await officeSession(true);
        try {
          const res = await post(s.headers, "/api/tickets/payment/approve", { ids: [id] });
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.approved).toBe(1);
          expect(body.skipped).toBe(0);
          expect((await stateOf(id)).payment_status).toBe("approved");
        } finally {
          await s.cleanup();
        }
      });

      it("без tickets.list_all отклонение оплаты по чужому филиалу пропускается", async () => {
        const id = await freshTicket("closed", { payment_status: "pending", work_total_amount: "150.00" });
        const s = await officeSession(false);
        try {
          const res = await post(s.headers, "/api/tickets/payment/reject", { ids: [id], comment: "нет акта" });
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.rejected).toBe(0);
          expect(body.skipped).toBe(1);
          expect((await stateOf(id)).payment_status).toBe("pending");
        } finally {
          await s.cleanup();
        }
      });

      it("с tickets.list_all отклонение оплаты по чужому филиалу проходит", async () => {
        const id = await freshTicket("closed", { payment_status: "pending", work_total_amount: "150.00" });
        const s = await officeSession(true);
        try {
          const res = await post(s.headers, "/api/tickets/payment/reject", { ids: [id], comment: "нет акта" });
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.rejected).toBe(1);
          expect((await stateOf(id)).payment_status).toBe("rejected");
        } finally {
          await s.cleanup();
        }
      });

      it("без tickets.list_all приём (close) заявки чужого филиала — 404, статус прежний", async () => {
        const id = await freshTicket("done");
        const s = await officeSession(false);
        try {
          expect((await post(s.headers, `/api/tickets/${id}/close`)).status).toBe(404);
          expect((await stateOf(id)).status).toBe("done");
        } finally {
          await s.cleanup();
        }
      });

      it("с tickets.list_all приём (close) заявки чужого филиала проходит", async () => {
        const id = await freshTicket("done");
        const s = await officeSession(true);
        try {
          expect((await post(s.headers, `/api/tickets/${id}/close`)).status).toBe(200);
          expect((await stateOf(id)).status).toBe("closed");
        } finally {
          await s.cleanup();
        }
      });

      it("без tickets.list_all возврат в работу (reopen) заявки чужого филиала — 404", async () => {
        const id = await freshTicket("done");
        const s = await officeSession(false);
        try {
          expect((await post(s.headers, `/api/tickets/${id}/reopen`, { comment: "переделать" })).status).toBe(404);
          expect((await stateOf(id)).status).toBe("done");
        } finally {
          await s.cleanup();
        }
      });

      it("с tickets.list_all возврат в работу (reopen) заявки чужого филиала проходит", async () => {
        const id = await freshTicket("done");
        const s = await officeSession(true);
        try {
          expect((await post(s.headers, `/api/tickets/${id}/reopen`, { comment: "переделать" })).status).toBe(200);
          expect((await stateOf(id)).status).toBe("in_progress");
        } finally {
          await s.cleanup();
        }
      });

      it("без tickets.list_all отмена заявки чужого филиала — 404", async () => {
        const id = await freshTicket("new");
        const s = await officeSession(false);
        try {
          expect((await post(s.headers, `/api/tickets/${id}/cancel`, { comment: "дубль" })).status).toBe(404);
          expect((await stateOf(id)).status).toBe("new");
        } finally {
          await s.cleanup();
        }
      });

      it("с tickets.list_all отмена заявки чужого филиала проходит", async () => {
        const id = await freshTicket("new");
        const s = await officeSession(true);
        try {
          expect((await post(s.headers, `/api/tickets/${id}/cancel`, { comment: "дубль" })).status).toBe(200);
          expect((await stateOf(id)).status).toBe("cancelled");
        } finally {
          await s.cleanup();
        }
      });

      it("без tickets.list_all комментарий к заявке чужого филиала — 404, строки нет", async () => {
        const id = await freshTicket("new");
        const s = await officeSession(false);
        try {
          expect((await post(s.headers, `/api/tickets/${id}/comments`, { body: "не должен записаться" })).status).toBe(404);
          const rows = await drizzleDb.select({ id: ticket_comments.id }).from(ticket_comments).where(eq(ticket_comments.ticket_id, id));
          expect(rows).toHaveLength(0);
        } finally {
          await s.cleanup();
        }
      });

      it("с tickets.list_all комментарий к заявке чужого филиала пишется как office", async () => {
        const id = await freshTicket("new");
        const s = await officeSession(true);
        try {
          const res = await post(s.headers, `/api/tickets/${id}/comments`, { body: "от офиса" });
          expect(res.status).toBe(200);
          // Учётка с терминалами, но с tickets.list_all: офис, а не менеджер.
          expect((await res.json()).author_kind).toBe("office");
          const rows = await drizzleDb.select({ k: ticket_comments.author_kind }).from(ticket_comments).where(eq(ticket_comments.ticket_id, id));
          expect(rows.map((r) => r.k)).toEqual(["office"]);
          const events = await drizzleDb.select({ k: ticket_events.actor_kind }).from(ticket_events).where(eq(ticket_events.ticket_id, id));
          expect(events.map((e) => e.k)).toEqual(["office"]);
        } finally {
          await s.cleanup();
        }
      });

      it("без tickets.list_all учётка с терминалами пишет manager, с правом office, close тоже", async () => {
        const own = await freshTicket("done", { terminal_id: terminalA });
        const own2 = await freshTicket("done", { terminal_id: terminalA });
        const narrow = await officeSession(false);
        const wide = await officeSession(true);
        try {
          const kindOfClose = async (headers: Record<string, string>, id: string) => {
            expect((await post(headers, `/api/tickets/${id}/close`)).status).toBe(200);
            const ev = await drizzleDb
              .select({ k: ticket_events.actor_kind })
              .from(ticket_events)
              .where(eq(ticket_events.ticket_id, id));
            return ev.map((e) => e.k);
          };
          expect(await kindOfClose(narrow.headers, own)).toEqual(["manager"]);
          expect(await kindOfClose(wide.headers, own2)).toEqual(["office"]);
        } finally {
          await narrow.cleanup();
          await wide.cleanup();
        }
      });

      // seen — исключение из правила: manager_seen_at значит «филиал посмотрел»,
      // колонка не хранит актора, и офис этого утверждать не может. Право
      // list_all на этот роут не действует ни в какую сторону.
      it("без tickets.list_all отметка seen на заявке чужого филиала — 404, поле пусто", async () => {
        const id = await freshTicket("new");
        const s = await officeSession(false);
        try {
          expect((await post(s.headers, `/api/tickets/${id}/seen`)).status).toBe(404);
          expect((await stateOf(id)).manager_seen_at).toBeNull();
        } finally {
          await s.cleanup();
        }
      });

      it("tickets.list_all не действует на seen: чужая заявка — 404, поле пусто, своя — 200", async () => {
        const foreign = await freshTicket("new");
        const own = await freshTicket("new", { terminal_id: terminalA });
        const s = await officeSession(true);
        try {
          expect((await post(s.headers, `/api/tickets/${foreign}/seen`)).status).toBe(404);
          expect((await stateOf(foreign)).manager_seen_at).toBeNull();
          // Контроль: роут сам по себе рабочий, 404 выше именно из-за скоупа.
          expect((await post(s.headers, `/api/tickets/${own}/seen`)).status).toBe(200);
          expect((await stateOf(own)).manager_seen_at).not.toBeNull();
        } finally {
          await s.cleanup();
        }
      });

      // Пустой снимок терминалов (terminals: []) не значит «все филиалы»:
      // межфилиальный доступ при нём даёт только tickets.list_all, как и при
      // создании заявки. Без права снимок значит «ни одного филиала», и каждый
      // роут отвечает так, как отвечает на чужую заявку. Негативная половина
      // главная: если проверку права в effectiveTerminals вернуть к «пустой
      // снимок — без фильтра», она краснеет. Тип заявки — staff без
      // исполнителя: 200-пути ничего не ставят в очередь уведомлений.
      const emptySession = (wide: boolean) =>
        withSession({
          permissions: [
            "tickets.list",
            "tickets.close",
            "tickets.cancel",
            "tickets.payment.approve",
            ...(wide ? ["tickets.list_all"] : []),
          ],
          terminals: [],
        });

      it("пустой снимок без tickets.list_all: список и total пусты", async () => {
        const s = await emptySession(false);
        try {
          const list = await listAs(s.headers, typeFilter());
          expect(list.ids).toEqual([]);
          expect(list.total).toBe(0);
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок с tickets.list_all: список и total охватывают оба филиала", async () => {
        const s = await emptySession(true);
        try {
          const list = await listAs(s.headers, typeFilter());
          // Не toBe(2): свежие заявки соседних тестов лежат под тем же типом.
          expect(list.ids).toContain(must(ticketA, "ticketA"));
          expect(list.ids).toContain(must(ticketB, "ticketB"));
          expect(list.total).toBeGreaterThanOrEqual(2);
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок: карточка по id — 404 без tickets.list_all, 200 с ним", async () => {
        const b = must(ticketB, "ticketB");
        const narrow = await emptySession(false);
        const wide = await emptySession(true);
        try {
          expect((await call(`/api/tickets/${b}`, { headers: narrow.headers })).status).toBe(404);
          const res = await call(`/api/tickets/${b}`, { headers: wide.headers });
          expect(res.status).toBe(200);
          expect((await res.json()).id).toBe(b);
        } finally {
          await narrow.cleanup();
          await wide.cleanup();
        }
      });

      it("пустой снимок: файл вложения — 404 без tickets.list_all, 200 с ним", async () => {
        const path = `/api/tickets/attachments/${must(attachmentB, "attachmentB")}/file`;
        const narrow = await emptySession(false);
        const wide = await emptySession(true);
        try {
          expect((await call(path, { headers: narrow.headers })).status).toBe(404);
          expect((await call(path, { headers: wide.headers })).status).toBe(200);
        } finally {
          await narrow.cleanup();
          await wide.cleanup();
        }
      });

      it("пустой снимок без tickets.list_all: приём (close) — 404, статус прежний", async () => {
        const id = await freshTicket("done");
        const s = await emptySession(false);
        try {
          expect((await post(s.headers, `/api/tickets/${id}/close`)).status).toBe(404);
          expect((await stateOf(id)).status).toBe("done");
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок с tickets.list_all: приём (close) проходит как office", async () => {
        const id = await freshTicket("done");
        const s = await emptySession(true);
        try {
          expect((await post(s.headers, `/api/tickets/${id}/close`)).status).toBe(200);
          expect((await stateOf(id)).status).toBe("closed");
          const ev = await drizzleDb.select({ k: ticket_events.actor_kind }).from(ticket_events).where(eq(ticket_events.ticket_id, id));
          expect(ev.map((e) => e.k)).toEqual(["office"]);
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок без tickets.list_all: возврат (reopen) и отмена (cancel) — 404, статус прежний", async () => {
        const doneId = await freshTicket("done");
        const newId = await freshTicket("new");
        const s = await emptySession(false);
        try {
          expect((await post(s.headers, `/api/tickets/${doneId}/reopen`, { comment: "переделать" })).status).toBe(404);
          expect((await post(s.headers, `/api/tickets/${newId}/cancel`, { comment: "дубль" })).status).toBe(404);
          expect((await stateOf(doneId)).status).toBe("done");
          expect((await stateOf(newId)).status).toBe("new");
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок с tickets.list_all: возврат (reopen) и отмена (cancel) проходят", async () => {
        const doneId = await freshTicket("done");
        const newId = await freshTicket("new");
        const s = await emptySession(true);
        try {
          expect((await post(s.headers, `/api/tickets/${doneId}/reopen`, { comment: "переделать" })).status).toBe(200);
          expect((await post(s.headers, `/api/tickets/${newId}/cancel`, { comment: "дубль" })).status).toBe(200);
          expect((await stateOf(doneId)).status).toBe("in_progress");
          expect((await stateOf(newId)).status).toBe("cancelled");
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок без tickets.list_all: комментарий — 404, строки нет", async () => {
        const id = await freshTicket("new");
        const s = await emptySession(false);
        try {
          expect((await post(s.headers, `/api/tickets/${id}/comments`, { body: "не должен записаться" })).status).toBe(404);
          const rows = await drizzleDb.select({ id: ticket_comments.id }).from(ticket_comments).where(eq(ticket_comments.ticket_id, id));
          expect(rows).toHaveLength(0);
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок с tickets.list_all: комментарий пишется как office", async () => {
        const id = await freshTicket("new");
        const s = await emptySession(true);
        try {
          const res = await post(s.headers, `/api/tickets/${id}/comments`, { body: "от офиса" });
          expect(res.status).toBe(200);
          expect((await res.json()).author_kind).toBe("office");
        } finally {
          await s.cleanup();
        }
      });

      it("пустой снимок: оплата — без tickets.list_all пропущена, с ним утверждена и отклонена", async () => {
        const forApprove = await freshTicket("closed", { payment_status: "pending", work_total_amount: "150.00" });
        const forReject = await freshTicket("closed", { payment_status: "pending", work_total_amount: "150.00" });
        const narrow = await emptySession(false);
        const wide = await emptySession(true);
        try {
          const a0 = await (await post(narrow.headers, "/api/tickets/payment/approve", { ids: [forApprove] })).json();
          expect(a0).toEqual({ approved: 0, skipped: 1 });
          const r0 = await (await post(narrow.headers, "/api/tickets/payment/reject", { ids: [forReject], comment: "нет акта" })).json();
          expect(r0).toEqual({ rejected: 0, skipped: 1 });
          expect((await stateOf(forApprove)).payment_status).toBe("pending");
          expect((await stateOf(forReject)).payment_status).toBe("pending");

          const a1 = await (await post(wide.headers, "/api/tickets/payment/approve", { ids: [forApprove] })).json();
          expect(a1).toEqual({ approved: 1, skipped: 0 });
          const r1 = await (await post(wide.headers, "/api/tickets/payment/reject", { ids: [forReject], comment: "нет акта" })).json();
          expect(r1).toEqual({ rejected: 1, skipped: 0 });
          expect((await stateOf(forApprove)).payment_status).toBe("approved");
          expect((await stateOf(forReject)).payment_status).toBe("rejected");
        } finally {
          await narrow.cleanup();
          await wide.cleanup();
        }
      });

      // seen скоплен при любых правах: пустой снимок не открывает его ни
      // пустотой, ни tickets.list_all. Это была найденная дыра: сессия с
      // tickets.list и terminals: [] ставила manager_seen_at в чужом филиале.
      it("пустой снимок: seen — 404 и без tickets.list_all, и с ним, поле пусто", async () => {
        const id = await freshTicket("new");
        const narrow = await emptySession(false);
        const wide = await emptySession(true);
        try {
          expect((await post(narrow.headers, `/api/tickets/${id}/seen`)).status).toBe(404);
          expect((await post(wide.headers, `/api/tickets/${id}/seen`)).status).toBe(404);
          expect((await stateOf(id)).manager_seen_at).toBeNull();
        } finally {
          await narrow.cleanup();
          await wide.cleanup();
        }
      });

      // Непустой снимок не тронут: те же роуты, тот же результат, что до правила.
      it("непустой снимок: свой филиал работает как раньше (seen и close — 200)", async () => {
        const own = await freshTicket("done", { terminal_id: terminalA });
        const ownSeen = await freshTicket("new", { terminal_id: terminalA });
        const s = await withSession({ permissions: ["tickets.list", "tickets.close"], terminals: [terminalA] });
        try {
          expect((await post(s.headers, `/api/tickets/${own}/close`)).status).toBe(200);
          expect((await post(s.headers, `/api/tickets/${ownSeen}/seen`)).status).toBe(200);
          expect((await stateOf(ownSeen)).manager_seen_at).not.toBeNull();
        } finally {
          await s.cleanup();
        }
      });

      // manager_seen_at ставит база (now()), а не Node: ticket_events.created_at
      // тоже ставит Postgres, и точка непрочитанного сравнивает эти два момента.
      // Часы процесса здесь сдвинуты на 2000 год: отметка от Node легла бы туда,
      // отметка от базы остаётся в настоящем.
      it("seen берёт время базы, а не часов процесса", async () => {
        const id = await freshTicket("new", { terminal_id: terminalA });
        const s = await withSession({ permissions: ["tickets.list"], terminals: [terminalA] });
        try {
          setSystemTime(new Date("2000-01-01T00:00:00.000Z"));
          let status: number;
          try {
            status = (await post(s.headers, `/api/tickets/${id}/seen`)).status;
          } finally {
            setSystemTime();
          }
          expect(status).toBe(200);
          const seen = (await stateOf(id)).manager_seen_at;
          expect(new Date(String(seen)).getFullYear()).toBeGreaterThan(2020);
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
        // Карточку читает офис: пустой снимок без tickets.list_all ничего не видит.
        const s = await withSession({ permissions: ["tickets.list", "tickets.list_all"] });
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

      // Выдача ссылки для выключенного исполнителя бесполезна (бот его не
      // привяжет) и вредна (гасит действующую ссылку). Роут отвечает 422 и не
      // трогает код.
      it("выдача ссылки: выключенному 422 и код не меняется, включённому ссылка", async () => {
        const s = await withSession({ permissions: ["tickets.contractors.manage"] });
        const json = { ...s.headers, "content-type": "application/json" };
        const prevBot = process.env.TICKETS_BOT_USERNAME;
        process.env.TICKETS_BOT_USERNAME = "test_bot";
        try {
          const created = await call("/api/ticket_executors", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ kind: "external", contractor_id: contractorId, full_name: "Выкл " + suffix }),
          });
          expect(created.status).toBe(200);
          const { id } = await created.json();
          createdExecutorIds.push(id);
          const codeOf = async () =>
            (await drizzleDb.select({ c: ticket_executors.invite_code }).from(ticket_executors).where(eq(ticket_executors.id, id)))[0]!.c;

          const off = await call(`/api/ticket_executors/${id}`, { method: "PUT", headers: json, body: JSON.stringify({ is_active: false }) });
          expect(off.status).toBe(200);
          const before = await codeOf();
          const denied = await call(`/api/ticket_executors/${id}/invite`, { method: "POST", headers: s.headers });
          expect(denied.status).toBe(422);
          expect((await denied.json()).message).toContain("выключен");
          expect(await codeOf()).toBe(before);

          const on = await call(`/api/ticket_executors/${id}`, { method: "PUT", headers: json, body: JSON.stringify({ is_active: true }) });
          expect(on.status).toBe(200);
          const ok = await call(`/api/ticket_executors/${id}/invite`, { method: "POST", headers: s.headers });
          expect(ok.status).toBe(200);
          expect(await codeOf()).not.toBe(before);

          const missing = await call(`/api/ticket_executors/${randomUUID()}/invite`, { method: "POST", headers: s.headers });
          expect(missing.status).toBe(404);
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
        // Без терминалов сессия — офис и несёт tickets.list_all; со скоупом
        // филиала право не выдаётся, иначе она тоже стала бы офисом.
        const permissions = opts.terminals ? ["tickets.list"] : ["tickets.list", "tickets.list_all"];
        const s = await withSession({ permissions, ...opts });
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

      it("офисная сессия (tickets.list_all, без филиалов) пишет office в комментарий и событие", async () => {
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
        const s = await withSession({ permissions: ["tickets.list", "tickets.list_all"] });
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

    // Точка непрочитанного на планшете: «в заявке есть события новее
    // manager_seen_at». Строка списка не несла ни времени последнего события, ни
    // updated_at (комментарий updated_at не трогает), поэтому добавлены
    // last_event_at и preview_attachment_id. Время событий и отметки задано явно,
    // а не через now(): иначе порядок зависел бы от двух разных часов (Node у
    // /seen и база у defaultNow()). Фикстуры настоящие: на пустой связи тест
    // прошёл бы и при выкинутом подзапросе, потому что null это null.
    describe("список заявок — last_event_at и превью (с фикстурами)", () => {
      const terminalId = randomUUID();
      const createdTicketIds: string[] = [];
      let typeId: string | undefined;
      let unreadId: string | undefined;
      let readId: string | undefined;
      let noEventsId: string | undefined;
      let previewId: string | undefined;
      let onlyResultId: string | undefined;
      const files: string[] = [];

      // Postgres отдаёт timestamptz строкой «2026-10-05 17:00:00.123456+05» (пояс
      // сессии базы): сравниваем моменты, а не текст.
      const ms = (s: string | null) => Date.parse((s ?? "").replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
      let previewProblemFirst: string | undefined;

      beforeAll(async () => {
        const [type] = await drizzleDb
          .insert(ticket_types)
          .values({
            code: "test_last_event_" + randomUUID().slice(0, 8),
            number_prefix: "TE",
            name_ru: "Тестовый тип (last_event_at)",
            name_uz: "Test turi (last_event_at)",
            executor_kind: "staff",
            fields_schema: [],
          })
          .returning({ id: ticket_types.id });
        typeId = type.id;

        const insertTicket = async (extra: Partial<typeof tickets.$inferInsert> = {}) => {
          const [row] = await drizzleDb
            .insert(tickets)
            .values({
              type_id: must(typeId, "typeId"),
              terminal_id: terminalId,
              organization_id: randomUUID(),
              created_by: randomUUID(),
              ...extra,
            })
            .returning({ id: tickets.id });
          createdTicketIds.push(row.id);
          return row.id;
        };
        const insertEvent = (ticket_id: string, at: string, actor_kind: "manager" | "executor" | "office" | "system", type: "created" | "comment" | "assigned") =>
          drizzleDb.insert(ticket_events).values({ ticket_id, type, actor_kind, created_at: at });

        // Непрочитанная: отметка 10:00, события 09:00 (created), 11:00 и 10:30.
        // Вставка не по порядку: максимум должен быть именно максимумом, а не
        // первым или последним вставленным.
        unreadId = await insertTicket({ manager_seen_at: "2026-10-05T10:00:00.000Z" });
        await insertEvent(unreadId, "2026-10-05T09:00:00.000Z", "manager", "created");
        await insertEvent(unreadId, "2026-10-05T11:00:00.000Z", "executor", "comment");
        await insertEvent(unreadId, "2026-10-05T10:30:00.000Z", "office", "assigned");

        // Прочитанная: единственное событие раньше отметки.
        readId = await insertTicket({ manager_seen_at: "2026-10-05T12:00:00.000Z" });
        await insertEvent(readId, "2026-10-05T09:00:00.000Z", "manager", "created");

        // Без событий вовсе.
        noEventsId = await insertTicket();

        // Превью: фото результата самое раннее, затем два фото проблемы; нужно
        // самое раннее фото ПРОБЛЕМЫ. Заявка к тому же с тремя событиями и двумя
        // фото проблемы: размножение строк join-ом показало бы её в списке 6 раз.
        previewId = await insertTicket();
        await insertEvent(previewId, "2026-10-05T09:00:00.000Z", "manager", "created");
        await insertEvent(previewId, "2026-10-05T09:05:00.000Z", "system", "assigned");
        await insertEvent(previewId, "2026-10-05T09:10:00.000Z", "executor", "comment");
        const insertAttachment = async (ticket_id: string, phase: "problem" | "result", at: string) => {
          const file = join(tmpdir(), "last_event_probe_" + randomUUID() + ".jpg");
          files.push(file);
          await writeFile(file, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
          const [a] = await drizzleDb
            .insert(ticket_attachments)
            .values({ ticket_id, phase, file_path: file, mime: "image/jpeg", size_bytes: 4, uploaded_by_kind: "manager", created_at: at })
            .returning({ id: ticket_attachments.id });
          return a.id;
        };
        await insertAttachment(previewId, "result", "2026-10-05T08:00:00.000Z");
        await insertAttachment(previewId, "problem", "2026-10-05T09:02:00.000Z");
        previewProblemFirst = await insertAttachment(previewId, "problem", "2026-10-05T09:01:00.000Z");

        // Только фото результата: превью проблемы нет.
        onlyResultId = await insertTicket();
        await insertAttachment(onlyResultId, "result", "2026-10-05T09:00:00.000Z");
      }, 30000);

      afterAll(async () => {
        // Дети раньше заявки: каскада по FK нет.
        if (createdTicketIds.length > 0) {
          await drizzleDb.delete(ticket_attachments).where(inArray(ticket_attachments.ticket_id, createdTicketIds));
          await drizzleDb.delete(ticket_events).where(inArray(ticket_events.ticket_id, createdTicketIds));
          await drizzleDb.delete(tickets).where(inArray(tickets.id, createdTicketIds));
        }
        if (typeId) {
          await drizzleDb.delete(ticket_types).where(inArray(ticket_types.id, [typeId]));
        }
        for (const f of files) await rm(f, { force: true });
      });

      const listRows = async () => {
        const s = await withSession({ permissions: ["tickets.list"], terminals: [terminalId] });
        try {
          const filters = JSON.stringify([{ field: "type_id", operator: "eq", value: must(typeId, "typeId") }]);
          const res = await call(`/api/tickets?limit=50&offset=0&filters=${encodeURIComponent(filters)}`, { headers: s.headers });
          expect(res.status).toBe(200);
          const body = await res.json();
          return body.data as any[];
        } finally {
          await s.cleanup();
        }
      };
      const rowOf = (rows: any[], id: string | undefined, name: string) => {
        const row = rows.find((r) => r.id === must(id, name));
        if (!row) throw new Error(`заявка ${name} не вернулась в списке`);
        return row;
      };

      it("новейшее событие новее отметки: last_event_at — максимум, а не первое или последнее по вставке", async () => {
        const row = rowOf(await listRows(), unreadId, "unreadId");
        expect(typeof row.last_event_at).toBe("string");
        expect(ms(row.last_event_at)).toBe(Date.parse("2026-10-05T11:00:00.000Z"));
        expect(ms(row.last_event_at)).toBeGreaterThan(ms(row.manager_seen_at));
      });

      it("событий нет: last_event_at равен null", async () => {
        const row = rowOf(await listRows(), noEventsId, "noEventsId");
        expect(row.last_event_at).toBeNull();
        expect(row.manager_seen_at).toBeNull();
      });

      it("отметка новее последнего события: событие не новее отметки", async () => {
        const row = rowOf(await listRows(), readId, "readId");
        expect(ms(row.last_event_at)).toBeLessThanOrEqual(ms(row.manager_seen_at));
      });

      it("seen после события гасит условие точки: отметка становится новее last_event_at", async () => {
        const id = must(unreadId, "unreadId");
        const s = await withSession({ permissions: ["tickets.list"], terminals: [terminalId] });
        try {
          const res = await call(`/api/tickets/${id}/seen`, {
            method: "POST",
            headers: { ...s.headers, "content-type": "application/json" },
          });
          expect(res.status).toBe(200);
        } finally {
          await s.cleanup();
        }
        const row = rowOf(await listRows(), unreadId, "unreadId");
        expect(ms(row.last_event_at)).toBe(Date.parse("2026-10-05T11:00:00.000Z"));
        expect(ms(row.manager_seen_at)).toBeGreaterThan(ms(row.last_event_at));
      });

      it("подзапросы не размножают строки: заявка с тремя событиями и тремя фото стоит в списке один раз", async () => {
        const rows = await listRows();
        expect(rows).toHaveLength(5);
        expect(new Set(rows.map((r) => r.id)).size).toBe(5);
        expect(rows.filter((r) => r.id === previewId)).toHaveLength(1);
      });

      it("превью — самое раннее фото проблемы, фото результата не берётся", async () => {
        const rows = await listRows();
        expect(rowOf(rows, previewId, "previewId").preview_attachment_id).toBe(must(previewProblemFirst, "previewProblemFirst"));
      });

      it("без фото проблемы превью — null (и без фото вовсе, и с одним результатом)", async () => {
        const rows = await listRows();
        expect(rowOf(rows, onlyResultId, "onlyResultId").preview_attachment_id).toBeNull();
        expect(rowOf(rows, noEventsId, "noEventsId").preview_attachment_id).toBeNull();
      });
    });

    // Редактор типов (admin/app/[locale]/tickets/types) отправляет схему целиком
    // и ждёт её обратно без потерь: три поля с вариантами не должны ни схлопнуться,
    // ни потерять подписи, ни поменять порядок. Это же «сохранить без изменений»
    // из плана, которое на проде делать нельзя: запись в живой тип рискует его
    // fields_schema, а войти в админку исполнитель не может. Поэтому здесь, на
    // managers_tickets_test: сверяется jsonb_array_length до и после и сама схема.
    describe("типы заявок — схема полей проходит запись без потерь (с фикстурой)", () => {
      const suffix = randomUUID().slice(0, 8);
      const createdTypeIds: string[] = [];
      const option = (value: string, ru: string, uz: string) => ({ value, label_ru: ru, label_uz: uz });
      // Форма, которую даёт редактор: select с вариантами, select покороче,
      // необязательный text. Ключи и порядок важны, подписи — кириллица и
      // узбекские апострофы, чтобы сериализация jsonb была проверена не на ASCII.
      const schema = [
        {
          key: "broken_part",
          type: "select",
          required: true,
          label_ru: "Что сломано",
          label_uz: "Nima buzilgan",
          options: [
            option("camera", "Конкретная камера", "Muayyan kamera"),
            option("dvr", "Видеорегистратор", "Videoregistrator"),
            option("no_remote", "Нет удалённого доступа", "Masofaviy kirish yo'q"),
          ],
        },
        {
          key: "zone",
          type: "select",
          required: false,
          label_ru: "Зона",
          label_uz: "Hudud",
          options: [option("hall", "Зал", "Zal"), option("street", "Улица", "Ko'cha")],
        },
        { key: "note", type: "text", required: false, label_ru: "Описание", label_uz: "Izoh" },
      ];

      afterAll(async () => {
        // Заявок фикстура не создаёт, поэтому дочерних строк нет и удаляется
        // один тип.
        if (createdTypeIds.length > 0) {
          await drizzleDb.delete(ticket_types).where(inArray(ticket_types.id, createdTypeIds));
        }
      });

      const stored = async (id: string) => {
        const [r] = await drizzleDb
          .select({
            n: sql<number>`jsonb_array_length(${ticket_types.fields_schema})`,
            schema: ticket_types.fields_schema,
          })
          .from(ticket_types)
          .where(eq(ticket_types.id, id));
        return r;
      };

      it("три поля с вариантами: создание, чтение и повторное сохранение того же ничего не теряют", async () => {
        const s = await withSession({ permissions: ["tickets.types.manage"] });
        const json = { ...s.headers, "content-type": "application/json" };
        try {
          const created = await call("/api/ticket_types", {
            method: "POST",
            headers: json,
            body: JSON.stringify({
              code: "test_schema_" + suffix,
              number_prefix: "TS",
              name_ru: "Тест схемы",
              name_uz: "Sxema testi",
              executor_kind: "external",
              fields_schema: schema,
            }),
          });
          expect(created.status).toBe(200);
          const { id } = await created.json();
          createdTypeIds.push(id);

          const before = await stored(id);
          expect(Number(before.n)).toBe(3);
          expect(before.schema).toEqual(schema);

          // То, что экран получил бы на открытии панели.
          const list = await call("/api/ticket_types/manage?include_inactive=true", { headers: s.headers });
          expect(list.status).toBe(200);
          const row = (await list.json()).data.find((r: any) => r.id === id);
          expect(row.fields_schema).toEqual(schema);

          // «Сохранить без изменений»: в PUT уходит ровно то, что вернул GET.
          const put = await call(`/api/ticket_types/${id}`, {
            method: "PUT",
            headers: json,
            body: JSON.stringify({ fields_schema: row.fields_schema }),
          });
          expect(put.status).toBe(200);
          expect((await put.json()).fields_schema).toEqual(schema);

          const after = await stored(id);
          expect(Number(after.n)).toBe(3);
          expect(after.schema).toEqual(schema);
        } finally {
          await s.cleanup();
        }
      });

      it("схема с ошибками: 422 со списком errors, сохранённая схема не меняется", async () => {
        const [row] = await drizzleDb
          .insert(ticket_types)
          .values({
            code: "test_schema_bad_" + suffix,
            number_prefix: "TB",
            name_ru: "Тест 422",
            name_uz: "422 testi",
            executor_kind: "external",
            fields_schema: schema,
          })
          .returning({ id: ticket_types.id });
        createdTypeIds.push(row.id);

        const s = await withSession({ permissions: ["tickets.types.manage"] });
        try {
          const res = await call(`/api/ticket_types/${row.id}`, {
            method: "PUT",
            headers: { ...s.headers, "content-type": "application/json" },
            body: JSON.stringify({
              fields_schema: [
                { key: "Bad Key", type: "text", required: false, label_ru: "x", label_uz: "x" },
                { key: "ok", type: "select", required: false, label_ru: "y", label_uz: "y", options: [] },
              ],
            }),
          });
          expect(res.status).toBe(422);
          const body = await res.json();
          // Экран показывает message заголовком, а errors списком над формой.
          expect(body.message).toBe("Схема полей неверна");
          expect(body.errors).toEqual([
            "поле #1: ключ должен быть snake_case латиницей",
            "ok: у select должен быть хотя бы один вариант",
          ]);

          const kept = await stored(row.id);
          expect(Number(kept.n)).toBe(3);
          expect(kept.schema).toEqual(schema);
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
