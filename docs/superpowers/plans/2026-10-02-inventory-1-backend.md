# Инвентаризации, план 1: бэкенд — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** таблицы, права и HTTP API модуля `inventory`: шаблоны, инвентаризации, идемпотентная синхронизация записей, отправка, возврат и отмена. Всё покрыто HTTP-тестами на тестовой базе.

**Architecture:** новый модуль `backend/src/modules/inventory/`. Чистые правила (статусы, периоды по Ташкенту, валидация количества) лежат в `rules.ts` с юнит-тестами. Работа с БД — в `counts.ts` и `templates.ts`, доступ к складу — в `access.ts`, роуты — в тонком `controller.ts`. Контроллер экспортируется как `as unknown as Elysia` и регистрируется в `app.ts` до `apiController` (иначе Eden упирается в TS2589, ср. `tickets`). Каждая мутация блокирует строку инвентаризации (`FOR UPDATE`).

**Tech Stack:** Bun, Elysia 1.4, Drizzle ORM 0.44 (node-postgres), PostgreSQL 17 локально, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-02-inventory-counts-design.md`

## Global Constraints

- Схема только в `backend/drizzle/schema.ts`. Миграция генерируется `bunx drizzle-kit generate` из `backend/` и применяется **только к локальным базам**: `managers` на 127.0.0.1 и `managers_tickets_test`. Прод (choparpizza.uz) только для чтения.
- Никаких внешних ключей из новых таблиц на `users`, `corporation_store`, `nomenclature_*`: тестовая база пустая, а `withSession` создаёт пользователя без строки в `users`. Внешние ключи между новыми таблицами `inventory_*` можно.
- `numeric` из Drizzle приходит строкой. Суммы считаются только в SQL (`sum(qty)`), без JS-float.
- Период — строка `YYYY-MM-DD` (последний день месяца), никогда не `Date`. Все календарные правила считаются в Asia/Tashkent (UTC+5, без перехода на летнее время).
- Ответы модуля **не содержат** учётных цифр iiko. Generic-параметр `fields` модуль не принимает.
- `permissions.description` — `varchar(60)`.
- HTTP-тесты запускаются только через `bun run test:http:inventory` (новый скрипт). Хелпер `tests/helpers/http.ts` требует базу ровно `managers_tickets_test` и `PROJECT_PREFIX=managers_test_`.
- Коммиты на ветке `feature/inventory-counts`. В конце сообщения строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Чужие изменения (`.DS_Store`, `admin/.million/store.json`) не добавлять.

## Review Focus

- **Отправка во время синхронизации:** запись, принятая сервером, обязана попасть в `fact_qty`, иначе её отклоняют с 409. Пин: тест «sync и submit одновременно» в Task 5.
- **Два «Начать» одновременно:** получается одна инвентаризация без 500. Пин: тест параллельного `POST /counts` в Task 4.
- **Граница 5-го числа по Ташкенту:** 6-е, 03:00 +05 в UTC ещё 5-е. Пин: юнит-тесты `allowedPeriods` и `canReopen` в Task 2.
- **Сотрудник офиса без привязки к складу:** читает, но не пишет. Пин: тест `access: read` в Task 4 и 403 на `sync` в Task 5.
- **Повторная пачка после обрыва связи:** без дублей. `add` и `delete` одной записи в одной пачке дают 0 живых записей. Пин: тесты идемпотентности в Task 5.

---

### Task 1: Таблицы, миграция, права, тестовая база

**Files:**
- Modify: `backend/drizzle/schema.ts` (дописать в конец)
- Create: `backend/drizzle/migrations/0026_inventory_counts.sql` (генерируется), `backend/drizzle/migrations/meta/0026_snapshot.json`, правка `meta/_journal.json`
- Create: `backend/src/modules/inventory/seed-permissions.ts`
- Modify: `backend/package.json` (скрипт `test:http:inventory`)

**Interfaces:**
- Produces: drizzle-таблицы `inventory_templates`, `inventory_template_items`, `inventory_counts`, `inventory_count_lines`, `inventory_count_entries`, `inventory_count_events`. Права `inventory.count`, `inventory.manage`, `inventory.templates`.

- [ ] **Step 1: Дописать таблицы в конец `backend/drizzle/schema.ts`**

Все нужные импорты (`pgTable`, `uuid`, `varchar`, `boolean`, `integer`, `timestamp`, `numeric`, `date`, `jsonb`, `index`, `uniqueIndex`, `check`, `sql`) уже есть в шапке файла.

```ts
// ── Инвентаризации (spec 2026-10-02-inventory-counts-design.md) ──
// Внешних ключей на users/corporation_store/nomenclature_* нет намеренно:
// тестовая база пустая, а данные iiko синкаются отдельно.

export const inventory_templates = pgTable("inventory_templates", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  organization_id: uuid("organization_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  active: boolean("active").default(true).notNull(),
  sort: integer("sort").default(0).notNull(),
  created_by: uuid("created_by"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const inventory_template_items = pgTable(
  "inventory_template_items",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    template_id: uuid("template_id")
      .notNull()
      .references(() => inventory_templates.id, { onDelete: "cascade" }),
    product_id: uuid("product_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    template_product_uq: uniqueIndex("inventory_template_items_template_product_uq").on(t.template_id, t.product_id),
  })
);

export const inventory_counts = pgTable(
  "inventory_counts",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    store_id: uuid("store_id").notNull(),
    // null у складов без организации (31 из 94 в проде, включая новые филиалы).
    organization_id: uuid("organization_id"),
    template_id: uuid("template_id")
      .notNull()
      .references(() => inventory_templates.id),
    template_name: varchar("template_name", { length: 255 }).notNull(),
    period: date("period", { mode: "string" }).notNull(),
    status: varchar("status", { length: 32 }).default("draft").notNull(),
    created_by: uuid("created_by").notNull(),
    submitted_by: uuid("submitted_by"),
    submitted_at: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    store_period_template_uq: uniqueIndex("inventory_counts_store_period_template_uq")
      .on(t.store_id, t.period, t.template_id)
      .where(sql`status <> 'cancelled'`),
    store_period_idx: index("inventory_counts_store_period_idx").on(t.store_id, t.period),
  })
);

export const inventory_count_lines = pgTable(
  "inventory_count_lines",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    count_id: uuid("count_id")
      .notNull()
      .references(() => inventory_counts.id, { onDelete: "cascade" }),
    product_id: uuid("product_id").notNull(),
    product_name: varchar("product_name", { length: 255 }).notNull(),
    unit_id: uuid("unit_id"),
    unit_name: varchar("unit_name", { length: 255 }),
    group_id: uuid("group_id"),
    group_name: varchar("group_name", { length: 512 }).notNull(),
    source: varchar("source", { length: 16 }).notNull(),
    added_by: uuid("added_by"),
    skipped: boolean("skipped").default(false).notNull(),
    skipped_by: uuid("skipped_by"),
    fact_qty: numeric("fact_qty", { precision: 14, scale: 4 }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    count_product_uq: uniqueIndex("inventory_count_lines_count_product_uq").on(t.count_id, t.product_id),
  })
);

export const inventory_count_entries = pgTable(
  "inventory_count_entries",
  {
    // id генерирует устройство — это ключ идемпотентности синхронизации.
    id: uuid("id").primaryKey().notNull(),
    count_id: uuid("count_id")
      .notNull()
      .references(() => inventory_counts.id, { onDelete: "cascade" }),
    line_id: uuid("line_id")
      .notNull()
      .references(() => inventory_count_lines.id, { onDelete: "cascade" }),
    qty: numeric("qty", { precision: 14, scale: 4 }).notNull(),
    created_by: uuid("created_by").notNull(),
    client_created_at: timestamp("client_created_at", { withTimezone: true, mode: "string" }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    deleted_at: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
    deleted_by: uuid("deleted_by"),
  },
  (t) => ({
    count_idx: index("inventory_count_entries_count_idx").on(t.count_id),
    line_idx: index("inventory_count_entries_line_idx").on(t.line_id),
    qty_check: check("inventory_count_entries_qty_check", sql`qty >= 0`),
  })
);

export const inventory_count_events = pgTable(
  "inventory_count_events",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    count_id: uuid("count_id")
      .notNull()
      .references(() => inventory_counts.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(),
    user_id: uuid("user_id").notNull(),
    payload: jsonb("payload"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    count_idx: index("inventory_count_events_count_idx").on(t.count_id),
  })
);
```

- [ ] **Step 2: Сгенерировать миграцию**

```bash
cd backend && bunx drizzle-kit generate --name=inventory_counts
```
Ожидается: `0026_inventory_counts.sql`. 02.10.2026 проверено, что без правок схема с миграциями совпадает («No schema changes»).

- [ ] **Step 3: Проверить SQL глазами**

```bash
cd backend && cat drizzle/migrations/0026_inventory_counts.sql
```
В файле должны быть **только** `CREATE TABLE "inventory_*"`, их индексы, FK между `inventory_*` и check. Уникальный индекс `inventory_counts_store_period_template_uq` должен заканчиваться на `WHERE status <> 'cancelled'`. Если есть что-то про чужие таблицы — остановиться и доложить.

- [ ] **Step 4: Применить к локальной базе `managers`**

```bash
cd backend && bunx drizzle-kit migrate
psql "$(grep '^DATABASE_URL' .env | cut -d= -f2-)" -Atc "select tablename from pg_tables where tablename like 'inventory_%' order by 1"
```
Ожидается 6 таблиц.

- [ ] **Step 5: Создать и смигрировать тестовую базу**

```bash
cd backend
DB=$(grep '^DATABASE_URL' .env | cut -d= -f2-)
psql "$DB" -c "CREATE DATABASE managers_tickets_test"
TEST_URL=$(echo "$DB" | sed 's#/[^/]*$#/managers_tickets_test#')
DATABASE_URL="$TEST_URL" bunx drizzle-kit migrate
psql "$TEST_URL" -Atc "select count(*) from pg_tables where tablename like 'inventory_%'"
```
Ожидается `6`. Если `migrate` падает на чужой миграции — остановиться и доложить, не чинить чужое. Если база уже есть, `CREATE DATABASE` упадёт, это нормально: дальше просто `migrate`.

- [ ] **Step 6: Скрипт тестов в `backend/package.json`**

В `"scripts"` рядом с `test:http` добавить:
```json
"test:http:inventory": "PROJECT_PREFIX=managers_test_ DATABASE_URL=$TEST_DATABASE_URL bun test src/modules/inventory/routes.test.ts",
```
Отдельный скрипт, а не дописывание к `test:http`: хелпер закрывает redis в `afterAll` файла, и второй файл в том же процессе остался бы без соединения.

- [ ] **Step 7: Сид прав `backend/src/modules/inventory/seed-permissions.ts`**

```ts
import { drizzleDb } from "../../lib/db";
import { permissions } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";

// description — varchar(60), длиннее не влезет.
const SLUGS: { slug: string; description: string }[] = [
  { slug: "inventory.count", description: "Инвентаризация: ввод остатков своих складов" },
  { slug: "inventory.manage", description: "Инвентаризация: начать, отправить, вернуть" },
  { slug: "inventory.templates", description: "Инвентаризация: шаблоны, обзор всех складов" },
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

Запустить на локальной базе:
```bash
cd backend && bun run src/modules/inventory/seed-permissions.ts
```
Ожидается: `inserted inventory.count`, `inserted inventory.manage`, `inserted inventory.templates`, `done`.

- [ ] **Step 8: Commit**

```bash
git add backend/drizzle/schema.ts backend/drizzle/migrations backend/src/modules/inventory/seed-permissions.ts backend/package.json
git commit -m "feat(inventory): таблицы инвентаризаций, миграция и сид прав

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Чистые правила и общие типы

**Files:**
- Create: `backend/src/modules/inventory/types.ts`
- Create: `backend/src/modules/inventory/rules.ts`
- Test: `backend/src/modules/inventory/rules.test.ts`

**Interfaces:**
- Produces (`rules.ts`):
  - `type CountStatus = "draft" | "submitted" | "cancelled"`
  - `type CountAction = "submit" | "reopen" | "cancel"`
  - `nextStatus(action: CountAction, from: string): CountStatus | null`
  - `lastDayOfMonth(year: number, month1to12: number): string`
  - `allowedPeriods(now: Date): string[]` — первым идёт текущий период
  - `isValidPeriod(period: string): boolean`
  - `canReopen(period: string, now: Date): boolean`
  - `isValidQty(q: unknown): q is number`
  - `MAX_QTY = 1_000_000`, `PERIOD_GRACE_DAYS = 5`, `UUID_RE`
- Produces (`types.ts`): все типы ответов API (ниже). Файл без импортов, фронт подключает его через `import type`.

- [ ] **Step 1: Написать `types.ts`**

```ts
// Общие типы ответов модуля inventory. Без импортов: admin подключает файл
// через `import type` из @backend/modules/inventory/types, а контроллер
// экспортирован как `as unknown as Elysia`, так что Eden эти типы не выведет.

export type InventoryCountStatus = "draft" | "submitted" | "cancelled";
export type InventoryAccess = "write" | "read";

export interface InventoryStore {
  id: string;
  name: string;
  organization_id: string | null;
}

export interface InventoryEntry {
  id: string;
  line_id: string;
  qty: string;
  created_by: string;
  created_by_name: string;
  client_created_at: string;
}

export interface InventoryLine {
  id: string;
  product_id: string;
  product_name: string;
  unit_name: string | null;
  group_id: string | null;
  group_name: string;
  source: "template" | "added";
  skipped: boolean;
  fact_qty: string | null;
  /** Сумма живых записей, строкой numeric ("0" если записей нет). */
  total: string;
  entries: InventoryEntry[];
}

export interface InventoryCountSummary {
  id: string;
  store_id: string;
  store_name: string;
  template_id: string;
  template_name: string;
  period: string;
  status: InventoryCountStatus;
  created_at: string;
  submitted_at: string | null;
  submitted_by_name: string | null;
  lines_total: number;
  lines_done: number;
  participants: string[];
}

export interface InventoryCountDetail extends InventoryCountSummary {
  /** Текущий пользователь: фронт помечает «мои» записи и фильтр «Мои». */
  viewer_id: string;
  access: InventoryAccess;
  can_manage: boolean;
  can_reopen: boolean;
  lines: InventoryLine[];
}

export type InventorySyncOp =
  | { op: "add"; id: string; line_id: string; qty: number; client_created_at: string }
  | { op: "delete"; id: string };

export type InventorySyncRejectReason = "not_found_line" | "forbidden" | "invalid_qty" | "invalid_id";

export interface InventorySyncResult {
  applied: string[];
  rejected: { id: string; reason: InventorySyncRejectReason }[];
}

export interface InventoryTemplateSummary {
  id: string;
  organization_id: string;
  organization_name: string | null;
  name: string;
  active: boolean;
  sort: number;
  items_count: number;
}

export interface InventoryTemplateDetail extends InventoryTemplateSummary {
  product_ids: string[];
}

export interface InventoryProduct {
  id: string;
  name: string;
  unit_name: string | null;
  group_name: string;
}

export interface InventoryFolders {
  groups: { id: string; name: string; parent_id: string | null }[];
  products: { id: string; name: string; unit_name: string | null; parent_id: string | null }[];
}

export interface InventorySuggestion {
  product_id: string;
  product_name: string;
  times: number;
}

export interface InventoryOverviewRow {
  store_id: string;
  store_name: string;
  organization_id: string | null;
  counts: InventoryCountSummary[];
}

export interface InventoryErrorBody {
  error: string;
  [k: string]: unknown;
}
```

- [ ] **Step 2: Написать падающие тесты `rules.test.ts`**

```ts
import { describe, expect, it } from "bun:test";
import {
  allowedPeriods,
  canReopen,
  isValidPeriod,
  isValidQty,
  lastDayOfMonth,
  nextStatus,
} from "./rules";

describe("nextStatus", () => {
  it("draft → submitted → draft, draft → cancelled", () => {
    expect(nextStatus("submit", "draft")).toBe("submitted");
    expect(nextStatus("reopen", "submitted")).toBe("draft");
    expect(nextStatus("cancel", "draft")).toBe("cancelled");
  });
  it("запрещённые переходы дают null", () => {
    expect(nextStatus("submit", "submitted")).toBeNull();
    expect(nextStatus("cancel", "submitted")).toBeNull();
    expect(nextStatus("reopen", "draft")).toBeNull();
    expect(nextStatus("submit", "cancelled")).toBeNull();
    expect(nextStatus("submit", "garbage")).toBeNull();
  });
});

describe("lastDayOfMonth / isValidPeriod", () => {
  it("считает последний день, включая февраль високосного года", () => {
    expect(lastDayOfMonth(2026, 10)).toBe("2026-10-31");
    expect(lastDayOfMonth(2026, 11)).toBe("2026-11-30");
    expect(lastDayOfMonth(2028, 2)).toBe("2028-02-29");
    expect(lastDayOfMonth(2026, 12)).toBe("2026-12-31");
  });
  it("валиден только последний день месяца в формате YYYY-MM-DD", () => {
    expect(isValidPeriod("2026-10-31")).toBe(true);
    expect(isValidPeriod("2026-10-30")).toBe(false);
    expect(isValidPeriod("2026-10-31T00:00:00Z")).toBe(false);
    expect(isValidPeriod("31.10.2026")).toBe(false);
  });
});

describe("allowedPeriods (Asia/Tashkent, UTC+5)", () => {
  it("в середине месяца — только текущий", () => {
    expect(allowedPeriods(new Date("2026-10-15T07:00:00Z"))).toEqual(["2026-10-31"]);
  });
  it("1-е число 03:00 +05 (в UTC ещё 31-е) — уже новый месяц и прошлый", () => {
    expect(allowedPeriods(new Date("2026-10-31T22:00:00Z"))).toEqual(["2026-11-30", "2026-10-31"]);
  });
  it("5-е 23:59 +05 — прошлый ещё доступен", () => {
    expect(allowedPeriods(new Date("2026-11-05T18:59:00Z"))).toEqual(["2026-11-30", "2026-10-31"]);
  });
  it("6-е 03:00 +05 (в UTC ещё 5-е) — прошлый уже нет", () => {
    expect(allowedPeriods(new Date("2026-11-05T22:00:00Z"))).toEqual(["2026-11-30"]);
  });
  it("переход через год", () => {
    expect(allowedPeriods(new Date("2027-01-02T00:00:00Z"))).toEqual(["2027-01-31", "2026-12-31"]);
  });
});

describe("canReopen", () => {
  it("до 5-го числа следующего месяца включительно", () => {
    expect(canReopen("2026-10-31", new Date("2026-10-31T10:00:00Z"))).toBe(true);
    expect(canReopen("2026-10-31", new Date("2026-11-05T18:59:00Z"))).toBe(true);
  });
  it("6-е 00:00 +05 — уже нельзя", () => {
    expect(canReopen("2026-10-31", new Date("2026-11-05T19:00:00Z"))).toBe(false);
  });
  it("декабрьский период — до 5 января", () => {
    expect(canReopen("2026-12-31", new Date("2027-01-05T10:00:00Z"))).toBe(true);
    expect(canReopen("2026-12-31", new Date("2027-01-06T10:00:00Z"))).toBe(false);
  });
});

describe("isValidQty", () => {
  it("принимает 0, дроби до 4 знаков и максимум", () => {
    expect(isValidQty(0)).toBe(true);
    expect(isValidQty(2.5)).toBe(true);
    expect(isValidQty(1.2345)).toBe(true);
    expect(isValidQty(1_000_000)).toBe(true);
  });
  it("отклоняет отрицательные, >1e6, >4 знаков, не числа", () => {
    expect(isValidQty(-0.1)).toBe(false);
    expect(isValidQty(1_000_000.5)).toBe(false);
    expect(isValidQty(1.23456)).toBe(false);
    expect(isValidQty(Number.NaN)).toBe(false);
    expect(isValidQty(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidQty("2.5")).toBe(false);
    expect(isValidQty(null)).toBe(false);
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

```bash
cd backend && bun test src/modules/inventory/rules.test.ts
```
Ожидается FAIL: `Cannot find module './rules'`.

- [ ] **Step 4: Написать `rules.ts`**

```ts
// Единственное место, где записаны жизненный цикл инвентаризации и
// календарные правила. Контроллер и фронт спрашивают здесь, а не держат
// свои копии условий.

export type CountStatus = "draft" | "submitted" | "cancelled";
export type CountAction = "submit" | "reopen" | "cancel";

const TRANSITIONS: Record<CountAction, { from: CountStatus[]; to: CountStatus }> = {
  submit: { from: ["draft"], to: "submitted" },
  reopen: { from: ["submitted"], to: "draft" },
  cancel: { from: ["draft"], to: "cancelled" },
};

export function nextStatus(action: CountAction, from: string): CountStatus | null {
  const rule = TRANSITIONS[action];
  if (!rule) return null;
  return (rule.from as string[]).includes(from) ? rule.to : null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Asia/Tashkent — UTC+5 круглый год, без перехода на летнее время, поэтому
// хватает сдвига, без Intl и без зависимости от TZ сервера.
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
export const PERIOD_GRACE_DAYS = 5;

function tashkentParts(now: Date): { y: number; m: number; d: number } {
  const t = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(day)}`;
}

function prevMonth(y: number, m: number): { y: number; m: number } {
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}

function nextMonth(y: number, m: number): { y: number; m: number } {
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

/** Периоды, доступные для новой инвентаризации. Первый — текущий месяц. */
export function allowedPeriods(now: Date): string[] {
  const { y, m, d } = tashkentParts(now);
  const current = lastDayOfMonth(y, m);
  if (d > PERIOD_GRACE_DAYS) return [current];
  const p = prevMonth(y, m);
  return [current, lastDayOfMonth(p.y, p.m)];
}

export function isValidPeriod(period: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return false;
  return lastDayOfMonth(year, month) === period;
}

/** Вернуть в черновик можно до PERIOD_GRACE_DAYS числа следующего месяца включительно. */
export function canReopen(period: string, now: Date): boolean {
  if (!isValidPeriod(period)) return false;
  const [py, pm] = period.split("-").map(Number);
  const limit = nextMonth(py, pm);
  const { y, m, d } = tashkentParts(now);
  const nowKey = y * 10000 + m * 100 + d;
  const limitKey = limit.y * 10000 + limit.m * 100 + PERIOD_GRACE_DAYS;
  return nowKey <= limitKey;
}

export const MAX_QTY = 1_000_000;

export function isValidQty(q: unknown): q is number {
  if (typeof q !== "number" || !Number.isFinite(q)) return false;
  if (q < 0 || q > MAX_QTY) return false;
  return Number(q.toFixed(4)) === q;
}
```

- [ ] **Step 5: Тесты проходят**

```bash
cd backend && bun test src/modules/inventory/rules.test.ts
```
Ожидается PASS, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/inventory/types.ts backend/src/modules/inventory/rules.ts backend/src/modules/inventory/rules.test.ts
git commit -m "feat(inventory): правила статусов, периодов по Ташкенту и общие типы

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Каркас контроллера, доступ к складам, тестовый харнесс

**Files:**
- Create: `backend/src/modules/inventory/errors.ts`
- Create: `backend/src/modules/inventory/access.ts`
- Create: `backend/src/modules/inventory/controller.ts`
- Modify: `backend/src/app.ts` (импорт и `.use(inventoryController)` до `.use(apiController)`)
- Test: `backend/src/modules/inventory/routes.test.ts`

**Interfaces:**
- Consumes: таблицы из Task 1, `UUID_RE` и `allowedPeriods` из Task 2.
- Produces:
  - `class InventoryError extends Error { status: number; code: string; extra: Record<string, unknown> }`
  - `type Actor = { userId: string; perms: string[] }`
  - `storeAccess(db: DbLike, actor: Actor, storeId: string): Promise<"write" | "read" | "none">`
  - `actorFrom(cacheController, user, role): Promise<Actor>`
  - `type DbLike` — `DrizzleDB` или транзакция
  - роуты `GET /api/inventory/stores`, `GET /api/inventory/periods`
  - хелперы тестов в `routes.test.ts`: `seedWorld()`, `api()`, `manager()`, `helper()`, `office()`

- [ ] **Step 1: `errors.ts`**

```ts
// Бизнес-ошибка модуля: сервисы бросают её, контроллер превращает в
// HTTP-ответ { error: code, ...extra }. Всё остальное — настоящий 500.
export class InventoryError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(code);
  }
}

export async function run<T>(
  set: { status?: number | string },
  fn: () => Promise<T>
): Promise<T | { error: string; [k: string]: unknown }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof InventoryError) {
      set.status = e.status;
      return { error: e.code, ...e.extra };
    }
    throw e;
  }
}
```

- [ ] **Step 2: `access.ts`**

```ts
import type { DrizzleDB } from "@backend/lib/db";
import { users_stores } from "backend/drizzle/schema";
import { and, eq } from "drizzle-orm";

export type DbLike = DrizzleDB | Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export type Actor = { userId: string; perms: string[] };
export type StoreAccess = "write" | "read" | "none";

export async function actorFrom(
  cacheController: { getPermissionsByRoleId(roleId: string): Promise<string[]> },
  user: { id: string } | null,
  role: { id: string } | null
): Promise<Actor> {
  const perms = role ? await cacheController.getPermissionsByRoleId(role.id) : [];
  return { userId: user!.id, perms };
}

// Склад — единица доступа. Свой склад (users_stores) — запись. Офис с
// inventory.templates видит чужие склады только на чтение. Все остальные — none.
export async function storeAccess(db: DbLike, actor: Actor, storeId: string): Promise<StoreAccess> {
  const rows = await db
    .select({ id: users_stores.id })
    .from(users_stores)
    .where(and(eq(users_stores.user_id, actor.userId), eq(users_stores.corporation_store_id, storeId)))
    .limit(1);
  if (rows.length) return "write";
  if (actor.perms.includes("inventory.templates")) return "read";
  return "none";
}

export function canManage(actor: Actor, access: StoreAccess): boolean {
  return access === "write" && actor.perms.includes("inventory.manage");
}
```

- [ ] **Step 3: каркас `controller.ts`**

```ts
import { ctx } from "@backend/context";
import { corporation_store, users_stores } from "backend/drizzle/schema";
import { asc, eq } from "drizzle-orm";
import Elysia from "elysia";
import { actorFrom } from "./access";
import { run } from "./errors";
import { allowedPeriods } from "./rules";
import type { InventoryStore } from "./types";

const inventoryControllerImpl = new Elysia({ name: "@api/inventory", prefix: "/api" })
  .use(ctx)
  .guard({ detail: { hide: true } })
  .get(
    "/inventory/stores",
    async ({ user, role, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom(cacheController, user, role);
        const rows = await drizzle
          .select({
            id: corporation_store.id,
            name: corporation_store.name,
            organization_id: corporation_store.organization_id,
          })
          .from(users_stores)
          .innerJoin(corporation_store, eq(corporation_store.id, users_stores.corporation_store_id))
          .where(eq(users_stores.user_id, actor.userId))
          .orderBy(asc(corporation_store.name));
        return rows.map((r) => ({ ...r, name: r.name ?? "" })) as InventoryStore[];
      }),
    { permission: "inventory.count" }
  )
  .get("/inventory/periods", () => ({ periods: allowedPeriods(new Date()) }), {
    permission: "inventory.count",
  });

// Как tickets/cash_shifts: после apiController накопленный тип роутов у
// предела глубины TS (TS2589), поэтому тип расширяем. Фронт ходит через
// admin/lib/inventory-api.ts с типами из ./types.
export const inventoryController = inventoryControllerImpl as unknown as Elysia;
```

- [ ] **Step 4: Регистрация в `backend/src/app.ts`**

Рядом с прочими импортами добавить:
```ts
import { inventoryController } from "./modules/inventory/controller";
```
В цепочке после `.use(ticketsBotController)` и до `.use(apiController)` добавить:
```ts
  .use(inventoryController)
```

- [ ] **Step 5: Написать харнесс и первые падающие тесты `routes.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в tickets/routes.test.ts: голый `bun test` этот файл
// пропускает, а запуск через test:http:inventory доходит до fail-fast хелпера.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("inventory (пропущено: запускайте через bun run test:http:inventory)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, closeTestRedis, ensureApp, withSession, sweepTestRoles } = await import("../../../tests/helpers/http");
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { eq, inArray, sql } = await import("drizzle-orm");
  const { allowedPeriods } = await import("./rules");

  type Session = Awaited<ReturnType<typeof withSession>>;

  const PERIOD = allowedPeriods(new Date())[0];

  async function api(s: Session | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = s ? { ...s.headers } : {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await callApi(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  // Мир для одного теста: склад, папки, единица, 3 товара, шаблон из 2 товаров.
  // Всё на случайных uuid, убирается в cleanup().
  async function seedWorld() {
    const orgId = randomUUID();
    const storeId = randomUUID();
    const otherStoreId = randomUUID();
    const unitId = randomUUID();
    const parentGroupId = randomUUID();
    const groupId = randomUUID();
    const p1 = randomUUID(); // в папке «Склад / Мясные продукты»
    const p2 = randomUUID(); // без папки
    const p3 = randomUUID(); // вне шаблона
    const templateId = randomUUID();
    const tag = randomUUID().slice(0, 8);

    await drizzleDb.insert(schema.corporation_store).values([
      { id: storeId, name: `Склад тест ${tag}`, organization_id: orgId, type: "STORE" },
      { id: otherStoreId, name: `Чужой склад ${tag}`, organization_id: orgId, type: "STORE" },
    ]);
    await drizzleDb.insert(schema.measure_unit).values({ id: unitId, name: "кг", code: `kg-${tag}` });
    await drizzleDb.insert(schema.nomenclature_group).values([
      { id: parentGroupId, name: "Склад", deleted: false },
      { id: groupId, name: "Мясные продукты", deleted: false, parent_id: parentGroupId },
    ]);
    await drizzleDb.insert(schema.nomenclature_element).values([
      { id: p1, name: `Говядина ${tag}`, type: "GOODS", mainUnit: unitId, parent_id: groupId, deleted: false },
      { id: p2, name: `Соль ${tag}`, type: "GOODS", mainUnit: unitId, deleted: false },
      { id: p3, name: `Перец ${tag}`, type: "GOODS", mainUnit: unitId, parent_id: groupId, deleted: false },
    ]);
    await drizzleDb.insert(schema.inventory_templates).values({ id: templateId, organization_id: orgId, name: `Месячная ${tag}` });
    await drizzleDb.insert(schema.inventory_template_items).values([
      { template_id: templateId, product_id: p1 },
      { template_id: templateId, product_id: p2 },
    ]);

    const userIds: string[] = [];
    async function bindUser(userId: string, store = storeId) {
      userIds.push(userId);
      await drizzleDb.insert(schema.users_stores).values({ user_id: userId, corporation_store_id: store });
    }

    async function cleanup() {
      const countIds = (
        await drizzleDb
          .select({ id: schema.inventory_counts.id })
          .from(schema.inventory_counts)
          .where(inArray(schema.inventory_counts.store_id, [storeId, otherStoreId]))
      ).map((r) => r.id);
      if (countIds.length) await drizzleDb.delete(schema.inventory_counts).where(inArray(schema.inventory_counts.id, countIds));
      await drizzleDb.delete(schema.inventory_templates).where(eq(schema.inventory_templates.organization_id, orgId));
      if (userIds.length) await drizzleDb.delete(schema.users_stores).where(inArray(schema.users_stores.user_id, userIds));
      await drizzleDb.delete(schema.nomenclature_element).where(inArray(schema.nomenclature_element.id, [p1, p2, p3]));
      await drizzleDb.delete(schema.nomenclature_group).where(inArray(schema.nomenclature_group.id, [groupId, parentGroupId]));
      await drizzleDb.delete(schema.measure_unit).where(eq(schema.measure_unit.id, unitId));
      await drizzleDb.delete(schema.corporation_store).where(inArray(schema.corporation_store.id, [storeId, otherStoreId]));
    }

    return { orgId, storeId, otherStoreId, unitId, groupId, p1, p2, p3, templateId, tag, bindUser, cleanup };
  }

  type World = Awaited<ReturnType<typeof seedWorld>>;

  // Роли. bindStore=true кладёт users_stores на склад мира.
  async function sessionFor(w: World, permissions: string[], bindStore = true) {
    const userId = randomUUID();
    if (bindStore) await w.bindUser(userId);
    return withSession({ permissions, userId });
  }
  const manager = (w: World) => sessionFor(w, ["inventory.count", "inventory.manage"]);
  const helper = (w: World) => sessionFor(w, ["inventory.count"]);
  const office = (w: World) => sessionFor(w, ["inventory.count", "inventory.templates"], false);

  beforeAll(async () => {
    await ensureApp();
  }, 60000);

  afterAll(async () => {
    await sweepTestRoles();
    await closeTestRedis();
  });

  describe("inventory: доступ и склады", () => {
    it("без сессии — 401", async () => {
      const r = await api(null, "GET", "/api/inventory/stores");
      expect(r.status).toBe(401);
    });

    it("без права inventory.count — 403", async () => {
      const s = await withSession({ permissions: ["users.list"] });
      try {
        const r = await api(s, "GET", "/api/inventory/stores");
        expect(r.status).toBe(403);
      } finally {
        await s.cleanup();
      }
    });

    it("отдаёт только свои склады", async () => {
      const w = await seedWorld();
      const s = await helper(w);
      try {
        const r = await api(s, "GET", "/api/inventory/stores");
        expect(r.status).toBe(200);
        expect(r.body.map((x: any) => x.id)).toEqual([w.storeId]);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });

    it("periods отдаёт текущий период первым", async () => {
      const w = await seedWorld();
      const s = await helper(w);
      try {
        const r = await api(s, "GET", "/api/inventory/periods");
        expect(r.status).toBe(200);
        expect(r.body.periods[0]).toBe(PERIOD);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });
  });

  // TASK-4-TESTS
  // TASK-5-TESTS
  // TASK-6-TESTS
  // TASK-7-TESTS
}
```

Маркеры `// TASK-N-TESTS` — места, куда следующие задачи вставляют свои `describe`-блоки. Сами маркеры остаются, пока все задачи не сделаны.

- [ ] **Step 6: Прогнать тесты**

```bash
cd backend
export TEST_DATABASE_URL=$(grep '^DATABASE_URL' .env | cut -d= -f2- | sed 's#/[^/]*$#/managers_tickets_test#')
bun run test:http:inventory
```
Ожидается: 4 pass. Если что-то падает на `insert` в `corporation_store`/`nomenclature_*` из-за NOT NULL-колонки, которой нет в сиде, добавить её в `seedWorld` (смотреть определение таблицы в `schema.ts`) и перезапустить.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/inventory backend/src/app.ts
git commit -m "feat(inventory): каркас контроллера, доступ к складам, HTTP-харнесс

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Создание, список и чтение инвентаризаций

**Files:**
- Create: `backend/src/modules/inventory/counts.ts`
- Modify: `backend/src/modules/inventory/controller.ts`
- Test: `backend/src/modules/inventory/routes.test.ts` (блок вместо `// TASK-4-TESTS`)

**Interfaces:**
- Consumes: `storeAccess`, `canManage`, `Actor`, `DbLike` (Task 3); `allowedPeriods`, `canReopen`, `UUID_RE` (Task 2); типы из `types.ts`.
- Produces (`counts.ts`):
  - `availableTemplates(db, actor, storeId): Promise<InventoryTemplateSummary[]>`
  - `createCount(db, actor, input: { store_id: string; template_id: string; period: string }, now: Date): Promise<{ id: string; existing: boolean }>`
  - `loadCount(db, actor, id: string, now: Date): Promise<InventoryCountDetail>`
  - `listCounts(db, actor, storeId: string): Promise<InventoryCountSummary[]>`
  - `summaries(db, rows): Promise<InventoryCountSummary[]>` — общая сборка прогресса и участников (её использует overview в Task 7)
  - `lockCount(tx, id): Promise<typeof inventory_counts.$inferSelect>`
  - `writeEvent(tx, countId, type, userId, payload?)`
  - `userNames(db, ids: string[]): Promise<Map<string, string>>`
- Роуты: `GET /api/inventory/templates/available?store_id`, `POST /api/inventory/counts`, `GET /api/inventory/counts?store_id`, `GET /api/inventory/counts/:id`.

- [ ] **Step 1: Падающие тесты (вставить вместо `// TASK-4-TESTS`)**

```ts
  describe("inventory: создание и чтение", () => {
    it("available отдаёт активные шаблоны организации склада", async () => {
      const w = await seedWorld();
      const s = await manager(w);
      try {
        const r = await api(s, "GET", `/api/inventory/templates/available?store_id=${w.storeId}`);
        expect(r.status).toBe(200);
        expect(r.body.map((t: any) => t.id)).toContain(w.templateId);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });

    it("создаёт инвентаризацию со строками из шаблона и снимками папок", async () => {
      const w = await seedWorld();
      const s = await manager(w);
      try {
        const c = await api(s, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        expect(c.status).toBe(200);
        expect(c.body.existing).toBe(false);
        const r = await api(s, "GET", `/api/inventory/counts/${c.body.id}`);
        expect(r.status).toBe(200);
        expect(r.body.status).toBe("draft");
        expect(r.body.access).toBe("write");
        expect(r.body.can_manage).toBe(true);
        expect(r.body.lines_total).toBe(2);
        expect(r.body.lines_done).toBe(0);
        const byProduct = Object.fromEntries(r.body.lines.map((l: any) => [l.product_id, l]));
        expect(byProduct[w.p1].group_name).toBe("Склад / Мясные продукты");
        expect(byProduct[w.p1].unit_name).toBe("кг");
        expect(byProduct[w.p2].group_name).toBe("Без группы");
        expect(byProduct[w.p1].total).toBe("0");
        expect(byProduct[w.p1].source).toBe("template");
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });

    it("повторное и параллельное создание дают одну инвентаризацию", async () => {
      const w = await seedWorld();
      const s = await manager(w);
      try {
        const input = { store_id: w.storeId, template_id: w.templateId, period: PERIOD };
        const [a, b] = await Promise.all([
          api(s, "POST", "/api/inventory/counts", input),
          api(s, "POST", "/api/inventory/counts", input),
        ]);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        expect(a.body.id).toBe(b.body.id);
        const again = await api(s, "POST", "/api/inventory/counts", input);
        expect(again.body.id).toBe(a.body.id);
        expect(again.body.existing).toBe(true);
        const rows = await drizzleDb.select().from(schema.inventory_counts).where(eq(schema.inventory_counts.store_id, w.storeId));
        expect(rows.length).toBe(1);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });

    it("недопустимый период — 422, чужой склад — 403, без inventory.manage — 403", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      const h = await helper(w);
      try {
        const bad = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: "2020-01-31" });
        expect(bad.status).toBe(422);
        expect(bad.body.error).toBe("invalid_period");
        const foreign = await api(m, "POST", "/api/inventory/counts", { store_id: w.otherStoreId, template_id: w.templateId, period: PERIOD });
        expect(foreign.status).toBe(403);
        const noManage = await api(h, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        expect(noManage.status).toBe(403);
      } finally {
        await m.cleanup();
        await h.cleanup();
        await w.cleanup();
      }
    });

    it("офис без привязки читает (access: read), чужой помощник получает 403", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      const o = await office(w);
      const stranger = await sessionFor(w, ["inventory.count"], false);
      try {
        const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const ro = await api(o, "GET", `/api/inventory/counts/${c.body.id}`);
        expect(ro.status).toBe(200);
        expect(ro.body.access).toBe("read");
        expect(ro.body.can_manage).toBe(false);
        const denied = await api(stranger, "GET", `/api/inventory/counts/${c.body.id}`);
        expect(denied.status).toBe(403);
        const list = await api(m, "GET", `/api/inventory/counts?store_id=${w.storeId}`);
        expect(list.status).toBe(200);
        expect(list.body.map((x: any) => x.id)).toEqual([c.body.id]);
      } finally {
        await m.cleanup();
        await o.cleanup();
        await stranger.cleanup();
        await w.cleanup();
      }
    });

    it("кривой и несуществующий id — 404", async () => {
      const w = await seedWorld();
      const s = await helper(w);
      try {
        expect((await api(s, "GET", "/api/inventory/counts/not-a-uuid")).status).toBe(404);
        expect((await api(s, "GET", `/api/inventory/counts/${randomUUID()}`)).status).toBe(404);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });

    it("в ответе нет учётных полей iiko", async () => {
      const w = await seedWorld();
      const s = await manager(w);
      try {
        const c = await api(s, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const r = await api(s, "GET", `/api/inventory/counts/${c.body.id}`);
        const text = JSON.stringify(r.body).toLowerCase();
        expect(text.includes("book")).toBe(false);
        expect(text.includes("iiko")).toBe(false);
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });
  });
```

- [ ] **Step 2: Убедиться, что падают**

```bash
cd backend && bun run test:http:inventory
```
Ожидается: новые тесты FAIL (404 на неизвестные роуты), тесты из Task 3 PASS.

- [ ] **Step 3: Написать `counts.ts` (создание и чтение)**

```ts
import {
  corporation_store,
  inventory_count_entries,
  inventory_count_events,
  inventory_count_lines,
  inventory_counts,
  inventory_templates,
  organization,
  users,
} from "backend/drizzle/schema";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { canManage, storeAccess, type Actor, type DbLike } from "./access";
import { InventoryError } from "./errors";
import { allowedPeriods, canReopen, UUID_RE } from "./rules";
import type {
  InventoryCountDetail,
  InventoryCountStatus,
  InventoryCountSummary,
  InventoryEntry,
  InventoryLine,
  InventoryTemplateSummary,
} from "./types";

type CountRow = typeof inventory_counts.$inferSelect;

export function assertUuid(id: string) {
  if (!UUID_RE.test(id)) throw new InventoryError(404, "not_found");
}

export async function lockCount(tx: DbLike, id: string): Promise<CountRow> {
  assertUuid(id);
  const rows = await tx.select().from(inventory_counts).where(eq(inventory_counts.id, id)).for("update");
  if (!rows.length) throw new InventoryError(404, "not_found");
  return rows[0];
}

export async function writeEvent(tx: DbLike, countId: string, type: string, userId: string, payload?: unknown) {
  await tx.insert(inventory_count_events).values({ count_id: countId, type, user_id: userId, payload: payload ?? null });
}

export async function userNames(db: DbLike, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const rows = await db
    .select({ id: users.id, first_name: users.first_name, last_name: users.last_name, login: users.login })
    .from(users)
    .where(inArray(users.id, uniq));
  for (const r of rows) {
    const full = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
    out.set(r.id, full || r.login);
  }
  for (const id of uniq) if (!out.has(id)) out.set(id, "—");
  return out;
}

// Снимок строки: название, единица, папка iiko «Родитель / Папка».
const GROUP_NAME_SQL = sql.raw(
  `case when g.id is null then 'Без группы' when gp.name is null then g.name else gp.name || ' / ' || g.name end`
);

export async function availableTemplates(db: DbLike, actor: Actor, storeId: string): Promise<InventoryTemplateSummary[]> {
  assertUuid(storeId);
  const access = await storeAccess(db, actor, storeId);
  if (access === "none") throw new InventoryError(403, "store_forbidden");
  const [store] = await db.select().from(corporation_store).where(eq(corporation_store.id, storeId));
  if (!store) throw new InventoryError(404, "store_not_found");
  const where = [eq(inventory_templates.active, true)];
  // Склад без организации (новые филиалы) видит все активные шаблоны.
  if (store.organization_id) where.push(eq(inventory_templates.organization_id, store.organization_id));
  const rows = await db
    .select({
      id: inventory_templates.id,
      organization_id: inventory_templates.organization_id,
      organization_name: organization.name,
      name: inventory_templates.name,
      active: inventory_templates.active,
      sort: inventory_templates.sort,
      items_count: sql<number>`(select count(*)::int from inventory_template_items ti where ti.template_id = ${inventory_templates.id})`,
    })
    .from(inventory_templates)
    .leftJoin(organization, eq(organization.id, inventory_templates.organization_id))
    .where(and(...where))
    .orderBy(asc(inventory_templates.sort), asc(inventory_templates.name));
  return rows.map((r) => ({ ...r, organization_name: r.organization_name ?? null }));
}

function isUniqueViolation(e: any): boolean {
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function findActive(db: DbLike, storeId: string, period: string, templateId: string) {
  const [row] = await db
    .select({ id: inventory_counts.id })
    .from(inventory_counts)
    .where(
      and(
        eq(inventory_counts.store_id, storeId),
        eq(inventory_counts.period, period),
        eq(inventory_counts.template_id, templateId),
        ne(inventory_counts.status, "cancelled")
      )
    );
  return row ?? null;
}

export async function createCount(
  db: DbLike,
  actor: Actor,
  input: { store_id: string; template_id: string; period: string },
  now: Date
): Promise<{ id: string; existing: boolean }> {
  assertUuid(input.store_id);
  assertUuid(input.template_id);
  const access = await storeAccess(db, actor, input.store_id);
  if (!canManage(actor, access)) throw new InventoryError(403, "forbidden");
  if (!allowedPeriods(now).includes(input.period)) {
    throw new InventoryError(422, "invalid_period", { allowed: allowedPeriods(now) });
  }
  const [store] = await db.select().from(corporation_store).where(eq(corporation_store.id, input.store_id));
  if (!store) throw new InventoryError(404, "store_not_found");
  const [tpl] = await db.select().from(inventory_templates).where(eq(inventory_templates.id, input.template_id));
  if (!tpl || !tpl.active) throw new InventoryError(422, "template_unavailable");
  if (store.organization_id && store.organization_id !== tpl.organization_id) {
    throw new InventoryError(422, "template_unavailable");
  }

  const existing = await findActive(db, input.store_id, input.period, input.template_id);
  if (existing) return { id: existing.id, existing: true };

  try {
    const id = await db.transaction(async (tx) => {
      const [count] = await tx
        .insert(inventory_counts)
        .values({
          store_id: input.store_id,
          organization_id: store.organization_id ?? tpl.organization_id,
          template_id: tpl.id,
          template_name: tpl.name,
          period: input.period,
          status: "draft",
          created_by: actor.userId,
        })
        .returning({ id: inventory_counts.id });
      await tx.execute(sql`
        insert into inventory_count_lines (count_id, product_id, product_name, unit_id, unit_name, group_id, group_name, source)
        select ${count.id}, n.id, coalesce(n.name, ''), n."mainUnit", mu.name, g.id, ${GROUP_NAME_SQL}, 'template'
        from inventory_template_items ti
        join nomenclature_element n on n.id = ti.product_id
        left join measure_unit mu on mu.id = n."mainUnit"
        left join nomenclature_group g on g.id = n.parent_id
        left join nomenclature_group gp on gp.id = g.parent_id
        where ti.template_id = ${tpl.id}
      `);
      await writeEvent(tx, count.id, "created", actor.userId, { template_id: tpl.id, period: input.period });
      return count.id;
    });
    return { id, existing: false };
  } catch (e) {
    // Гонка двух «Начать»: частичный уникальный индекс отбил вторую вставку.
    if (isUniqueViolation(e)) {
      const row = await findActive(db, input.store_id, input.period, input.template_id);
      if (row) return { id: row.id, existing: true };
    }
    throw e;
  }
}

type SummaryBase = Pick<
  CountRow,
  "id" | "store_id" | "template_id" | "template_name" | "period" | "status" | "created_at" | "submitted_at" | "submitted_by"
> & { store_name: string | null };

const summaryColumns = {
  id: inventory_counts.id,
  store_id: inventory_counts.store_id,
  template_id: inventory_counts.template_id,
  template_name: inventory_counts.template_name,
  period: inventory_counts.period,
  status: inventory_counts.status,
  created_at: inventory_counts.created_at,
  submitted_at: inventory_counts.submitted_at,
  submitted_by: inventory_counts.submitted_by,
  store_name: corporation_store.name,
};

export async function summaries(db: DbLike, rows: SummaryBase[]): Promise<InventoryCountSummary[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const l = inventory_count_lines;
  const progress = await db
    .select({
      count_id: l.count_id,
      total: sql<number>`count(*)::int`,
      done: sql<number>`(count(*) filter (where ${l.skipped} or exists (select 1 from inventory_count_entries e where e.line_id = ${l.id} and e.deleted_at is null)))::int`,
    })
    .from(l)
    .where(inArray(l.count_id, ids))
    .groupBy(l.count_id);
  const progressBy = new Map(progress.map((p) => [p.count_id, p]));

  const parts = await db
    .selectDistinct({ count_id: inventory_count_entries.count_id, user_id: inventory_count_entries.created_by })
    .from(inventory_count_entries)
    .where(and(inArray(inventory_count_entries.count_id, ids), isNull(inventory_count_entries.deleted_at)));
  const names = await userNames(db, [...parts.map((p) => p.user_id), ...rows.map((r) => r.submitted_by ?? "")]);
  const partsBy = new Map<string, string[]>();
  for (const p of parts) {
    const list = partsBy.get(p.count_id) ?? [];
    list.push(names.get(p.user_id) ?? "—");
    partsBy.set(p.count_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    store_id: r.store_id,
    store_name: r.store_name ?? "",
    template_id: r.template_id,
    template_name: r.template_name,
    period: r.period,
    status: r.status as InventoryCountStatus,
    created_at: r.created_at,
    submitted_at: r.submitted_at,
    submitted_by_name: r.submitted_by ? names.get(r.submitted_by) ?? "—" : null,
    lines_total: progressBy.get(r.id)?.total ?? 0,
    lines_done: progressBy.get(r.id)?.done ?? 0,
    participants: (partsBy.get(r.id) ?? []).sort(),
  }));
}

export async function listCounts(db: DbLike, actor: Actor, storeId: string): Promise<InventoryCountSummary[]> {
  assertUuid(storeId);
  if ((await storeAccess(db, actor, storeId)) === "none") throw new InventoryError(403, "store_forbidden");
  const rows = await db
    .select(summaryColumns)
    .from(inventory_counts)
    .leftJoin(corporation_store, eq(corporation_store.id, inventory_counts.store_id))
    .where(and(eq(inventory_counts.store_id, storeId), ne(inventory_counts.status, "cancelled")))
    .orderBy(desc(inventory_counts.period), asc(inventory_counts.template_name));
  return summaries(db, rows);
}

export async function loadCount(db: DbLike, actor: Actor, id: string, now: Date): Promise<InventoryCountDetail> {
  assertUuid(id);
  const [row] = await db
    .select(summaryColumns)
    .from(inventory_counts)
    .leftJoin(corporation_store, eq(corporation_store.id, inventory_counts.store_id))
    .where(eq(inventory_counts.id, id));
  if (!row) throw new InventoryError(404, "not_found");
  const access = await storeAccess(db, actor, row.store_id);
  if (access === "none") throw new InventoryError(403, "store_forbidden");

  const [summary] = await summaries(db, [row]);
  const l = inventory_count_lines;
  const lines = await db
    .select({
      id: l.id,
      product_id: l.product_id,
      product_name: l.product_name,
      unit_name: l.unit_name,
      group_id: l.group_id,
      group_name: l.group_name,
      source: l.source,
      skipped: l.skipped,
      fact_qty: l.fact_qty,
      total: sql<string>`coalesce((select sum(e.qty) from inventory_count_entries e where e.line_id = ${l.id} and e.deleted_at is null), 0)::text`,
    })
    .from(l)
    .where(eq(l.count_id, id))
    .orderBy(asc(l.group_name), asc(l.product_name));

  const e = inventory_count_entries;
  const entries = await db
    .select({ id: e.id, line_id: e.line_id, qty: e.qty, created_by: e.created_by, client_created_at: e.client_created_at })
    .from(e)
    .where(and(eq(e.count_id, id), isNull(e.deleted_at)))
    .orderBy(asc(e.client_created_at));
  const names = await userNames(db, entries.map((x) => x.created_by));
  const entriesBy = new Map<string, InventoryEntry[]>();
  for (const x of entries) {
    const list = entriesBy.get(x.line_id) ?? [];
    list.push({ ...x, qty: String(x.qty), created_by_name: names.get(x.created_by) ?? "—" });
    entriesBy.set(x.line_id, list);
  }

  const manage = canManage(actor, access);
  return {
    ...summary,
    viewer_id: actor.userId,
    access,
    can_manage: manage,
    can_reopen: manage && row.status === "submitted" && canReopen(row.period, now),
    lines: lines.map(
      (x): InventoryLine => ({
        ...x,
        source: x.source as InventoryLine["source"],
        fact_qty: x.fact_qty === null ? null : String(x.fact_qty),
        total: normalizeNumeric(x.total),
        entries: entriesBy.get(x.id) ?? [],
      })
    ),
  };
}

// "5.5000" → "5.5", "0.0000" → "0": numeric из sum() приходит с хвостом нулей.
export function normalizeNumeric(v: string): string {
  if (!v.includes(".")) return v;
  return v.replace(/\.?0+$/, "") || "0";
}
```

- [ ] **Step 4: Роуты в `controller.ts`**

Импорты дополнить:
```ts
import { t } from "elysia";
import { availableTemplates, createCount, listCounts, loadCount } from "./counts";
```
(`import Elysia, { t } from "elysia";` одной строкой.) В цепочку перед `;` добавить:

```ts
  .get(
    "/inventory/templates/available",
    async ({ query, user, role, drizzle, cacheController, set }) =>
      run(set, async () => availableTemplates(drizzle, await actorFrom(cacheController, user, role), query.store_id)),
    { permission: "inventory.count", query: t.Object({ store_id: t.String() }) }
  )
  .post(
    "/inventory/counts",
    async ({ body, user, role, drizzle, cacheController, set }) =>
      run(set, async () => createCount(drizzle, await actorFrom(cacheController, user, role), body, new Date())),
    {
      permission: "inventory.count",
      body: t.Object({ store_id: t.String(), template_id: t.String(), period: t.String() }),
    }
  )
  .get(
    "/inventory/counts",
    async ({ query, user, role, drizzle, cacheController, set }) =>
      run(set, async () => listCounts(drizzle, await actorFrom(cacheController, user, role), query.store_id)),
    { permission: "inventory.count", query: t.Object({ store_id: t.String() }) }
  )
  .get(
    "/inventory/counts/:id",
    async ({ params, user, role, drizzle, cacheController, set }) =>
      run(set, async () => loadCount(drizzle, await actorFrom(cacheController, user, role), params.id, new Date())),
    { permission: "inventory.count", params: t.Object({ id: t.String() }) }
  )
```

`POST /inventory/counts` стоит под `inventory.count`, потому что `inventory.manage` проверяется внутри `createCount` вместе со складом: одно место решает «можно ли управлять этим складом».

- [ ] **Step 5: Тесты проходят**

```bash
cd backend && bun run test:http:inventory
```
Ожидается: все тесты Task 3 и Task 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/inventory
git commit -m "feat(inventory): создание, список и чтение инвентаризаций

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Синхронизация записей, добавление позиции, «не считали»

**Files:**
- Modify: `backend/src/modules/inventory/counts.ts`
- Modify: `backend/src/modules/inventory/controller.ts`
- Test: `backend/src/modules/inventory/routes.test.ts` (блок вместо `// TASK-5-TESTS`)

**Interfaces:**
- Consumes: `lockCount`, `writeEvent`, `assertUuid`, `GROUP_NAME_SQL` (Task 4); `isValidQty`, `UUID_RE` (Task 2); `InventorySyncOp`, `InventorySyncResult`, `InventoryLine` (types).
- Produces:
  - `syncEntries(db, actor, id, ops: InventorySyncOp[]): Promise<InventorySyncResult>`
  - `addLine(db, actor, id, productId): Promise<{ line_id: string; created: boolean }>`
  - `setSkipped(db, actor, id, lineId, skipped: boolean): Promise<{ ok: true }>`
  - `searchProducts(db, q: string, limit: number): Promise<InventoryProduct[]>`
  - `requireWritableDraft(tx, actor, id): Promise<{ row: CountRow; manage: boolean }>`
- Роуты: `POST /api/inventory/counts/:id/entries/sync`, `POST /api/inventory/counts/:id/lines`, `PATCH /api/inventory/counts/:id/lines/:lineId`, `GET /api/inventory/products?q&limit`.

- [ ] **Step 1: Падающие тесты (вставить вместо `// TASK-5-TESTS`)**

```ts
  describe("inventory: синхронизация записей", () => {
    async function startedCount(w: World) {
      const m = await manager(w);
      const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
      const d = await api(m, "GET", `/api/inventory/counts/${c.body.id}`);
      const lineOf = (pid: string) => d.body.lines.find((l: any) => l.product_id === pid).id as string;
      return { m, countId: c.body.id as string, lineOf };
    }
    const add = (line_id: string, qty: number, id = randomUUID()) => ({
      op: "add" as const, id, line_id, qty, client_created_at: new Date().toISOString(),
    });

    it("повтор той же пачки не создаёт дублей, итог — сумма", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        const ops = [add(lineOf(w.p1), 2.5), add(lineOf(w.p1), 3)];
        const r1 = await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops });
        const r2 = await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops });
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(r1.body.applied.length).toBe(2);
        const d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        const line = d.body.lines.find((l: any) => l.product_id === w.p1);
        expect(line.entries.length).toBe(2);
        expect(line.total).toBe("5.5");
        expect(d.body.lines_done).toBe(1);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("add и delete одной записи в одной пачке — 0 живых записей", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        const a = add(lineOf(w.p1), 4);
        const r = await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [a, { op: "delete", id: a.id }] });
        expect(r.body.applied).toEqual([a.id, a.id]);
        const d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.lines.find((l: any) => l.product_id === w.p1).entries.length).toBe(0);
        const raw = await drizzleDb.select().from(schema.inventory_count_entries).where(eq(schema.inventory_count_entries.id, a.id));
        expect(raw[0].deleted_at).not.toBeNull();
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("плохое количество и чужая строка отклоняются по одной, остальное применяется", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        const good = add(lineOf(w.p1), 1);
        const neg = add(lineOf(w.p1), -1);
        const many = add(lineOf(w.p1), 1.23456);
        const foreign = add(randomUUID(), 1);
        const r = await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [good, neg, many, foreign] });
        expect(r.status).toBe(200);
        expect(r.body.applied).toEqual([good.id]);
        expect(r.body.rejected).toEqual([
          { id: neg.id, reason: "invalid_qty" },
          { id: many.id, reason: "invalid_qty" },
          { id: foreign.id, reason: "not_found_line" },
        ]);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("помощник не удаляет чужую запись, менеджер удаляет", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      const h = await helper(w);
      try {
        const mine = add(lineOf(w.p1), 2);
        await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [mine] });
        const hr = await api(h, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [{ op: "delete", id: mine.id }] });
        expect(hr.body.rejected).toEqual([{ id: mine.id, reason: "forbidden" }]);
        const theirs = add(lineOf(w.p2), 1);
        await api(h, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [theirs] });
        const mr = await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [{ op: "delete", id: theirs.id }] });
        expect(mr.body.applied).toEqual([theirs.id]);
      } finally {
        await m.cleanup();
        await h.cleanup();
        await w.cleanup();
      }
    });

    it("офис на чтении получает 403 на sync", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      const o = await office(w);
      try {
        const r = await api(o, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p1), 1)] });
        expect(r.status).toBe(403);
      } finally {
        await m.cleanup();
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("товар вне шаблона добавляется один раз и помечен added", async () => {
      const w = await seedWorld();
      const { m, countId } = await startedCount(w);
      const h = await helper(w);
      try {
        const a = await api(h, "POST", `/api/inventory/counts/${countId}/lines`, { product_id: w.p3 });
        expect(a.status).toBe(200);
        expect(a.body.created).toBe(true);
        const b = await api(h, "POST", `/api/inventory/counts/${countId}/lines`, { product_id: w.p3 });
        expect(b.body.created).toBe(false);
        expect(b.body.line_id).toBe(a.body.line_id);
        const d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        const line = d.body.lines.find((l: any) => l.product_id === w.p3);
        expect(line.source).toBe("added");
        expect(line.group_name).toBe("Склад / Мясные продукты");
        const unknown = await api(h, "POST", `/api/inventory/counts/${countId}/lines`, { product_id: randomUUID() });
        expect(unknown.status).toBe(404);
      } finally {
        await m.cleanup();
        await h.cleanup();
        await w.cleanup();
      }
    });

    it("«не считали» засчитывается в прогресс и снимается", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        const r = await api(m, "PATCH", `/api/inventory/counts/${countId}/lines/${lineOf(w.p2)}`, { skipped: true });
        expect(r.status).toBe(200);
        let d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.lines_done).toBe(1);
        await api(m, "PATCH", `/api/inventory/counts/${countId}/lines/${lineOf(w.p2)}`, { skipped: false });
        d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.lines_done).toBe(0);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("поиск товаров находит по части названия", async () => {
      const w = await seedWorld();
      const s = await helper(w);
      try {
        const r = await api(s, "GET", `/api/inventory/products?q=${encodeURIComponent("Перец " + w.tag)}&limit=10`);
        expect(r.status).toBe(200);
        expect(r.body.map((p: any) => p.id)).toEqual([w.p3]);
        expect(r.body[0].group_name).toBe("Склад / Мясные продукты");
      } finally {
        await s.cleanup();
        await w.cleanup();
      }
    });
  });
```

- [ ] **Step 2: Убедиться, что падают**

```bash
cd backend && bun run test:http:inventory
```
Ожидается: новые тесты FAIL (404), остальные PASS.

- [ ] **Step 3: Дописать в `counts.ts`**

Добавить `isValidQty` — в импорт `./rules`, `InventoryProduct`, `InventorySyncOp`, `InventorySyncResult` — в импорт типов. Затем дописать:

```ts
export async function requireWritableDraft(tx: DbLike, actor: Actor, id: string) {
  const row = await lockCount(tx, id);
  const access = await storeAccess(tx, actor, row.store_id);
  if (access !== "write") throw new InventoryError(403, "store_forbidden");
  if (row.status !== "draft") throw new InventoryError(409, "not_draft", { status: row.status });
  return { row, manage: canManage(actor, access) };
}

export async function syncEntries(db: DbLike, actor: Actor, id: string, ops: InventorySyncOp[]): Promise<InventorySyncResult> {
  return db.transaction(async (tx) => {
    // FOR UPDATE: submit ждёт конца этой пачки, поэтому принятая запись
    // всегда попадает в fact_qty, а пачка после submit получает 409.
    const { manage } = await requireWritableDraft(tx, actor, id);
    const lineRows = await tx
      .select({ id: inventory_count_lines.id })
      .from(inventory_count_lines)
      .where(eq(inventory_count_lines.count_id, id));
    const lineIds = new Set(lineRows.map((r) => r.id));
    const result: InventorySyncResult = { applied: [], rejected: [] };

    for (const op of ops) {
      if (!UUID_RE.test(op.id)) {
        result.rejected.push({ id: op.id, reason: "invalid_id" });
        continue;
      }
      if (op.op === "add") {
        if (!isValidQty(op.qty)) {
          result.rejected.push({ id: op.id, reason: "invalid_qty" });
          continue;
        }
        if (!lineIds.has(op.line_id)) {
          result.rejected.push({ id: op.id, reason: "not_found_line" });
          continue;
        }
        const clientAt = Number.isNaN(Date.parse(op.client_created_at)) ? new Date().toISOString() : op.client_created_at;
        await tx
          .insert(inventory_count_entries)
          .values({
            id: op.id,
            count_id: id,
            line_id: op.line_id,
            qty: String(op.qty),
            created_by: actor.userId,
            client_created_at: clientAt,
          })
          .onConflictDoNothing({ target: inventory_count_entries.id });
        result.applied.push(op.id);
      } else {
        const [entry] = await tx
          .select()
          .from(inventory_count_entries)
          .where(and(eq(inventory_count_entries.id, op.id), eq(inventory_count_entries.count_id, id)));
        if (!entry || entry.deleted_at) {
          result.applied.push(op.id);
          continue;
        }
        if (entry.created_by !== actor.userId && !manage) {
          result.rejected.push({ id: op.id, reason: "forbidden" });
          continue;
        }
        await tx
          .update(inventory_count_entries)
          .set({ deleted_at: sql`now()`, deleted_by: actor.userId })
          .where(eq(inventory_count_entries.id, op.id));
        result.applied.push(op.id);
      }
    }
    return result;
  });
}

export async function addLine(db: DbLike, actor: Actor, id: string, productId: string) {
  assertUuid(productId);
  return db.transaction(async (tx) => {
    await requireWritableDraft(tx, actor, id);
    const inserted = await tx.execute(sql`
      insert into inventory_count_lines (count_id, product_id, product_name, unit_id, unit_name, group_id, group_name, source, added_by)
      select ${id}, n.id, coalesce(n.name, ''), n."mainUnit", mu.name, g.id, ${GROUP_NAME_SQL}, 'added', ${actor.userId}
      from nomenclature_element n
      left join measure_unit mu on mu.id = n."mainUnit"
      left join nomenclature_group g on g.id = n.parent_id
      left join nomenclature_group gp on gp.id = g.parent_id
      where n.id = ${productId} and coalesce(n.deleted, false) = false
      on conflict (count_id, product_id) do nothing
      returning id
    `);
    const newId = (inserted.rows[0] as { id: string } | undefined)?.id;
    if (newId) {
      await writeEvent(tx, id, "line_added", actor.userId, { product_id: productId });
      return { line_id: newId, created: true };
    }
    const [existing] = await tx
      .select({ id: inventory_count_lines.id })
      .from(inventory_count_lines)
      .where(and(eq(inventory_count_lines.count_id, id), eq(inventory_count_lines.product_id, productId)));
    if (!existing) throw new InventoryError(404, "product_not_found");
    return { line_id: existing.id, created: false };
  });
}

export async function setSkipped(db: DbLike, actor: Actor, id: string, lineId: string, skipped: boolean) {
  assertUuid(lineId);
  return db.transaction(async (tx) => {
    await requireWritableDraft(tx, actor, id);
    const updated = await tx
      .update(inventory_count_lines)
      .set({ skipped, skipped_by: skipped ? actor.userId : null })
      .where(and(eq(inventory_count_lines.id, lineId), eq(inventory_count_lines.count_id, id)))
      .returning({ id: inventory_count_lines.id });
    if (!updated.length) throw new InventoryError(404, "line_not_found");
    return { ok: true as const };
  });
}

export async function searchProducts(db: DbLike, q: string, limit: number) {
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await db.execute(sql`
    select n.id, coalesce(n.name, '') as name, mu.name as unit_name, ${GROUP_NAME_SQL} as group_name
    from nomenclature_element n
    left join measure_unit mu on mu.id = n."mainUnit"
    left join nomenclature_group g on g.id = n.parent_id
    left join nomenclature_group gp on gp.id = g.parent_id
    where coalesce(n.deleted, false) = false
      and n.type in ('GOODS', 'PREPARED')
      and n.name ilike ${"%" + term + "%"}
    order by n.name
    limit ${Math.min(Math.max(limit, 1), 50)}
  `);
  return rows.rows as unknown as InventoryProduct[];
}
```

- [ ] **Step 4: Роуты в `controller.ts`**

Дополнить импорт из `./counts`: `addLine, searchProducts, setSkipped, syncEntries`. В цепочку добавить:

```ts
  .post(
    "/inventory/counts/:id/entries/sync",
    async ({ params, body, user, role, drizzle, cacheController, set }) =>
      run(set, async () => syncEntries(drizzle, await actorFrom(cacheController, user, role), params.id, body.ops)),
    {
      permission: "inventory.count",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        ops: t.Array(
          t.Union([
            t.Object({
              op: t.Literal("add"),
              id: t.String(),
              line_id: t.String(),
              qty: t.Number(),
              client_created_at: t.String(),
            }),
            t.Object({ op: t.Literal("delete"), id: t.String() }),
          ]),
          { maxItems: 500 }
        ),
      }),
    }
  )
  .post(
    "/inventory/counts/:id/lines",
    async ({ params, body, user, role, drizzle, cacheController, set }) =>
      run(set, async () => addLine(drizzle, await actorFrom(cacheController, user, role), params.id, body.product_id)),
    { permission: "inventory.count", params: t.Object({ id: t.String() }), body: t.Object({ product_id: t.String() }) }
  )
  .patch(
    "/inventory/counts/:id/lines/:lineId",
    async ({ params, body, user, role, drizzle, cacheController, set }) =>
      run(set, async () =>
        setSkipped(drizzle, await actorFrom(cacheController, user, role), params.id, params.lineId, body.skipped)
      ),
    {
      permission: "inventory.count",
      params: t.Object({ id: t.String(), lineId: t.String() }),
      body: t.Object({ skipped: t.Boolean() }),
    }
  )
  .get(
    "/inventory/products",
    async ({ query, drizzle }) => searchProducts(drizzle, query.q ?? "", Number(query.limit ?? 20)),
    { permission: "inventory.count", query: t.Object({ q: t.Optional(t.String()), limit: t.Optional(t.String()) }) }
  )
```

- [ ] **Step 5: Тесты проходят**

```bash
cd backend && bun run test:http:inventory
```
Ожидается: всё PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/inventory
git commit -m "feat(inventory): идемпотентная синхронизация записей, позиции вне шаблона, «не считали»

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Отправка, возврат в черновик, отмена

**Files:**
- Modify: `backend/src/modules/inventory/counts.ts`
- Modify: `backend/src/modules/inventory/controller.ts`
- Test: `backend/src/modules/inventory/routes.test.ts` (блок вместо `// TASK-6-TESTS`)

**Interfaces:**
- Consumes: `lockCount`, `writeEvent`, `storeAccess`, `canManage`, `nextStatus`, `canReopen`.
- Produces:
  - `submitCount(db, actor, id, skipIncomplete: boolean): Promise<{ ok: true }>`. 422 `{ error: "incomplete", incomplete: number }`
  - `reopenCount(db, actor, id, now: Date): Promise<{ ok: true }>`. 422 `reopen_window_closed`
  - `cancelCount(db, actor, id): Promise<{ ok: true }>`
- Роуты: `POST /api/inventory/counts/:id/submit` `{ skip_incomplete?: boolean }`, `POST …/reopen`, `POST …/cancel`.

- [ ] **Step 1: Падающие тесты (вставить вместо `// TASK-6-TESTS`)**

```ts
  describe("inventory: отправка, возврат, отмена", () => {
    async function startedCount(w: World) {
      const m = await manager(w);
      const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
      const d = await api(m, "GET", `/api/inventory/counts/${c.body.id}`);
      const lineOf = (pid: string) => d.body.lines.find((l: any) => l.product_id === pid).id as string;
      return { m, countId: c.body.id as string, lineOf };
    }
    const add = (line_id: string, qty: number) => ({
      op: "add" as const, id: randomUUID(), line_id, qty, client_created_at: new Date().toISOString(),
    });

    it("незаполненные строки блокируют отправку, skip_incomplete их пропускает", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p1), 2.5), add(lineOf(w.p1), 3)] });
        const blocked = await api(m, "POST", `/api/inventory/counts/${countId}/submit`, {});
        expect(blocked.status).toBe(422);
        expect(blocked.body).toEqual({ error: "incomplete", incomplete: 1 });
        const ok = await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        expect(ok.status).toBe(200);
        const d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.status).toBe("submitted");
        expect(d.body.submitted_at).not.toBeNull();
        const p1 = d.body.lines.find((l: any) => l.product_id === w.p1);
        const p2 = d.body.lines.find((l: any) => l.product_id === w.p2);
        expect(Number(p1.fact_qty)).toBe(5.5);
        expect(p2.skipped).toBe(true);
        expect(p2.fact_qty).toBeNull();
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("после отправки sync — 409, помощник не может отправить", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      const h = await helper(w);
      try {
        const hs = await api(h, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        expect(hs.status).toBe(403);
        await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        const r = await api(h, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p1), 1)] });
        expect(r.status).toBe(409);
        expect(r.body).toEqual({ error: "not_draft", status: "submitted" });
      } finally {
        await m.cleanup();
        await h.cleanup();
        await w.cleanup();
      }
    });

    it("sync и submit одновременно: каждая принятая запись есть в fact_qty", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      const h = await helper(w);
      try {
        await api(m, "PATCH", `/api/inventory/counts/${countId}/lines/${lineOf(w.p2)}`, { skipped: true });
        await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p1), 1)] });
        const batches = Array.from({ length: 8 }, () => [add(lineOf(w.p1), 1), add(lineOf(w.p1), 1)]);
        await Promise.all([
          ...batches.map((ops) => api(h, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops })),
          api(m, "POST", `/api/inventory/counts/${countId}/submit`, {}),
        ]);
        const live = await drizzleDb.execute(sql`
          select coalesce(sum(qty), 0)::numeric as s from inventory_count_entries
          where count_id = ${countId} and deleted_at is null`);
        const [line] = await drizzleDb
          .select()
          .from(schema.inventory_count_lines)
          .where(eq(schema.inventory_count_lines.id, lineOf(w.p1)));
        expect(Number(line.fact_qty)).toBe(Number((live.rows[0] as any).s));
      } finally {
        await m.cleanup();
        await h.cleanup();
        await w.cleanup();
      }
    });

    it("возврат в черновик очищает fact_qty, отмена освобождает место для новой", async () => {
      const w = await seedWorld();
      const { m, countId, lineOf } = await startedCount(w);
      try {
        await api(m, "POST", `/api/inventory/counts/${countId}/entries/sync`, { ops: [add(lineOf(w.p1), 1)] });
        await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        const re = await api(m, "POST", `/api/inventory/counts/${countId}/reopen`, {});
        expect(re.status).toBe(200);
        let d = await api(m, "GET", `/api/inventory/counts/${countId}`);
        expect(d.body.status).toBe("draft");
        expect(d.body.submitted_at).toBeNull();
        expect(d.body.lines.every((l: any) => l.fact_qty === null)).toBe(true);
        const cancel = await api(m, "POST", `/api/inventory/counts/${countId}/cancel`, {});
        expect(cancel.status).toBe(200);
        const again = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        expect(again.status).toBe(200);
        expect(again.body.id).not.toBe(countId);
        const events = await drizzleDb
          .select({ type: schema.inventory_count_events.type })
          .from(schema.inventory_count_events)
          .where(eq(schema.inventory_count_events.count_id, countId));
        expect(events.map((e) => e.type).sort()).toEqual(["cancelled", "created", "reopened", "submitted"]);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("отменить отправленную нельзя — 409", async () => {
      const w = await seedWorld();
      const { m, countId } = await startedCount(w);
      try {
        await api(m, "POST", `/api/inventory/counts/${countId}/submit`, { skip_incomplete: true });
        const r = await api(m, "POST", `/api/inventory/counts/${countId}/cancel`, {});
        expect(r.status).toBe(409);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });
  });
```

- [ ] **Step 2: Убедиться, что падают**

```bash
cd backend && bun run test:http:inventory
```
Ожидается: новые тесты FAIL.

- [ ] **Step 3: Дописать в `counts.ts`**

Добавить `nextStatus` в импорт из `./rules`. Затем:

```ts
async function requireManagedCount(tx: DbLike, actor: Actor, id: string) {
  const row = await lockCount(tx, id);
  const access = await storeAccess(tx, actor, row.store_id);
  if (access === "none") throw new InventoryError(403, "store_forbidden");
  if (!canManage(actor, access)) throw new InventoryError(403, "forbidden");
  return row;
}

export async function submitCount(db: DbLike, actor: Actor, id: string, skipIncomplete: boolean) {
  return db.transaction(async (tx) => {
    const row = await requireManagedCount(tx, actor, id);
    const to = nextStatus("submit", row.status);
    if (!to) throw new InventoryError(409, "not_draft", { status: row.status });

    const l = inventory_count_lines;
    const incomplete = await tx
      .select({ id: l.id })
      .from(l)
      .where(
        and(
          eq(l.count_id, id),
          eq(l.skipped, false),
          sql`not exists (select 1 from inventory_count_entries e where e.line_id = ${l.id} and e.deleted_at is null)`
        )
      );
    if (incomplete.length && !skipIncomplete) {
      throw new InventoryError(422, "incomplete", { incomplete: incomplete.length });
    }
    if (incomplete.length) {
      await tx
        .update(l)
        .set({ skipped: true, skipped_by: actor.userId })
        .where(inArray(l.id, incomplete.map((x) => x.id)));
    }
    // Итог фиксируется в SQL: numeric без JS-float.
    await tx.execute(sql`
      update inventory_count_lines l set fact_qty = (
        select coalesce(sum(e.qty), 0) from inventory_count_entries e
        where e.line_id = l.id and e.deleted_at is null)
      where l.count_id = ${id} and not l.skipped`);
    await tx.execute(sql`update inventory_count_lines set fact_qty = null where count_id = ${id} and skipped`);
    await tx
      .update(inventory_counts)
      .set({ status: to, submitted_by: actor.userId, submitted_at: sql`now()`, updated_at: sql`now()` })
      .where(eq(inventory_counts.id, id));
    await writeEvent(tx, id, "submitted", actor.userId, { auto_skipped: incomplete.length });
    return { ok: true as const };
  });
}

export async function reopenCount(db: DbLike, actor: Actor, id: string, now: Date) {
  return db.transaction(async (tx) => {
    const row = await requireManagedCount(tx, actor, id);
    const to = nextStatus("reopen", row.status);
    if (!to) throw new InventoryError(409, "not_submitted", { status: row.status });
    if (!canReopen(row.period, now)) throw new InventoryError(422, "reopen_window_closed");
    await tx.update(inventory_count_lines).set({ fact_qty: null }).where(eq(inventory_count_lines.count_id, id));
    await tx
      .update(inventory_counts)
      .set({ status: to, submitted_by: null, submitted_at: null, updated_at: sql`now()` })
      .where(eq(inventory_counts.id, id));
    await writeEvent(tx, id, "reopened", actor.userId);
    return { ok: true as const };
  });
}

export async function cancelCount(db: DbLike, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const row = await requireManagedCount(tx, actor, id);
    const to = nextStatus("cancel", row.status);
    if (!to) throw new InventoryError(409, "not_draft", { status: row.status });
    await tx.update(inventory_counts).set({ status: to, updated_at: sql`now()` }).where(eq(inventory_counts.id, id));
    await writeEvent(tx, id, "cancelled", actor.userId);
    return { ok: true as const };
  });
}
```

- [ ] **Step 4: Роуты в `controller.ts`**

Дополнить импорт: `cancelCount, reopenCount, submitCount`. В цепочку добавить:

```ts
  .post(
    "/inventory/counts/:id/submit",
    async ({ params, body, user, role, drizzle, cacheController, set }) =>
      run(set, async () =>
        submitCount(drizzle, await actorFrom(cacheController, user, role), params.id, body?.skip_incomplete === true)
      ),
    {
      permission: "inventory.count",
      params: t.Object({ id: t.String() }),
      body: t.Optional(t.Object({ skip_incomplete: t.Optional(t.Boolean()) })),
    }
  )
  .post(
    "/inventory/counts/:id/reopen",
    async ({ params, user, role, drizzle, cacheController, set }) =>
      run(set, async () => reopenCount(drizzle, await actorFrom(cacheController, user, role), params.id, new Date())),
    { permission: "inventory.count", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/inventory/counts/:id/cancel",
    async ({ params, user, role, drizzle, cacheController, set }) =>
      run(set, async () => cancelCount(drizzle, await actorFrom(cacheController, user, role), params.id)),
    { permission: "inventory.count", params: t.Object({ id: t.String() }) }
  )
```

- [ ] **Step 5: Тесты проходят**

```bash
cd backend && bun run test:http:inventory
```
Ожидается: всё PASS. Если тест одновременности flaky — это баг блокировки, а не теста: проверить, что `syncEntries` и `submitCount` оба начинают с `lockCount` внутри своей транзакции.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/inventory
git commit -m "feat(inventory): отправка с фиксацией fact_qty, возврат в черновик, отмена

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Шаблоны, папки iiko, подсказки, обзор офиса

**Files:**
- Create: `backend/src/modules/inventory/templates.ts`
- Modify: `backend/src/modules/inventory/controller.ts`
- Test: `backend/src/modules/inventory/routes.test.ts` (блок вместо `// TASK-7-TESTS`, затем удалить все маркеры)

**Interfaces:**
- Consumes: `summaries`, `assertUuid`, `InventoryError`, типы.
- Produces (`templates.ts`):
  - `listTemplates(db, organizationId?: string): Promise<InventoryTemplateSummary[]>`
  - `getTemplate(db, id): Promise<InventoryTemplateDetail>`
  - `createTemplate(db, actor, input: { organization_id: string; name: string; active?: boolean; sort?: number }): Promise<{ id: string }>`
  - `updateTemplate(db, id, patch: { name?: string; active?: boolean; sort?: number }): Promise<{ ok: true }>`
  - `deleteTemplate(db, id): Promise<{ ok: true }>`. 409 `in_use`
  - `replaceItems(db, id, productIds: string[]): Promise<{ items_count: number }>`
  - `folders(db): Promise<InventoryFolders>`
  - `suggestions(db, id): Promise<InventorySuggestion[]>`
  - `overview(db, period: string, organizationId?: string): Promise<InventoryOverviewRow[]>`
  - `listOrganizations(db): Promise<{ id: string; name: string }[]>`
- Роуты (все `inventory.templates`): `GET /api/inventory/organizations`, `GET/POST /api/inventory/templates`, `GET/PATCH/DELETE /api/inventory/templates/:id`, `PUT /api/inventory/templates/:id/items`, `GET /api/inventory/templates/:id/suggestions`, `GET /api/inventory/folders`, `GET /api/inventory/overview?period&organization_id`.

- [ ] **Step 1: Падающие тесты (вставить вместо `// TASK-7-TESTS`)**

```ts
  describe("inventory: шаблоны и обзор", () => {
    it("CRUD шаблона и состав закрыты от менеджера", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      try {
        expect((await api(m, "GET", "/api/inventory/templates")).status).toBe(403);
        expect((await api(m, "POST", "/api/inventory/templates", { organization_id: w.orgId, name: "x" })).status).toBe(403);
        expect((await api(m, "GET", "/api/inventory/overview?period=" + PERIOD)).status).toBe(403);
      } finally {
        await m.cleanup();
        await w.cleanup();
      }
    });

    it("создание, состав, чтение, деактивация", async () => {
      const w = await seedWorld();
      const o = await office(w);
      try {
        const c = await api(o, "POST", "/api/inventory/templates", { organization_id: w.orgId, name: `Ежедневная ${w.tag}` });
        expect(c.status).toBe(200);
        const id = c.body.id;
        const put = await api(o, "PUT", `/api/inventory/templates/${id}/items`, { product_ids: [w.p1, w.p3, w.p1] });
        expect(put.body).toEqual({ items_count: 2 });
        const g = await api(o, "GET", `/api/inventory/templates/${id}`);
        expect(g.body.product_ids.sort()).toEqual([w.p1, w.p3].sort());
        expect(g.body.items_count).toBe(2);
        await api(o, "PATCH", `/api/inventory/templates/${id}`, { active: false });
        const list = await api(o, "GET", `/api/inventory/templates?organization_id=${w.orgId}`);
        expect(list.body.find((t: any) => t.id === id).active).toBe(false);
        const del = await api(o, "DELETE", `/api/inventory/templates/${id}`);
        expect(del.status).toBe(200);
      } finally {
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("шаблон с инвентаризациями не удаляется — 409", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      const o = await office(w);
      try {
        await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const r = await api(o, "DELETE", `/api/inventory/templates/${w.templateId}`);
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("in_use");
      } finally {
        await m.cleanup();
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("подсказки — товары, добавленные при пересчёте и не входящие в шаблон", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      const o = await office(w);
      try {
        const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        await api(m, "POST", `/api/inventory/counts/${c.body.id}/lines`, { product_id: w.p3 });
        const s = await api(o, "GET", `/api/inventory/templates/${w.templateId}/suggestions`);
        expect(s.status).toBe(200);
        expect(s.body).toEqual([{ product_id: w.p3, product_name: `Перец ${w.tag}`, times: 1 }]);
      } finally {
        await m.cleanup();
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("организации для редактора шаблонов", async () => {
      const w = await seedWorld();
      const o = await office(w);
      try {
        const r = await api(o, "GET", "/api/inventory/organizations");
        expect(r.status).toBe(200);
        expect(Array.isArray(r.body)).toBe(true);
      } finally {
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("папки отдают группы и товары", async () => {
      const w = await seedWorld();
      const o = await office(w);
      try {
        const r = await api(o, "GET", "/api/inventory/folders");
        expect(r.status).toBe(200);
        expect(r.body.groups.find((g: any) => g.id === w.groupId).parent_id).not.toBeNull();
        expect(r.body.products.find((p: any) => p.id === w.p1).parent_id).toBe(w.groupId);
      } finally {
        await o.cleanup();
        await w.cleanup();
      }
    });

    it("обзор показывает склад с инвентаризацией и склад без неё", async () => {
      const w = await seedWorld();
      const m = await manager(w);
      const o = await office(w);
      try {
        const c = await api(m, "POST", "/api/inventory/counts", { store_id: w.storeId, template_id: w.templateId, period: PERIOD });
        const r = await api(o, "GET", `/api/inventory/overview?period=${PERIOD}&organization_id=${w.orgId}`);
        expect(r.status).toBe(200);
        const mine = r.body.find((x: any) => x.store_id === w.storeId);
        const other = r.body.find((x: any) => x.store_id === w.otherStoreId);
        expect(mine.counts.map((x: any) => x.id)).toEqual([c.body.id]);
        expect(other.counts).toEqual([]);
        const bad = await api(o, "GET", "/api/inventory/overview?period=2026-10-30");
        expect(bad.status).toBe(422);
      } finally {
        await m.cleanup();
        await o.cleanup();
        await w.cleanup();
      }
    });
  });
```

- [ ] **Step 2: Убедиться, что падают**

```bash
cd backend && bun run test:http:inventory
```
Ожидается: новые тесты FAIL.

- [ ] **Step 3: Написать `templates.ts`**

```ts
import {
  corporation_store,
  inventory_count_lines,
  inventory_counts,
  inventory_template_items,
  inventory_templates,
  measure_unit,
  nomenclature_element,
  nomenclature_group,
  organization,
} from "backend/drizzle/schema";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Actor, DbLike } from "./access";
import { assertUuid, summaries } from "./counts";
import { InventoryError } from "./errors";
import { isValidPeriod, UUID_RE } from "./rules";
import type {
  InventoryFolders,
  InventoryOverviewRow,
  InventorySuggestion,
  InventoryTemplateDetail,
  InventoryTemplateSummary,
} from "./types";

const templateColumns = {
  id: inventory_templates.id,
  organization_id: inventory_templates.organization_id,
  organization_name: organization.name,
  name: inventory_templates.name,
  active: inventory_templates.active,
  sort: inventory_templates.sort,
  items_count: sql<number>`(select count(*)::int from inventory_template_items ti where ti.template_id = ${inventory_templates.id})`,
};

export async function listTemplates(db: DbLike, organizationId?: string): Promise<InventoryTemplateSummary[]> {
  const where = organizationId && UUID_RE.test(organizationId) ? eq(inventory_templates.organization_id, organizationId) : undefined;
  const rows = await db
    .select(templateColumns)
    .from(inventory_templates)
    .leftJoin(organization, eq(organization.id, inventory_templates.organization_id))
    .where(where)
    .orderBy(asc(inventory_templates.sort), asc(inventory_templates.name));
  return rows.map((r) => ({ ...r, organization_name: r.organization_name ?? null }));
}

export async function getTemplate(db: DbLike, id: string): Promise<InventoryTemplateDetail> {
  assertUuid(id);
  const [row] = await db
    .select(templateColumns)
    .from(inventory_templates)
    .leftJoin(organization, eq(organization.id, inventory_templates.organization_id))
    .where(eq(inventory_templates.id, id));
  if (!row) throw new InventoryError(404, "not_found");
  const items = await db
    .select({ product_id: inventory_template_items.product_id })
    .from(inventory_template_items)
    .where(eq(inventory_template_items.template_id, id));
  return { ...row, organization_name: row.organization_name ?? null, product_ids: items.map((i) => i.product_id) };
}

export async function createTemplate(
  db: DbLike,
  actor: Actor,
  input: { organization_id: string; name: string; active?: boolean; sort?: number }
) {
  assertUuid(input.organization_id);
  const name = input.name.trim();
  if (!name) throw new InventoryError(422, "name_required");
  const [row] = await db
    .insert(inventory_templates)
    .values({
      organization_id: input.organization_id,
      name,
      active: input.active ?? true,
      sort: input.sort ?? 0,
      created_by: actor.userId,
    })
    .returning({ id: inventory_templates.id });
  return { id: row.id };
}

export async function updateTemplate(db: DbLike, id: string, patch: { name?: string; active?: boolean; sort?: number }) {
  assertUuid(id);
  const set: Partial<typeof inventory_templates.$inferInsert> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new InventoryError(422, "name_required");
    set.name = name;
  }
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sort !== undefined) set.sort = patch.sort;
  const updated = await db
    .update(inventory_templates)
    .set(set)
    .where(eq(inventory_templates.id, id))
    .returning({ id: inventory_templates.id });
  if (!updated.length) throw new InventoryError(404, "not_found");
  return { ok: true as const };
}

export async function deleteTemplate(db: DbLike, id: string) {
  assertUuid(id);
  const [used] = await db
    .select({ id: inventory_counts.id })
    .from(inventory_counts)
    .where(eq(inventory_counts.template_id, id))
    .limit(1);
  if (used) throw new InventoryError(409, "in_use");
  const deleted = await db.delete(inventory_templates).where(eq(inventory_templates.id, id)).returning({ id: inventory_templates.id });
  if (!deleted.length) throw new InventoryError(404, "not_found");
  return { ok: true as const };
}

export async function replaceItems(db: DbLike, id: string, productIds: string[]) {
  assertUuid(id);
  const uniq = [...new Set(productIds)];
  if (uniq.some((p) => !UUID_RE.test(p))) throw new InventoryError(422, "invalid_product_id");
  return db.transaction(async (tx) => {
    const [tpl] = await tx.select({ id: inventory_templates.id }).from(inventory_templates).where(eq(inventory_templates.id, id)).for("update");
    if (!tpl) throw new InventoryError(404, "not_found");
    await tx.delete(inventory_template_items).where(eq(inventory_template_items.template_id, id));
    if (uniq.length) {
      await tx.insert(inventory_template_items).values(uniq.map((product_id) => ({ template_id: id, product_id })));
    }
    await tx.update(inventory_templates).set({ updated_at: new Date().toISOString() }).where(eq(inventory_templates.id, id));
    return { items_count: uniq.length };
  });
}

export async function folders(db: DbLike): Promise<InventoryFolders> {
  const groups = await db
    .select({ id: nomenclature_group.id, name: nomenclature_group.name, parent_id: nomenclature_group.parent_id })
    .from(nomenclature_group)
    .where(eq(nomenclature_group.deleted, false))
    .orderBy(asc(nomenclature_group.name));
  const products = await db
    .select({
      id: nomenclature_element.id,
      name: nomenclature_element.name,
      unit_name: measure_unit.name,
      parent_id: nomenclature_element.parent_id,
    })
    .from(nomenclature_element)
    .leftJoin(measure_unit, eq(measure_unit.id, nomenclature_element.mainUnit))
    .where(
      and(
        sql`coalesce(${nomenclature_element.deleted}, false) = false`,
        inArray(nomenclature_element.type, ["GOODS", "PREPARED"])
      )
    )
    .orderBy(asc(nomenclature_element.name));
  return {
    groups,
    products: products.map((p) => ({ ...p, name: p.name ?? "", unit_name: p.unit_name ?? null })),
  };
}

export async function suggestions(db: DbLike, id: string): Promise<InventorySuggestion[]> {
  assertUuid(id);
  const rows = await db.execute(sql`
    select l.product_id, max(l.product_name) as product_name, count(*)::int as times
    from inventory_count_lines l
    join inventory_counts c on c.id = l.count_id
    where c.template_id = ${id}
      and c.status <> 'cancelled'
      and l.source = 'added'
      and l.product_id not in (select ti.product_id from inventory_template_items ti where ti.template_id = ${id})
    group by l.product_id
    order by times desc, product_name
    limit 50
  `);
  return rows.rows as unknown as InventorySuggestion[];
}

export async function listOrganizations(db: DbLike): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .orderBy(asc(organization.name));
}

export async function overview(db: DbLike, period: string, organizationId?: string): Promise<InventoryOverviewRow[]> {
  if (!isValidPeriod(period)) throw new InventoryError(422, "invalid_period");
  const storeWhere = organizationId && UUID_RE.test(organizationId) ? eq(corporation_store.organization_id, organizationId) : undefined;
  const stores = await db
    .select({ id: corporation_store.id, name: corporation_store.name, organization_id: corporation_store.organization_id })
    .from(corporation_store)
    .where(storeWhere)
    .orderBy(asc(corporation_store.name));
  if (!stores.length) return [];
  const rows = await db
    .select({
      id: inventory_counts.id,
      store_id: inventory_counts.store_id,
      template_id: inventory_counts.template_id,
      template_name: inventory_counts.template_name,
      period: inventory_counts.period,
      status: inventory_counts.status,
      created_at: inventory_counts.created_at,
      submitted_at: inventory_counts.submitted_at,
      submitted_by: inventory_counts.submitted_by,
      store_name: corporation_store.name,
    })
    .from(inventory_counts)
    .leftJoin(corporation_store, eq(corporation_store.id, inventory_counts.store_id))
    .where(
      and(
        eq(inventory_counts.period, period),
        ne(inventory_counts.status, "cancelled"),
        inArray(inventory_counts.store_id, stores.map((s) => s.id))
      )
    );
  const sums = await summaries(db, rows);
  const byStore = new Map<string, typeof sums>();
  for (const s of sums) byStore.set(s.store_id, [...(byStore.get(s.store_id) ?? []), s]);
  return stores.map((s) => ({
    store_id: s.id,
    store_name: s.name ?? "",
    organization_id: s.organization_id,
    counts: byStore.get(s.id) ?? [],
  }));
}
```

- [ ] **Step 4: Роуты в `controller.ts`**

Импорт:
```ts
import {
  createTemplate,
  deleteTemplate,
  folders,
  getTemplate,
  listOrganizations,
  listTemplates,
  overview,
  replaceItems,
  suggestions,
  updateTemplate,
} from "./templates";
```
В цепочку (роут `/inventory/templates/available` из Task 4 уже стоит выше, статический путь Elysia матчит раньше `:id`):

```ts
  .get(
    "/inventory/templates",
    async ({ query, drizzle }) => listTemplates(drizzle, query.organization_id),
    { permission: "inventory.templates", query: t.Object({ organization_id: t.Optional(t.String()) }) }
  )
  .post(
    "/inventory/templates",
    async ({ body, user, role, drizzle, cacheController, set }) =>
      run(set, async () => createTemplate(drizzle, await actorFrom(cacheController, user, role), body)),
    {
      permission: "inventory.templates",
      body: t.Object({
        organization_id: t.String(),
        name: t.String(),
        active: t.Optional(t.Boolean()),
        sort: t.Optional(t.Number()),
      }),
    }
  )
  .get(
    "/inventory/templates/:id",
    async ({ params, drizzle, set }) => run(set, async () => getTemplate(drizzle, params.id)),
    { permission: "inventory.templates", params: t.Object({ id: t.String() }) }
  )
  .patch(
    "/inventory/templates/:id",
    async ({ params, body, drizzle, set }) => run(set, async () => updateTemplate(drizzle, params.id, body)),
    {
      permission: "inventory.templates",
      params: t.Object({ id: t.String() }),
      body: t.Object({ name: t.Optional(t.String()), active: t.Optional(t.Boolean()), sort: t.Optional(t.Number()) }),
    }
  )
  .delete(
    "/inventory/templates/:id",
    async ({ params, drizzle, set }) => run(set, async () => deleteTemplate(drizzle, params.id)),
    { permission: "inventory.templates", params: t.Object({ id: t.String() }) }
  )
  .put(
    "/inventory/templates/:id/items",
    async ({ params, body, drizzle, set }) => run(set, async () => replaceItems(drizzle, params.id, body.product_ids)),
    {
      permission: "inventory.templates",
      params: t.Object({ id: t.String() }),
      body: t.Object({ product_ids: t.Array(t.String(), { maxItems: 5000 }) }),
    }
  )
  .get(
    "/inventory/templates/:id/suggestions",
    async ({ params, drizzle, set }) => run(set, async () => suggestions(drizzle, params.id)),
    { permission: "inventory.templates", params: t.Object({ id: t.String() }) }
  )
  .get("/inventory/folders", async ({ drizzle }) => folders(drizzle), { permission: "inventory.templates" })
  .get("/inventory/organizations", async ({ drizzle }) => listOrganizations(drizzle), { permission: "inventory.templates" })
  .get(
    "/inventory/overview",
    async ({ query, drizzle, set }) => run(set, async () => overview(drizzle, query.period, query.organization_id)),
    { permission: "inventory.templates", query: t.Object({ period: t.String(), organization_id: t.Optional(t.String()) }) }
  )
```

- [ ] **Step 5: Удалить маркеры `// TASK-N-TESTS` из `routes.test.ts`, прогнать всё**

```bash
cd backend && grep -n "TASK-.-TESTS" src/modules/inventory/routes.test.ts   # должно быть пусто после удаления
bun test src/modules/inventory/rules.test.ts && bun run test:http:inventory
```
Ожидается: всё PASS.

- [ ] **Step 6: Проверить, что ничего не сломалось**

```bash
cd backend && bun test src/modules/tickets/ 2>&1 | tail -3
cd ../admin && bunx tsc --noEmit -p . 2>&1 | tail -5
```
Ожидается: тесты tickets в том же состоянии, что до плана (HTTP-тест пропущен, юниты зелёные). `tsc` в admin не даёт новых ошибок (admin импортирует тип `App` из `backend/src/app.ts`; контроллер расширен до `Elysia`, глубина не растёт). Если в `tsc` есть ошибки, сравнить с `git stash`-версией: чинить только новые.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/inventory
git commit -m "feat(inventory): шаблоны, папки iiko, подсказки и обзор офиса

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (сделан при написании)

- **Покрытие спеки:** п. 5 (модель) — Task 1; п. 6 (права, склад на сервере, удаление записей) — Tasks 3–6; п. 7 (API) — Tasks 3–7, плюс добавлены `GET /inventory/periods` и `GET /inventory/templates/available` (менеджеру нужен список шаблонов при старте, а `GET /inventory/templates` закрыт `inventory.templates`); п. 8 (серверная часть синхронизации) — Task 5; п. 10 (пограничные случаи) — тесты Tasks 4–6; п. 11 (проверки) — все задачи. Экраны (п. 9) — план 2.
- **Типы:** `InventorySyncOp`, `InventoryCountDetail`, `Actor`, `DbLike` используются с одинаковыми именами во всех задачах.
- **Расхождения со спекой, внесённые в спеку тем же коммитом:** `organization_id` у инвентаризации nullable; права сидятся скриптом, а не миграцией (как в tickets); офлайн-хранилище — localStorage.
