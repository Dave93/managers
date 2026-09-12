# Заявки — План 1: ядро бэкенда

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять серверное ядро заявок — схему, чистую логику (состояния, поля, акт, вложения) и офисный API, которым пользуются планшет менеджера и админка.

**Architecture:** Новый модуль `backend/src/modules/tickets/` по образцу остальных доменов: чистые функции без ввода-вывода в отдельных файлах с юнит-тестами, HTTP-слой в `controller.ts` на макросе `permission` из `@backend/context`. Данные — Postgres через Drizzle, схема в `backend/drizzle/schema.ts`. Уведомления, Telegram-бот, мини-апп и фронтенд в этот план не входят: события пишутся в `ticket_events`, а рассылка появится в Плане 2 и подключится к уже существующим строкам.

**Tech Stack:** Bun, Elysia, Drizzle ORM, PostgreSQL, `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-12-tickets-design.md`

## Global Constraints

- Репозиторий на сервере: `/home/davr/managers`. `git push` не работает (протухший PAT) — коммиты остаются локальными.
- `bun` и `bunx` не в PATH при неинтерактивном ssh: `export PATH=/root/.bun/bin:$PATH`.
- Схема только в `backend/drizzle/schema.ts` (не под `src/`). Миграции не идемпотентны, порядок определяет `backend/drizzle/migrations/meta/_journal.json`.
- Новый модуль обязан быть зарегистрирован в `backend/src/controllers.ts`, иначе роутов не будет.
- Рабочее дерево грязное (`git status` показывает чужие `*.bak*` и правки от 07.2026). Коммитить только свои файлы поимённо, `git add -A` запрещён.
- Деньги в акте — целые тийины внутри, форматирование только на выходе. Плавающая точка в суммах запрещена.
- `permissions.description` — `varchar(60)`, описания короче 60 символов.
- Тесты запускаются из `backend/`: `bun test src/modules/tickets/<файл>.test.ts`.
- Деплой в этот план не входит. Ничего не собирать в бинарь, `pm2` не трогать.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `backend/drizzle/schema.ts` (правка) | 8 таблиц `ticket_*` и 6 enum-ов |
| `backend/src/modules/tickets/state.ts` | Машина состояний: какое действие из какого статуса допустимо |
| `backend/src/modules/tickets/fields.ts` | Валидация `fields_schema` типа и `details` заявки |
| `backend/src/modules/tickets/act.ts` | Нормализация позиций акта и подсчёт итога в тийинах |
| `backend/src/modules/tickets/storage.ts` | Пути, лимиты и MIME вложений |
| `backend/src/modules/tickets/events.ts` | Запись событий в `ticket_events` внутри транзакции |
| `backend/src/modules/tickets/controller.ts` | HTTP-слой офисной части |
| `backend/src/modules/tickets/seed-permissions.ts` | Права в таблицу `permissions` |
| `backend/src/modules/tickets/seed-types.ts` | Два стартовых типа с их схемами полей |
| `backend/src/controllers.ts` (правка) | Регистрация контроллера |

Telegram-часть (`tg-ctx.ts`, `tg-controller.ts`, `routing.ts`, `queue.ts`) появится в Плане 2 в этом же каталоге.

---

### Task 1: Схема и миграция

**Files:**
- Modify: `backend/drizzle/schema.ts` (в конец файла)
- Create: `backend/drizzle/migrations/<номер>_tickets_core.sql` (генерируется)

**Interfaces:**
- Consumes: ничего
- Produces: экспорты `ticket_contractors`, `ticket_types`, `ticket_executors`, `tickets`, `ticket_attachments`, `ticket_comments`, `ticket_work_items`, `ticket_events`, `ticket_notifications` и enum-ы `ticket_status`, `ticket_priority`, `ticket_executor_kind`, `ticket_attachment_phase`, `ticket_payment_status`, `ticket_event_type`

- [ ] **Step 1: Дописать enum-ы и таблицы в схему**

В конец `backend/drizzle/schema.ts`:

```ts
export const ticket_status = pgEnum("ticket_status", [
  "new",
  "in_progress",
  "done",
  "closed",
  "cancelled",
]);

export const ticket_priority = pgEnum("ticket_priority", ["normal", "urgent"]);

export const ticket_executor_kind = pgEnum("ticket_executor_kind", ["external", "staff"]);

export const ticket_attachment_phase = pgEnum("ticket_attachment_phase", ["problem", "result"]);

export const ticket_payment_status = pgEnum("ticket_payment_status", [
  "pending",
  "approved",
  "rejected",
]);

export const ticket_actor_kind = pgEnum("ticket_actor_kind", [
  "manager",
  "executor",
  "office",
  "system",
]);

export const ticket_event_type = pgEnum("ticket_event_type", [
  "created",
  "assigned",
  "comment",
  "done_submitted",
  "reopened",
  "closed",
  "cancelled",
  "payment_approved",
  "payment_rejected",
]);

export const ticket_notification_kind = pgEnum("ticket_notification_kind", ["send", "edit"]);

export const ticket_notification_status = pgEnum("ticket_notification_status", [
  "pending",
  "sending",
  "sent",
  "failed",
]);

export const ticket_contractors = pgTable("ticket_contractors", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  note: text("note"),
  is_active: boolean("is_active").default(true).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const ticket_types = pgTable(
  "ticket_types",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    number_prefix: varchar("number_prefix", { length: 5 }).notNull(),
    name_ru: varchar("name_ru", { length: 255 }).notNull(),
    name_uz: varchar("name_uz", { length: 255 }).notNull(),
    icon: varchar("icon", { length: 50 }),
    executor_kind: ticket_executor_kind("executor_kind").notNull(),
    contractor_id: uuid("contractor_id").references(() => ticket_contractors.id),
    fields_schema: jsonb("fields_schema").default([]).notNull(),
    requires_cost: boolean("requires_cost").default(true).notNull(),
    active: boolean("active").default(true).notNull(),
    sort: integer("sort").default(0).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    code_idx: uniqueIndex("idx_ticket_types_code").on(table.code),
  })
);

export const ticket_executors = pgTable(
  "ticket_executors",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    kind: ticket_executor_kind("kind").notNull(),
    contractor_id: uuid("contractor_id").references(() => ticket_contractors.id),
    user_id: uuid("user_id"),
    full_name: varchar("full_name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 50 }),
    tg_user_id: bigint("tg_user_id", { mode: "number" }),
    lang: varchar("lang", { length: 10 }).default("ru").notNull(),
    invite_code: uuid("invite_code").defaultRandom().notNull(),
    invite_used_at: timestamp("invite_used_at", { withTimezone: true, mode: "string" }),
    is_active: boolean("is_active").default(true).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    tg_user_id_idx: uniqueIndex("idx_ticket_executors_tg_user_id").on(table.tg_user_id),
    invite_code_idx: uniqueIndex("idx_ticket_executors_invite_code").on(table.invite_code),
    contractor_idx: index("idx_ticket_executors_contractor_id").on(table.contractor_id),
  })
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    seq: serial("seq").notNull(),
    type_id: uuid("type_id").references(() => ticket_types.id).notNull(),
    terminal_id: uuid("terminal_id").notNull(),
    organization_id: uuid("organization_id").notNull(),
    status: ticket_status("status").default("new").notNull(),
    priority: ticket_priority("priority").default("normal").notNull(),
    details: jsonb("details").default({}).notNull(),
    description: text("description"),
    created_by: uuid("created_by").notNull(),
    assigned_executor_id: uuid("assigned_executor_id").references(() => ticket_executors.id),
    assigned_at: timestamp("assigned_at", { withTimezone: true, mode: "string" }),
    done_at: timestamp("done_at", { withTimezone: true, mode: "string" }),
    closed_at: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    cancelled_at: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    closed_by: uuid("closed_by"),
    cancelled_by: uuid("cancelled_by"),
    reopen_count: integer("reopen_count").default(0).notNull(),
    work_total_amount: numeric("work_total_amount", { precision: 14, scale: 2 }),
    payment_status: ticket_payment_status("payment_status").default("pending").notNull(),
    payment_approved_by: uuid("payment_approved_by"),
    payment_approved_at: timestamp("payment_approved_at", { withTimezone: true, mode: "string" }),
    payment_comment: text("payment_comment"),
    manager_seen_at: timestamp("manager_seen_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    terminal_idx: index("idx_tickets_terminal_id").on(table.terminal_id),
    status_idx: index("idx_tickets_status").on(table.status),
    type_idx: index("idx_tickets_type_id").on(table.type_id),
    created_at_idx: index("idx_tickets_created_at").on(table.created_at),
    executor_idx: index("idx_tickets_assigned_executor_id").on(table.assigned_executor_id),
  })
);

export const ticket_attachments = pgTable(
  "ticket_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    ticket_id: uuid("ticket_id").references(() => tickets.id).notNull(),
    phase: ticket_attachment_phase("phase").notNull(),
    file_path: text("file_path").notNull(),
    mime: varchar("mime", { length: 100 }).notNull(),
    size_bytes: integer("size_bytes").notNull(),
    uploaded_by_kind: ticket_actor_kind("uploaded_by_kind").notNull(),
    uploaded_by_user_id: uuid("uploaded_by_user_id"),
    uploaded_by_executor_id: uuid("uploaded_by_executor_id"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    ticket_idx: index("idx_ticket_attachments_ticket_id").on(table.ticket_id),
  })
);

export const ticket_comments = pgTable(
  "ticket_comments",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    ticket_id: uuid("ticket_id").references(() => tickets.id).notNull(),
    author_kind: ticket_actor_kind("author_kind").notNull(),
    author_user_id: uuid("author_user_id"),
    author_executor_id: uuid("author_executor_id"),
    body: text("body").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    ticket_idx: index("idx_ticket_comments_ticket_id").on(table.ticket_id),
  })
);

export const ticket_work_items = pgTable(
  "ticket_work_items",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    ticket_id: uuid("ticket_id").references(() => tickets.id).notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    qty: numeric("qty", { precision: 10, scale: 2 }).default("1").notNull(),
    unit: varchar("unit", { length: 20 }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    ticket_idx: index("idx_ticket_work_items_ticket_id").on(table.ticket_id),
  })
);

export const ticket_events = pgTable(
  "ticket_events",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    ticket_id: uuid("ticket_id").references(() => tickets.id).notNull(),
    type: ticket_event_type("type").notNull(),
    actor_kind: ticket_actor_kind("actor_kind").notNull(),
    actor_user_id: uuid("actor_user_id"),
    actor_executor_id: uuid("actor_executor_id"),
    payload: jsonb("payload").default({}).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    ticket_idx: index("idx_ticket_events_ticket_id").on(table.ticket_id),
  })
);

export const ticket_notifications = pgTable(
  "ticket_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    event_id: uuid("event_id").references(() => ticket_events.id).notNull(),
    channel: varchar("channel", { length: 20 }).default("telegram").notNull(),
    recipient_executor_id: uuid("recipient_executor_id").references(() => ticket_executors.id),
    recipient_chat_id: bigint("recipient_chat_id", { mode: "number" }).notNull(),
    kind: ticket_notification_kind("kind").default("send").notNull(),
    target_message_id: bigint("target_message_id", { mode: "number" }),
    status: ticket_notification_status("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    last_error: text("last_error"),
    tg_message_id: bigint("tg_message_id", { mode: "number" }),
    sent_at: timestamp("sent_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    dedupe_idx: uniqueIndex("idx_ticket_notifications_dedupe").on(
      table.event_id,
      table.recipient_chat_id,
      table.kind
    ),
    pending_idx: index("idx_ticket_notifications_status").on(table.status, table.created_at),
  })
);
```

- [ ] **Step 2: Сгенерировать миграцию**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bunx drizzle-kit generate
```

- [ ] **Step 3: Прочитать сгенерированный SQL целиком**

Открыть новый файл в `backend/drizzle/migrations/`. Убедиться, что в нём **только** `CREATE TYPE` и `CREATE TABLE` для `ticket_*` и ни одного `DROP` или `ALTER` по чужим таблицам. Дерево грязное, и `drizzle-kit` мог подхватить чужие правки схемы. Если в файле есть что-то помимо девяти новых таблиц и enum-ов — удалить файл, выяснить, чья правка схемы висит незакоммиченной, и не продолжать.

Переименовать файл в `<номер>_tickets_core.sql` и поправить имя в `meta/_journal.json` (там же источник правды по порядку).

- [ ] **Step 4: Применить миграцию**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bunx drizzle-kit migrate
```

- [ ] **Step 5: Проверить, что таблицы на месте**

```bash
psql "$DATABASE_URL" -c "\dt ticket*" -c "\d tickets"
```
Ожидается 8 таблиц `ticket_*` плюс `tickets`, у `tickets` колонка `seq` типа `integer` с `nextval`.

- [ ] **Step 6: Коммит**

```bash
cd /home/davr/managers
git add backend/drizzle/schema.ts backend/drizzle/migrations
git commit -m "feat(tickets): схема заявок — 9 таблиц и enum-ы"
```

---

### Task 2: Машина состояний

**Files:**
- Create: `backend/src/modules/tickets/state.ts`
- Test: `backend/src/modules/tickets/state.test.ts`

**Interfaces:**
- Consumes: ничего (чистый модуль, без импортов из проекта)
- Produces: `TicketStatus`, `TicketAction`, `nextStatus(action, from): TicketStatus | null`, `allowedActions(from): TicketAction[]`

- [ ] **Step 1: Написать падающий тест**

`backend/src/modules/tickets/state.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { allowedActions, nextStatus, type TicketAction, type TicketStatus } from "./state";

describe("машина состояний заявки", () => {
  it("проводит заявку по основному пути", () => {
    expect(nextStatus("claim", "new")).toBe("in_progress");
    expect(nextStatus("submit", "in_progress")).toBe("done");
    expect(nextStatus("accept", "done")).toBe("closed");
  });

  it("возвращает сданную заявку в работу", () => {
    expect(nextStatus("reopen", "done")).toBe("in_progress");
  });

  it("отменяет только незавершённые заявки", () => {
    expect(nextStatus("cancel", "new")).toBe("cancelled");
    expect(nextStatus("cancel", "in_progress")).toBe("cancelled");
    expect(nextStatus("cancel", "done")).toBeNull();
    expect(nextStatus("cancel", "closed")).toBeNull();
  });

  it("отвергает все остальные пары действие-статус", () => {
    const actions: TicketAction[] = ["claim", "submit", "accept", "reopen", "cancel"];
    const statuses: TicketStatus[] = ["new", "in_progress", "done", "closed", "cancelled"];
    const allowed = new Set([
      "claim:new",
      "submit:in_progress",
      "accept:done",
      "reopen:done",
      "cancel:new",
      "cancel:in_progress",
    ]);
    for (const a of actions) {
      for (const s of statuses) {
        const expected = allowed.has(`${a}:${s}`);
        expect(nextStatus(a, s) !== null).toBe(expected);
      }
    }
  });

  it("закрытая и отменённая заявки не принимают ничего", () => {
    expect(allowedActions("closed")).toEqual([]);
    expect(allowedActions("cancelled")).toEqual([]);
  });

  it("перечисляет действия для сданной заявки", () => {
    expect(allowedActions("done").sort()).toEqual(["accept", "reopen"]);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test src/modules/tickets/state.test.ts
```
Ожидается: FAIL, `Cannot find module './state'`.

- [ ] **Step 3: Реализовать**

`backend/src/modules/tickets/state.ts`:

```ts
export type TicketStatus = "new" | "in_progress" | "done" | "closed" | "cancelled";
export type TicketAction = "claim" | "submit" | "accept" | "reopen" | "cancel";

// Единственное место, где записан жизненный цикл заявки. И контроллер, и
// мини-апп спрашивают тут, а не повторяют условия у себя: расхождение между
// двумя копиями правил проявляется как "кнопка есть, а нажать нельзя".
const TRANSITIONS: Record<TicketAction, { from: TicketStatus[]; to: TicketStatus }> = {
  claim: { from: ["new"], to: "in_progress" },
  submit: { from: ["in_progress"], to: "done" },
  accept: { from: ["done"], to: "closed" },
  reopen: { from: ["done"], to: "in_progress" },
  cancel: { from: ["new", "in_progress"], to: "cancelled" },
};

export function nextStatus(action: TicketAction, from: TicketStatus): TicketStatus | null {
  const rule = TRANSITIONS[action];
  if (!rule) return null;
  return rule.from.includes(from) ? rule.to : null;
}

export function allowedActions(from: TicketStatus): TicketAction[] {
  return (Object.keys(TRANSITIONS) as TicketAction[]).filter((a) => nextStatus(a, from) !== null);
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test src/modules/tickets/state.test.ts
```
Ожидается: 6 pass, 0 fail.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/state.ts backend/src/modules/tickets/state.test.ts
git commit -m "feat(tickets): машина состояний заявки"
```

---

### Task 3: Валидация схемы полей и значений

**Files:**
- Create: `backend/src/modules/tickets/fields.ts`
- Test: `backend/src/modules/tickets/fields.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `FieldDef`, `validateSchema(raw: unknown): SchemaResult`, `validateDetails(schema: FieldDef[], raw: unknown): DetailsResult`, где `SchemaResult = { ok: true; schema: FieldDef[] } | { ok: false; errors: string[] }`, `DetailsResult = { ok: true; details: Record<string, string> } | { ok: false; errors: string[] }`

- [ ] **Step 1: Написать падающий тест**

`backend/src/modules/tickets/fields.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { validateDetails, validateSchema, type FieldDef } from "./fields";

const SCHEMA: FieldDef[] = [
  {
    key: "tv_place",
    type: "select",
    required: true,
    label_ru: "Какой телевизор",
    label_uz: "Qaysi televizor",
    options: [
      { value: "hall", label_ru: "Зал", label_uz: "Zal" },
      { value: "kitchen", label_ru: "Кухня", label_uz: "Oshxona" },
    ],
  },
  { key: "note", type: "text", required: false, label_ru: "Описание", label_uz: "Izoh" },
];

describe("validateSchema", () => {
  it("принимает корректную схему", () => {
    const r = validateSchema(SCHEMA);
    expect(r.ok).toBe(true);
  });

  it("требует непустой список вариантов у select", () => {
    const r = validateSchema([{ ...SCHEMA[0], options: [] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("tv_place");
  });

  it("отвергает повторяющиеся ключи полей", () => {
    const r = validateSchema([SCHEMA[1], SCHEMA[1]]);
    expect(r.ok).toBe(false);
  });

  it("отвергает ключ не в snake_case", () => {
    const r = validateSchema([{ ...SCHEMA[1], key: "TV Place" }]);
    expect(r.ok).toBe(false);
  });

  it("требует обе подписи", () => {
    const r = validateSchema([{ ...SCHEMA[1], label_uz: "" }]);
    expect(r.ok).toBe(false);
  });

  it("отвергает повторяющиеся значения вариантов", () => {
    const r = validateSchema([
      {
        ...SCHEMA[0],
        options: [
          { value: "hall", label_ru: "Зал", label_uz: "Zal" },
          { value: "hall", label_ru: "Ещё зал", label_uz: "Yana zal" },
        ],
      },
    ]);
    expect(r.ok).toBe(false);
  });

  it("отвергает не массив", () => {
    expect(validateSchema({ key: "x" }).ok).toBe(false);
    expect(validateSchema(null).ok).toBe(false);
  });
});

describe("validateDetails", () => {
  it("принимает валидные значения и обрезает пробелы", () => {
    const r = validateDetails(SCHEMA, { tv_place: "hall", note: "  мигает  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.details).toEqual({ tv_place: "hall", note: "мигает" });
  });

  it("требует обязательное поле", () => {
    const r = validateDetails(SCHEMA, { note: "мигает" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("tv_place");
  });

  it("считает пустую строку отсутствующим значением", () => {
    expect(validateDetails(SCHEMA, { tv_place: "   " }).ok).toBe(false);
  });

  it("отвергает значение select вне списка вариантов", () => {
    expect(validateDetails(SCHEMA, { tv_place: "toilet" }).ok).toBe(false);
  });

  it("отвергает неизвестные ключи", () => {
    expect(validateDetails(SCHEMA, { tv_place: "hall", hacked: "1" }).ok).toBe(false);
  });

  it("пропускает необязательное поле", () => {
    const r = validateDetails(SCHEMA, { tv_place: "kitchen" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.details).toEqual({ tv_place: "kitchen" });
  });

  it("ограничивает длину текста", () => {
    expect(validateDetails(SCHEMA, { tv_place: "hall", note: "x".repeat(2001) }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test src/modules/tickets/fields.test.ts
```
Ожидается: FAIL, `Cannot find module './fields'`.

- [ ] **Step 3: Реализовать**

`backend/src/modules/tickets/fields.ts`:

```ts
export type FieldOption = { value: string; label_ru: string; label_uz: string };

export type FieldDef = {
  key: string;
  type: "select" | "text";
  required: boolean;
  label_ru: string;
  label_uz: string;
  options?: FieldOption[];
};

export type SchemaResult = { ok: true; schema: FieldDef[] } | { ok: false; errors: string[] };
export type DetailsResult =
  | { ok: true; details: Record<string, string> }
  | { ok: false; errors: string[] };

const KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
const MAX_TEXT = 2000;

const isStr = (v: unknown): v is string => typeof v === "string";
const filled = (v: unknown): v is string => isStr(v) && v.trim().length > 0;

// Схема типа приходит из админки и уезжает в форму на планшете менеджера.
// Невалидная схема ломает создание заявок в разгар смены, чинить её будет
// некому, поэтому проверка стоит на входе, а не на отрисовке.
export function validateSchema(raw: unknown): SchemaResult {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { ok: false, errors: ["схема должна быть массивом полей"] };

  const seenKeys = new Set<string>();
  const schema: FieldDef[] = [];

  raw.forEach((item, i) => {
    const where = `поле #${i + 1}`;
    if (typeof item !== "object" || item === null) {
      errors.push(`${where}: не объект`);
      return;
    }
    const f = item as Record<string, unknown>;

    if (!isStr(f.key) || !KEY_RE.test(f.key)) {
      errors.push(`${where}: ключ должен быть snake_case латиницей`);
      return;
    }
    if (seenKeys.has(f.key)) {
      errors.push(`${f.key}: повторяющийся ключ`);
      return;
    }
    seenKeys.add(f.key);

    if (f.type !== "select" && f.type !== "text") {
      errors.push(`${f.key}: тип должен быть select или text`);
      return;
    }
    if (!filled(f.label_ru) || !filled(f.label_uz)) {
      errors.push(`${f.key}: нужны обе подписи, русская и узбекская`);
      return;
    }

    const def: FieldDef = {
      key: f.key,
      type: f.type,
      required: f.required === true,
      label_ru: f.label_ru.trim(),
      label_uz: f.label_uz.trim(),
    };

    if (f.type === "select") {
      if (!Array.isArray(f.options) || f.options.length === 0) {
        errors.push(`${f.key}: у select должен быть хотя бы один вариант`);
        return;
      }
      const seenValues = new Set<string>();
      const options: FieldOption[] = [];
      for (const o of f.options as Record<string, unknown>[]) {
        if (!filled(o?.value) || !filled(o?.label_ru) || !filled(o?.label_uz)) {
          errors.push(`${f.key}: у варианта нужны value и обе подписи`);
          return;
        }
        if (seenValues.has(o.value)) {
          errors.push(`${f.key}: повторяющееся значение варианта ${o.value}`);
          return;
        }
        seenValues.add(o.value);
        options.push({
          value: o.value.trim(),
          label_ru: o.label_ru.trim(),
          label_uz: o.label_uz.trim(),
        });
      }
      def.options = options;
    }

    schema.push(def);
  });

  return errors.length ? { ok: false, errors } : { ok: true, schema };
}

export function validateDetails(schema: FieldDef[], raw: unknown): DetailsResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["значения полей должны быть объектом"] };
  }
  const input = raw as Record<string, unknown>;
  const known = new Set(schema.map((f) => f.key));

  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors.push(`${key}: поля нет в схеме типа`);
  }

  const details: Record<string, string> = {};
  for (const f of schema) {
    const value = input[f.key];
    if (!filled(value)) {
      if (f.required) errors.push(`${f.key}: обязательное поле`);
      continue;
    }
    const trimmed = value.trim();
    if (f.type === "select") {
      if (!f.options?.some((o) => o.value === trimmed)) {
        errors.push(`${f.key}: значение вне списка вариантов`);
        continue;
      }
    } else if (trimmed.length > MAX_TEXT) {
      errors.push(`${f.key}: длиннее ${MAX_TEXT} символов`);
      continue;
    }
    details[f.key] = trimmed;
  }

  return errors.length ? { ok: false, errors } : { ok: true, details };
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test src/modules/tickets/fields.test.ts
```
Ожидается: 14 pass, 0 fail.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/fields.ts backend/src/modules/tickets/fields.test.ts
git commit -m "feat(tickets): валидация схемы полей типа и значений заявки"
```

---

### Task 4: Акт выполненных работ

**Files:**
- Create: `backend/src/modules/tickets/act.ts`
- Test: `backend/src/modules/tickets/act.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `WorkItemInput`, `NormalizedWorkItem = { position: number; title: string; qty: string; unit: string | null; amount: string }`, `normalizeWorkItems(raw: unknown): { ok: true; items: NormalizedWorkItem[]; total: string } | { ok: false; errors: string[] }`

- [ ] **Step 1: Написать падающий тест**

`backend/src/modules/tickets/act.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { normalizeWorkItems } from "./act";

describe("normalizeWorkItems", () => {
  it("нумерует позиции и считает итог", () => {
    const r = normalizeWorkItems([
      { title: "Замена блока питания", amount: "350000" },
      { title: "Выезд", amount: 100000 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => i.position)).toEqual([1, 2]);
    expect(r.total).toBe("450000.00");
  });

  it("складывает копейки без потерь на плавающей точке", () => {
    const r = normalizeWorkItems([
      { title: "a", amount: "0.10" },
      { title: "b", amount: "0.20" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBe("0.30");
  });

  it("подставляет количество 1 по умолчанию", () => {
    const r = normalizeWorkItems([{ title: "Работа", amount: "1000" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items[0]).toEqual({
      position: 1,
      title: "Работа",
      qty: "1.00",
      unit: null,
      amount: "1000.00",
    });
  });

  it("требует хотя бы одну позицию", () => {
    expect(normalizeWorkItems([]).ok).toBe(false);
    expect(normalizeWorkItems(null).ok).toBe(false);
  });

  it("отвергает нулевую и отрицательную сумму", () => {
    expect(normalizeWorkItems([{ title: "a", amount: "0" }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: "-5" }]).ok).toBe(false);
  });

  it("отвергает сумму не числом и с тремя знаками после точки", () => {
    expect(normalizeWorkItems([{ title: "a", amount: "много" }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "a", amount: "1.005" }]).ok).toBe(false);
  });

  it("отвергает пустой и слишком длинный заголовок", () => {
    expect(normalizeWorkItems([{ title: "   ", amount: "1000" }]).ok).toBe(false);
    expect(normalizeWorkItems([{ title: "x".repeat(201), amount: "1000" }]).ok).toBe(false);
  });

  it("ограничивает число позиций", () => {
    const many = Array.from({ length: 51 }, () => ({ title: "a", amount: "1" }));
    expect(normalizeWorkItems(many).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test src/modules/tickets/act.test.ts
```
Ожидается: FAIL, `Cannot find module './act'`.

- [ ] **Step 3: Реализовать**

`backend/src/modules/tickets/act.ts`:

```ts
export type WorkItemInput = {
  title?: unknown;
  qty?: unknown;
  unit?: unknown;
  amount?: unknown;
};

export type NormalizedWorkItem = {
  position: number;
  title: string;
  qty: string;
  unit: string | null;
  amount: string;
};

export type ActResult =
  | { ok: true; items: NormalizedWorkItem[]; total: string }
  | { ok: false; errors: string[] };

const MAX_ITEMS = 50;
const MAX_TITLE = 200;
const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

// Суммы живут в тийинах (целых сотых) до самого форматирования: сложение
// денег в double даёт 0.1 + 0.2 = 0.30000000000000004, и акт на миллион
// расходится с итогом на копейку, которую потом ищут руками.
function toMinor(raw: unknown): number | null {
  const s = typeof raw === "number" ? raw.toString() : typeof raw === "string" ? raw.trim() : "";
  if (!DECIMAL_RE.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

const fromMinor = (minor: number): string => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

export function normalizeWorkItems(raw: unknown): ActResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, errors: ["в акте должна быть хотя бы одна позиция"] };
  }
  if (raw.length > MAX_ITEMS) {
    return { ok: false, errors: [`позиций больше ${MAX_ITEMS}`] };
  }

  const errors: string[] = [];
  const items: NormalizedWorkItem[] = [];
  let totalMinor = 0;

  raw.forEach((entry: WorkItemInput, i) => {
    const where = `позиция #${i + 1}`;
    const title = typeof entry?.title === "string" ? entry.title.trim() : "";
    if (!title) {
      errors.push(`${where}: пустое наименование`);
      return;
    }
    if (title.length > MAX_TITLE) {
      errors.push(`${where}: наименование длиннее ${MAX_TITLE} символов`);
      return;
    }

    const amountMinor = toMinor(entry?.amount);
    if (amountMinor === null) {
      errors.push(`${where}: сумма должна быть числом с двумя знаками после точки`);
      return;
    }
    if (amountMinor <= 0) {
      errors.push(`${where}: сумма должна быть больше нуля`);
      return;
    }

    const qtyMinor = entry?.qty === undefined || entry?.qty === null ? 100 : toMinor(entry.qty);
    if (qtyMinor === null || qtyMinor <= 0) {
      errors.push(`${where}: количество должно быть больше нуля`);
      return;
    }

    const unit = typeof entry?.unit === "string" && entry.unit.trim() ? entry.unit.trim().slice(0, 20) : null;

    totalMinor += amountMinor;
    items.push({
      position: items.length + 1,
      title,
      qty: fromMinor(qtyMinor),
      unit,
      amount: fromMinor(amountMinor),
    });
  });

  return errors.length ? { ok: false, errors } : { ok: true, items, total: fromMinor(totalMinor) };
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test src/modules/tickets/act.test.ts
```
Ожидается: 8 pass, 0 fail.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/act.ts backend/src/modules/tickets/act.test.ts
git commit -m "feat(tickets): акт выполненных работ, подсчёт итога в тийинах"
```

---

### Task 5: Вложения — правила и хранилище

**Files:**
- Create: `backend/src/modules/tickets/storage.ts`
- Test: `backend/src/modules/tickets/storage.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `MAX_FILES_PER_PHASE = 5`, `MAX_FILE_BYTES = 10485760`, `extForMime(mime: string): string | null`, `checkUpload(input: { mime: string; size: number; existingCount: number }): { ok: true } | { ok: false; error: string }`, `uploadsBase(): string`, `attachmentPath(ticketId: string, ext: string): string`, `saveAttachment(file: File, ticketId: string): Promise<{ ok: true; file_path: string; mime: string; size_bytes: number } | { ok: false; error: string }>`

- [ ] **Step 1: Написать падающий тест**

`backend/src/modules/tickets/storage.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { attachmentPath, checkUpload, extForMime, MAX_FILES_PER_PHASE } from "./storage";

describe("правила вложений", () => {
  it("знает разрешённые типы", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/heic")).toBeNull();
    expect(extForMime("application/pdf")).toBeNull();
    expect(extForMime("video/mp4")).toBeNull();
  });

  it("пропускает обычное фото", () => {
    expect(checkUpload({ mime: "image/jpeg", size: 2_000_000, existingCount: 0 })).toEqual({ ok: true });
  });

  it("отвергает чужой тип", () => {
    const r = checkUpload({ mime: "application/pdf", size: 1000, existingCount: 0 });
    expect(r.ok).toBe(false);
  });

  it("отвергает файл больше 10 МБ", () => {
    const r = checkUpload({ mime: "image/png", size: 10 * 1024 * 1024 + 1, existingCount: 0 });
    expect(r.ok).toBe(false);
  });

  it("отвергает пустой файл", () => {
    expect(checkUpload({ mime: "image/png", size: 0, existingCount: 0 }).ok).toBe(false);
  });

  it("держит лимит в пять файлов на фазу", () => {
    expect(checkUpload({ mime: "image/png", size: 1000, existingCount: MAX_FILES_PER_PHASE - 1 }).ok).toBe(true);
    expect(checkUpload({ mime: "image/png", size: 1000, existingCount: MAX_FILES_PER_PHASE }).ok).toBe(false);
  });

  it("кладёт файл в каталог заявки со случайным именем", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const p = attachmentPath(id, "jpg");
    expect(p).toContain(`/${id}/`);
    expect(p.endsWith(".jpg")).toBe(true);
    expect(p).not.toBe(attachmentPath(id, "jpg"));
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test src/modules/tickets/storage.test.ts
```
Ожидается: FAIL, `Cannot find module './storage'`.

- [ ] **Step 3: Реализовать**

`backend/src/modules/tickets/storage.ts`:

```ts
import fs from "node:fs";
import { randomUUID } from "node:crypto";

export const MAX_FILES_PER_PHASE = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function extForMime(mime: string): string | null {
  return MIME_EXT[mime] ?? null;
}

export function uploadsBase(): string {
  return process.env.TICKETS_UPLOADS_DIR ?? "/home/davr/managers/uploads/tickets";
}

export function attachmentPath(ticketId: string, ext: string): string {
  return `${uploadsBase()}/${ticketId}/${randomUUID()}.${ext}`;
}

export function checkUpload(input: { mime: string; size: number; existingCount: number }):
  | { ok: true }
  | { ok: false; error: string } {
  if (!extForMime(input.mime)) return { ok: false, error: "только JPEG и PNG" };
  if (input.size <= 0) return { ok: false, error: "пустой файл" };
  if (input.size > MAX_FILE_BYTES) return { ok: false, error: "файл больше 10 МБ" };
  if (input.existingCount >= MAX_FILES_PER_PHASE) {
    return { ok: false, error: `больше ${MAX_FILES_PER_PHASE} фото на этап нельзя` };
  }
  return { ok: true };
}

// Файл ложится на диск раньше строки в базе, поэтому вызывающий обязан удалить
// его, если вставка упала — иначе на диске копятся сироты, на которые ничто
// не ссылается. Тот же порядок и та же обязанность, что в credit_admin.
export async function saveAttachment(
  file: File,
  ticketId: string
): Promise<{ ok: true; file_path: string; mime: string; size_bytes: number } | { ok: false; error: string }> {
  const ext = extForMime(file.type);
  if (!ext) return { ok: false, error: "только JPEG и PNG" };
  const dir = `${uploadsBase()}/${ticketId}`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  const file_path = attachmentPath(ticketId, ext);
  await Bun.write(file_path, file);
  return { ok: true, file_path, mime: file.type, size_bytes: file.size };
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test src/modules/tickets/storage.test.ts
```
Ожидается: 7 pass, 0 fail.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/storage.ts backend/src/modules/tickets/storage.test.ts
git commit -m "feat(tickets): правила и хранилище вложений"
```

---

### Task 6: Создание заявки и списки

**Files:**
- Create: `backend/src/modules/tickets/events.ts`
- Create: `backend/src/modules/tickets/controller.ts`
- Modify: `backend/src/controllers.ts`

**Interfaces:**
- Consumes: `validateDetails` и `FieldDef` из `./fields`, `saveAttachment`, `checkUpload`, `MAX_FILES_PER_PHASE` из `./storage`
- Produces: `writeEvent(tx, input): Promise<{ id: string }>`, `ticketsController`, HTTP-роуты `POST /tickets`, `GET /tickets`, `GET /tickets/:id`, `GET /tickets/attachments/:id/file`

- [ ] **Step 1: Написать модуль событий**

`backend/src/modules/tickets/events.ts`:

```ts
import { ticket_events } from "backend/drizzle/schema";

export type TicketEventType =
  | "created"
  | "assigned"
  | "comment"
  | "done_submitted"
  | "reopened"
  | "closed"
  | "cancelled"
  | "payment_approved"
  | "payment_rejected";

export type ActorKind = "manager" | "executor" | "office" | "system";

export type EventInput = {
  ticket_id: string;
  type: TicketEventType;
  actor_kind: ActorKind;
  actor_user_id?: string | null;
  actor_executor_id?: string | null;
  payload?: Record<string, unknown>;
};

// Пишется ТОЛЬКО внутри той же транзакции, что и сама смена заявки. Событие,
// записанное отдельным запросом после коммита, теряется при любом падении
// между двумя запросами — и рассылка по нему не уйдёт никогда.
export async function writeEvent(tx: any, input: EventInput): Promise<{ id: string }> {
  const [row] = await tx
    .insert(ticket_events)
    .values({
      ticket_id: input.ticket_id,
      type: input.type,
      actor_kind: input.actor_kind,
      actor_user_id: input.actor_user_id ?? null,
      actor_executor_id: input.actor_executor_id ?? null,
      payload: input.payload ?? {},
    })
    .returning({ id: ticket_events.id });
  return row;
}
```

- [ ] **Step 2: Написать контроллер с созданием, списком и карточкой**

`backend/src/modules/tickets/controller.ts`:

```ts
import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import {
  ticket_attachments,
  ticket_comments,
  ticket_events,
  ticket_types,
  ticket_work_items,
  ticket_executors,
  tickets,
  terminals,
} from "backend/drizzle/schema";
import { and, desc, eq, inArray, sql, SQLWrapper } from "drizzle-orm";
import fs from "node:fs";
import Elysia, { t } from "elysia";
import { writeEvent } from "./events";
import { validateDetails, type FieldDef } from "./fields";
import { checkUpload, MAX_FILES_PER_PHASE, saveAttachment } from "./storage";

const ticketNumber = (prefix: string, seq: number) => `${prefix}-${String(seq).padStart(6, "0")}`;

export const ticketsController = new Elysia({ name: "@api/tickets" })
  .use(ctx)
  .post(
    "/tickets",
    async ({ body, user, terminals: userTerminals, set, drizzle }) => {
      const [type] = await drizzle
        .select()
        .from(ticket_types)
        .where(and(eq(ticket_types.id, body.type_id), eq(ticket_types.active, true)))
        .execute();
      if (!type) {
        set.status = 404;
        return { message: "Тип заявки не найден" };
      }

      // Филиал берётся из сессии, а не из тела запроса: менеджер физически
      // не должен иметь возможности завести заявку на чужой филиал.
      const terminal_id = body.terminal_id ?? userTerminals?.[0];
      if (!terminal_id || (userTerminals?.length && !userTerminals.includes(terminal_id))) {
        set.status = 403;
        return { message: "Филиал недоступен" };
      }

      let parsedDetails: unknown;
      try {
        parsedDetails = JSON.parse(body.details ?? "{}");
      } catch {
        set.status = 422;
        return { message: "details должен быть JSON-объектом" };
      }
      const detailsCheck = validateDetails(type.fields_schema as FieldDef[], parsedDetails);
      if (!detailsCheck.ok) {
        set.status = 422;
        return { message: "Поля заполнены неверно", errors: detailsCheck.errors };
      }

      const files = (Array.isArray(body.photos) ? body.photos : body.photos ? [body.photos] : []) as File[];
      if (files.length === 0) {
        set.status = 422;
        return { message: "Нужна хотя бы одна фотография" };
      }
      if (files.length > MAX_FILES_PER_PHASE) {
        set.status = 422;
        return { message: `Не больше ${MAX_FILES_PER_PHASE} фотографий` };
      }
      for (const [i, f] of files.entries()) {
        const c = checkUpload({ mime: f.type, size: f.size, existingCount: i });
        if (!c.ok) {
          set.status = 422;
          return { message: c.error };
        }
      }

      const [terminal] = await drizzle
        .select({ organization_id: terminals.organization_id })
        .from(terminals)
        .where(eq(terminals.id, terminal_id))
        .execute();
      if (!terminal) {
        set.status = 404;
        return { message: "Филиал не найден" };
      }

      const ticket_id = crypto.randomUUID();
      const saved: { file_path: string; mime: string; size_bytes: number }[] = [];
      try {
        for (const f of files) {
          const r = await saveAttachment(f, ticket_id);
          if (!r.ok) {
            set.status = 422;
            return { message: r.error };
          }
          saved.push({ file_path: r.file_path, mime: r.mime, size_bytes: r.size_bytes });
        }

        const created = await drizzle.transaction(async (tx) => {
          const [row] = await tx
            .insert(tickets)
            .values({
              id: ticket_id,
              type_id: type.id,
              terminal_id,
              organization_id: terminal.organization_id,
              priority: body.priority === "urgent" ? "urgent" : "normal",
              details: detailsCheck.details,
              description: body.description?.trim() || null,
              created_by: user!.id,
            })
            .returning();

          await tx.insert(ticket_attachments).values(
            saved.map((s) => ({
              ticket_id,
              phase: "problem" as const,
              file_path: s.file_path,
              mime: s.mime,
              size_bytes: s.size_bytes,
              uploaded_by_kind: "manager" as const,
              uploaded_by_user_id: user!.id,
            }))
          );

          await writeEvent(tx, {
            ticket_id,
            type: "created",
            actor_kind: "manager",
            actor_user_id: user!.id,
            payload: { type_code: type.code, priority: row.priority },
          });

          return row;
        });

        return { ...created, number: ticketNumber(type.number_prefix, created.seq) };
      } catch (e) {
        // Файлы легли раньше строк. Если транзакция упала, на диске остаются
        // сироты, на которые ничто не ссылается — убираем их здесь.
        for (const s of saved) {
          try {
            fs.unlinkSync(s.file_path);
          } catch {}
        }
        console.error("tickets: create failed", e);
        set.status = 500;
        return { message: "Не удалось создать заявку" };
      }
    },
    {
      permission: "tickets.create",
      type: "multipart/form-data",
      body: t.Object({
        type_id: t.String(),
        terminal_id: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        details: t.Optional(t.String()),
        description: t.Optional(t.String()),
        photos: t.Files({ maxSize: "10m", maxItems: MAX_FILES_PER_PHASE }),
      }),
    }
  )
  .get(
    "/tickets",
    async ({ query: { limit, offset, filters }, terminals: userTerminals, drizzle }) => {
      const where: (SQLWrapper | undefined)[] = filters ? parseFilterFields(filters, tickets, {}) : [];
      // Скоупинг по филиалам сессии. Пустой массив у офисной роли означает
      // "все филиалы" — тот же смысл, что в остальных модулях.
      if (userTerminals && userTerminals.length > 0) {
        where.push(inArray(tickets.terminal_id, userTerminals));
      }

      const [{ count }] = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(tickets)
        .where(and(...where))
        .execute();

      const rows = await drizzle
        .select({
          id: tickets.id,
          seq: tickets.seq,
          status: tickets.status,
          priority: tickets.priority,
          details: tickets.details,
          created_at: tickets.created_at,
          assigned_at: tickets.assigned_at,
          done_at: tickets.done_at,
          manager_seen_at: tickets.manager_seen_at,
          work_total_amount: tickets.work_total_amount,
          payment_status: tickets.payment_status,
          type_name: ticket_types.name_ru,
          type_prefix: ticket_types.number_prefix,
          terminal_name: terminals.name,
          executor_name: ticket_executors.full_name,
        })
        .from(tickets)
        .leftJoin(ticket_types, eq(tickets.type_id, ticket_types.id))
        .leftJoin(terminals, eq(tickets.terminal_id, terminals.id))
        .leftJoin(ticket_executors, eq(tickets.assigned_executor_id, ticket_executors.id))
        .where(and(...where))
        .orderBy(desc(tickets.created_at))
        .limit(+limit)
        .offset(+offset)
        .execute();

      return {
        total: count,
        data: rows.map((r) => ({ ...r, number: ticketNumber(r.type_prefix ?? "T", r.seq) })),
      };
    },
    {
      permission: "tickets.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/tickets/:id",
    async ({ params: { id }, terminals: userTerminals, set, drizzle }) => {
      const where: SQLWrapper[] = [eq(tickets.id, id)];
      if (userTerminals && userTerminals.length > 0) {
        where.push(inArray(tickets.terminal_id, userTerminals));
      }
      const [ticket] = await drizzle
        .select()
        .from(tickets)
        .where(and(...where))
        .execute();
      if (!ticket) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }

      const [type] = await drizzle.select().from(ticket_types).where(eq(ticket_types.id, ticket.type_id)).execute();
      const [attachments, comments, workItems, events] = await Promise.all([
        drizzle.select().from(ticket_attachments).where(eq(ticket_attachments.ticket_id, id)).execute(),
        drizzle.select().from(ticket_comments).where(eq(ticket_comments.ticket_id, id)).orderBy(ticket_comments.created_at).execute(),
        drizzle.select().from(ticket_work_items).where(eq(ticket_work_items.ticket_id, id)).orderBy(ticket_work_items.position).execute(),
        drizzle.select().from(ticket_events).where(eq(ticket_events.ticket_id, id)).orderBy(ticket_events.created_at).execute(),
      ]);

      return {
        ...ticket,
        number: ticketNumber(type?.number_prefix ?? "T", ticket.seq),
        type,
        attachments: attachments.map(({ file_path, ...rest }) => rest),
        comments,
        work_items: workItems,
        events,
      };
    },
    { permission: "tickets.list" }
  )
  .get(
    "/tickets/attachments/:id/file",
    async ({ params: { id }, terminals: userTerminals, set, drizzle }) => {
      const [row] = await drizzle
        .select({ file_path: ticket_attachments.file_path, mime: ticket_attachments.mime, terminal_id: tickets.terminal_id })
        .from(ticket_attachments)
        .leftJoin(tickets, eq(ticket_attachments.ticket_id, tickets.id))
        .where(eq(ticket_attachments.id, id))
        .execute();
      if (!row) {
        set.status = 404;
        return { message: "Файл не найден" };
      }
      // Доступ решается здесь, а не отдачей статики через nginx: по прямой
      // ссылке иначе виден любой файл любого филиала.
      if (userTerminals && userTerminals.length > 0 && !userTerminals.includes(row.terminal_id!)) {
        set.status = 404;
        return { message: "Файл не найден" };
      }
      set.headers["content-type"] = row.mime;
      return Bun.file(row.file_path);
    },
    { permission: "tickets.list" }
  );
```

Про два права на чтение. Роуты чтения закрыты одним `tickets.list`, а широту видимости
определяет массив `terminals` из сессии: у филиальной роли он заполнен и режет выдачу, у офисной
пуст и означает «все филиалы» — так же, как в остальных модулях этого бэкенда. `tickets.list_all`
остаётся отдельным правом и работает как признак раздела в админке (по образцу `passport_layout`):
им фронт решает, показывать ли офисный экран. Макрос `permission` умеет проверять ровно одно
право на роут, поэтому проверка «или одно, или другое» в нём не выражается, и разводить два
одинаковых роута ради этого не стоит.

- [ ] **Step 3: Зарегистрировать контроллер**

В `backend/src/controllers.ts` добавить импорт рядом с остальными:

```ts
import { ticketsController } from "./modules/tickets/controller";
```

и в конец цепочки `.use(...)`:

```ts
  .use(ticketsController);
```

- [ ] **Step 4: Проверить, что модуль компилируется и роуты поднимаются**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && PORT=6799 timeout 25 bun src/index.ts &
sleep 12
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:6799/api/tickets?limit=10\&offset=0
```
Ожидается: `401`. Именно 401, а не 404: 404 означает, что регистрация в `controllers.ts` не сработала. Порт 6799 взят нарочно, чтобы не столкнуться с рабочим процессом.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/events.ts backend/src/modules/tickets/controller.ts backend/src/controllers.ts
git commit -m "feat(tickets): создание заявки, список, карточка, раздача вложений"
```

---

### Task 7: Действия менеджера

**Files:**
- Modify: `backend/src/modules/tickets/controller.ts`

**Interfaces:**
- Consumes: `nextStatus` из `./state`, `writeEvent` из `./events`
- Produces: роуты `POST /tickets/:id/close`, `POST /tickets/:id/reopen`, `POST /tickets/:id/cancel`, `POST /tickets/:id/comments`, `POST /tickets/:id/seen`

- [ ] **Step 1: Дописать роуты в конец цепочки контроллера**

```ts
  .post(
    "/tickets/:id/close",
    async ({ params: { id }, user, terminals: userTerminals, set, drizzle }) => {
      const result = await drizzle.transaction(async (tx) => {
        // Переход проверяется тем же запросом, что и пишет: между SELECT и
        // UPDATE заявку успевают вернуть в работу с другого планшета.
        const updated = await tx
          .update(tickets)
          .set({ status: "closed", closed_at: new Date().toISOString(), closed_by: user!.id, updated_at: new Date().toISOString() })
          .where(and(eq(tickets.id, id), eq(tickets.status, "done")))
          .returning();
        if (updated.length === 0) return null;
        await writeEvent(tx, { ticket_id: id, type: "closed", actor_kind: "manager", actor_user_id: user!.id });
        return updated[0];
      });

      if (!result) {
        set.status = 409;
        return { message: "Заявку можно принять только из состояния «сдана»" };
      }
      if (userTerminals?.length && !userTerminals.includes(result.terminal_id)) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }
      return result;
    },
    { permission: "tickets.close" }
  )
  .post(
    "/tickets/:id/reopen",
    async ({ params: { id }, body: { comment }, user, set, drizzle }) => {
      if (!comment?.trim()) {
        set.status = 422;
        return { message: "Нужен комментарий: без него исполнитель не поймёт, что переделывать" };
      }
      const result = await drizzle.transaction(async (tx) => {
        const updated = await tx
          .update(tickets)
          .set({
            status: "in_progress",
            done_at: null,
            reopen_count: sql`${tickets.reopen_count} + 1`,
            updated_at: new Date().toISOString(),
          })
          .where(and(eq(tickets.id, id), eq(tickets.status, "done")))
          .returning();
        if (updated.length === 0) return null;
        await tx.insert(ticket_comments).values({
          ticket_id: id,
          author_kind: "manager",
          author_user_id: user!.id,
          body: comment.trim(),
        });
        await writeEvent(tx, {
          ticket_id: id,
          type: "reopened",
          actor_kind: "manager",
          actor_user_id: user!.id,
          payload: { comment: comment.trim() },
        });
        return updated[0];
      });
      if (!result) {
        set.status = 409;
        return { message: "Вернуть в работу можно только сданную заявку" };
      }
      return result;
    },
    { permission: "tickets.close", body: t.Object({ comment: t.String() }) }
  )
  .post(
    "/tickets/:id/cancel",
    async ({ params: { id }, body: { comment }, user, set, drizzle }) => {
      const result = await drizzle.transaction(async (tx) => {
        const updated = await tx
          .update(tickets)
          .set({
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            cancelled_by: user!.id,
            updated_at: new Date().toISOString(),
          })
          .where(and(eq(tickets.id, id), inArray(tickets.status, ["new", "in_progress"])))
          .returning();
        if (updated.length === 0) return null;
        await writeEvent(tx, {
          ticket_id: id,
          type: "cancelled",
          actor_kind: "manager",
          actor_user_id: user!.id,
          payload: { comment: comment?.trim() ?? null },
        });
        return updated[0];
      });
      if (!result) {
        set.status = 409;
        return { message: "Отменить можно только новую или взятую в работу заявку" };
      }
      return result;
    },
    { permission: "tickets.cancel", body: t.Object({ comment: t.Optional(t.String()) }) }
  )
  .post(
    "/tickets/:id/comments",
    async ({ params: { id }, body: { body: text }, user, terminals: userTerminals, set, drizzle }) => {
      if (!text?.trim()) {
        set.status = 422;
        return { message: "Пустой комментарий" };
      }
      const where: SQLWrapper[] = [eq(tickets.id, id)];
      if (userTerminals && userTerminals.length > 0) where.push(inArray(tickets.terminal_id, userTerminals));
      const [ticket] = await drizzle.select({ id: tickets.id }).from(tickets).where(and(...where)).execute();
      if (!ticket) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }

      return drizzle.transaction(async (tx) => {
        const [comment] = await tx
          .insert(ticket_comments)
          .values({ ticket_id: id, author_kind: "manager", author_user_id: user!.id, body: text.trim() })
          .returning();
        await writeEvent(tx, {
          ticket_id: id,
          type: "comment",
          actor_kind: "manager",
          actor_user_id: user!.id,
          payload: { comment_id: comment.id },
        });
        return comment;
      });
    },
    { permission: "tickets.list", body: t.Object({ body: t.String() }) }
  )
  .post(
    "/tickets/:id/seen",
    async ({ params: { id }, terminals: userTerminals, drizzle, set }) => {
      const where: SQLWrapper[] = [eq(tickets.id, id)];
      if (userTerminals && userTerminals.length > 0) where.push(inArray(tickets.terminal_id, userTerminals));
      const updated = await drizzle
        .update(tickets)
        .set({ manager_seen_at: new Date().toISOString() })
        .where(and(...where))
        .returning({ id: tickets.id, manager_seen_at: tickets.manager_seen_at });
      if (updated.length === 0) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }
      return updated[0];
    },
    { permission: "tickets.list" }
  )
```

- [ ] **Step 2: Проверить, что роуты поднимаются**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && PORT=6799 timeout 25 bun src/index.ts &
sleep 12
for p in close reopen cancel comments seen; do
  printf "%s " $p
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:6799/api/tickets/00000000-0000-0000-0000-000000000000/$p
done
```
Ожидается: пять строк с `401`. Любой `404` означает, что роут не зарегистрирован.

- [ ] **Step 3: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/controller.ts
git commit -m "feat(tickets): приёмка, возврат в работу, отмена, комментарии, отметка прочтения"
```

---

### Task 8: Утверждение сумм офисом

**Files:**
- Modify: `backend/src/modules/tickets/controller.ts`

**Interfaces:**
- Consumes: `writeEvent` из `./events`
- Produces: роуты `POST /tickets/payment/approve` и `POST /tickets/payment/reject`, оба принимают `{ ids: string[]; comment?: string }`

- [ ] **Step 1: Дописать роуты**

```ts
  .post(
    "/tickets/payment/approve",
    async ({ body: { ids }, user, set, drizzle }) => {
      if (!ids.length || ids.length > 200) {
        set.status = 422;
        return { message: "Передайте от 1 до 200 заявок" };
      }
      // Утверждать можно только закрытую заявку, у которой сумма ещё не
      // тронута: повторное нажатие на уже утверждённой ничего не меняет и
      // не пишет второе событие.
      const updated = await drizzle.transaction(async (tx) => {
        const rows = await tx
          .update(tickets)
          .set({
            payment_status: "approved",
            payment_approved_by: user!.id,
            payment_approved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .where(and(inArray(tickets.id, ids), eq(tickets.status, "closed"), eq(tickets.payment_status, "pending")))
          .returning({ id: tickets.id, work_total_amount: tickets.work_total_amount });
        for (const r of rows) {
          await writeEvent(tx, {
            ticket_id: r.id,
            type: "payment_approved",
            actor_kind: "office",
            actor_user_id: user!.id,
            payload: { amount: r.work_total_amount },
          });
        }
        return rows;
      });
      return { approved: updated.length, skipped: ids.length - updated.length };
    },
    { permission: "tickets.payment.approve", body: t.Object({ ids: t.Array(t.String()) }) }
  )
  .post(
    "/tickets/payment/reject",
    async ({ body: { ids, comment }, user, set, drizzle }) => {
      if (!comment?.trim()) {
        set.status = 422;
        return { message: "Нужен комментарий с причиной отклонения" };
      }
      if (!ids.length || ids.length > 200) {
        set.status = 422;
        return { message: "Передайте от 1 до 200 заявок" };
      }
      const updated = await drizzle.transaction(async (tx) => {
        const rows = await tx
          .update(tickets)
          .set({
            payment_status: "rejected",
            payment_approved_by: user!.id,
            payment_approved_at: new Date().toISOString(),
            payment_comment: comment.trim(),
            updated_at: new Date().toISOString(),
          })
          .where(and(inArray(tickets.id, ids), eq(tickets.status, "closed"), eq(tickets.payment_status, "pending")))
          .returning({ id: tickets.id });
        for (const r of rows) {
          await writeEvent(tx, {
            ticket_id: r.id,
            type: "payment_rejected",
            actor_kind: "office",
            actor_user_id: user!.id,
            payload: { comment: comment.trim() },
          });
        }
        return rows;
      });
      return { rejected: updated.length, skipped: ids.length - updated.length };
    },
    {
      permission: "tickets.payment.approve",
      body: t.Object({ ids: t.Array(t.String()), comment: t.String() }),
    }
  )
```

- [ ] **Step 2: Проверить, что роуты поднимаются**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && PORT=6799 timeout 25 bun src/index.ts &
sleep 12
curl -s -o /dev/null -w "approve %{http_code}\n" -X POST http://127.0.0.1:6799/api/tickets/payment/approve
curl -s -o /dev/null -w "reject %{http_code}\n" -X POST http://127.0.0.1:6799/api/tickets/payment/reject
```
Ожидается: два `401`.

- [ ] **Step 3: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/controller.ts
git commit -m "feat(tickets): утверждение и отклонение сумм пачкой"
```

---

### Task 9: Справочники типов, фирм и исполнителей

**Files:**
- Modify: `backend/src/modules/tickets/controller.ts`

**Interfaces:**
- Consumes: `validateSchema` из `./fields`
- Produces: роуты `GET|POST /ticket_types`, `PUT /ticket_types/:id`, `GET|POST /ticket_contractors`, `PUT /ticket_contractors/:id`, `GET|POST /ticket_executors`, `PUT /ticket_executors/:id`, `POST /ticket_executors/:id/invite`

- [ ] **Step 1: Дописать роуты**

```ts
  .get(
    "/ticket_types",
    async ({ drizzle }) => ({
      data: await drizzle.select().from(ticket_types).orderBy(ticket_types.sort, ticket_types.name_ru).execute(),
    }),
    { permission: "tickets.create" }
  )
  .post(
    "/ticket_types",
    async ({ body, set, drizzle }) => {
      const schemaCheck = validateSchema(body.fields_schema);
      if (!schemaCheck.ok) {
        set.status = 422;
        return { message: "Схема полей неверна", errors: schemaCheck.errors };
      }
      if (body.executor_kind === "external" && !body.contractor_id) {
        set.status = 422;
        return { message: "Для внешнего исполнителя нужна фирма" };
      }
      const [row] = await drizzle
        .insert(ticket_types)
        .values({ ...body, fields_schema: schemaCheck.schema })
        .returning();
      return row;
    },
    {
      permission: "tickets.types.manage",
      body: t.Object({
        code: t.String(),
        number_prefix: t.String(),
        name_ru: t.String(),
        name_uz: t.String(),
        icon: t.Optional(t.String()),
        executor_kind: t.String(),
        contractor_id: t.Optional(t.String()),
        fields_schema: t.Any(),
        requires_cost: t.Optional(t.Boolean()),
        active: t.Optional(t.Boolean()),
        sort: t.Optional(t.Number()),
      }),
    }
  )
  .put(
    "/ticket_types/:id",
    async ({ params: { id }, body, set, drizzle }) => {
      const patch: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() };
      if (body.fields_schema !== undefined) {
        const schemaCheck = validateSchema(body.fields_schema);
        if (!schemaCheck.ok) {
          set.status = 422;
          return { message: "Схема полей неверна", errors: schemaCheck.errors };
        }
        patch.fields_schema = schemaCheck.schema;
      }
      const [row] = await drizzle.update(ticket_types).set(patch).where(eq(ticket_types.id, id)).returning();
      if (!row) {
        set.status = 404;
        return { message: "Тип не найден" };
      }
      return row;
    },
    {
      permission: "tickets.types.manage",
      body: t.Object({
        number_prefix: t.Optional(t.String()),
        name_ru: t.Optional(t.String()),
        name_uz: t.Optional(t.String()),
        icon: t.Optional(t.String()),
        contractor_id: t.Optional(t.String()),
        fields_schema: t.Optional(t.Any()),
        requires_cost: t.Optional(t.Boolean()),
        active: t.Optional(t.Boolean()),
        sort: t.Optional(t.Number()),
      }),
    }
  )
  .get(
    "/ticket_contractors",
    async ({ drizzle }) => ({
      data: await drizzle.select().from(ticket_contractors).orderBy(ticket_contractors.name).execute(),
    }),
    { permission: "tickets.contractors.manage" }
  )
  .post(
    "/ticket_contractors",
    async ({ body, drizzle }) => {
      const [row] = await drizzle.insert(ticket_contractors).values(body).returning();
      return row;
    },
    {
      permission: "tickets.contractors.manage",
      body: t.Object({ name: t.String(), phone: t.Optional(t.String()), note: t.Optional(t.String()) }),
    }
  )
  .put(
    "/ticket_contractors/:id",
    async ({ params: { id }, body, set, drizzle }) => {
      const [row] = await drizzle
        .update(ticket_contractors)
        .set({ ...body, updated_at: new Date().toISOString() })
        .where(eq(ticket_contractors.id, id))
        .returning();
      if (!row) {
        set.status = 404;
        return { message: "Фирма не найдена" };
      }
      return row;
    },
    {
      permission: "tickets.contractors.manage",
      body: t.Object({
        name: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        note: t.Optional(t.String()),
        is_active: t.Optional(t.Boolean()),
      }),
    }
  )
  .get(
    "/ticket_executors",
    async ({ query: { contractor_id }, drizzle }) => {
      const where = contractor_id ? [eq(ticket_executors.contractor_id, contractor_id)] : [];
      return {
        data: await drizzle
          .select()
          .from(ticket_executors)
          .where(and(...where))
          .orderBy(ticket_executors.full_name)
          .execute(),
      };
    },
    { permission: "tickets.contractors.manage", query: t.Object({ contractor_id: t.Optional(t.String()) }) }
  )
  .post(
    "/ticket_executors",
    async ({ body, set, drizzle }) => {
      if (body.kind === "external" && !body.contractor_id) {
        set.status = 422;
        return { message: "Внешнему исполнителю нужна фирма" };
      }
      if (body.kind === "staff" && !body.user_id) {
        set.status = 422;
        return { message: "Сотруднику нужна учётная запись" };
      }
      const [row] = await drizzle.insert(ticket_executors).values(body).returning();
      return row;
    },
    {
      permission: "tickets.contractors.manage",
      body: t.Object({
        kind: t.String(),
        contractor_id: t.Optional(t.String()),
        user_id: t.Optional(t.String()),
        full_name: t.String(),
        phone: t.Optional(t.String()),
        lang: t.Optional(t.String()),
      }),
    }
  )
  .put(
    "/ticket_executors/:id",
    async ({ params: { id }, body, set, drizzle }) => {
      const [row] = await drizzle
        .update(ticket_executors)
        .set({ ...body, updated_at: new Date().toISOString() })
        .where(eq(ticket_executors.id, id))
        .returning();
      if (!row) {
        set.status = 404;
        return { message: "Исполнитель не найден" };
      }
      return row;
    },
    {
      permission: "tickets.contractors.manage",
      body: t.Object({
        full_name: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        lang: t.Optional(t.String()),
        is_active: t.Optional(t.Boolean()),
      }),
    }
  )
  .post(
    "/ticket_executors/:id/invite",
    async ({ params: { id }, set, drizzle }) => {
      // Новый код на каждый запрос: старую ссылку могли переслать не туда,
      // и она перестаёт работать в тот момент, когда выписана новая.
      const [row] = await drizzle
        .update(ticket_executors)
        .set({ invite_code: sql`gen_random_uuid()`, invite_used_at: null, updated_at: new Date().toISOString() })
        .where(eq(ticket_executors.id, id))
        .returning({ invite_code: ticket_executors.invite_code, full_name: ticket_executors.full_name });
      if (!row) {
        set.status = 404;
        return { message: "Исполнитель не найден" };
      }
      const bot = process.env.TICKETS_BOT_USERNAME ?? "";
      return { invite_code: row.invite_code, link: `https://t.me/${bot}?start=inv_${row.invite_code}` };
    },
    { permission: "tickets.contractors.manage" }
  )
```

Дописать импорт `ticket_contractors` и `validateSchema` в шапку файла:

```ts
import { ticket_contractors } from "backend/drizzle/schema";
import { validateDetails, validateSchema, type FieldDef } from "./fields";
```

- [ ] **Step 2: Проверить роуты**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && PORT=6799 timeout 25 bun src/index.ts &
sleep 12
for p in ticket_types ticket_contractors ticket_executors; do
  printf "%s " $p
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:6799/api/$p
done
```
Ожидается: три `401`.

- [ ] **Step 3: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/controller.ts
git commit -m "feat(tickets): справочники типов, фирм и исполнителей"
```

---

### Task 10: Сиды прав и стартовых типов

**Files:**
- Create: `backend/src/modules/tickets/seed-permissions.ts`
- Create: `backend/src/modules/tickets/seed-types.ts`

**Interfaces:**
- Consumes: таблицы `permissions`, `ticket_types`, `ticket_contractors` из схемы
- Produces: два исполняемых скрипта, запускаемых через `bun`

- [ ] **Step 1: Написать сид прав**

`backend/src/modules/tickets/seed-permissions.ts`:

```ts
import { drizzleDb } from "../../lib/db";
import { permissions } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";

// description — varchar(60), длиннее не влезет.
const SLUGS: { slug: string; description: string }[] = [
  { slug: "tickets.create", description: "Заявки: создание с планшета" },
  { slug: "tickets.list", description: "Заявки: список своих филиалов" },
  { slug: "tickets.close", description: "Заявки: приёмка и возврат в работу" },
  { slug: "tickets.cancel", description: "Заявки: отмена" },
  { slug: "tickets.list_all", description: "Заявки: раздел офиса, все филиалы" },
  { slug: "tickets.payment.approve", description: "Заявки: утверждение сумм" },
  { slug: "tickets.types.manage", description: "Заявки: типы и схемы полей" },
  { slug: "tickets.contractors.manage", description: "Заявки: фирмы и исполнители" },
];

async function main() {
  for (const s of SLUGS) {
    const existing = await drizzleDb
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.slug, s.slug))
      .execute();
    if (existing.length) {
      console.log(`skip ${s.slug} (exists)`);
      continue;
    }
    await drizzleDb.insert(permissions).values({ slug: s.slug, description: s.description, active: true }).execute();
    console.log(`inserted ${s.slug}`);
  }
  console.log("done");
  process.exit(0);
}

main();
```

- [ ] **Step 2: Написать сид типов**

`backend/src/modules/tickets/seed-types.ts`:

```ts
import { drizzleDb } from "../../lib/db";
import { ticket_types } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import { validateSchema, type FieldDef } from "./fields";

const opt = (value: string, ru: string, uz: string) => ({ value, label_ru: ru, label_uz: uz });

const AD_TV: FieldDef[] = [
  {
    key: "tv_place",
    type: "select",
    required: true,
    label_ru: "Какой телевизор",
    label_uz: "Qaysi televizor",
    options: [
      opt("hall", "Зал", "Zal"),
      opt("kitchen", "Кухня", "Oshxona"),
      opt("window", "Витрина", "Vitrina"),
      opt("other", "Другой", "Boshqa"),
    ],
  },
  {
    key: "symptom",
    type: "select",
    required: true,
    label_ru: "Что происходит",
    label_uz: "Nima bo'lyapti",
    options: [
      opt("no_power", "Не включается", "Yoqilmayapti"),
      opt("black_screen", "Чёрный экран", "Qora ekran"),
      opt("no_signal", "Нет картинки с плеера", "Pleerdan tasvir yo'q"),
      opt("frozen", "Зависла картинка", "Tasvir qotib qolgan"),
      opt("no_sound", "Нет звука", "Ovoz yo'q"),
      opt("other", "Другое", "Boshqa"),
    ],
  },
  { key: "note", type: "text", required: false, label_ru: "Описание", label_uz: "Izoh" },
];

const CAMERAS: FieldDef[] = [
  {
    key: "broken_part",
    type: "select",
    required: true,
    label_ru: "Что сломано",
    label_uz: "Nima buzilgan",
    options: [
      opt("camera", "Конкретная камера", "Muayyan kamera"),
      opt("dvr", "Видеорегистратор", "Videoregistrator"),
      opt("no_record", "Нет записи", "Yozuv yo'q"),
      opt("no_remote", "Нет удалённого доступа", "Masofaviy kirish yo'q"),
    ],
  },
  {
    key: "zone",
    type: "select",
    required: true,
    label_ru: "Зона",
    label_uz: "Hudud",
    options: [
      opt("cashier", "Касса", "Kassa"),
      opt("hall", "Зал", "Zal"),
      opt("kitchen", "Кухня", "Oshxona"),
      opt("storage", "Склад", "Ombor"),
      opt("street", "Улица", "Ko'cha"),
    ],
  },
  { key: "note", type: "text", required: false, label_ru: "Описание", label_uz: "Izoh" },
];

const TYPES = [
  { code: "ad_tv", number_prefix: "TV", name_ru: "Реклама ТВ", name_uz: "Reklama TV", icon: "tv", schema: AD_TV },
  { code: "cameras", number_prefix: "CAM", name_ru: "Камеры", name_uz: "Kameralar", icon: "cctv", schema: CAMERAS },
];

async function main() {
  for (const t of TYPES) {
    const check = validateSchema(t.schema);
    if (!check.ok) {
      console.error(`${t.code}: схема невалидна`, check.errors);
      process.exit(1);
    }
    const existing = await drizzleDb
      .select({ id: ticket_types.id })
      .from(ticket_types)
      .where(eq(ticket_types.code, t.code))
      .execute();
    if (existing.length) {
      console.log(`skip ${t.code} (exists)`);
      continue;
    }
    // contractor_id остаётся пустым: фирмы заводит владелец в админке, и
    // привязка типа к фирме — его решение, а не решение сида.
    await drizzleDb
      .insert(ticket_types)
      .values({
        code: t.code,
        number_prefix: t.number_prefix,
        name_ru: t.name_ru,
        name_uz: t.name_uz,
        icon: t.icon,
        executor_kind: "external",
        fields_schema: check.schema,
      })
      .execute();
    console.log(`inserted ${t.code}`);
  }
  console.log("done");
  process.exit(0);
}

main();
```

- [ ] **Step 3: Прогнать оба сида**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun src/modules/tickets/seed-permissions.ts
bun src/modules/tickets/seed-types.ts
```
Ожидается: восемь строк `inserted tickets.*` и две `inserted ad_tv` / `inserted cameras`.

- [ ] **Step 4: Проверить в базе**

```bash
psql "$DATABASE_URL" -c "select slug from permissions where slug like 'tickets%' order by slug" \
  -c "select code, number_prefix, jsonb_array_length(fields_schema) as fields from ticket_types order by code"
```
Ожидается: 8 прав; `ad_tv` с 3 полями и `cameras` с 3 полями.

- [ ] **Step 5: Повторно прогнать сиды и убедиться, что они идемпотентны**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun src/modules/tickets/seed-permissions.ts
bun src/modules/tickets/seed-types.ts
```
Ожидается: только строки `skip ... (exists)`, ни одного `inserted`.

- [ ] **Step 6: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/seed-permissions.ts backend/src/modules/tickets/seed-types.ts
git commit -m "feat(tickets): сиды прав и двух стартовых типов"
```

---

### Task 11: Полный прогон тестов и проверка модуля целиком

**Files:**
- Нет новых файлов; правки по результатам прогона — в файлы соответствующих задач

- [ ] **Step 1: Прогнать все тесты модуля**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test src/modules/tickets/
```
Ожидается: 35 pass, 0 fail (6 + 14 + 8 + 7).

- [ ] **Step 2: Убедиться, что чужие тесты не сломались**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test src/modules/passport/ src/modules/credit/
```
Ожидается: столько же pass, сколько было до начала работы, 0 fail. Модуль заявок ничего чужого не трогал, любое падение здесь — признак правки не в своём файле.

- [ ] **Step 3: Поднять бэкенд на свободном порту и снять карту роутов**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && PORT=6799 timeout 30 bun src/index.ts &
sleep 12
for u in "tickets?limit=10&offset=0" "ticket_types" "ticket_contractors" "ticket_executors"; do
  printf "%-20s " "$u"
  curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:6799/api/$u"
done
```
Ожидается: четыре `401`. Ни одного `404`, ни одного `500`.

- [ ] **Step 4: Проверить, что чужие файлы не попали в коммиты**

```bash
cd /home/davr/managers && git log --stat -11 --format="%h %s" | grep -E "^\s" | sort -u
```
Ожидается: только пути `backend/drizzle/schema.ts`, `backend/drizzle/migrations/*`, `backend/src/modules/tickets/*`, `backend/src/controllers.ts`.

- [ ] **Step 5: Коммит журнала выполнения**

Записать в `docs/superpowers/tickets-progress.md` дату, номера коммитов задач 1-10 и итог прогона тестов.

```bash
cd /home/davr/managers
git add docs/superpowers/tickets-progress.md
git commit -m "docs(tickets): журнал выполнения плана 1"
```

---

## Что дальше

План 1 оставляет ядро рабочим, но невидимым: прав никому не выдано, интерфейсов нет, уведомления не уходят. Следующие планы пишутся отдельно, каждый — самостоятельно проверяемый кусок:

- **План 2 — уведомления и бот:** `routing.ts` с тестами, очередь `tickets-notify`, процесс `office_tickets_worker`, вебхук `/tickets/bot/webhook`, привязка по инвайту, подъём bullmq в backend до ^5.80.9.
- **План 3 — API исполнителя:** макрос `tgExecutor` на `initData`, роуты `/tickets/tg/*`, захват заявки одним `UPDATE ... WHERE status='new'`, сдача работы с актом и фото, тесты на изоляцию по фирме.
- **План 4 — мини-апп:** `tickets_miniapp/` на Vite, три экрана, `MainButton`, темы телеграма, два языка.
- **План 5 — админка:** планшет менеджера (создание в два шага, список с непрочитанным, экран приёмки) и офис (таблица, вкладка «К оплате», редакторы справочников).
- **План 6 — деплой:** бинарь, воркер, admin, мини-апп, nginx, `setWebhook`, выдача прав, живой прогон.
