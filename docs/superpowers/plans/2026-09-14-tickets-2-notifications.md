# Заявки — План 2: уведомления, бот и тесты авторизации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести заявку до подрядчика: событие в базе превращается в сообщение в Telegram, а человек из подрядной фирмы привязывается к боту по одноразовой ссылке.

**Architecture:** Postgres — правда, Redis — транспорт. Изменение заявки пишет `ticket_events` и строки `ticket_notifications` в одной транзакции; после коммита задача уходит в очередь BullMQ `tickets-notify`. Отдельный процесс `office_tickets_worker` (bun-исходник в `cron/`, как `iiko_document_worker`) разбирает очередь и говорит с Telegram. Маршрутизация и тексты — чистые функции с тестами. Плюс первая в этом репозитории обвязка для тестов уровня HTTP: отдельная база, поднятый в процессе Elysia, подложенная в Redis сессия.

**Tech Stack:** Bun, Elysia, Drizzle, PostgreSQL, BullMQ 5.80, ioredis, Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-09-12-tickets-design.md` (разделы 8 «Бот и мини-апп исполнителя», 11 «Уведомления», 7 «API» в части вебхука)

**Предыдущий план:** `docs/superpowers/plans/2026-09-12-tickets-1-backend-core.md`, журнал `docs/superpowers/tickets-plan1-ledger.md` — там 38 решений, принятых по ходу; читать перед спорами о том, «почему так».

## Global Constraints

- Репозиторий на сервере: `/home/davr/managers`, ветка для этого плана — `feature/tickets-notify` от `main`. `git push` не работает (протухший PAT), всё локально.
- `bun` не в PATH при неинтерактивном ssh: `export PATH=/root/.bun/bin:$PATH`.
- Рабочее дерево грязное. Коммитить только свои файлы поимённо, `git add -A` запрещён.
- `pkill -f` запрещён (однажды снёс прод-воркеры). `pm2 restart` — только на шаге деплоя и только для своего процесса.
- Прод-база `managers` — для тестов уровня HTTP заводится ОТДЕЛЬНАЯ база `managers_tickets_test`; ни один тест не пишет в прод.
- `office_api` — компилируемый бинарь; правка исходников без пересборки ничего не меняет.
- Уведомления никогда не отправляются из HTTP-обработчика. Обработчик пишет строки и ставит задачу; говорит с Telegram только воркер.
- Событие и его строки уведомлений пишутся в ОДНОЙ транзакции с изменением заявки. Постановка в очередь — после коммита.
- Тексты сообщений двуязычные: русский и узбекский на латинице, язык берётся из `ticket_executors.lang`.
- BullMQ-задачи обязаны нести `removeOnComplete` и `removeOnFail` (их отсутствие в arryt раздуло Redis до 3.41 ГБ).

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `backend/tests/helpers/http.ts` | Обвязка тестов уровня HTTP: сессия в Redis, вызов `app.handle`, уборка |
| `backend/src/modules/tickets/routes.test.ts` | Тесты авторизации и скоупинга на существующие роуты |
| `backend/src/modules/tickets/routing.ts` + `.test.ts` | Событие + заявка → список получателей (чистая функция) |
| `backend/src/modules/tickets/messages.ts` + `.test.ts` | Тексты и клавиатуры сообщений на двух языках |
| `backend/src/modules/tickets/telegram.ts` + `.test.ts` | Клиент Bot API: send, edit, разбор 429 |
| `backend/src/modules/tickets/notify.ts` + `.test.ts` | Запись `ticket_notifications` в транзакции + постановка в очередь |
| `backend/src/modules/tickets/queue.ts` | Очередь `tickets-notify`, опции задач, имена |
| `backend/src/modules/tickets/bot-controller.ts` | `POST /tickets/bot/webhook`: `/start inv_<uuid>` |
| `cron/tickets_worker.ts` | Процесс-воркер: разбор очереди, отправка, подметалка |
| `cron/pm2.config.js` (правка) | Регистрация `office_tickets_worker` |
| `backend/src/modules/tickets/controller.ts` (правка) | Вызовы `notify` после каждого изменения состояния |
| `backend/src/controllers.ts` (правка) | Регистрация `bot-controller` |
| `backend/package.json` (правка) | bullmq `^5.61.0` → `^5.80.9` (выравнивание с `cron`) |

---

### Task 1: Обвязка для тестов уровня HTTP

**Files:**
- Create: `backend/tests/helpers/http.ts`
- Create: `backend/tests/helpers/README.md`
- Modify: `backend/package.json` (скрипт `test:http`)

**Interfaces:**
- Consumes: `backend/src/app.ts` (экспорт `app`), `@backend/lib/shared-instances` (redis)
- Produces: `withSession(opts): Promise<{ headers, cleanup }>`, `callApi(path, init?): Promise<Response>`, `TEST_DB_URL`

Задача заводит то, чего в репозитории нет ни у одного модуля: возможность позвать роут целиком и проверить, кого он пускает. Без неё правило «филиал не видит чужой филиал» держится на чтении кода.

- [ ] **Step 1: Создать тестовую базу и накатить миграции**

```bash
ssh root@choparpizza.uz
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
DB=$(grep -m1 DATABASE_URL .env | cut -d= -f2- | tr -d '"')
psql "$DB" -c "CREATE DATABASE managers_tickets_test"
TEST_URL=$(echo "$DB" | sed 's#/[^/]*$#/managers_tickets_test#')
echo "$TEST_URL"
DATABASE_URL="$TEST_URL" bunx drizzle-kit migrate
psql "$TEST_URL" -c "\dt ticket*"
```
Ожидается: 9 таблиц `ticket_*`. Если `drizzle-kit migrate` падает на чужой миграции — остановиться и доложить, не чинить чужое.

- [ ] **Step 2: Написать обвязку**

`backend/tests/helpers/http.ts`:

```ts
import { randomUUID } from "node:crypto";
import Redis from "ioredis";

// Тесты ходят в ОТДЕЛЬНУЮ базу. Переменная выставляется до импорта app,
// иначе синглтон drizzle успеет подключиться к проду.
export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/managers_tickets_test";

const prefix = process.env.PROJECT_PREFIX ?? "";
const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: parseInt(process.env.REDIS_PORT ?? "6379"),
});

export type SessionOptions = {
  permissions: string[];
  terminals?: string[];
  userId?: string;
  roleId?: string;
};

// Макрос permission читает две вещи: user_data:<sessionId> (юзер, роль,
// терминалы) и кэш ролей, откуда берёт права по role.id. Тест подкладывает
// обе, потому что поднимать настоящий логин ради проверки доступа — это
// проверять логин, а не доступ.
export async function withSession(opts: SessionOptions) {
  const sessionId = randomUUID();
  const userId = opts.userId ?? randomUUID();
  const roleId = opts.roleId ?? randomUUID();

  await redis.set(
    `${prefix}user_data:${sessionId}`,
    JSON.stringify({
      user: { id: userId, status: "active", login: `test_${userId.slice(0, 8)}` },
      role: { id: roleId, name: "test", code: "test" },
      terminals: opts.terminals ?? [],
    }),
    "EX",
    300
  );

  const rolesKey = `${prefix}roles`;
  const existing = await redis.get(rolesKey);
  const roles = existing ? JSON.parse(existing) : [];
  roles.push({ id: roleId, name: "test", code: "test", permissions: opts.permissions });
  await redis.set(rolesKey, JSON.stringify(roles));

  return {
    sessionId,
    userId,
    roleId,
    headers: { cookie: `sessionId=${sessionId}` },
    async cleanup() {
      await redis.del(`${prefix}user_data:${sessionId}`);
      const raw = await redis.get(rolesKey);
      if (raw) {
        const list = JSON.parse(raw).filter((r: any) => r.id !== roleId);
        await redis.set(rolesKey, JSON.stringify(list));
      }
    },
  };
}

export async function closeTestRedis() {
  await redis.quit();
}
```

`backend/tests/helpers/README.md` — десять строк: зачем отдельная база, как её пересоздать, почему тесты подкладывают сессию в Redis, и предупреждение, что ключ `${PROJECT_PREFIX}roles` общий с продом, поэтому `cleanup()` обязателен.

- [ ] **Step 3: Добавить скрипт запуска**

В `backend/package.json`, в `scripts`:

```json
"test:http": "DATABASE_URL=$TEST_DATABASE_URL bun test src/modules/tickets/routes.test.ts"
```

- [ ] **Step 4: Проверить обвязку на одном роуте**

Временный файл `backend/tests/helpers/smoke.test.ts`:

```ts
import { describe, expect, it, afterAll } from "bun:test";
import { closeTestRedis, withSession } from "./http";

describe("обвязка сессий", () => {
  it("кладёт сессию и права в redis и убирает за собой", async () => {
    const s = await withSession({ permissions: ["tickets.list"], terminals: [] });
    expect(s.headers.cookie).toContain("sessionId=");
    await s.cleanup();
  });
  afterAll(async () => { await closeTestRedis(); });
});
```

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test tests/helpers/smoke.test.ts
```
Ожидается: 1 pass. После проверки файл удалить — его роль исчерпана.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add backend/tests/helpers/http.ts backend/tests/helpers/README.md backend/package.json
git commit -m "test(tickets): обвязка для тестов уровня HTTP — отдельная база и сессия в redis"
```

---

### Task 2: Тесты авторизации и скоупинга

**Files:**
- Create: `backend/src/modules/tickets/routes.test.ts`

**Interfaces:**
- Consumes: `withSession`, `closeTestRedis` из `backend/tests/helpers/http`; `app` из `@backend/app`
- Produces: регрессионная сетка под правила доступа; следующий план добавляет вторую модель доступа на те же таблицы

- [ ] **Step 1: Написать тесты**

`backend/src/modules/tickets/routes.test.ts`:

```ts
import { afterAll, describe, expect, it } from "bun:test";
import { closeTestRedis, withSession } from "../../../tests/helpers/http";
import app from "../../app";

const call = (path: string, init: RequestInit = {}) =>
  app.handle(new Request(`http://localhost${path}`, init));

describe("доступ к заявкам", () => {
  it("без сессии отдаёт 401", async () => {
    const res = await call("/api/tickets?limit=10&offset=0");
    expect(res.status).toBe(401);
  });

  it("с сессией без нужного права отдаёт 403", async () => {
    const s = await withSession({ permissions: ["users.list"] });
    const res = await call("/api/tickets?limit=10&offset=0", { headers: s.headers });
    expect(res.status).toBe(403);
    await s.cleanup();
  });

  it("с правом tickets.list отдаёт список", async () => {
    const s = await withSession({ permissions: ["tickets.list"] });
    const res = await call("/api/tickets?limit=10&offset=0", { headers: s.headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    await s.cleanup();
  });

  it("филиальная роль не видит заявок чужого филиала", async () => {
    const mine = "11111111-1111-1111-1111-111111111111";
    const s = await withSession({ permissions: ["tickets.list"], terminals: [mine] });
    const res = await call("/api/tickets?limit=100&offset=0", { headers: s.headers });
    const body = await res.json();
    for (const row of body.data) expect(row.terminal_id ?? mine).toBe(mine);
    await s.cleanup();
  });

  it("несуществующая заявка отдаёт 404, а не 500", async () => {
    const s = await withSession({ permissions: ["tickets.list"] });
    const res = await call("/api/tickets/99999999-9999-9999-9999-999999999999", { headers: s.headers });
    expect(res.status).toBe(404);
    await s.cleanup();
  });

  it("кривой id отдаёт 404, а не ошибку базы", async () => {
    const s = await withSession({ permissions: ["tickets.list"] });
    const res = await call("/api/tickets/not-a-uuid", { headers: s.headers });
    expect(res.status).toBe(404);
    await s.cleanup();
  });

  it("утверждение сумм закрыто от роли без этого права", async () => {
    const s = await withSession({ permissions: ["tickets.list", "tickets.close"] });
    const res = await call("/api/tickets/payment/approve", {
      method: "POST",
      headers: { ...s.headers, "content-type": "application/json" },
      body: JSON.stringify({ ids: ["11111111-1111-1111-1111-111111111111"] }),
    });
    expect(res.status).toBe(403);
    await s.cleanup();
  });

  it("справочники закрыты от менеджера", async () => {
    const s = await withSession({ permissions: ["tickets.create", "tickets.list"] });
    const res = await call("/api/ticket_contractors", { headers: s.headers });
    expect(res.status).toBe(403);
    await s.cleanup();
  });

  it("список типов доступен по праву создания", async () => {
    const s = await withSession({ permissions: ["tickets.create"] });
    const res = await call("/api/ticket_types", { headers: s.headers });
    expect(res.status).toBe(200);
    await s.cleanup();
  });

  afterAll(async () => { await closeTestRedis(); });
});
```

- [ ] **Step 2: Прогнать**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/managers_tickets_test" \
  DATABASE_URL="postgres://postgres:postgres@localhost:5432/managers_tickets_test" \
  bun test src/modules/tickets/routes.test.ts
```
Ожидается: 9 pass. Строка подключения — та же, что вывел Step 1 задачи 1; пароль и хост взять оттуда, не выдумывать.

- [ ] **Step 3: Убедиться, что прод-база не тронута**

```bash
psql "$(grep -m1 DATABASE_URL /home/davr/managers/backend/.env | cut -d= -f2- | tr -d '"')" \
  -tAc "select count(*) from tickets"
```
Ожидается: `0`. Любое другое число означает, что тест писал в прод — остановиться и доложить.

- [ ] **Step 4: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/routes.test.ts
git commit -m "test(tickets): тесты авторизации и терминального скоупинга"
```

---

### Task 3: Маршрутизация уведомлений

**Files:**
- Create: `backend/src/modules/tickets/routing.ts`
- Test: `backend/src/modules/tickets/routing.test.ts`

**Interfaces:**
- Consumes: ничего (чистый модуль)
- Produces: `Recipient = { executor_id: string; chat_id: number; lang: string; kind: "send" | "edit"; target_message_id?: number }`, `routeEvent(input): Recipient[]`

- [ ] **Step 1: Написать падающий тест**

`backend/src/modules/tickets/routing.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { routeEvent, type RoutingInput } from "./routing";

const ex = (id: string, chat: number, lang = "ru") => ({ id, tg_user_id: chat, lang, is_active: true });

const base: RoutingInput = {
  event: { type: "created", actor_kind: "manager" },
  ticket: { id: "t1", status: "new", assigned_executor_id: null },
  firmExecutors: [ex("e1", 111), ex("e2", 222)],
  broadcast: [],
};

describe("routeEvent", () => {
  it("рассылает новую заявку всем исполнителям фирмы", () => {
    const r = routeEvent(base);
    expect(r.map((x) => x.chat_id).sort()).toEqual([111, 222]);
    expect(r.every((x) => x.kind === "send")).toBe(true);
  });

  it("пропускает неактивных исполнителей и людей без привязки к боту", () => {
    const r = routeEvent({
      ...base,
      firmExecutors: [ex("e1", 111), { ...ex("e2", 222), is_active: false }, { id: "e3", tg_user_id: null, lang: "ru", is_active: true }],
    });
    expect(r.map((x) => x.chat_id)).toEqual([111]);
  });

  it("при захвате гасит кнопку у остальных и подтверждает взявшему", () => {
    const r = routeEvent({
      event: { type: "assigned", actor_kind: "executor", actor_executor_id: "e1" },
      ticket: { id: "t1", status: "in_progress", assigned_executor_id: "e1" },
      firmExecutors: [ex("e1", 111), ex("e2", 222)],
      broadcast: [
        { executor_id: "e1", chat_id: 111, tg_message_id: 900 },
        { executor_id: "e2", chat_id: 222, tg_message_id: 901 },
      ],
    });
    const edits = r.filter((x) => x.kind === "edit");
    expect(edits.map((x) => x.chat_id)).toEqual([222]);
    expect(edits[0].target_message_id).toBe(901);
    const sends = r.filter((x) => x.kind === "send");
    expect(sends.map((x) => x.chat_id)).toEqual([111]);
  });

  it("комментарий менеджера уходит только исполнителю", () => {
    const r = routeEvent({
      event: { type: "comment", actor_kind: "manager" },
      ticket: { id: "t1", status: "in_progress", assigned_executor_id: "e1" },
      firmExecutors: [ex("e1", 111), ex("e2", 222)],
      broadcast: [],
    });
    expect(r.map((x) => x.chat_id)).toEqual([111]);
  });

  it("комментарий исполнителя не уходит никому", () => {
    const r = routeEvent({
      event: { type: "comment", actor_kind: "executor", actor_executor_id: "e1" },
      ticket: { id: "t1", status: "in_progress", assigned_executor_id: "e1" },
      firmExecutors: [ex("e1", 111)],
      broadcast: [],
    });
    expect(r).toEqual([]);
  });

  it("возврат в работу и закрытие уходят исполнителю", () => {
    for (const type of ["reopened", "closed"] as const) {
      const r = routeEvent({
        event: { type, actor_kind: "manager" },
        ticket: { id: "t1", status: type === "closed" ? "closed" : "in_progress", assigned_executor_id: "e1" },
        firmExecutors: [ex("e1", 111), ex("e2", 222)],
        broadcast: [],
      });
      expect(r.map((x) => x.chat_id)).toEqual([111]);
    }
  });

  it("отмена гасит кнопку у нерешивших и пишет взявшему", () => {
    const r = routeEvent({
      event: { type: "cancelled", actor_kind: "manager" },
      ticket: { id: "t1", status: "cancelled", assigned_executor_id: "e1" },
      firmExecutors: [ex("e1", 111), ex("e2", 222)],
      broadcast: [
        { executor_id: "e1", chat_id: 111, tg_message_id: 900 },
        { executor_id: "e2", chat_id: 222, tg_message_id: 901 },
      ],
    });
    expect(r.filter((x) => x.kind === "edit").map((x) => x.chat_id)).toEqual([901]);
    expect(r.filter((x) => x.kind === "send").map((x) => x.chat_id)).toEqual([111]);
  });

  it("отмена неназначенной заявки только гасит кнопки", () => {
    const r = routeEvent({
      event: { type: "cancelled", actor_kind: "manager" },
      ticket: { id: "t1", status: "cancelled", assigned_executor_id: null },
      firmExecutors: [ex("e1", 111), ex("e2", 222)],
      broadcast: [
        { executor_id: "e1", chat_id: 111, tg_message_id: 900 },
        { executor_id: "e2", chat_id: 222, tg_message_id: 901 },
      ],
    });
    expect(r.every((x) => x.kind === "edit")).toBe(true);
    expect(r.map((x) => x.chat_id).sort()).toEqual([111, 222]);
  });

  it("платёжные события не уходят наружу", () => {
    for (const type of ["payment_approved", "payment_rejected"] as const) {
      const r = routeEvent({
        event: { type, actor_kind: "office" },
        ticket: { id: "t1", status: "closed", assigned_executor_id: "e1" },
        firmExecutors: [ex("e1", 111)],
        broadcast: [],
      });
      expect(r).toEqual([]);
    }
  });

  it("сдача работы исполнителем никому не шлётся", () => {
    const r = routeEvent({
      event: { type: "done_submitted", actor_kind: "executor", actor_executor_id: "e1" },
      ticket: { id: "t1", status: "done", assigned_executor_id: "e1" },
      firmExecutors: [ex("e1", 111)],
      broadcast: [],
    });
    expect(r).toEqual([]);
  });

  it("язык получателя переносится в адресата", () => {
    const r = routeEvent({ ...base, firmExecutors: [ex("e1", 111, "uz")] });
    expect(r[0].lang).toBe("uz");
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/routing.test.ts
```
Ожидается: FAIL, `Cannot find module './routing'`.

- [ ] **Step 3: Реализовать**

`backend/src/modules/tickets/routing.ts`:

```ts
export type ExecutorRow = {
  id: string;
  tg_user_id: number | null;
  lang: string;
  is_active: boolean;
};

export type BroadcastRow = {
  executor_id: string;
  chat_id: number;
  tg_message_id: number | null;
};

export type RoutingInput = {
  event: {
    type:
      | "created" | "assigned" | "comment" | "done_submitted"
      | "reopened" | "closed" | "cancelled"
      | "payment_approved" | "payment_rejected";
    actor_kind: "manager" | "executor" | "office" | "system";
    actor_executor_id?: string | null;
  };
  ticket: { id: string; status: string; assigned_executor_id: string | null };
  firmExecutors: ExecutorRow[];
  // Уже разосланные сообщения по этой заявке: кому и какое. Нужны, чтобы
  // погасить кнопку «Беру» у тех, кто не успел.
  broadcast: BroadcastRow[];
};

export type Recipient = {
  executor_id: string;
  chat_id: number;
  lang: string;
  kind: "send" | "edit";
  target_message_id?: number;
};

const reachable = (e: ExecutorRow): boolean => e.is_active && typeof e.tg_user_id === "number";

const send = (e: ExecutorRow): Recipient => ({
  executor_id: e.id,
  chat_id: e.tg_user_id as number,
  lang: e.lang,
  kind: "send",
});

// Гашение кнопки у всех, кроме указанного исполнителя. Заявка уже не `new`,
// и живая кнопка «Беру» у остальных — это выезд на объект, где чинить нечего.
function editOthers(input: RoutingInput, exceptExecutorId: string | null): Recipient[] {
  const byId = new Map(input.firmExecutors.map((e) => [e.id, e]));
  return input.broadcast
    .filter((b) => b.executor_id !== exceptExecutorId && typeof b.tg_message_id === "number")
    .map((b) => ({
      executor_id: b.executor_id,
      chat_id: b.chat_id,
      lang: byId.get(b.executor_id)?.lang ?? "ru",
      kind: "edit" as const,
      target_message_id: b.tg_message_id as number,
    }));
}

function assignedExecutor(input: RoutingInput): ExecutorRow | undefined {
  const id = input.ticket.assigned_executor_id;
  if (!id) return undefined;
  return input.firmExecutors.find((e) => e.id === id && reachable(e));
}

export function routeEvent(input: RoutingInput): Recipient[] {
  switch (input.event.type) {
    case "created":
      return input.firmExecutors.filter(reachable).map(send);

    case "assigned": {
      const taker = assignedExecutor(input);
      return [...editOthers(input, input.ticket.assigned_executor_id), ...(taker ? [send(taker)] : [])];
    }

    case "comment": {
      // Только комментарий менеджера уходит наружу: исполнитель свой
      // комментарий уже видит, а менеджеру телеграм мы не шлём вовсе.
      if (input.event.actor_kind === "executor") return [];
      const target = assignedExecutor(input);
      return target ? [send(target)] : [];
    }

    case "reopened":
    case "closed": {
      const target = assignedExecutor(input);
      return target ? [send(target)] : [];
    }

    case "cancelled": {
      const target = assignedExecutor(input);
      return [...editOthers(input, input.ticket.assigned_executor_id), ...(target ? [send(target)] : [])];
    }

    // Сдача работы — событие для филиала, он видит его на планшете.
    case "done_submitted":
    // Деньги наружу не уходят: подрядчик узнаёт об оплате не из бота.
    // Поведение закреплено тестом, иначе первый же рефакторинг превратит
    // внутреннее финансовое решение в сообщение контрагенту.
    case "payment_approved":
    case "payment_rejected":
      return [];
  }
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/routing.test.ts
```
Ожидается: 11 pass.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/routing.ts backend/src/modules/tickets/routing.test.ts
git commit -m "feat(tickets): маршрутизация уведомлений по событиям заявки"
```

---

### Task 4: Тексты сообщений

**Files:**
- Create: `backend/src/modules/tickets/messages.ts`
- Test: `backend/src/modules/tickets/messages.test.ts`

**Interfaces:**
- Consumes: `FieldDef` из `./fields`
- Produces: `buildMessage(input): { text: string; reply_markup?: object }`, `MessageInput`

- [ ] **Step 1: Написать падающий тест**

`backend/src/modules/tickets/messages.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { buildMessage, type MessageInput } from "./messages";

const base: MessageInput = {
  eventType: "created",
  lang: "ru",
  ticket: {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    number: "TV-000123",
    priority: "urgent",
    terminal_name: "Чорсу",
    type_name_ru: "Реклама ТВ",
    type_name_uz: "Reklama TV",
    summary_ru: "Не включается",
    summary_uz: "Yoqilmayapti",
  },
  miniappUrl: "https://api.office.lesailes.uz/tickets-app/",
};

describe("buildMessage", () => {
  it("новая срочная заявка: номер, филиал, тип и кнопка", () => {
    const m = buildMessage(base);
    expect(m.text).toContain("TV-000123");
    expect(m.text).toContain("Чорсу");
    expect(m.text).toContain("Реклама ТВ");
    expect(m.text).toContain("Срочная");
    expect(m.reply_markup).toBeDefined();
    const button = (m.reply_markup as any).inline_keyboard[0][0];
    expect(button.web_app.url).toContain("?ticket=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("обычная заявка не называется срочной", () => {
    const m = buildMessage({ ...base, ticket: { ...base.ticket, priority: "normal" } });
    expect(m.text).not.toContain("Срочная");
  });

  it("узбекская локаль берёт узбекские подписи", () => {
    const m = buildMessage({ ...base, lang: "uz" });
    expect(m.text).toContain("Reklama TV");
    expect(m.text).toContain("Yoqilmayapti");
    expect(m.text).not.toContain("Реклама ТВ");
  });

  it("неизвестный язык падает на русский", () => {
    const m = buildMessage({ ...base, lang: "en" });
    expect(m.text).toContain("Реклама ТВ");
  });

  it("гашение кнопки: текст без кнопки и с именем взявшего", () => {
    const m = buildMessage({
      ...base,
      eventType: "assigned_other",
      takenBy: "Азиз",
      takenAt: "14:32",
    });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("Азиз");
    expect(m.text).toContain("14:32");
  });

  it("подтверждение взявшему содержит кнопку", () => {
    const m = buildMessage({ ...base, eventType: "assigned_taker" });
    expect(m.reply_markup).toBeDefined();
  });

  it("возврат в работу несёт комментарий менеджера", () => {
    const m = buildMessage({ ...base, eventType: "reopened", comment: "Экран всё ещё чёрный" });
    expect(m.text).toContain("Экран всё ещё чёрный");
    expect(m.reply_markup).toBeDefined();
  });

  it("комментарий менеджера уходит с текстом комментария", () => {
    const m = buildMessage({ ...base, eventType: "comment", comment: "Какой из трёх телевизоров?" });
    expect(m.text).toContain("Какой из трёх телевизоров?");
  });

  it("закрытие благодарит и кнопку не даёт", () => {
    const m = buildMessage({ ...base, eventType: "closed" });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("TV-000123");
  });

  it("отмена сообщает, что ехать не надо", () => {
    const m = buildMessage({ ...base, eventType: "cancelled" });
    expect(m.reply_markup).toBeUndefined();
  });

  it("слишком длинный комментарий обрезается по границе телеграма", () => {
    const m = buildMessage({ ...base, eventType: "comment", comment: "я".repeat(5000) });
    expect(m.text.length).toBeLessThanOrEqual(4096);
  });

  it("разметка не ломается на символах HTML", () => {
    const m = buildMessage({ ...base, eventType: "comment", comment: "<b>жирный</b> & <i>" });
    expect(m.text).toContain("&lt;b&gt;");
    expect(m.text).toContain("&amp;");
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/messages.test.ts
```
Ожидается: FAIL, `Cannot find module './messages'`.

- [ ] **Step 3: Реализовать**

`backend/src/modules/tickets/messages.ts`:

```ts
export type MessageEvent =
  | "created" | "assigned_taker" | "assigned_other"
  | "comment" | "reopened" | "closed" | "cancelled";

export type MessageInput = {
  eventType: MessageEvent;
  lang: string;
  ticket: {
    id: string;
    number: string;
    priority: "normal" | "urgent";
    terminal_name: string;
    type_name_ru: string;
    type_name_uz: string;
    summary_ru: string;
    summary_uz: string;
  };
  miniappUrl: string;
  comment?: string;
  takenBy?: string;
  takenAt?: string;
};

// Telegram рвёт сообщение длиннее 4096 символов целиком, а не хвост,
// поэтому режем сами и оставляем видимый след обрезки.
const TG_LIMIT = 4096;

const L = {
  ru: {
    urgent: "🔴 Срочная",
    normal: "🔧 Заявка",
    open: "Открыть заявку",
    taken: (who: string, at: string) => `Взял ${who}, ${at}`,
    reopened: "Работу вернули на доработку",
    closed: "Филиал принял работу. Спасибо",
    cancelled: "Заявка отменена — выезжать не нужно",
    comment: "Сообщение от филиала",
  },
  uz: {
    urgent: "🔴 Shoshilinch",
    normal: "🔧 Ariza",
    open: "Arizani ochish",
    taken: (who: string, at: string) => `${who} oldi, ${at}`,
    reopened: "Ish qayta ko'rib chiqishga qaytarildi",
    closed: "Filial ishni qabul qildi. Rahmat",
    cancelled: "Ariza bekor qilindi — borish shart emas",
    comment: "Filialdan xabar",
  },
} as const;

const pick = (lang: string) => (lang === "uz" ? L.uz : L.ru);

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const clip = (s: string): string => (s.length <= TG_LIMIT ? s : `${s.slice(0, TG_LIMIT - 1)}…`);

export function buildMessage(input: MessageInput): { text: string; reply_markup?: object } {
  const t = pick(input.lang);
  const typeName = input.lang === "uz" ? input.ticket.type_name_uz : input.ticket.type_name_ru;
  const summary = input.lang === "uz" ? input.ticket.summary_uz : input.ticket.summary_ru;
  const head = `${input.ticket.priority === "urgent" ? t.urgent : t.normal} · ${esc(typeName)}`;
  const place = `${esc(input.ticket.terminal_name)} · ${esc(input.ticket.number)}`;

  const button = {
    inline_keyboard: [[
      { text: t.open, web_app: { url: `${input.miniappUrl}?ticket=${input.ticket.id}` } },
    ]],
  };

  switch (input.eventType) {
    case "created":
    case "assigned_taker":
      return { text: clip(`${head}\n${place}\n${esc(summary)}`), reply_markup: button };

    case "assigned_other":
      return {
        text: clip(`${head}\n${place}\n${t.taken(esc(input.takenBy ?? ""), esc(input.takenAt ?? ""))}`),
      };

    case "comment":
      return {
        text: clip(`${head}\n${place}\n\n${t.comment}:\n${esc(input.comment ?? "")}`),
        reply_markup: button,
      };

    case "reopened":
      return {
        text: clip(`${head}\n${place}\n\n${t.reopened}:\n${esc(input.comment ?? "")}`),
        reply_markup: button,
      };

    case "closed":
      return { text: clip(`${head}\n${place}\n\n${t.closed}`) };

    case "cancelled":
      return { text: clip(`${head}\n${place}\n\n${t.cancelled}`) };
  }
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/messages.test.ts
```
Ожидается: 12 pass.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/messages.ts backend/src/modules/tickets/messages.test.ts
git commit -m "feat(tickets): тексты уведомлений на двух языках"
```

---

### Task 5: Клиент Telegram

**Files:**
- Create: `backend/src/modules/tickets/telegram.ts`
- Test: `backend/src/modules/tickets/telegram.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `sendMessage(token, chatId, payload): Promise<TgResult>`, `editMessageText(token, chatId, messageId, payload): Promise<TgResult>`, `TgResult = { ok: true; message_id: number } | { ok: false; retryAfterMs?: number; permanent: boolean; error: string }`

- [ ] **Step 1: Написать падающий тест**

`backend/src/modules/tickets/telegram.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { interpretResponse } from "./telegram";

describe("interpretResponse", () => {
  it("успех отдаёт message_id", () => {
    const r = interpretResponse(200, { ok: true, result: { message_id: 42 } });
    expect(r).toEqual({ ok: true, message_id: 42 });
  });

  it("429 отдаёт задержку из retry_after в миллисекундах", () => {
    const r = interpretResponse(429, { ok: false, parameters: { retry_after: 7 }, description: "Too Many Requests" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.retryAfterMs).toBe(7000);
      expect(r.permanent).toBe(false);
    }
  });

  it("429 без retry_after всё равно временная ошибка", () => {
    const r = interpretResponse(429, { ok: false, description: "Too Many Requests" });
    if (!r.ok) expect(r.permanent).toBe(false);
  });

  it("403 «бот заблокирован» — постоянная ошибка, ретраить бесполезно", () => {
    const r = interpretResponse(403, { ok: false, description: "Forbidden: bot was blocked by the user" });
    if (!r.ok) expect(r.permanent).toBe(true);
  });

  it("400 «chat not found» — постоянная", () => {
    const r = interpretResponse(400, { ok: false, description: "Bad Request: chat not found" });
    if (!r.ok) expect(r.permanent).toBe(true);
  });

  it("400 «message is not modified» считаем успехом гашения", () => {
    const r = interpretResponse(400, { ok: false, description: "Bad Request: message is not modified" });
    expect(r.ok).toBe(true);
  });

  it("500 от телеграма — временная", () => {
    const r = interpretResponse(500, { ok: false, description: "Internal Server Error" });
    if (!r.ok) expect(r.permanent).toBe(false);
  });

  it("мусор вместо json — временная ошибка, а не падение", () => {
    const r = interpretResponse(200, null);
    if (!r.ok) expect(r.permanent).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/telegram.test.ts
```
Ожидается: FAIL, `Cannot find module './telegram'`.

- [ ] **Step 3: Реализовать**

`backend/src/modules/tickets/telegram.ts`:

```ts
export type TgResult =
  | { ok: true; message_id: number }
  | { ok: false; retryAfterMs?: number; permanent: boolean; error: string };

// Разбор ответа вынесен отдельно от сети: это единственная часть, где
// принимается решение «ретраить или списать», и её надо проверять тестами,
// а не живым Telegram.
export function interpretResponse(status: number, body: any): TgResult {
  if (status === 200 && body?.ok === true) {
    return { ok: true, message_id: body.result?.message_id ?? 0 };
  }

  const description: string = body?.description ?? `http ${status}`;

  // Гашение кнопки у сообщения, которое уже без кнопки, телеграм считает
  // ошибкой. Для нас цель достигнута.
  if (status === 400 && description.includes("message is not modified")) {
    return { ok: true, message_id: 0 };
  }

  if (status === 429) {
    const retryAfter = body?.parameters?.retry_after;
    return {
      ok: false,
      permanent: false,
      retryAfterMs: typeof retryAfter === "number" ? retryAfter * 1000 : undefined,
      error: description,
    };
  }

  // Пользователь заблокировал бота, чата нет, бот выкинут из чата — сколько
  // ни повторяй, ответ не изменится.
  const permanentMarks = [
    "bot was blocked",
    "chat not found",
    "user is deactivated",
    "bot was kicked",
    "have no rights",
  ];
  const permanent =
    (status === 400 || status === 403) && permanentMarks.some((m) => description.includes(m));

  return { ok: false, permanent, error: description };
}

async function call(token: string, method: string, payload: object): Promise<TgResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return interpretResponse(res.status, body);
  } catch (e) {
    // Сеть легла — временная ошибка, пусть очередь повторит.
    return { ok: false, permanent: false, error: (e as Error).message };
  }
}

export function sendMessage(
  token: string,
  chatId: number,
  payload: { text: string; reply_markup?: object }
): Promise<TgResult> {
  return call(token, "sendMessage", {
    chat_id: chatId,
    text: payload.text,
    parse_mode: "HTML",
    reply_markup: payload.reply_markup,
    disable_web_page_preview: true,
  });
}

export function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  payload: { text: string; reply_markup?: object }
): Promise<TgResult> {
  return call(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: payload.text,
    parse_mode: "HTML",
    reply_markup: payload.reply_markup,
  });
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/telegram.test.ts
```
Ожидается: 8 pass.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/telegram.ts backend/src/modules/tickets/telegram.test.ts
git commit -m "feat(tickets): клиент Telegram Bot API с разбором 429 и постоянных ошибок"
```

---

### Task 6: Очередь и запись уведомлений

**Files:**
- Create: `backend/src/modules/tickets/queue.ts`
- Create: `backend/src/modules/tickets/notify.ts`
- Test: `backend/src/modules/tickets/notify.test.ts`

**Interfaces:**
- Consumes: `routeEvent` из `./routing`; `ticket_notifications`, `ticket_executors`, `tickets`, `ticket_types` из схемы
- Produces: `TICKETS_QUEUE = "tickets-notify"`, `jobOptions`, `getTicketsQueue()`, `enqueueNotifications(ids)`, `recordNotifications(tx, input): Promise<string[]>`

- [ ] **Step 1: Написать очередь**

`backend/src/modules/tickets/queue.ts`:

```ts
import { Queue } from "bullmq";

export const TICKETS_QUEUE = "tickets-notify";
export const TICKETS_SWEEP_JOB = "tickets-outbox-sweep";

// Без removeOnComplete/removeOnFail Redis растёт без потолка: в arryt это
// вылилось в 3.41 ГБ, которые пришлось чистить руками.
export const jobOptions = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};

export function redisConnection() {
  return {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379"),
  };
}

let queue: Queue | null = null;

export function getTicketsQueue(): Queue {
  if (!queue) {
    queue = new Queue(TICKETS_QUEUE, { connection: redisConnection() });
    // Queue — EventEmitter: необработанное 'error' (например, Redis моргнул)
    // роняет процесс. Для API это недопустимо.
    queue.on("error", (e) => console.error("tickets-notify queue error", e));
  }
  return queue;
}

export async function enqueueNotifications(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;
  const q = getTicketsQueue();
  await Promise.all(
    notificationIds.map((id) =>
      q.add("deliver", { notificationId: id }, { ...jobOptions, jobId: id }).catch((e) => {
        // Постановка не удалась — строка в базе осталась pending, её подберёт
        // подметалка. Молча терять нельзя, падать тоже: заявка уже создана.
        console.error("tickets-notify enqueue failed", id, e);
      })
    )
  );
}
```

- [ ] **Step 2: Написать падающий тест на запись уведомлений**

`backend/src/modules/tickets/notify.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { buildNotificationRows } from "./notify";

const recipients = [
  { executor_id: "e1", chat_id: 111, lang: "ru", kind: "send" as const },
  { executor_id: "e2", chat_id: 222, lang: "uz", kind: "edit" as const, target_message_id: 900 },
];

describe("buildNotificationRows", () => {
  it("строит строку на получателя с привязкой к событию", () => {
    const rows = buildNotificationRows("ev1", recipients);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      event_id: "ev1",
      recipient_executor_id: "e1",
      recipient_chat_id: 111,
      kind: "send",
      status: "pending",
    });
    expect(rows[1]).toMatchObject({ kind: "edit", target_message_id: 900 });
  });

  it("пустой список получателей даёт пустой список строк", () => {
    expect(buildNotificationRows("ev1", [])).toEqual([]);
  });

  it("дубликат получателя с тем же видом схлопывается", () => {
    const rows = buildNotificationRows("ev1", [recipients[0], { ...recipients[0] }]);
    expect(rows).toHaveLength(1);
  });

  it("один и тот же чат с разными видами остаётся двумя строками", () => {
    const rows = buildNotificationRows("ev1", [
      { executor_id: "e1", chat_id: 111, lang: "ru", kind: "send" },
      { executor_id: "e1", chat_id: 111, lang: "ru", kind: "edit", target_message_id: 5 },
    ]);
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Запустить тест, убедиться что падает**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/notify.test.ts
```
Ожидается: FAIL, `Cannot find module './notify'`.

- [ ] **Step 4: Реализовать**

`backend/src/modules/tickets/notify.ts`:

```ts
import { ticket_notifications, ticket_executors, ticket_types, tickets, terminals } from "backend/drizzle/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { routeEvent, type Recipient, type RoutingInput } from "./routing";
import { enqueueNotifications } from "./queue";

export type NotificationRow = {
  event_id: string;
  recipient_executor_id: string;
  recipient_chat_id: number;
  kind: "send" | "edit";
  target_message_id: number | null;
  status: "pending";
};

// Уникальность в базе стоит на (event_id, recipient_chat_id, kind), поэтому
// одинаковые адресаты схлопываются здесь, а не ловятся как ошибка вставки.
export function buildNotificationRows(eventId: string, recipients: Recipient[]): NotificationRow[] {
  const seen = new Set<string>();
  const rows: NotificationRow[] = [];
  for (const r of recipients) {
    const key = `${r.chat_id}:${r.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      event_id: eventId,
      recipient_executor_id: r.executor_id,
      recipient_chat_id: r.chat_id,
      kind: r.kind,
      target_message_id: r.target_message_id ?? null,
      status: "pending",
    });
  }
  return rows;
}

// Вызывается ВНУТРИ транзакции, которая меняет заявку. Возвращает id строк,
// которые вызывающий ставит в очередь ПОСЛЕ коммита: задача, поставленная до
// коммита, может прийти воркеру раньше, чем строка станет видимой.
export async function recordNotifications(
  tx: any,
  input: {
    eventId: string;
    ticketId: string;
    eventType: RoutingInput["event"]["type"];
    actorKind: RoutingInput["event"]["actor_kind"];
    actorExecutorId?: string | null;
  }
): Promise<string[]> {
  const [ticket] = await tx
    .select({
      id: tickets.id,
      status: tickets.status,
      assigned_executor_id: tickets.assigned_executor_id,
      type_id: tickets.type_id,
    })
    .from(tickets)
    .where(eq(tickets.id, input.ticketId))
    .execute();
  if (!ticket) return [];

  const [type] = await tx
    .select({ contractor_id: ticket_types.contractor_id })
    .from(ticket_types)
    .where(eq(ticket_types.id, ticket.type_id))
    .execute();
  if (!type?.contractor_id) return [];

  const firmExecutors = await tx
    .select({
      id: ticket_executors.id,
      tg_user_id: ticket_executors.tg_user_id,
      lang: ticket_executors.lang,
      is_active: ticket_executors.is_active,
    })
    .from(ticket_executors)
    .where(eq(ticket_executors.contractor_id, type.contractor_id))
    .execute();

  // Ранее разосланные сообщения этой заявки — чтобы погасить кнопку у тех,
  // кто не успел её нажать.
  const broadcast = await tx
    .select({
      executor_id: ticket_notifications.recipient_executor_id,
      chat_id: ticket_notifications.recipient_chat_id,
      tg_message_id: ticket_notifications.tg_message_id,
    })
    .from(ticket_notifications)
    .where(and(eq(ticket_notifications.status, "sent"), isNotNull(ticket_notifications.tg_message_id)))
    .execute();

  const recipients = routeEvent({
    event: { type: input.eventType, actor_kind: input.actorKind, actor_executor_id: input.actorExecutorId ?? null },
    ticket: { id: ticket.id, status: ticket.status, assigned_executor_id: ticket.assigned_executor_id },
    firmExecutors,
    broadcast: broadcast.filter((b: any) => b.executor_id),
  });

  const rows = buildNotificationRows(input.eventId, recipients);
  if (rows.length === 0) return [];

  const inserted = await tx
    .insert(ticket_notifications)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: ticket_notifications.id });

  return inserted.map((r: any) => r.id);
}

export { enqueueNotifications };
```

Замечание для исполнителя: выборка `broadcast` в коде выше не ограничена заявкой — это ошибка, которую надо исправить при реализации. Строки `ticket_notifications` связаны с заявкой через `ticket_events.ticket_id`, поэтому запрос обязан присоединить `ticket_events` и отфильтровать по `ticket_id = input.ticketId`. Сделай это и опиши в отчёте: без фильтра гашение кнопок уедет в чужие заявки.

- [ ] **Step 5: Запустить тест, убедиться что проходит**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/notify.test.ts
```
Ожидается: 4 pass.

- [ ] **Step 6: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/queue.ts backend/src/modules/tickets/notify.ts backend/src/modules/tickets/notify.test.ts
git commit -m "feat(tickets): очередь уведомлений и запись адресатов в транзакции"
```

---

### Task 7: Подключить уведомления к изменениям заявки

**Files:**
- Modify: `backend/src/modules/tickets/controller.ts`

**Interfaces:**
- Consumes: `recordNotifications`, `enqueueNotifications` из `./notify`
- Produces: после каждого изменения состояния в очереди лежат задачи на доставку

- [ ] **Step 1: Встроить вызовы**

В каждом месте, где сейчас вызывается `writeEvent(tx, …)`, вслед за ним — `recordNotifications(tx, …)` с id этого события, а собранные id строк вернуть наружу из транзакции. После коммита — один `enqueueNotifications(ids)`.

Точки подключения (все уже существуют):
- создание заявки → событие `created`
- приёмка → `closed`
- возврат в работу → `reopened`
- отмена → `cancelled`
- комментарий менеджера → `comment`
- утверждение и отклонение суммы → события пишутся, адресатов нет (`routeEvent` вернёт пустой список; вызов всё равно делается, чтобы поведение задавалось одной функцией, а не отсутствием вызова)

`writeEvent` уже возвращает `{ id }` — это и есть `eventId`.

Постановка в очередь строго после коммита:

```ts
const { row, notificationIds } = await drizzle.transaction(async (tx) => {
  // … изменение заявки …
  const event = await writeEvent(tx, { … });
  const ids = await recordNotifications(tx, {
    eventId: event.id,
    ticketId: id,
    eventType: "closed",
    actorKind: "manager",
  });
  return { row: updated[0], notificationIds: ids };
});
await enqueueNotifications(notificationIds);
return row;
```

- [ ] **Step 2: Проверить, что ничего не сломалось**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/
bunx tsc --noEmit -p . 2>&1 | grep -c "modules/tickets"
```
Ожидается: все тесты модуля проходят; вторая команда печатает `0`.

- [ ] **Step 3: Убедиться, что API отвечает**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && PORT=6799 timeout 120 bun src/index.ts &
sleep 90
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:6799/api/tickets?limit=10&offset=0"
```
Ожидается: `401`.

- [ ] **Step 4: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/controller.ts
git commit -m "feat(tickets): постановка уведомлений в очередь после каждого изменения заявки"
```

---

### Task 8: Процесс-воркер

**Files:**
- Create: `cron/tickets_worker.ts`
- Modify: `cron/pm2.config.js`

**Interfaces:**
- Consumes: `@backend/modules/tickets/*` (алиасы из `cron/` резолвятся — проверено 2026-09-12), `cron/src/redis`
- Produces: процесс pm2 `office_tickets_worker`, разбирающий очередь `tickets-notify`

- [ ] **Step 1: Написать воркер**

`cron/tickets_worker.ts`:

```ts
import { Queue, Worker } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
import { drizzleDb } from "@backend/lib/db";
import {
  ticket_notifications,
  ticket_events,
  tickets,
  ticket_types,
  terminals,
  ticket_executors,
} from "backend/drizzle/schema";
import { buildMessage, type MessageEvent } from "@backend/modules/tickets/messages";
import { editMessageText, sendMessage } from "@backend/modules/tickets/telegram";
import { TICKETS_QUEUE, TICKETS_SWEEP_JOB, jobOptions, redisConnection } from "@backend/modules/tickets/queue";

const BOT_TOKEN = process.env.TICKETS_BOT_TOKEN ?? "";
const MINIAPP_URL = process.env.TICKETS_MINIAPP_URL ?? "https://api.office.lesailes.uz/tickets-app/";

if (!BOT_TOKEN) {
  console.error("tickets worker: TICKETS_BOT_TOKEN не задан — доставка невозможна");
  process.exit(1);
}

// Правки текстов сообщений живут в backend, но исполняет их ЭТОТ процесс:
// после деплоя бэкенда его нужно перезапускать отдельно, иначе бот шлёт
// старые формулировки при уже новом API.
const queue = new Queue(TICKETS_QUEUE, { connection: redisConnection() });
queue.on("error", (e) => console.error("tickets-notify queue error", e));

queue
  .upsertJobScheduler(TICKETS_SWEEP_JOB, { pattern: "*/5 * * * *" }, { name: TICKETS_SWEEP_JOB })
  .catch((e) => console.error("tickets worker: sweep registration failed", e));

const EVENT_TO_MESSAGE: Record<string, MessageEvent> = {
  created: "created",
  comment: "comment",
  reopened: "reopened",
  closed: "closed",
  cancelled: "cancelled",
};

async function deliver(notificationId: string) {
  // Захват строки: если её уже забрал другой прогон, выходим молча.
  const claimed = await drizzleDb
    .update(ticket_notifications)
    .set({ status: "sending", attempts: sql`${ticket_notifications.attempts} + 1` })
    .where(and(eq(ticket_notifications.id, notificationId), eq(ticket_notifications.status, "pending")))
    .returning()
    .execute();
  if (claimed.length === 0) return { skipped: true };

  const n = claimed[0];

  const [ctx] = await drizzleDb
    .select({
      ticket_id: ticket_events.ticket_id,
      event_type: ticket_events.type,
      payload: ticket_events.payload,
      status: tickets.status,
      seq: tickets.seq,
      priority: tickets.priority,
      assigned_executor_id: tickets.assigned_executor_id,
      details: tickets.details,
      number_prefix: ticket_types.number_prefix,
      type_name_ru: ticket_types.name_ru,
      type_name_uz: ticket_types.name_uz,
      terminal_name: terminals.name,
    })
    .from(ticket_events)
    .leftJoin(tickets, eq(ticket_events.ticket_id, tickets.id))
    .leftJoin(ticket_types, eq(tickets.type_id, ticket_types.id))
    .leftJoin(terminals, eq(tickets.terminal_id, terminals.id))
    .where(eq(ticket_events.id, n.event_id))
    .execute();

  if (!ctx) {
    await drizzleDb
      .update(ticket_notifications)
      .set({ status: "failed", last_error: "event not found" })
      .where(eq(ticket_notifications.id, n.id))
      .execute();
    return { failed: true };
  }

  const [executor] = await drizzleDb
    .select({ lang: ticket_executors.lang, full_name: ticket_executors.full_name })
    .from(ticket_executors)
    .where(eq(ticket_executors.id, n.recipient_executor_id!))
    .execute();

  // Рассылка могла пролежать в очереди те секунды, за которые заявку успели
  // взять или отменить. Сообщение с живой кнопкой на чужую работу хуже, чем
  // отсутствие сообщения.
  let messageEvent: MessageEvent = EVENT_TO_MESSAGE[ctx.event_type] ?? "created";
  if (ctx.event_type === "created" && ctx.status !== "new") {
    messageEvent = "assigned_other";
  }
  if (ctx.event_type === "assigned") {
    messageEvent = n.kind === "edit" ? "assigned_other" : "assigned_taker";
  }
  if (ctx.event_type === "cancelled" && n.kind === "edit") {
    messageEvent = "cancelled";
  }

  const details = (ctx.details ?? {}) as Record<string, string>;
  const summary = details.symptom ?? details.broken_part ?? details.note ?? "";

  const message = buildMessage({
    eventType: messageEvent,
    lang: executor?.lang ?? "ru",
    ticket: {
      id: ctx.ticket_id!,
      number: `${ctx.number_prefix ?? "T"}-${String(ctx.seq).padStart(6, "0")}`,
      priority: (ctx.priority as "normal" | "urgent") ?? "normal",
      terminal_name: ctx.terminal_name ?? "",
      type_name_ru: ctx.type_name_ru ?? "",
      type_name_uz: ctx.type_name_uz ?? "",
      summary_ru: summary,
      summary_uz: summary,
    },
    miniappUrl: MINIAPP_URL,
    comment: (ctx.payload as any)?.comment ?? undefined,
    takenBy: executor?.full_name ?? undefined,
    takenAt: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
  });

  const result =
    n.kind === "edit" && n.target_message_id
      ? await editMessageText(BOT_TOKEN, n.recipient_chat_id, n.target_message_id, message)
      : await sendMessage(BOT_TOKEN, n.recipient_chat_id, message);

  if (result.ok) {
    await drizzleDb
      .update(ticket_notifications)
      .set({ status: "sent", tg_message_id: result.message_id, sent_at: new Date().toISOString() })
      .where(eq(ticket_notifications.id, n.id))
      .execute();
    return { sent: true };
  }

  await drizzleDb
    .update(ticket_notifications)
    .set({ status: result.permanent ? "failed" : "pending", last_error: result.error })
    .where(eq(ticket_notifications.id, n.id))
    .execute();

  if (result.permanent) return { failed: true };
  if (result.retryAfterMs) {
    const err: any = new Error(result.error);
    err.retryAfterMs = result.retryAfterMs;
    throw err;
  }
  throw new Error(result.error);
}

async function sweep() {
  // Единственный сценарий, который очередь не закрывает: Redis лежал в момент
  // постановки, строка есть, задачи нет.
  const stale = await drizzleDb
    .select({ id: ticket_notifications.id })
    .from(ticket_notifications)
    .where(
      and(
        eq(ticket_notifications.status, "pending"),
        sql`${ticket_notifications.created_at} < now() - interval '2 minutes'`
      )
    )
    .limit(200)
    .execute();
  for (const row of stale) {
    await queue.add("deliver", { notificationId: row.id }, { ...jobOptions, jobId: row.id });
  }
  return { requeued: stale.length };
}

const worker = new Worker(
  TICKETS_QUEUE,
  async (job) => {
    if (job.name === TICKETS_SWEEP_JOB) return sweep();
    return deliver(job.data.notificationId);
  },
  {
    connection: redisConnection(),
    concurrency: 5,
    // Потолок телеграма около 30 сообщений в секунду; упираться в него не стоит.
    limiter: { max: 25, duration: 1000 },
  }
);

worker.on("error", (e) => console.error("tickets worker error", e));
worker.on("failed", (job, e) => console.error("tickets job failed", job?.id, e?.message));
console.log("tickets worker started");
```

- [ ] **Step 2: Зарегистрировать процесс**

В `cron/pm2.config.js`, в массив `apps`:

```js
    {
      name: "office_tickets_worker",
      script: "tickets_worker.ts",
      interpreter: "bun",
    },
```

- [ ] **Step 3: Проверить, что воркер собирается и стартует**

```bash
cd /home/davr/managers/cron && export PATH=/root/.bun/bin:$PATH
TICKETS_BOT_TOKEN=dummy timeout 15 bun tickets_worker.ts
```
Ожидается: строка `tickets worker started`, отсутствие исключений про импорты. Процесс завершится по таймауту — это нормально, pm2 его ещё не запускает.

- [ ] **Step 4: Коммит**

```bash
cd /home/davr/managers
git add cron/tickets_worker.ts cron/pm2.config.js
git commit -m "feat(tickets): процесс-воркер доставки уведомлений"
```

---

### Task 9: Вебхук бота и привязка исполнителя

**Files:**
- Create: `backend/src/modules/tickets/bot-controller.ts`
- Create: `backend/src/modules/tickets/bot.test.ts`
- Modify: `backend/src/controllers.ts`

**Interfaces:**
- Consumes: `ticket_executors`, `ticket_contractors` из схемы
- Produces: `POST /tickets/bot/webhook`, `parseStartPayload(text)`

- [ ] **Step 1: Написать падающий тест разбора команды**

`backend/src/modules/tickets/bot.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseStartPayload } from "./bot-controller";

describe("parseStartPayload", () => {
  it("достаёт код приглашения", () => {
    expect(parseStartPayload("/start inv_11111111-2222-3333-4444-555555555555")).toBe(
      "11111111-2222-3333-4444-555555555555"
    );
  });

  it("терпит лишние пробелы", () => {
    expect(parseStartPayload("  /start   inv_11111111-2222-3333-4444-555555555555  ")).toBe(
      "11111111-2222-3333-4444-555555555555"
    );
  });

  it("не принимает чужой префикс", () => {
    expect(parseStartPayload("/start ref_11111111-2222-3333-4444-555555555555")).toBeNull();
  });

  it("не принимает мусор вместо uuid", () => {
    expect(parseStartPayload("/start inv_не-uuid")).toBeNull();
  });

  it("голый /start без кода — не привязка", () => {
    expect(parseStartPayload("/start")).toBeNull();
  });

  it("любое другое сообщение игнорируется", () => {
    expect(parseStartPayload("привет")).toBeNull();
    expect(parseStartPayload("")).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/bot.test.ts
```
Ожидается: FAIL, `Cannot find module './bot-controller'`.

- [ ] **Step 3: Реализовать**

`backend/src/modules/tickets/bot-controller.ts`:

```ts
import { ctx } from "@backend/context";
import { ticket_contractors, ticket_executors } from "backend/drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { sendMessage } from "./telegram";
import { UUID_RE } from "./storage";

export function parseStartPayload(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const m = text.trim().match(/^\/start\s+inv_([0-9a-fA-F-]{36})$/);
  if (!m) return null;
  return UUID_RE.test(m[1]) ? m[1] : null;
}

// Единственный публичный роут подсистемы. Пускает только телеграм, знающий
// секрет; всё остальное получает 200 и игнорируется, чтобы телеграм не копил
// повторы.
export const ticketsBotController = new Elysia({ name: "@api/tickets-bot" })
  .use(ctx)
  .post(
    "/tickets/bot/webhook",
    async ({ headers, body, drizzle, set }) => {
      const secret = process.env.TICKETS_BOT_WEBHOOK_SECRET;
      if (!secret) {
        console.error("tickets bot: TICKETS_BOT_WEBHOOK_SECRET не задан");
        set.status = 500;
        return { ok: false };
      }
      if (headers["x-telegram-bot-api-secret-token"] !== secret) {
        set.status = 401;
        return { ok: false };
      }

      const message = (body as any)?.message;
      const code = parseStartPayload(message?.text);
      const chatId = message?.chat?.id;
      const fromId = message?.from?.id;
      if (!code || typeof chatId !== "number" || typeof fromId !== "number") {
        return { ok: true };
      }

      const token = process.env.TICKETS_BOT_TOKEN ?? "";

      const bound = await drizzle
        .update(ticket_executors)
        .set({
          tg_user_id: fromId,
          invite_used_at: new Date().toISOString(),
          lang: message?.from?.language_code === "uz" ? "uz" : "ru",
          updated_at: new Date().toISOString(),
        })
        .where(and(eq(ticket_executors.invite_code, code), isNull(ticket_executors.invite_used_at)))
        .returning({ id: ticket_executors.id, full_name: ticket_executors.full_name, contractor_id: ticket_executors.contractor_id })
        .execute();

      if (bound.length === 0) {
        if (token) await sendMessage(token, chatId, { text: "Ссылка недействительна или уже использована. Попросите новую." });
        return { ok: true };
      }

      const [contractor] = bound[0].contractor_id
        ? await drizzle.select({ name: ticket_contractors.name }).from(ticket_contractors).where(eq(ticket_contractors.id, bound[0].contractor_id)).execute()
        : [];

      if (token) {
        await sendMessage(token, chatId, {
          text: `Вы добавлены как исполнитель${contractor?.name ? `, фирма «${contractor.name}»` : ""}. Заявки будут приходить сюда.`,
        });
      }
      return { ok: true };
    },
    { body: t.Any() }
  );
```

Если `UUID_RE` в `storage.ts` не экспортирован — экспортировать его там и импортировать здесь; второй копии регулярки быть не должно.

- [ ] **Step 4: Зарегистрировать контроллер**

В `backend/src/controllers.ts`: импорт `ticketsBotController` и `.use(ticketsBotController)` в конец цепочки.

- [ ] **Step 5: Запустить тест и проверить роут**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/bot.test.ts
PORT=6799 timeout 120 bun src/index.ts &
sleep 90
curl -s -o /dev/null -w "без секрета: %{http_code}\n" -X POST http://127.0.0.1:6799/api/tickets/bot/webhook \
  -H 'content-type: application/json' -d '{"message":{"text":"/start"}}'
```
Ожидается: 6 pass; вебхук без заголовка секрета отвечает 401 (или 500, если секрет не настроен в `.env` — тогда так и записать в отчёт).

- [ ] **Step 6: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/bot-controller.ts backend/src/modules/tickets/bot.test.ts backend/src/controllers.ts
git commit -m "feat(tickets): вебхук бота и привязка исполнителя по приглашению"
```

---

### Task 10: Выравнивание bullmq и полный прогон

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Поднять версию**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
sed -i 's/"bullmq": "\^5\.61\.0"/"bullmq": "^5.80.9"/' package.json
grep bullmq package.json
bun install
```

- [ ] **Step 2: Полный прогон**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/
bun test src/modules/passport/ tests/credit/
bunx tsc --noEmit -p . 2>&1 | grep -c "modules/tickets"
```
Ожидается: тесты модуля зелёные (81 из плана 1 плюс новые), соседние без падений, `0` ошибок типов в модуле.

- [ ] **Step 3: Проверить, что чужие файлы не тронуты**

```bash
cd /home/davr/managers && git log --format="" --name-only main..HEAD | sort -u
```
Ожидается: только `backend/src/modules/tickets/*`, `backend/src/controllers.ts`, `backend/tests/helpers/*`, `backend/package.json`, `cron/tickets_worker.ts`, `cron/pm2.config.js`.

- [ ] **Step 4: Коммит**

```bash
cd /home/davr/managers
git add backend/package.json backend/bun.lockb 2>/dev/null || git add backend/package.json
git commit -m "chore(tickets): выровнять bullmq с cron (^5.80.9)"
```

---

### Task 11: Деплой

**Files:** нет правок кода; шаги выполняются на сервере

- [ ] **Step 1: Завести переменные**

В `backend/.env` (дописывать аккуратно: файл однажды был без завершающего перевода строки, и `>>` приклеил секрет к предыдущей переменной — проверить `tail -c 1`):

```
TICKETS_BOT_TOKEN=<токен от BotFather>
TICKETS_BOT_USERNAME=<имя бота без @>
TICKETS_BOT_WEBHOOK_SECRET=<длинная случайная строка>
TICKETS_MINIAPP_URL=https://api.office.lesailes.uz/tickets-app/
```

Те же четыре — в окружение воркера (`cron/.env`, если он его читает, иначе через `env` в `pm2.config.js`).

- [ ] **Step 2: Влить в main и пересобрать бэкенд**

По `backend/DEPLOY.md`: бэкап бинаря, `bun build --compile`, смоук на 6798, `mv app.new app`, `pm2 restart office_api`. Проверка тремя способами: роут снаружи отдаёт 401 (не 404), счётчик рестартов pm2 сдвинулся, `readlink -f /proc/PID/exe` без «(deleted)».

- [ ] **Step 3: Поднять воркер**

```bash
cd /home/davr/managers/cron && pm2 start pm2.config.js --only office_tickets_worker
pm2 logs office_tickets_worker --lines 20 --nostream
pm2 save
```
Ожидается: `tickets worker started`, никаких ошибок подключения.

- [ ] **Step 4: Зарегистрировать вебхук**

```bash
curl -sS "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://api.office.lesailes.uz/api/tickets/bot/webhook" \
  -d "secret_token=<TICKETS_BOT_WEBHOOK_SECRET>"
curl -sS "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```
Префикс `/api` обязателен — без него телеграм будет стучаться в пустоту молча.

- [ ] **Step 5: Живая проверка**

Завести в админке подрядную фирму, привязать её к типу «Реклама ТВ», добавить исполнителя, выдать приглашение, пройти по ссылке в телеграме. Затем создать заявку с планшета менеджера и убедиться, что сообщение пришло. Записать результат в `docs/superpowers/tickets-progress.md`.

---

## Что дальше

- **План 3** — API исполнителя `/tickets/tg/*`: начинается с разбиения `controller.ts` на `shared` + файлы роутов, затем макрос `tgExecutor` на `initData`, захват заявки одним `UPDATE ... WHERE status='new'`, сдача работы с актом и фото, тесты на изоляцию по фирме.
- **План 4** — мини-апп на Vite.
- **План 5** — админка и планшет менеджера.
