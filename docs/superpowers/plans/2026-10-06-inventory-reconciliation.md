# Сверка инвентаризаций с iiko — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** офис сравнивает слепой пересчёт из админки (A) с фактом iiko (B) и учётом iiko (C) по каждому складу за месяц, разбирает расхождения и принимает сверку; филиал не может править пересчёт после 2-го числа 12:00 без разблокировки офиса.

**Architecture:** новый подмодуль `backend/src/modules/inventory/reconcile/`. Чистая логика (разбор ответов iiko, выбор документа, расчёт строк) — `pure.ts`, клиент iiko только на чтение — `iiko-client.ts`, работа с БД (этапы 1 и 2) — `service.ts`, запросы для экранов — `read.ts`, очередь BullMQ и статус в Redis — `queue.ts`, обёртка задачи — `job.ts`, маршруты — плагин `routes.ts`, подключённый внутри `inventoryControllerImpl`. Воркер `cron/inventory_reconcile_worker.ts` и расписание в `cron/src/index.ts` вызывают ту же функцию. Срок ввода — в `rules.ts` и `counts.ts` подпроекта 1. Экраны офиса — `admin/app/[locale]/inventory/reconciliation/`.

**Tech Stack:** Bun, Elysia 1.4, Drizzle ORM (node-postgres), PostgreSQL 17 локально, BullMQ 5, node-cron 3, Next.js 15 + React 19, TanStack Query 5, next-intl 4, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-06-inventory-reconciliation-design.md` (подпроект 1: `docs/superpowers/specs/2026-10-02-inventory-counts-design.md`)

## Global Constraints

- Ветка `feature/inventory-reconciliation`. В конце каждого коммита строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Чужие изменения (`.DS_Store`, `admin/.million/store.json`) не добавлять.
- Схема только в `backend/drizzle/schema.ts`. Миграция — `bunx drizzle-kit generate` из `backend/`, применяется **только** к локальным базам `managers` (127.0.0.1) и `managers_tickets_test`. Прод (choparpizza.uz) — только чтение.
- iiko — **только чтение**: `auth`, `logout`, `GET reports/storeOperations`, `POST v2/reports/olap`, `GET v2/reports/balance/stores`. Никаких `documents/import`, `/resto/services/…`, проведений и распроведений. Токен iiko занимает лицензию: `logout` всегда в `finally`.
- Никаких внешних ключей из новых таблиц на `users`, `corporation_store`, `nomenclature_*`. Между новыми таблицами `inventory_*` — можно.
- `numeric` из Drizzle приходит строкой. Числа iiko — JS number: количество округляется до 4 знаков (`round4`), деньги до 2 (`round2`) на каждом шаге расчёта; в БД пишутся строкой.
- Период — строка `YYYY-MM-DD` (последний день месяца). Все календарные правила — Asia/Tashkent (UTC+5, без летнего времени). Время документов и учёта iiko — «наивное» местное время `YYYY-MM-DDTHH:mm:ss` без зоны.
- Срок ввода — 2-е число следующего месяца, 12:00 Asia/Tashkent = 07:00 UTC.
- Филиал (`inventory.count`, `inventory.manage`) никогда не получает цифры iiko: все маршруты сверки — под правом `inventory.reconcile`.
- `permissions.description` — не длиннее 60 символов.
- Тесты с базой запускаются только скриптами `bun run test:http:inventory` и `bun run test:http:reconcile` из `backend/` (база `managers_tickets_test`, `PROJECT_PREFIX=managers_test_`). Перед запуском: `export TEST_DATABASE_URL=$(grep '^DATABASE_URL' .env | cut -d= -f2- | sed 's#/[^/]*$#/managers_tickets_test#')`.
- Тексты интерфейса — через next-intl, все 4 локали (`ru`, `en`, `uz-Latn`, `uz-Cyrl`).
- Реальные выгрузки iiko в репозиторий не коммитить: тестовые данные синтетические.

## Review Focus

- **Документ распровели после загрузки:** следующая загрузка не стирает сохранённые корректировки и строки, ставит «распроведён после загрузки» и пишет `doc_missing` один раз. Пин: тест «документ пропал» в Task 7.
- **Повторное «Загрузить из iiko» во время загрузки:** вторая задача не ставится, ответ 409 `already_running`. Пин: тест в Task 9.
- **Граница срока 2-го числа 12:00 по Ташкенту** (в UTC это 07:00 того же дня; 31.12 → 02.01): до — можно, ровно в срок — нельзя. Пин: юнит-тесты `inputDeadline` / `isInputOpen` / `allowedPeriods` в Task 3 и HTTP-тест «прошлый период закрыт» в Task 4.
- **Два документа «Месяц» на складе или выбор офиса:** статус `needs_choice` с кандидатами; выбранный офисом документ сохраняется при следующих загрузках. Пин: тест в Task 7.
- **Дробные количества (0,1 + 0,2):** B = C + корректировка без хвостов float. Пин: тест `buildLines` с 0.1/0.2 в Task 5.

---

### Task 1: Проверка формулы на всех складах августа (только чтение, без коммита)

Цель — убедиться, что B = учёт за минуту до документа + корректировка, на всех документах «Месяц» за 31.08.2026, а не только на 19004. Код одноразовый, живёт в scratchpad сессии, в репозиторий не попадает.

**Files:**
- Create: `<scratchpad>/formula_check.ts` (scratchpad-каталог сессии из системного промпта)

**Interfaces:**
- Consumes: ничего из репозитория.
- Produces: вывод «stores N, ok N, bad 0». Если `bad > 0` — остановиться и доложить: дизайн этапа 2 зависит от формулы.

- [ ] **Step 1: Написать скрипт**

```ts
// Только чтение iiko. Для каждого документа «Месяц» за 31.08: учёт за минуту до
// документа + корректировка == учёт через минуту после документа, по каждому товару.
import { createHash } from "node:crypto";
const env = Object.fromEntries(
  (await Bun.file("/Users/ilhom/project/managers/managers/backend/.env").text())
    .split("\n").filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")])
);
const BASE = "https://les-ailes-co-co.iiko.it/resto/api";
const pass = /^[0-9a-f]{40}$/i.test(env.IIKO_PASSWORD) ? env.IIKO_PASSWORD : createHash("sha1").update(env.IIKO_PASSWORD).digest("hex");
const key = (await (await fetch(`${BASE}/auth?login=${encodeURIComponent(env.IIKO_LOGIN)}&pass=${pass}`)).text()).trim();
const shift = (at: string, ms: number) => new Date(Date.parse(at + "Z") + ms).toISOString().slice(0, 19);
try {
  const xml = await (await fetch(`${BASE}/reports/storeOperations?key=${key}&dateFrom=31.08.2026&dateTo=31.08.2026&documentTypes=INCOMING_INVENTORY&productDetalization=false`)).text();
  const docs = new Map<string, { num: string; store: string }>();
  for (const m of xml.matchAll(/<storeReportItemDto>([\s\S]*?)<\/storeReportItemDto>/g)) {
    const g = (n: string) => m[1].match(new RegExp(`<${n}>([^<]*)</${n}>`))?.[1] ?? null;
    if (g("type") === "INVENTORY_CORRECTION" && g("documentNum") && /месяц/i.test(g("documentComment") ?? "")) {
      docs.set(g("documentId")!, { num: g("documentNum")!, store: g("primaryStore")! });
    }
  }
  const olap: any = await (await fetch(`${BASE}/v2/reports/olap?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reportType: "TRANSACTIONS", buildSummary: "false",
      groupByRowFields: ["Account.Id", "Document", "DateTime.Typed", "Product.Id"], aggregateFields: ["Amount"],
      filters: {
        "DateTime.DateTyped": { filterType: "DateRange", periodType: "CUSTOM", from: "2026-08-31", to: "2026-09-01", includeLow: true, includeHigh: false },
        TransactionType: { filterType: "IncludeValues", values: ["INVENTORY_CORRECTION"] },
      },
    }),
  })).json();
  let ok = 0; const bad: string[] = [];
  for (const d of docs.values()) {
    const rows = olap.data.filter((r: any) => r["Account.Id"] === d.store && r.Document === d.num);
    const at = rows.map((r: any) => String(r["DateTime.Typed"]).slice(0, 19)).sort().at(-1) ?? "2026-08-31T23:59:00";
    const bal = async (ts: string) => new Map<string, number>(
      ((await (await fetch(`${BASE}/v2/reports/balance/stores?key=${key}&timestamp=${ts}&store=${d.store}`)).json()) as any[])
        .map((x) => [x.product, Number(x.amount)])
    );
    const before = await bal(shift(at, -60_000));
    const after = await bal(shift(at, 60_000));
    const corr = new Map<string, number>(rows.map((r: any) => [r["Product.Id"], Number(r.Amount)]));
    const ids = new Set([...before.keys(), ...after.keys(), ...corr.keys()]);
    const wrong = [...ids].filter((p) => Math.abs((before.get(p) ?? 0) + (corr.get(p) ?? 0) - (after.get(p) ?? 0)) > 1e-4);
    if (wrong.length) bad.push(`${d.num} store ${d.store}: ${wrong.length} products`); else ok++;
  }
  console.log({ stores: docs.size, ok, bad: bad.length }); for (const b of bad) console.log(" ", b);
} finally {
  await fetch(`${BASE}/logout?key=${key}`);
}
```

- [ ] **Step 2: Запустить**

Run: `bun <scratchpad>/formula_check.ts`
Expected: `{ stores: 56, ok: 56, bad: 0 }` (число складов — сколько документов «Месяц» за 31.08; на 06.10.2026 было 56). При `bad > 0` — стоп, доложить список документов.

Коммита нет.

---

### Task 2: Таблицы, миграция, право `inventory.reconcile`, тестовый скрипт

**Files:**
- Modify: `backend/drizzle/schema.ts` (колонка `unlocked_until` в `inventory_counts`; четыре новые таблицы в конце файла)
- Create: `backend/drizzle/migrations/0029_inventory_reconciliation.sql` + `meta/0029_snapshot.json` + правка `meta/_journal.json` (генерируются)
- Modify: `backend/src/modules/inventory/seed-permissions.ts`
- Modify: `backend/package.json` (скрипт `test:http:reconcile`)

**Interfaces:**
- Produces: drizzle-таблицы `inventory_reconciliations`, `inventory_reconciliation_iiko_lines`, `inventory_reconciliation_lines`, `inventory_reconciliation_events`; колонка `inventory_counts.unlocked_until` (timestamptz, mode string); право `inventory.reconcile`; скрипт `bun run test:http:reconcile`.

- [ ] **Step 1: Колонка `unlocked_until` в `inventory_counts`**

В `backend/drizzle/schema.ts`, в определении `inventory_counts` после строки `submitted_at: …,` добавить:

```ts
    // Разблокировка офисом после срока ввода (spec 2026-10-06, §8): до этого момента филиал снова может править.
    unlocked_until: timestamp("unlocked_until", { withTimezone: true, mode: "string" }),
```

- [ ] **Step 2: Новые таблицы в конце `backend/drizzle/schema.ts`**

Все импорты (`pgTable`, `uuid`, `varchar`, `text`, `boolean`, `integer`, `numeric`, `date`, `timestamp`, `jsonb`, `index`, `uniqueIndex`, `primaryKey`, `sql`) уже есть в шапке файла — проверить `grep -n "primaryKey,\|jsonb," backend/drizzle/schema.ts | head`.

```ts
// ── Сверка инвентаризаций с iiko (spec 2026-10-06-inventory-reconciliation-design.md) ──
// Внешних ключей на users/corporation_store/nomenclature_* нет намеренно (как у inventory_counts).

export const inventory_reconciliations = pgTable(
  "inventory_reconciliations",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    store_id: uuid("store_id").notNull(),
    organization_id: uuid("organization_id"),
    period: date("period", { mode: "string" }).notNull(),
    // waiting_iiko / needs_choice / ready / in_review / accepted
    status: varchar("status", { length: 32 }).default("waiting_iiko").notNull(),
    iiko_document_id: uuid("iiko_document_id"),
    iiko_document_num: varchar("iiko_document_num", { length: 64 }),
    iiko_document_comment: varchar("iiko_document_comment", { length: 1024 }),
    // Местное время сервера iiko, без зоны.
    iiko_document_at: timestamp("iiko_document_at", { mode: "string" }),
    // posted / unposted_after_fetch
    iiko_doc_state: varchar("iiko_doc_state", { length: 32 }),
    iiko_candidates: jsonb("iiko_candidates"),
    book_at: timestamp("book_at", { mode: "string" }),
    admin_state: varchar("admin_state", { length: 16 }).default("none").notNull(),
    lines_total: integer("lines_total").default(0).notNull(),
    mismatch_ab_count: integer("mismatch_ab_count").default(0).notNull(),
    diff_ab_sum: numeric("diff_ab_sum", { precision: 18, scale: 2 }),
    diff_ac_sum: numeric("diff_ac_sum", { precision: 18, scale: 2 }),
    diff_bc_sum: numeric("diff_bc_sum", { precision: 18, scale: 2 }),
    fetched_at: timestamp("fetched_at", { withTimezone: true, mode: "string" }),
    fetched_by: uuid("fetched_by"),
    calculated_at: timestamp("calculated_at", { withTimezone: true, mode: "string" }),
    review_comment: text("review_comment"),
    reviewed_by: uuid("reviewed_by"),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
    accepted_totals: jsonb("accepted_totals"),
    changed_after_accept: boolean("changed_after_accept").default(false).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    store_period_uq: uniqueIndex("inventory_reconciliations_store_period_uq").on(t.store_id, t.period),
    period_idx: index("inventory_reconciliations_period_idx").on(t.period),
  })
);

// Корректировки выбранного документа iiko (сырые данные этапа 1).
export const inventory_reconciliation_iiko_lines = pgTable(
  "inventory_reconciliation_iiko_lines",
  {
    reconciliation_id: uuid("reconciliation_id")
      .notNull()
      .references(() => inventory_reconciliations.id, { onDelete: "cascade" }),
    product_id: uuid("product_id").notNull(),
    product_name: varchar("product_name", { length: 255 }).notNull(),
    qty: numeric("qty", { precision: 14, scale: 4 }).notNull(),
    sum: numeric("sum", { precision: 18, scale: 2 }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.reconciliation_id, t.product_id] }) })
);

// Результат этапа 2: строки отчёта сверки.
export const inventory_reconciliation_lines = pgTable(
  "inventory_reconciliation_lines",
  {
    reconciliation_id: uuid("reconciliation_id")
      .notNull()
      .references(() => inventory_reconciliations.id, { onDelete: "cascade" }),
    product_id: uuid("product_id").notNull(),
    product_name: varchar("product_name", { length: 255 }).notNull(),
    unit_name: varchar("unit_name", { length: 255 }),
    group_name: varchar("group_name", { length: 512 }).notNull(),
    // counted / skipped / absent
    admin_state: varchar("admin_state", { length: 16 }).notNull(),
    admin_qty: numeric("admin_qty", { precision: 14, scale: 4 }),
    admin_counts_n: integer("admin_counts_n").default(0).notNull(),
    book_qty: numeric("book_qty", { precision: 14, scale: 4 }).default("0").notNull(),
    book_sum: numeric("book_sum", { precision: 18, scale: 2 }).default("0").notNull(),
    iiko_correction_qty: numeric("iiko_correction_qty", { precision: 14, scale: 4 }).default("0").notNull(),
    iiko_correction_sum: numeric("iiko_correction_sum", { precision: 18, scale: 2 }).default("0").notNull(),
    iiko_fact_qty: numeric("iiko_fact_qty", { precision: 14, scale: 4 }),
    unit_cost: numeric("unit_cost", { precision: 18, scale: 4 }),
    cost_source: varchar("cost_source", { length: 16 }),
    diff_ab_qty: numeric("diff_ab_qty", { precision: 14, scale: 4 }),
    diff_ab_sum: numeric("diff_ab_sum", { precision: 18, scale: 2 }),
    diff_ac_sum: numeric("diff_ac_sum", { precision: 18, scale: 2 }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.reconciliation_id, t.product_id] }) })
);

export const inventory_reconciliation_events = pgTable(
  "inventory_reconciliation_events",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    reconciliation_id: uuid("reconciliation_id")
      .notNull()
      .references(() => inventory_reconciliations.id, { onDelete: "cascade" }),
    // fetched / doc_missing / doc_chosen / calculated / status_changed
    type: varchar("type", { length: 32 }).notNull(),
    user_id: uuid("user_id"),
    payload: jsonb("payload"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({ recon_idx: index("inventory_reconciliation_events_recon_idx").on(t.reconciliation_id) })
);
```

- [ ] **Step 3: Сгенерировать миграцию и проверить SQL**

Run: `cd backend && bunx drizzle-kit generate --name=inventory_reconciliation`
Expected: создан `drizzle/migrations/0029_inventory_reconciliation.sql`. Открыть его: там только `ALTER TABLE "inventory_counts" ADD COLUMN "unlocked_until" …`, четыре `CREATE TABLE "inventory_reconciliation…"`, их индексы и FK между новыми таблицами. Если в файле есть что-то про чужие таблицы — стоп, доложить.

- [ ] **Step 4: Применить к локальной и тестовой базе**

```bash
cd backend && bunx drizzle-kit migrate
DB=$(grep '^DATABASE_URL' .env | cut -d= -f2-)
TEST_URL=$(echo "$DB" | sed 's#/[^/]*$#/managers_tickets_test#')
DATABASE_URL="$TEST_URL" bunx drizzle-kit migrate
psql "$DB" -Atc "select count(*) from pg_tables where tablename like 'inventory_reconciliation%'"
psql "$TEST_URL" -Atc "select count(*) from pg_tables where tablename like 'inventory_reconciliation%'"
```
Expected: обе проверки печатают `4`.

- [ ] **Step 5: Право в сид-скрипте**

В `backend/src/modules/inventory/seed-permissions.ts` в массив `SLUGS` добавить строку:

```ts
  { slug: "inventory.reconcile", description: "Инвентаризация: сверка с iiko, разблокировка ввода" },
```

Run: `cd backend && bun src/modules/inventory/seed-permissions.ts`
Expected: `inserted inventory.reconcile` (или `skip … (exists)`), затем `done`. Это локальная база — прод не трогаем.

- [ ] **Step 6: Тестовый скрипт**

В `backend/package.json`, в `scripts`, после `test:http:inventory` добавить:

```json
    "test:http:reconcile": "PROJECT_PREFIX=managers_test_ INVENTORY_RECONCILE_QUEUE=inventory_reconcile_test DATABASE_URL=$TEST_DATABASE_URL bun test src/modules/inventory/reconcile/",
```

- [ ] **Step 7: Коммит**

```bash
git add backend/drizzle/schema.ts backend/drizzle/migrations/0029_inventory_reconciliation.sql backend/drizzle/migrations/meta/0029_snapshot.json backend/drizzle/migrations/meta/_journal.json backend/src/modules/inventory/seed-permissions.ts backend/package.json
git commit -m "feat(inventory/reconcile): таблицы сверки, unlocked_until, право inventory.reconcile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Срок ввода в `rules.ts`

**Files:**
- Modify: `backend/src/modules/inventory/rules.ts`
- Modify: `backend/src/modules/inventory/rules.test.ts`

**Interfaces:**
- Produces (в `rules.ts`):
  - `inputDeadline(period: string): Date` — 2-е число следующего месяца 12:00 Ташкент;
  - `isInputOpen(period: string, unlockedUntil: string | null, now: Date): boolean`;
  - `allowedPeriods(now: Date): string[]` — прошлый месяц доступен до его `inputDeadline`;
  - `previousPeriod(now: Date): string` — последний день прошлого месяца по Ташкенту;
  - `UNLOCK_HOURS = 24`.
- Удаляются: `PERIOD_GRACE_DAYS`, `canReopen` (единственные потребители — `counts.ts` и `rules.test.ts`, их правит этот и следующий task).

- [ ] **Step 1: Переписать тесты календаря в `rules.test.ts`**

Импорт в начале файла заменить на:

```ts
import { describe, expect, it } from "bun:test";
import {
  allowedPeriods,
  inputDeadline,
  isInputOpen,
  isValidPeriod,
  isValidQty,
  lastDayOfMonth,
  nextStatus,
  previousPeriod,
} from "./rules";
```

Блоки `describe("allowedPeriods (Asia/Tashkent, UTC+5)", …)` и `describe("canReopen", …)` целиком заменить на:

```ts
describe("inputDeadline — 2-е число следующего месяца, 12:00 Ташкент (07:00 UTC)", () => {
  it("октябрь → 2 ноября 07:00Z", () => {
    expect(inputDeadline("2026-10-31").toISOString()).toBe("2026-11-02T07:00:00.000Z");
  });
  it("декабрь → 2 января следующего года", () => {
    expect(inputDeadline("2026-12-31").toISOString()).toBe("2027-01-02T07:00:00.000Z");
  });
  it("февраль високосного года", () => {
    expect(inputDeadline("2028-02-29").toISOString()).toBe("2028-03-02T07:00:00.000Z");
  });
});

describe("isInputOpen", () => {
  it("до срока — открыт", () => {
    expect(isInputOpen("2026-10-31", null, new Date("2026-11-02T06:59:59Z"))).toBe(true);
  });
  it("ровно в срок и позже — закрыт", () => {
    expect(isInputOpen("2026-10-31", null, new Date("2026-11-02T07:00:00Z"))).toBe(false);
    expect(isInputOpen("2026-10-31", null, new Date("2026-11-20T10:00:00Z"))).toBe(false);
  });
  it("разблокировка офиса открывает до unlocked_until", () => {
    const now = new Date("2026-11-10T10:00:00Z");
    expect(isInputOpen("2026-10-31", "2026-11-11T10:00:00Z", now)).toBe(true);
    expect(isInputOpen("2026-10-31", "2026-11-10T10:00:00Z", now)).toBe(false);
    expect(isInputOpen("2026-10-31", "2026-11-09T10:00:00Z", now)).toBe(false);
  });
  it("кривой период — закрыт", () => {
    expect(isInputOpen("2026-10-30", null, new Date("2026-10-01T00:00:00Z"))).toBe(false);
  });
});

describe("allowedPeriods (прошлый месяц — до его срока ввода)", () => {
  it("в середине месяца — только текущий", () => {
    expect(allowedPeriods(new Date("2026-10-15T07:00:00Z"))).toEqual(["2026-10-31"]);
  });
  it("1-е число 03:00 +05 (в UTC ещё 31-е) — новый месяц и прошлый", () => {
    expect(allowedPeriods(new Date("2026-10-31T22:00:00Z"))).toEqual(["2026-11-30", "2026-10-31"]);
  });
  it("2-е 11:59 +05 — прошлый ещё доступен", () => {
    expect(allowedPeriods(new Date("2026-11-02T06:59:00Z"))).toEqual(["2026-11-30", "2026-10-31"]);
  });
  it("2-е 12:00 +05 — прошлый уже нет", () => {
    expect(allowedPeriods(new Date("2026-11-02T07:00:00Z"))).toEqual(["2026-11-30"]);
  });
  it("переход через год", () => {
    expect(allowedPeriods(new Date("2027-01-02T06:00:00Z"))).toEqual(["2027-01-31", "2026-12-31"]);
    expect(allowedPeriods(new Date("2027-01-02T07:00:00Z"))).toEqual(["2027-01-31"]);
  });
});

describe("previousPeriod", () => {
  it("прошлый месяц по Ташкенту", () => {
    expect(previousPeriod(new Date("2026-10-06T03:00:00Z"))).toBe("2026-09-30");
    // 1 ноября 02:00 +05 — в UTC ещё 31 октября
    expect(previousPeriod(new Date("2026-10-31T21:00:00Z"))).toBe("2026-10-31");
    expect(previousPeriod(new Date("2027-01-03T03:00:00Z"))).toBe("2026-12-31");
  });
});
```

- [ ] **Step 2: Запустить — тесты падают**

Run: `cd backend && bun test src/modules/inventory/rules.test.ts`
Expected: FAIL — `inputDeadline`/`isInputOpen`/`previousPeriod` не экспортируются.

- [ ] **Step 3: Реализация в `rules.ts`**

Удалить строку `export const PERIOD_GRACE_DAYS = 5;`, функцию `allowedPeriods` и функцию `canReopen` вместе с её комментарием. После функции `isValidPeriod` добавить:

```ts
// Срок ввода (spec 2026-10-06, §8): 2-е число следующего месяца, 12:00 по Ташкенту.
export const DEADLINE_DAY = 2;
export const DEADLINE_HOUR_TASHKENT = 12;
export const UNLOCK_HOURS = 24;

export function inputDeadline(period: string): Date {
  const [py, pm] = period.split("-").map(Number);
  const n = nextMonth(py, pm);
  return new Date(Date.UTC(n.y, n.m - 1, DEADLINE_DAY, DEADLINE_HOUR_TASHKENT) - TASHKENT_OFFSET_MS);
}

/** Филиал может менять пересчёт: до срока или пока действует разблокировка офиса. */
export function isInputOpen(period: string, unlockedUntil: string | null, now: Date): boolean {
  if (!isValidPeriod(period)) return false;
  if (now.getTime() < inputDeadline(period).getTime()) return true;
  return unlockedUntil !== null && Date.parse(unlockedUntil) > now.getTime();
}

/** Периоды, доступные для новой инвентаризации. Первый — текущий месяц, прошлый — до его срока ввода. */
export function allowedPeriods(now: Date): string[] {
  const { y, m } = tashkentParts(now);
  const current = lastDayOfMonth(y, m);
  const prev = previousPeriod(now);
  return now.getTime() < inputDeadline(prev).getTime() ? [current, prev] : [current];
}

/** Последний день прошлого месяца по Ташкенту — период, который сверяет cron. */
export function previousPeriod(now: Date): string {
  const { y, m } = tashkentParts(now);
  const p = prevMonth(y, m);
  return lastDayOfMonth(p.y, p.m);
}
```

`isValidPeriod` объявлена выше и используется в `isInputOpen` — порядок функций в файле не важен (function declarations всплывают), но `const`-константы `DEADLINE_*` должны стоять до первого вызова в рантайме — они на уровне модуля, всё в порядке.

- [ ] **Step 4: Запустить тесты**

Run: `cd backend && bun test src/modules/inventory/rules.test.ts`
Expected: PASS (все describe-блоки, включая неизменённые `nextStatus`, `lastDayOfMonth / isValidPeriod`, `isValidQty`).

`counts.ts` ещё импортирует `canReopen` — он чинится в Task 4, поэтому коммит этой задачи делается вместе с Task 4 (иначе бэкенд не стартует). Перейти к Task 4 без коммита.

---

### Task 4: Срок ввода в пересчётах, разблокировка офисом

**Files:**
- Modify: `backend/src/modules/inventory/counts.ts`
- Modify: `backend/src/modules/inventory/templates.ts:192-203` (select для `overview`)
- Modify: `backend/src/modules/inventory/types.ts`
- Modify: `backend/src/modules/inventory/controller.ts` (маршрут unlock добавит Task 9; здесь — ничего, кроме того что `counts.ts` экспортирует `unlockCount`)
- Modify: `backend/src/modules/inventory/routes.test.ts` (новый describe)
- Modify: `admin/lib/inventory/queue.test.ts:36-40` (фикстура `detail()`)

**Interfaces:**
- Consumes: `inputDeadline`, `isInputOpen`, `UNLOCK_HOURS` из Task 3.
- Produces:
  - `InventoryCountSummary` получает поля `deadline: string` (ISO UTC), `unlocked_until: string | null`, `input_open: boolean`;
  - `unlockCount(db: DbLike, actor: Actor, id: string, now: Date): Promise<{ unlocked_until: string }>` в `counts.ts`;
  - `export const GROUP_NAME_SQL` в `counts.ts` (нужен Task 7);
  - ошибка `422 { error: "input_closed", deadline }` на любой правке после срока.

- [ ] **Step 1: Написать HTTP-тесты срока**

В `backend/src/modules/inventory/routes.test.ts` перед закрывающей `}` ветки `else` (после последнего `describe`) добавить:

```ts
  describe("inventory: срок ввода и разблокировка", () => {
    const PAST = "2026-01-31"; // срок истёк 2026-02-02T07:00Z

    // Пересчёт за прошлый период вставляется напрямую: через API его не создать.
    async function pastCount(w: World, status: "draft" | "submitted", createdBy: string) {
      const [c] = await drizzleDb
        .insert(schema.inventory_counts)
        .values({
          store_id: w.storeId,
          organization_id: w.orgId,
          template_id: w.templateId,
          template_name: "Месячная",
          period: PAST,
          status,
          created_by: createdBy,
        })
        .returning({ id: schema.inventory_counts.id });
      const [line] = await drizzleDb
        .insert(schema.inventory_count_lines)
        .values({ count_id: c.id, product_id: w.p1, product_name: "Говядина", group_name: "Склад", source: "template" })
        .returning({ id: schema.inventory_count_lines.id });
      return { countId: c.id, lineId: line.id };
    }

    const reconciler = (w: World) => sessionFor(w, ["inventory.count", "inventory.reconcile"], false);

    it("после срока: запись, отправка и возврат — 422 input_closed, детали говорят input_open=false", async () => {
      const w = await seedWorld();
      try {
        const m = await manager(w);
        const draft = await pastCount(w, "draft", m.userId);
        const sync = await api(m, "POST", `/api/inventory/counts/${draft.countId}/entries/sync`, {
          ops: [{ op: "add", id: randomUUID(), line_id: draft.lineId, qty: 1, client_created_at: new Date().toISOString() }],
        });
        expect(sync.status).toBe(422);
        expect(sync.body.error).toBe("input_closed");
        expect(sync.body.deadline).toBe("2026-02-02T07:00:00.000Z");

        const submit = await api(m, "POST", `/api/inventory/counts/${draft.countId}/submit`, { skip_incomplete: true });
        expect(submit.status).toBe(422);

        // Уникальный индекс (store, period, template) среди неотменённых: черновик отменяем
        // напрямую в базе, и только потом вставляем отправленный пересчёт.
        await drizzleDb.update(schema.inventory_counts).set({ status: "cancelled" }).where(eq(schema.inventory_counts.id, draft.countId));
        const sent = await pastCount(w, "submitted", m.userId);
        const reopen = await api(m, "POST", `/api/inventory/counts/${sent.countId}/reopen`, {});
        expect(reopen.status).toBe(422);
        expect(reopen.body.error).toBe("input_closed");

        const detail = await api(m, "GET", `/api/inventory/counts/${sent.countId}`);
        expect(detail.status).toBe(200);
        expect(detail.body.input_open).toBe(false);
        expect(detail.body.can_reopen).toBe(false);
        expect(detail.body.deadline).toBe("2026-02-02T07:00:00.000Z");
        expect(detail.body.unlocked_until).toBeNull();
      } finally {
        await w.cleanup();
      }
    });

    it("разблокировка: менеджер филиала — 403, офис с inventory.reconcile — 200, затем ввод снова принимается", async () => {
      const w = await seedWorld();
      try {
        const m = await manager(w);
        const draft = await pastCount(w, "draft", m.userId);

        const denied = await api(m, "POST", `/api/inventory/counts/${draft.countId}/unlock`, {});
        expect(denied.status).toBe(403);

        const o = await reconciler(w);
        const ok = await api(o, "POST", `/api/inventory/counts/${draft.countId}/unlock`, {});
        expect(ok.status).toBe(200);
        expect(Date.parse(ok.body.unlocked_until)).toBeGreaterThan(Date.now() + 23 * 3600_000);

        const sync = await api(m, "POST", `/api/inventory/counts/${draft.countId}/entries/sync`, {
          ops: [{ op: "add", id: randomUUID(), line_id: draft.lineId, qty: 2, client_created_at: new Date().toISOString() }],
        });
        expect(sync.status).toBe(200);
        expect(sync.body.applied.length).toBe(1);

        const events = await drizzleDb
          .select({ type: schema.inventory_count_events.type })
          .from(schema.inventory_count_events)
          .where(eq(schema.inventory_count_events.count_id, draft.countId));
        expect(events.map((e) => e.type)).toContain("unlocked");
      } finally {
        await w.cleanup();
      }
    });

    it("разблокировать отменённый пересчёт нельзя — 409", async () => {
      const w = await seedWorld();
      try {
        const m = await manager(w);
        const draft = await pastCount(w, "draft", m.userId);
        await drizzleDb.update(schema.inventory_counts).set({ status: "cancelled" }).where(eq(schema.inventory_counts.id, draft.countId));
        const o = await reconciler(w);
        const r = await api(o, "POST", `/api/inventory/counts/${draft.countId}/unlock`, {});
        expect(r.status).toBe(409);
      } finally {
        await w.cleanup();
      }
    });
  });
```

Маршрут `/unlock` появляется в Task 9 (плагин сверки). Чтобы эти тесты прошли уже здесь, в Step 4 маршрут временно добавляется прямо в `controller.ts`, а в Task 9 переезжает в плагин.

- [ ] **Step 2: Запустить — тесты падают**

```bash
cd backend && export TEST_DATABASE_URL=$(grep '^DATABASE_URL' .env | cut -d= -f2- | sed 's#/[^/]*$#/managers_tickets_test#')
bun run test:http:inventory 2>&1 | tail -30
```
Expected: FAIL в новом describe (sync на прошлый период даёт 200, `/unlock` — 404). Остальные describe — PASS, кроме тех, что упали из-за импорта `canReopen` — если бэкенд не стартует, сначала Step 3.

- [ ] **Step 3: `counts.ts` — срок ввода**

1. Импорт из `./rules` заменить на:

```ts
import { allowedPeriods, inputDeadline, isInputOpen, isValidQty, nextStatus, UNLOCK_HOURS, UUID_RE } from "./rules";
```

2. `const GROUP_NAME_SQL = sql.raw(` → `export const GROUP_NAME_SQL = sql.raw(`.

3. Добавить хелпер сразу после функции `assertUuid`:

```ts
// Срок ввода (spec 2026-10-06, §8). Ошибка несёт срок, чтобы фронт показал дату.
function assertInputOpen(row: { period: string; unlocked_until: string | null }, now: Date) {
  if (!isInputOpen(row.period, row.unlocked_until, now)) {
    throw new InventoryError(422, "input_closed", { deadline: inputDeadline(row.period).toISOString() });
  }
}
```

4. В `type SummaryBase = Pick<CountRow, …>` добавить в список `| "unlocked_until"`:

```ts
type SummaryBase = Pick<
  CountRow,
  "id" | "store_id" | "template_id" | "template_name" | "period" | "status" | "exord_filtered" | "created_at" | "submitted_at" | "submitted_by" | "unlocked_until"
> & { store_name: string | null };
```

5. В `summaryColumns` добавить `unlocked_until: inventory_counts.unlocked_until,`.

6. Сигнатуру `summaries` сделать `export async function summaries(db: DbLike, rows: SummaryBase[], now: Date = new Date()): Promise<InventoryCountSummary[]>` и в объект, который возвращает `rows.map((r) => ({ … }))`, добавить после `participants`:

```ts
    deadline: inputDeadline(r.period).toISOString(),
    unlocked_until: r.unlocked_until,
    input_open: isInputOpen(r.period, r.unlocked_until, now),
```

7. В `loadCount`: `const [summary] = await summaries(db, [row]);` → `const [summary] = await summaries(db, [row], now);`, а строку `can_reopen: …` заменить на:

```ts
    can_reopen: manage && row.status === "submitted" && summary.input_open,
```

8. `requireWritableDraft` — добавить параметр и проверку:

```ts
export async function requireWritableDraft(tx: DbLike, actor: Actor, id: string, now: Date = new Date()) {
  const row = await lockCount(tx, id);
  const access = await storeAccess(tx, actor, row.store_id);
  if (access !== "write") throw new InventoryError(403, "store_forbidden");
  if (row.status !== "draft") throw new InventoryError(409, "not_draft", { status: row.status });
  assertInputOpen(row, now);
  return { row, manage: canManage(actor, access) };
}
```

9. `submitCount`: сразу после строки `if (!to) throw new InventoryError(409, "not_draft", { status: row.status });` добавить `assertInputOpen(row, new Date());`.

10. `reopenCount`: строку `if (!canReopen(row.period, now)) throw new InventoryError(422, "reopen_window_closed");` заменить на `assertInputOpen(row, now);`.

11. `cancelCount`: после `if (!to) throw …` добавить `assertInputOpen(row, new Date());` — черновик после срока остаётся «не сдано», отменить его может только разблокировка.

12. В конец файла добавить:

```ts
// Офис разблокирует пересчёт после срока на UNLOCK_HOURS (spec 2026-10-06, §8).
// Право inventory.reconcile проверяет маршрут; склад офису привязывать не нужно.
export async function unlockCount(db: DbLike, actor: Actor, id: string, now: Date) {
  return db.transaction(async (tx) => {
    const row = await lockCount(tx, id);
    if (row.status === "cancelled") throw new InventoryError(409, "cancelled");
    const until = new Date(now.getTime() + UNLOCK_HOURS * 3600_000).toISOString();
    await tx.update(inventory_counts).set({ unlocked_until: until, updated_at: sql`now()` }).where(eq(inventory_counts.id, id));
    await writeEvent(tx, id, "unlocked", actor.userId, { until });
    return { unlocked_until: until };
  });
}
```

- [ ] **Step 4: `templates.ts`, `types.ts`, временный маршрут**

В `templates.ts`, в select функции `overview` (рядом с `submitted_by: inventory_counts.submitted_by,`) добавить `unlocked_until: inventory_counts.unlocked_until,`.

В `types.ts`, в `interface InventoryCountSummary` после `participants: string[];` добавить:

```ts
  /** Срок ввода, ISO UTC: 2-е число следующего месяца 12:00 Ташкент. */
  deadline: string;
  /** Разблокировано офисом до этого момента (ISO) или null. */
  unlocked_until: string | null;
  /** Можно ли сейчас менять пересчёт (до срока или разблокирован). */
  input_open: boolean;
```

В `controller.ts`: импорт из `./counts` дополнить `unlockCount`, и перед `.get("/inventory/templates", …)` временно добавить (в Task 9 переедет в плагин):

```ts
  .post(
    "/inventory/counts/:id/unlock",
    async ({ params, user, role, drizzle, cacheController, set }) =>
      run(set, async () => unlockCount(drizzle, await actorFrom(cacheController, user, role), params.id, new Date())),
    { permission: "inventory.reconcile", params: t.Object({ id: t.String() }) }
  )
```

- [ ] **Step 5: Фикстура админки**

В `admin/lib/inventory/queue.test.ts`, в объекте функции `detail()`, после `participants: ["Иван"],` добавить:

```ts
    deadline: "2026-11-02T07:00:00.000Z", unlocked_until: null, input_open: true,
```

- [ ] **Step 6: Запустить все тесты модуля**

```bash
cd backend && bun test src/modules/inventory/rules.test.ts && bun run test:http:inventory 2>&1 | tail -15
cd ../admin && bun test lib/inventory/queue.test.ts
```
Expected: всё PASS, включая новый describe «срок ввода и разблокировка».

- [ ] **Step 7: Коммит (вместе с Task 3)**

```bash
git add backend/src/modules/inventory/rules.ts backend/src/modules/inventory/rules.test.ts backend/src/modules/inventory/counts.ts backend/src/modules/inventory/templates.ts backend/src/modules/inventory/types.ts backend/src/modules/inventory/controller.ts backend/src/modules/inventory/routes.test.ts admin/lib/inventory/queue.test.ts
git commit -m "feat(inventory): срок ввода 2-го 12:00 по Ташкенту и разблокировка офисом

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Типы ответов и чистая логика сверки (`types.ts`, `pure.ts`)

**Files:**
- Create: `backend/src/modules/inventory/reconcile/types.ts`
- Create: `backend/src/modules/inventory/reconcile/pure.ts`
- Test: `backend/src/modules/inventory/reconcile/pure.test.ts`

**Interfaces:**
- Consumes: `lastDayOfMonth` из `../rules`.
- Produces (`types.ts`, без импортов — admin берёт через `import type`): `ReconStatus`, `ReconAdminState`, `ReconLineAdminState`, `ReconDocState`, `ReconCandidate`, `ReconTotals`, `ReconOverviewRow`, `ReconLine`, `ReconEvent`, `ReconBranchEdit`, `ReconCountRef`, `ReconDetail`, `ReconFetchState`, `ReconFetchStatus`.
- Produces (`pure.ts`):
  - `round2(x)`, `round4(x)`, `EPS = 0.00005`;
  - `StoreOpRow`, `parseStoreOperations(xml: string): StoreOpRow[]`;
  - `IikoDoc = { id; num; comment: string | null; store_id; date: "YYYY-MM-DD"; shortage_sum: number; surplus_sum: number }`, `inventoryDocs(rows: StoreOpRow[]): IikoDoc[]`, `isMonthly(comment: string | null): boolean`;
  - `DocChoice`, `pickDocument(docs: IikoDoc[], previousId: string | null): DocChoice`;
  - `Correction`, `parseOlapCorrections(data: Record<string, unknown>[]): Correction[]`, `CorrLine = { product_id; product_name; qty: number; sum: number }`, `correctionsFor(all: Correction[], storeId: string, docNum: string): { at: string | null; lines: CorrLine[] }`;
  - `bookAt(docAt: string | null, period: string): string`, `toIikoTimestamp(s: string): string`, `toIikoDate(date: string): string`, `nextDay(date: string): string`, `previousPeriods(period: string, n: number): string[]`;
  - `BookRow = { product_id; amount: number; sum: number }`, `AdminAgg`, `ProductMeta`, `LineCalc`, `unitCost(...)`, `buildLines(...)`;
  - `TotalsCalc`, `totals(lines: LineCalc[], hasDocument: boolean): TotalsCalc`, `totalsToDb(t: TotalsCalc): ReconTotals`, `sameTotals(a: ReconTotals | null, b: ReconTotals): boolean`;
  - `CorrChange`, `diffCorrections(before: CorrLine[], after: CorrLine[]): CorrChange[]`.

- [ ] **Step 1: `types.ts`**

```ts
// Типы ответов сверки инвентаризаций с iiko. Без импортов: admin подключает файл
// через `import type` из @backend/modules/inventory/reconcile/types, а контроллер
// инвентаризаций экспортирован как `as unknown as Elysia` — Eden эти типы не выведет.
// numeric приходит строкой.

export type ReconStatus = "waiting_iiko" | "needs_choice" | "ready" | "in_review" | "accepted";
export type ReconAdminState = "submitted" | "draft" | "none";
export type ReconLineAdminState = "counted" | "skipped" | "absent";
export type ReconDocState = "posted" | "unposted_after_fetch";

export interface ReconCandidate {
  id: string;
  num: string;
  comment: string | null;
  date: string;
  shortage_sum: number;
  surplus_sum: number;
}

export interface ReconTotals {
  lines_total: number;
  mismatch_ab_count: number;
  diff_ab_sum: string | null;
  diff_ac_sum: string | null;
  diff_bc_sum: string | null;
}

export interface ReconOverviewRow extends ReconTotals {
  id: string;
  store_id: string;
  store_name: string;
  organization_id: string | null;
  period: string;
  status: ReconStatus;
  /** Живое состояние пересчётов админки за период (не снимок). */
  admin_state: ReconAdminState;
  /** Срок ввода периода, ISO UTC — для «не сдано». */
  deadline: string;
  iiko_document_num: string | null;
  iiko_document_comment: string | null;
  iiko_doc_state: ReconDocState | null;
  changed_after_accept: boolean;
  fetched_at: string | null;
  calculated_at: string | null;
}

export interface ReconLine {
  product_id: string;
  product_name: string;
  unit_name: string | null;
  group_name: string;
  admin_state: ReconLineAdminState;
  admin_qty: string | null;
  admin_counts_n: number;
  book_qty: string;
  iiko_correction_qty: string;
  iiko_correction_sum: string;
  iiko_fact_qty: string | null;
  unit_cost: string | null;
  cost_source: "correction" | "balance" | null;
  diff_ab_qty: string | null;
  diff_ab_sum: string | null;
  diff_ac_sum: string | null;
}

export interface ReconEvent {
  id: string;
  type: string;
  user_name: string | null;
  payload: any;
  created_at: string;
}

export type ReconBranchEditKind = "entry_added" | "entry_deleted" | "reopened" | "unlocked";

export interface ReconBranchEdit {
  at: string;
  kind: ReconBranchEditKind;
  user_name: string;
  count_id: string;
  product_name: string | null;
  qty: string | null;
}

export interface ReconCountRef {
  id: string;
  template_name: string;
  status: string;
  unlocked_until: string | null;
  input_open: boolean;
}

export interface ReconDetail extends ReconOverviewRow {
  iiko_document_id: string | null;
  iiko_document_at: string | null;
  book_at: string | null;
  iiko_candidates: ReconCandidate[] | null;
  review_comment: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  accepted_totals: ReconTotals | null;
  counts: ReconCountRef[];
  lines: ReconLine[];
  events: ReconEvent[];
  branch_edits: ReconBranchEdit[];
}

export type ReconFetchState = "idle" | "queued" | "stage1" | "stage2" | "done" | "failed";

export interface ReconFetchStatus {
  period: string;
  store_id: string | null;
  state: ReconFetchState;
  started_at: string | null;
  stage1_done_at: string | null;
  finished_at: string | null;
  received: { store_id: string; store_name: string; num: string }[];
  missing: { store_id: string; store_name: string }[];
  error: string | null;
}
```

- [ ] **Step 2: Написать тесты `pure.test.ts`**

```ts
import { describe, expect, it } from "bun:test";
import {
  bookAt,
  buildLines,
  correctionsFor,
  diffCorrections,
  inventoryDocs,
  isMonthly,
  nextDay,
  parseOlapCorrections,
  parseStoreOperations,
  pickDocument,
  previousPeriods,
  sameTotals,
  toIikoDate,
  toIikoTimestamp,
  totals,
  totalsToDb,
  unitCost,
  type IikoDoc,
} from "./pure";

const S1 = "7e0661d8-0b59-4d57-a66e-6434a9895559";
const S2 = "6cd986d1-d79e-40d8-981d-65e7a2d93328";

function item(fields: Record<string, string>) {
  return `<storeReportItemDto>${Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join("")}</storeReportItemDto>`;
}

describe("parseStoreOperations + inventoryDocs", () => {
  const xml = `<?xml version="1.0"?><storeReportItemDtoes>${[
    item({ sum: "-9905579.000000000", date: "31.08.2026", type: "INVENTORY_CORRECTION", documentId: "d1", documentComment: "Месяц", documentNum: "2115", primaryStore: S1 }),
    item({ sum: "14379599.000000000", date: "31.08.2026", type: "INVENTORY_CORRECTION", documentId: "d1", documentComment: "Месяц", documentNum: "2115", primaryStore: S1 }),
    item({ sum: "-500", date: "31.08.2026", type: "STORE_COST_CORRECTION", documentId: "x1", primaryStore: S1 }),
    item({ sum: "100", date: "31.08.2026", type: "INVENTORY_CORRECTION", documentId: "d2", documentComment: "Склад &amp; кухня", documentNum: "2116", primaryStore: S2 }),
  ].join("")}</storeReportItemDtoes>`;

  it("разбирает строки, дату переводит в YYYY-MM-DD, раскрывает &amp;", () => {
    const rows = parseStoreOperations(xml);
    expect(rows.length).toBe(4);
    expect(rows[0]).toEqual({ document_id: "d1", num: "2115", comment: "Месяц", store_id: S1, date: "2026-08-31", type: "INVENTORY_CORRECTION", sum: -9905579 });
    expect(rows[3].comment).toBe("Склад & кухня");
    expect(rows[2].num).toBeNull();
  });

  it("документ = INVENTORY_CORRECTION с номером; недостача и излишек суммируются отдельно", () => {
    const docs = inventoryDocs(parseStoreOperations(xml));
    expect(docs.map((d) => d.num).sort()).toEqual(["2115", "2116"]);
    const d1 = docs.find((d) => d.num === "2115")!;
    expect(d1.shortage_sum).toBe(-9905579);
    expect(d1.surplus_sum).toBe(14379599);
  });

  it("isMonthly — без учёта регистра, null — нет", () => {
    expect(isMonthly("Месяц")).toBe(true);
    expect(isMonthly("инвентаризация за МЕСЯЦ")).toBe(true);
    expect(isMonthly("Неделя")).toBe(false);
    expect(isMonthly(null)).toBe(false);
  });
});

describe("pickDocument", () => {
  const doc = (id: string, num: string, comment: string | null): IikoDoc => ({
    id, num, comment, store_id: S1, date: "2026-08-31", shortage_sum: 0, surplus_sum: 0,
  });

  it("ровно один «Месяц» — он", () => {
    const c = pickDocument([doc("a", "10", null), doc("b", "11", "Месяц")], null);
    expect(c.kind).toBe("chosen");
    if (c.kind === "chosen") expect(c.doc.id).toBe("b");
  });
  it("два «Месяц» — нужен выбор, кандидаты по номеру", () => {
    const c = pickDocument([doc("b", "12", "Месяц"), doc("a", "9", "месяц")], null);
    expect(c.kind).toBe("needs_choice");
    if (c.kind === "needs_choice") expect(c.candidates.map((d) => d.num)).toEqual(["9", "12"]);
  });
  it("ни одного «Месяц», но есть другие — нужен выбор", () => {
    expect(pickDocument([doc("a", "10", null)], null).kind).toBe("needs_choice");
  });
  it("документов нет — none", () => {
    expect(pickDocument([], null).kind).toBe("none");
  });
  it("ранее выбранный документ сохраняется, даже если «Месяц» другой", () => {
    const c = pickDocument([doc("a", "10", null), doc("b", "11", "Месяц")], "a");
    expect(c.kind).toBe("chosen");
    if (c.kind === "chosen") expect(c.doc.id).toBe("a");
  });
  it("ранее выбранного больше нет — обычные правила", () => {
    const c = pickDocument([doc("b", "11", "Месяц")], "gone");
    expect(c.kind).toBe("chosen");
    if (c.kind === "chosen") expect(c.doc.id).toBe("b");
  });
});

describe("OLAP корректировки", () => {
  const data = [
    { "Account.Id": S1, Document: "2115", "DateTime.Typed": "2026-08-31T23:59:00", "Product.Id": "p1", "Product.Name": "Вода", Amount: 9, "Sum.ResignedSum": 14860 },
    { "Account.Id": S1, Document: "2115", "DateTime.Typed": "2026-08-31T23:59:00", "Product.Id": "p2", "Product.Name": "Упаковка", Amount: -38, "Sum.ResignedSum": -19181 },
    // другая сторона проводки — счёт недостач: в строки склада не попадает
    { "Account.Id": "67af8bc9-628f-2124-2345-3750bb7db6fa", Document: "2115", "DateTime.Typed": "2026-08-31T23:59:00", "Product.Id": "p2", "Product.Name": "Упаковка", Amount: 38, "Sum.ResignedSum": 19181 },
    { "Account.Id": S1, Document: "999", "DateTime.Typed": "2026-08-31T12:00:00", "Product.Id": "p1", "Product.Name": "Вода", Amount: 1, "Sum.ResignedSum": 1 },
  ];
  it("строки склада по номеру документа и время документа", () => {
    const r = correctionsFor(parseOlapCorrections(data), S1, "2115");
    expect(r.at).toBe("2026-08-31T23:59:00");
    expect(r.lines).toEqual([
      { product_id: "p1", product_name: "Вода", qty: 9, sum: 14860 },
      { product_id: "p2", product_name: "Упаковка", qty: -38, sum: -19181 },
    ]);
  });
  it("нет строк — at null", () => {
    expect(correctionsFor(parseOlapCorrections(data), S1, "1").at).toBeNull();
  });
});

describe("даты", () => {
  it("bookAt — минута до документа, без документа — 23:58 периода", () => {
    expect(bookAt("2026-08-31T23:59:00", "2026-08-31")).toBe("2026-08-31T23:58:00");
    expect(bookAt("2026-09-01T00:00:00", "2026-08-31")).toBe("2026-08-31T23:59:00");
    expect(bookAt(null, "2026-09-30")).toBe("2026-09-30T23:58:00");
  });
  it("toIikoTimestamp принимает формат postgres", () => {
    expect(toIikoTimestamp("2026-08-31 23:58:00")).toBe("2026-08-31T23:58:00");
    expect(toIikoTimestamp("2026-08-31T23:58:00")).toBe("2026-08-31T23:58:00");
  });
  it("toIikoDate, nextDay, previousPeriods", () => {
    expect(toIikoDate("2026-08-31")).toBe("31.08.2026");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(previousPeriods("2027-02-28", 3)).toEqual(["2027-01-31", "2026-12-31", "2026-11-30"]);
  });
});

describe("unitCost", () => {
  it("из корректировки, иначе из учёта, иначе нет", () => {
    expect(unitCost({ qty: -38, sum: -19181 }, { amount: 38, sum: 999 })).toEqual({ cost: 504.7632, source: "correction" });
    expect(unitCost({ qty: 0, sum: 0 }, { amount: 2, sum: 10375 })).toEqual({ cost: 5187.5, source: "balance" });
    expect(unitCost(undefined, { amount: -0.052, sum: -7885 })).toEqual({ cost: null, source: null });
    expect(unitCost(undefined, { amount: 3, sum: 0 })).toEqual({ cost: null, source: null });
    expect(unitCost(undefined, undefined)).toEqual({ cost: null, source: null });
  });
});

describe("buildLines + totals", () => {
  const meta = new Map([
    ["p3", { name: "Перец", unit_name: "кг", group_name: "Склад / Приправы" }],
    ["p4", { name: "Стаканы", unit_name: "шт", group_name: "Chopar / Коробки" }],
  ]);

  it("объединение: админка ∪ ненулевой учёт ∪ ненулевая корректировка; B = C + корр", () => {
    const lines = buildLines({
      admin: [
        { product_id: "p1", product_name: "Вода", unit_name: "шт", group_name: "Напитки", qty: 20, state: "counted", counts_n: 1 },
        { product_id: "p2", product_name: "Соль", unit_name: "кг", group_name: "Склад", qty: null, state: "skipped", counts_n: 2 },
      ],
      book: [
        { product_id: "p1", amount: 15, sum: 24765 },
        { product_id: "p3", amount: 0, sum: 0 }, // ноль и не в админке — строки нет
        { product_id: "p4", amount: -43, sum: 0 },
      ],
      corrections: [
        { product_id: "p1", product_name: "Вода", qty: 9, sum: 14860 },
        { product_id: "p4", product_name: "Стаканы", qty: 43, sum: 0 },
      ],
      meta,
    });
    expect(lines.map((l) => l.product_id).sort()).toEqual(["p1", "p2", "p4"]);
    const p1 = lines.find((l) => l.product_id === "p1")!;
    expect(p1.iiko_fact_qty).toBe(24);
    expect(p1.admin_qty).toBe(20);
    expect(p1.diff_ab_qty).toBe(-4);
    expect(p1.unit_cost).toBe(1651.1111);
    expect(p1.cost_source).toBe("correction");
    expect(p1.diff_ab_sum).toBe(-6604.44);
    expect(p1.diff_ac_sum).toBe(8255.56);
    const p2 = lines.find((l) => l.product_id === "p2")!;
    expect(p2.admin_state).toBe("skipped");
    expect(p2.admin_qty).toBeNull();
    expect(p2.diff_ab_qty).toBeNull();
    expect(p2.admin_counts_n).toBe(2);
    const p4 = lines.find((l) => l.product_id === "p4")!;
    expect(p4.admin_state).toBe("absent");
    expect(p4.product_name).toBe("Стаканы");
    expect(p4.iiko_fact_qty).toBe(0);
    expect(p4.unit_cost).toBeNull();

    const t = totals(lines, true);
    expect(t).toEqual({ lines_total: 3, mismatch_ab_count: 1, diff_ab_sum: -6604.44, diff_ac_sum: 8255.56, diff_bc_sum: 14860 });
  });

  it("без документа iiko: B нет, A − C считается", () => {
    const lines = buildLines({
      admin: [{ product_id: "p1", product_name: "Вода", unit_name: "шт", group_name: "Напитки", qty: 10, state: "counted", counts_n: 1 }],
      book: [{ product_id: "p1", amount: 12, sum: 1200 }],
      corrections: null,
      meta,
    });
    expect(lines[0].iiko_fact_qty).toBeNull();
    expect(lines[0].diff_ab_qty).toBeNull();
    expect(lines[0].diff_ac_sum).toBe(-200);
    expect(totals(lines, false).diff_bc_sum).toBeNull();
  });

  it("дроби без хвостов float: 0.1 + 0.2 = 0.3", () => {
    const lines = buildLines({
      admin: [{ product_id: "p1", product_name: "Сироп", unit_name: "л", group_name: "Склад", qty: 0.3, state: "counted", counts_n: 1 }],
      book: [{ product_id: "p1", amount: 0.1, sum: 100 }],
      corrections: [{ product_id: "p1", product_name: "Сироп", qty: 0.2, sum: 200 }],
      meta,
    });
    expect(lines[0].iiko_fact_qty).toBe(0.3);
    expect(lines[0].diff_ab_qty).toBe(0);
    expect(totals(lines, true).mismatch_ab_count).toBe(0);
  });

  it("totalsToDb / sameTotals", () => {
    const a = totalsToDb({ lines_total: 2, mismatch_ab_count: 1, diff_ab_sum: -5, diff_ac_sum: null, diff_bc_sum: 10.5 });
    expect(a).toEqual({ lines_total: 2, mismatch_ab_count: 1, diff_ab_sum: "-5.00", diff_ac_sum: null, diff_bc_sum: "10.50" });
    expect(sameTotals({ ...a, diff_ab_sum: "-5.0" }, a)).toBe(true);
    expect(sameTotals({ ...a, mismatch_ab_count: 2 }, a)).toBe(false);
    expect(sameTotals(null, a)).toBe(false);
  });
});

describe("diffCorrections", () => {
  it("изменённые, новые и пропавшие строки; нулевая vs отсутствующая — не изменение", () => {
    const before = [
      { product_id: "p1", product_name: "Вода", qty: 9, sum: 1 },
      { product_id: "p2", product_name: "Соль", qty: -1, sum: -1 },
      { product_id: "p3", product_name: "Перец", qty: 0, sum: 0 },
    ];
    const after = [
      { product_id: "p1", product_name: "Вода", qty: 7, sum: 1 },
      { product_id: "p4", product_name: "Сахар", qty: 2, sum: 2 },
    ];
    expect(diffCorrections(before, after)).toEqual([
      { product_id: "p1", product_name: "Вода", qty_before: 9, qty_after: 7 },
      { product_id: "p2", product_name: "Соль", qty_before: -1, qty_after: null },
      { product_id: "p4", product_name: "Сахар", qty_before: null, qty_after: 2 },
    ]);
  });
});
```

- [ ] **Step 3: Запустить — падает**

Run: `cd backend && bun test src/modules/inventory/reconcile/pure.test.ts`
Expected: FAIL — `Cannot find module './pure'`.

- [ ] **Step 4: `pure.ts`**

```ts
// Чистая логика сверки (spec 2026-10-06, §3, §5): разбор ответов iiko, выбор
// документа, расчёт строк и итогов. Без БД и сети — всё покрыто pure.test.ts.
import { lastDayOfMonth } from "../rules";
import type { ReconTotals } from "./types";

export const EPS = 0.00005;
export const round4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0; // + 0 убирает -0
export const round2 = (x: number) => Math.round(x * 100) / 100 + 0;

// ── storeOperations ──

export type StoreOpRow = {
  document_id: string;
  num: string | null;
  comment: string | null;
  store_id: string;
  /** YYYY-MM-DD */
  date: string;
  type: string;
  sum: number;
};

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tag(body: string, name: string): string | null {
  const m = body.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? decodeXml(m[1]) : null;
}

/** XML отчёта GET reports/storeOperations → строки. */
export function parseStoreOperations(xml: string): StoreOpRow[] {
  const out: StoreOpRow[] = [];
  for (const m of xml.matchAll(/<storeReportItemDto>([\s\S]*?)<\/storeReportItemDto>/g)) {
    const b = m[1];
    const date = tag(b, "date"); // dd.MM.yyyy
    const id = tag(b, "documentId");
    const store = tag(b, "primaryStore");
    if (!date || !id || !store) continue;
    const [dd, mm, yyyy] = date.split(".");
    out.push({
      document_id: id,
      num: tag(b, "documentNum"),
      comment: tag(b, "documentComment"),
      store_id: store,
      date: `${yyyy}-${mm}-${dd}`,
      type: tag(b, "type") ?? "",
      sum: Number(tag(b, "sum") ?? 0),
    });
  }
  return out;
}

export type IikoDoc = {
  id: string;
  num: string;
  comment: string | null;
  store_id: string;
  date: string;
  shortage_sum: number;
  surplus_sum: number;
};

/** Документы инвентаризации. STORE_COST_CORRECTION без номера — авто-корректировка себестоимости, не документ. */
export function inventoryDocs(rows: StoreOpRow[]): IikoDoc[] {
  const by = new Map<string, IikoDoc>();
  for (const r of rows) {
    if (r.type !== "INVENTORY_CORRECTION" || !r.num) continue;
    const d = by.get(r.document_id) ?? {
      id: r.document_id,
      num: r.num,
      comment: r.comment,
      store_id: r.store_id,
      date: r.date,
      shortage_sum: 0,
      surplus_sum: 0,
    };
    if (r.sum < 0) d.shortage_sum = round2(d.shortage_sum + r.sum);
    else d.surplus_sum = round2(d.surplus_sum + r.sum);
    by.set(r.document_id, d);
  }
  return [...by.values()];
}

export const isMonthly = (comment: string | null) => /месяц/i.test(comment ?? "");

export type DocChoice =
  | { kind: "chosen"; doc: IikoDoc }
  | { kind: "needs_choice"; candidates: IikoDoc[] }
  | { kind: "none" };

/** Выбор документа склада за период (spec §2, п. 5–6). */
export function pickDocument(docs: IikoDoc[], previousId: string | null): DocChoice {
  if (previousId) {
    const prev = docs.find((d) => d.id === previousId);
    if (prev) return { kind: "chosen", doc: prev };
  }
  if (!docs.length) return { kind: "none" };
  const monthly = docs.filter((d) => isMonthly(d.comment));
  if (monthly.length === 1) return { kind: "chosen", doc: monthly[0] };
  return {
    kind: "needs_choice",
    candidates: [...docs].sort((a, b) => a.num.localeCompare(b.num, undefined, { numeric: true })),
  };
}

// ── OLAP TRANSACTIONS / INVENTORY_CORRECTION ──

export type Correction = {
  store_id: string;
  doc_num: string;
  /** YYYY-MM-DDTHH:mm:ss, местное время iiko */
  at: string;
  product_id: string;
  product_name: string;
  qty: number;
  sum: number;
};

export function parseOlapCorrections(data: Record<string, unknown>[]): Correction[] {
  return data
    .filter((r) => r["Account.Id"] && r["Product.Id"] && r["Document"])
    .map((r) => ({
      store_id: String(r["Account.Id"]),
      doc_num: String(r["Document"]),
      at: String(r["DateTime.Typed"] ?? "").slice(0, 19),
      product_id: String(r["Product.Id"]),
      product_name: String(r["Product.Name"] ?? ""),
      qty: Number(r["Amount"] ?? 0),
      sum: Number(r["Sum.ResignedSum"] ?? 0),
    }));
}

export type CorrLine = { product_id: string; product_name: string; qty: number; sum: number };

/** Строки документа со стороны склада (Account.Id = склад) и время документа. */
export function correctionsFor(all: Correction[], storeId: string, docNum: string): { at: string | null; lines: CorrLine[] } {
  const rows = all.filter((r) => r.store_id === storeId && r.doc_num === docNum);
  const by = new Map<string, CorrLine>();
  for (const r of rows) {
    const c = by.get(r.product_id) ?? { product_id: r.product_id, product_name: r.product_name, qty: 0, sum: 0 };
    c.qty = round4(c.qty + r.qty);
    c.sum = round2(c.sum + r.sum);
    by.set(r.product_id, c);
  }
  const at = rows.map((r) => r.at).sort().at(-1) ?? null;
  return { at, lines: [...by.values()] };
}

// ── даты ──

/** Момент учёта C: минута до документа; без документа — 23:58 последнего дня. */
export function bookAt(docAt: string | null, period: string): string {
  if (!docAt) return `${period}T23:58:00`;
  return new Date(Date.parse(`${toIikoTimestamp(docAt)}Z`) - 60_000).toISOString().slice(0, 19);
}

/** "2026-08-31 23:58:00" (postgres) → "2026-08-31T23:58:00". */
export const toIikoTimestamp = (s: string) => s.replace(" ", "T").slice(0, 19);

/** YYYY-MM-DD → dd.MM.yyyy (формат storeOperations). */
export function toIikoDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
}

export function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** n предыдущих периодов (последние дни месяцев), ближайший первым. */
export function previousPeriods(period: string, n: number): string[] {
  let [y, m] = period.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (m === 1) {
      y -= 1;
      m = 12;
    } else {
      m -= 1;
    }
    out.push(lastDayOfMonth(y, m));
  }
  return out;
}

// ── расчёт строк ──

export type BookRow = { product_id: string; amount: number; sum: number };

export type AdminAgg = {
  product_id: string;
  product_name: string;
  unit_name: string | null;
  group_name: string;
  /** Сумма fact_qty по отправленным пересчётам; null — во всех «не считали». */
  qty: number | null;
  state: "counted" | "skipped";
  counts_n: number;
};

export type ProductMeta = { name: string; unit_name: string | null; group_name: string };

export type LineCalc = {
  product_id: string;
  product_name: string;
  unit_name: string | null;
  group_name: string;
  admin_state: "counted" | "skipped" | "absent";
  admin_qty: number | null;
  admin_counts_n: number;
  book_qty: number;
  book_sum: number;
  iiko_correction_qty: number;
  iiko_correction_sum: number;
  iiko_fact_qty: number | null;
  unit_cost: number | null;
  cost_source: "correction" | "balance" | null;
  diff_ab_qty: number | null;
  diff_ab_sum: number | null;
  diff_ac_sum: number | null;
};

/** Цена единицы (spec §2, п. 12). */
export function unitCost(
  corr: { qty: number; sum: number } | undefined,
  book: { amount: number; sum: number } | undefined
): { cost: number | null; source: "correction" | "balance" | null } {
  if (corr && Math.abs(corr.qty) > EPS && corr.sum !== 0) return { cost: round4(corr.sum / corr.qty), source: "correction" };
  if (book && book.amount > EPS && book.sum > 0) return { cost: round4(book.sum / book.amount), source: "balance" };
  return { cost: null, source: null };
}

/** Строки отчёта: админка ∪ ненулевой учёт ∪ ненулевая корректировка. corrections=null — документа iiko нет. */
export function buildLines(input: {
  admin: AdminAgg[];
  book: BookRow[];
  corrections: CorrLine[] | null;
  meta: Map<string, ProductMeta>;
}): LineCalc[] {
  const admin = new Map(input.admin.map((a) => [a.product_id, a]));
  const book = new Map(input.book.map((b) => [b.product_id, b]));
  const corr = new Map((input.corrections ?? []).map((c) => [c.product_id, c]));
  const ids = new Set<string>(admin.keys());
  for (const b of input.book) if (Math.abs(b.amount) > EPS) ids.add(b.product_id);
  for (const c of input.corrections ?? []) if (Math.abs(c.qty) > EPS) ids.add(c.product_id);

  const out: LineCalc[] = [];
  for (const id of ids) {
    const a = admin.get(id);
    const b = book.get(id);
    const c = corr.get(id);
    const m = input.meta.get(id);
    const bookQty = round4(b?.amount ?? 0);
    const corrQty = round4(c?.qty ?? 0);
    const fact = input.corrections === null ? null : round4(bookQty + corrQty);
    const A = a && a.state === "counted" ? a.qty : null;
    const { cost, source } = unitCost(c, b);
    const dAB = A !== null && fact !== null ? round4(A - fact) : null;
    out.push({
      product_id: id,
      product_name: a?.product_name ?? m?.name ?? c?.product_name ?? id,
      unit_name: a?.unit_name ?? m?.unit_name ?? null,
      group_name: a?.group_name ?? m?.group_name ?? "Без группы",
      admin_state: a ? a.state : "absent",
      admin_qty: A,
      admin_counts_n: a?.counts_n ?? 0,
      book_qty: bookQty,
      book_sum: round2(b?.sum ?? 0),
      iiko_correction_qty: corrQty,
      iiko_correction_sum: round2(c?.sum ?? 0),
      iiko_fact_qty: fact,
      unit_cost: cost,
      cost_source: source,
      diff_ab_qty: dAB,
      diff_ab_sum: dAB !== null && cost !== null ? round2(dAB * cost) : null,
      diff_ac_sum: A !== null && cost !== null ? round2((A - bookQty) * cost) : null,
    });
  }
  return out.sort(
    (x, y) => x.group_name.localeCompare(y.group_name, "ru") || x.product_name.localeCompare(y.product_name, "ru")
  );
}

export type TotalsCalc = {
  lines_total: number;
  mismatch_ab_count: number;
  diff_ab_sum: number | null;
  diff_ac_sum: number | null;
  diff_bc_sum: number | null;
};

export function totals(lines: LineCalc[], hasDocument: boolean): TotalsCalc {
  const sum = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? round2(v.reduce((s, x) => s + x, 0)) : null;
  };
  return {
    lines_total: lines.length,
    mismatch_ab_count: lines.filter((l) => l.diff_ab_qty !== null && Math.abs(l.diff_ab_qty) > EPS).length,
    diff_ab_sum: sum(lines.map((l) => l.diff_ab_sum)),
    diff_ac_sum: sum(lines.map((l) => l.diff_ac_sum)),
    diff_bc_sum: hasDocument ? round2(lines.reduce((s, l) => s + l.iiko_correction_sum, 0)) : null,
  };
}

const fmt2 = (x: number | null) => (x === null ? null : x.toFixed(2));

export function totalsToDb(t: TotalsCalc): ReconTotals {
  return {
    lines_total: t.lines_total,
    mismatch_ab_count: t.mismatch_ab_count,
    diff_ab_sum: fmt2(t.diff_ab_sum),
    diff_ac_sum: fmt2(t.diff_ac_sum),
    diff_bc_sum: fmt2(t.diff_bc_sum),
  };
}

export function sameTotals(a: ReconTotals | null, b: ReconTotals): boolean {
  if (!a) return false;
  const n = (x: string | null | undefined) => (x === null || x === undefined ? null : Number(x));
  return (
    a.lines_total === b.lines_total &&
    a.mismatch_ab_count === b.mismatch_ab_count &&
    n(a.diff_ab_sum) === n(b.diff_ab_sum) &&
    n(a.diff_ac_sum) === n(b.diff_ac_sum) &&
    n(a.diff_bc_sum) === n(b.diff_bc_sum)
  );
}

// ── версии корректировок ──

export type CorrChange = { product_id: string; product_name: string; qty_before: number | null; qty_after: number | null };

export function diffCorrections(before: CorrLine[], after: CorrLine[]): CorrChange[] {
  const b = new Map(before.map((x) => [x.product_id, x]));
  const a = new Map(after.map((x) => [x.product_id, x]));
  const out: CorrChange[] = [];
  for (const id of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(id);
    const y = a.get(id);
    if (Math.abs((x?.qty ?? 0) - (y?.qty ?? 0)) <= EPS) continue;
    out.push({ product_id: id, product_name: y?.product_name ?? x?.product_name ?? id, qty_before: x ? x.qty : null, qty_after: y ? y.qty : null });
  }
  return out;
}
```

- [ ] **Step 5: Запустить тесты**

Run: `cd backend && bun test src/modules/inventory/reconcile/pure.test.ts`
Expected: PASS. Если падает `p1.unit_cost` / суммы — пересчитать вручную: 14860 / 9 = 1651.1111; (20 − 24) × 1651.1111 = −6604.44; (20 − 15) × 1651.1111 = 8255.56. Чинить код, а не ожидания.

- [ ] **Step 6: Коммит**

```bash
git add backend/src/modules/inventory/reconcile/types.ts backend/src/modules/inventory/reconcile/pure.ts backend/src/modules/inventory/reconcile/pure.test.ts
git commit -m "feat(inventory/reconcile): чистая логика сверки — документы iiko, B = C + корр., итоги

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Клиент iiko только на чтение (`iiko-client.ts`)

**Files:**
- Create: `backend/src/modules/inventory/reconcile/iiko-client.ts`
- Test: `backend/src/modules/inventory/reconcile/iiko-client.test.ts`

**Interfaces:**
- Consumes: `inventoryDocs`, `parseStoreOperations`, `parseOlapCorrections`, `toIikoDate`, `nextDay`, типы `IikoDoc`, `Correction`, `BookRow` из Task 5.
- Produces:
  - `interface IikoClient { inventoryDocs(date: string): Promise<IikoDoc[]>; corrections(period: string): Promise<Correction[]>; balance(storeId: string, at: string): Promise<BookRow[]> }`;
  - `withIikoClient<T>(fn: (c: IikoClient) => Promise<T>, opts?: IikoClientOptions): Promise<T>`;
  - `passwordHash(p: string): string`, `class IikoError extends Error`.

- [ ] **Step 1: Тесты с подменой fetch**

```ts
import { describe, expect, it } from "bun:test";
import { IikoError, passwordHash, withIikoClient } from "./iiko-client";

type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return routes(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const BASE = "https://iiko.test/resto/api";
const opts = (f: typeof fetch) => ({ base: BASE, login: "api", password: "secret", fetch: f, retries: 1 });

describe("passwordHash", () => {
  it("sha1 от пароля; готовый sha1 не трогает", () => {
    expect(passwordHash("secret")).toBe("e5e9fa1ba31ecd1ae84f75caaa474f3a663f05f4");
    expect(passwordHash("E5E9FA1BA31ECD1AE84F75CAAA474F3A663F05F4")).toBe("e5e9fa1ba31ecd1ae84f75caaa474f3a663f05f4");
  });
});

describe("withIikoClient", () => {
  it("auth → запросы с key → logout; формат дат и тело OLAP", async () => {
    const xml = `<storeReportItemDtoes><storeReportItemDto><sum>-5</sum><date>31.08.2026</date><type>INVENTORY_CORRECTION</type><documentId>d1</documentId><documentComment>Месяц</documentComment><documentNum>2115</documentNum><primaryStore>s1</primaryStore></storeReportItemDto></storeReportItemDtoes>`;
    const { f, calls } = fakeFetch((url) => {
      if (url.includes("/auth?")) return new Response("KEY1");
      if (url.includes("/reports/storeOperations")) return new Response(xml);
      if (url.includes("/v2/reports/olap")) {
        return Response.json({ data: [{ "Account.Id": "s1", Document: "2115", "DateTime.Typed": "2026-08-31T23:59:00", "Product.Id": "p1", "Product.Name": "Вода", Amount: 9, "Sum.ResignedSum": 100 }] });
      }
      if (url.includes("/v2/reports/balance/stores")) return Response.json([{ store: "s1", product: "p1", amount: 15, sum: 300 }]);
      if (url.includes("/logout")) return new Response("");
      return new Response("nope", { status: 404 });
    });

    const res = await withIikoClient(async (c) => ({
      docs: await c.inventoryDocs("2026-08-31"),
      corr: await c.corrections("2026-08-31"),
      bal: await c.balance("s1", "2026-08-31T23:58:00"),
    }), opts(f));

    expect(res.docs).toEqual([{ id: "d1", num: "2115", comment: "Месяц", store_id: "s1", date: "2026-08-31", shortage_sum: -5, surplus_sum: 0 }]);
    expect(res.corr[0]).toEqual({ store_id: "s1", doc_num: "2115", at: "2026-08-31T23:59:00", product_id: "p1", product_name: "Вода", qty: 9, sum: 100 });
    expect(res.bal).toEqual([{ product_id: "p1", amount: 15, sum: 300 }]);

    expect(calls[0].url).toBe(`${BASE}/auth?login=api&pass=e5e9fa1ba31ecd1ae84f75caaa474f3a663f05f4`);
    const ops = calls.find((c) => c.url.includes("storeOperations"))!.url;
    expect(ops).toContain("key=KEY1");
    expect(ops).toContain("dateFrom=31.08.2026&dateTo=31.08.2026");
    expect(ops).toContain("documentTypes=INCOMING_INVENTORY");
    const olap = calls.find((c) => c.url.includes("/v2/reports/olap"))!;
    expect(olap.init?.method).toBe("POST");
    const body = JSON.parse(String(olap.init?.body));
    expect(body.filters["DateTime.DateTyped"]).toEqual({ filterType: "DateRange", periodType: "CUSTOM", from: "2026-08-31", to: "2026-09-01", includeLow: true, includeHigh: false });
    expect(body.filters.TransactionType.values).toEqual(["INVENTORY_CORRECTION"]);
    expect(calls.find((c) => c.url.includes("balance/stores"))!.url).toContain("timestamp=2026-08-31T23%3A58%3A00&store=s1");
    expect(calls.at(-1)!.url).toBe(`${BASE}/logout?key=KEY1`);
  });

  it("logout вызывается, даже если fn бросил", async () => {
    const { f, calls } = fakeFetch((url) => new Response(url.includes("/auth?") ? "K" : ""));
    await expect(withIikoClient(async () => { throw new Error("boom"); }, opts(f))).rejects.toThrow("boom");
    expect(calls.at(-1)!.url).toBe(`${BASE}/logout?key=K`);
  });

  it("5xx повторяется, 4xx — сразу IikoError", async () => {
    let n = 0;
    const { f } = fakeFetch((url) => {
      if (url.includes("/auth?")) return new Response("K");
      if (url.includes("balance")) {
        n++;
        return n === 1 ? new Response("busy", { status: 503 }) : Response.json([]);
      }
      if (url.includes("storeOperations")) return new Response("License", { status: 403 });
      return new Response("");
    });
    await withIikoClient(async (c) => {
      expect(await c.balance("s1", "2026-08-31T23:58:00")).toEqual([]);
      await expect(c.inventoryDocs("2026-08-31")).rejects.toBeInstanceOf(IikoError);
    }, opts(f));
    expect(n).toBe(2);
  });

  it("без логина/пароля — понятная ошибка, сеть не трогается", async () => {
    const { f, calls } = fakeFetch(() => new Response(""));
    await expect(withIikoClient(async () => 1, { base: BASE, fetch: f, login: "", password: "" })).rejects.toThrow("IIKO_LOGIN");
    expect(calls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `cd backend && bun test src/modules/inventory/reconcile/iiko-client.test.ts`
Expected: FAIL — нет модуля.

- [ ] **Step 3: `iiko-client.ts`**

```ts
// Клиент iiko resto API для сверки — ТОЛЬКО ЧТЕНИЕ (spec 2026-10-06, §3).
// Методы: storeOperations (документы с комментарием), OLAP TRANSACTIONS
// (корректировки), balance/stores (учёт). Токен занимает лицензионный слот
// iiko, поэтому один токен на вызов withIikoClient и logout в finally.
import { createHash } from "node:crypto";
import {
  inventoryDocs,
  nextDay,
  parseOlapCorrections,
  parseStoreOperations,
  toIikoDate,
  type BookRow,
  type Correction,
  type IikoDoc,
} from "./pure";

export interface IikoClient {
  /** Проведённые документы инвентаризации за день (YYYY-MM-DD), все склады. */
  inventoryDocs(date: string): Promise<IikoDoc[]>;
  /** Корректировки инвентаризаций за [period, period + 1 день), все склады. */
  corrections(period: string): Promise<Correction[]>;
  /** Учётный остаток склада на момент at (YYYY-MM-DDTHH:mm:ss, местное время iiko). */
  balance(storeId: string, at: string): Promise<BookRow[]>;
}

export type IikoClientOptions = {
  base?: string;
  login?: string;
  password?: string;
  fetch?: typeof fetch;
  retries?: number;
};

export class IikoError extends Error {}

const DEFAULT_BASE = "https://les-ailes-co-co.iiko.it/resto/api";
const TIMEOUT_MS = 120_000;

/** iiko принимает sha1 пароля; в .env бывает и готовый хэш. */
export function passwordHash(p: string): string {
  return /^[0-9a-f]{40}$/i.test(p) ? p.toLowerCase() : createHash("sha1").update(p).digest("hex");
}

export async function withIikoClient<T>(fn: (c: IikoClient) => Promise<T>, opts: IikoClientOptions = {}): Promise<T> {
  const base = opts.base ?? DEFAULT_BASE;
  const f = opts.fetch ?? fetch;
  const login = opts.login ?? process.env.IIKO_LOGIN;
  const password = opts.password ?? process.env.IIKO_PASSWORD;
  const retries = opts.retries ?? 2;
  if (!login || !password) throw new IikoError("IIKO_LOGIN / IIKO_PASSWORD are not set");

  async function request(url: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        if (attempt >= retries) throw new IikoError(`iiko: ${(e as Error).message}`);
        continue;
      }
      if (res.status >= 500 && attempt < retries) continue;
      if (!res.ok) throw new IikoError(`iiko ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return res;
    }
  }

  const auth = await request(`${base}/auth?login=${encodeURIComponent(login)}&pass=${passwordHash(password)}`);
  const key = (await auth.text()).trim();

  const client: IikoClient = {
    async inventoryDocs(date) {
      const d = toIikoDate(date);
      const res = await request(
        `${base}/reports/storeOperations?key=${key}&dateFrom=${d}&dateTo=${d}&documentTypes=INCOMING_INVENTORY&productDetalization=false`
      );
      return inventoryDocs(parseStoreOperations(await res.text()));
    },
    async corrections(period) {
      const body = {
        reportType: "TRANSACTIONS",
        buildSummary: "false",
        groupByRowFields: ["Account.Id", "Document", "DateTime.Typed", "Product.Id", "Product.Name"],
        aggregateFields: ["Amount", "Sum.ResignedSum"],
        filters: {
          "DateTime.DateTyped": {
            filterType: "DateRange",
            periodType: "CUSTOM",
            from: period,
            to: nextDay(period),
            includeLow: true,
            includeHigh: false,
          },
          TransactionType: { filterType: "IncludeValues", values: ["INVENTORY_CORRECTION"] },
        },
      };
      const res = await request(`${base}/v2/reports/olap?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { data?: Record<string, unknown>[] };
      return parseOlapCorrections(j.data ?? []);
    },
    async balance(storeId, at) {
      const res = await request(
        `${base}/v2/reports/balance/stores?key=${key}&timestamp=${encodeURIComponent(at)}&store=${storeId}`
      );
      const j = (await res.json()) as { product: string; amount: number; sum: number }[];
      return j.map((x) => ({ product_id: x.product, amount: Number(x.amount), sum: Number(x.sum) }));
    },
  };

  try {
    return await fn(client);
  } finally {
    try {
      await f(`${base}/logout?key=${key}`);
    } catch {
      // слот освободится по таймауту токена iiko
    }
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `cd backend && bun test src/modules/inventory/reconcile/iiko-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/modules/inventory/reconcile/iiko-client.ts backend/src/modules/inventory/reconcile/iiko-client.test.ts
git commit -m "feat(inventory/reconcile): клиент iiko только на чтение с logout в finally

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Этапы 1 и 2 с базой (`service.ts`)

**Files:**
- Create: `backend/src/modules/inventory/reconcile/service.ts`
- Test: `backend/src/modules/inventory/reconcile/service.test.ts`

**Interfaces:**
- Consumes: `IikoClient` (Task 6), всё из `pure.ts` (Task 5), `GROUP_NAME_SQL` из `../counts` (Task 4), `DbLike` из `../access`, таблицы Task 2.
- Produces:
  - `type RunInput = { period: string; storeId?: string | null; userId?: string | null }`;
  - `type Stage1Result = { scope: string[]; received: { store_id: string; num: string }[]; missing: string[] }`;
  - `computeScope(db, iiko, input): Promise<{ scope: string[]; docs: IikoDoc[] }>`;
  - `runStage1(db, iiko, input): Promise<Stage1Result>`;
  - `runStage2(db, iiko, input: RunInput & { scope: string[] }): Promise<void>`;
  - `type Progress = (patch: Partial<ReconFetchStatus>) => Promise<void>`;
  - `runReconcile(db, iiko, input, progress?): Promise<Stage1Result>`;
  - `storeNames(db, ids: string[]): Promise<Map<string, string>>`.

- [ ] **Step 1: Тесты с фальшивым iiko на тестовой базе**

```ts
import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в inventory/routes.test.ts: голый `bun test` файл пропускает.
// Пул базы не закрываем: routes.test.ts идёт в том же процессе.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;

if (!dbLooksLikeTest) {
  describe.skip("reconcile service (пропущено: запускайте через bun run test:http:reconcile)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { eq, inArray, and } = await import("drizzle-orm");
  const { runReconcile, computeScope } = await import("./service");
  type IikoClient = import("./iiko-client").IikoClient;
  type IikoDoc = import("./pure").IikoDoc;
  type Correction = import("./pure").Correction;

  const PERIOD = "2026-08-31";
  const PREV = "2026-07-31";

  async function seed() {
    const org = randomUUID();
    const A = randomUUID(); // «Месяц» за период
    const B = randomUUID(); // «Месяц» только в прошлом месяце
    const C = randomUUID(); // документ без «Месяц», раньше «Месяц» не было — вне области
    const D = randomUUID(); // только пересчёт в админке
    const [p1, p2, p3] = [randomUUID(), randomUUID(), randomUUID()];
    const unit = randomUUID();
    const user = randomUUID();
    const tag = randomUUID().slice(0, 6);
    await drizzleDb.insert(schema.corporation_store).values(
      [A, B, C, D].map((id, i) => ({ id, name: `Склад ${"ABCD"[i]} ${tag}`, organization_id: org, type: "STORE" }))
    );
    await drizzleDb.insert(schema.measure_unit).values({ id: unit, name: "шт", code: `sht-${tag}` });
    await drizzleDb.insert(schema.nomenclature_element).values([
      { id: p1, name: `Вода ${tag}`, type: "GOODS", mainUnit: unit, deleted: false },
      { id: p2, name: `Соль ${tag}`, type: "GOODS", mainUnit: unit, deleted: false },
      { id: p3, name: `Стаканы ${tag}`, type: "GOODS", mainUnit: unit, deleted: false },
    ]);

    // Отправленный пересчёт на складе A: p1 = 20, p2 «не считали».
    async function submittedCount(store: string, qty: Record<string, number | null>) {
      const [c] = await drizzleDb
        .insert(schema.inventory_counts)
        .values({ store_id: store, organization_id: org, template_name: "Все товары филиала", period: PERIOD, status: "submitted", created_by: user })
        .returning({ id: schema.inventory_counts.id });
      for (const [pid, q] of Object.entries(qty)) {
        await drizzleDb.insert(schema.inventory_count_lines).values({
          count_id: c.id, product_id: pid, product_name: pid === p1 ? `Вода ${tag}` : `Соль ${tag}`, unit_name: "шт",
          group_name: "Склад", source: "template", skipped: q === null, fact_qty: q === null ? null : String(q),
        });
      }
      return c.id;
    }
    await submittedCount(A, { [p1]: 20, [p2]: null });
    await submittedCount(D, { [p1]: 5 });

    const doc = (id: string, store: string, num: string, comment: string | null): IikoDoc => ({
      id, num, comment, store_id: store, date: PERIOD, shortage_sum: -100, surplus_sum: 50,
    });
    const docA = doc(randomUUID(), A, `9${tag}`, "Месяц");
    const docC = doc(randomUUID(), C, `8${tag}`, null);
    const prevB = { ...doc(randomUUID(), B, `7${tag}`, "Месяц"), date: PREV };

    const state = {
      docs: { [PERIOD]: [docA, docC], [PREV]: [prevB] } as Record<string, IikoDoc[]>,
      corrections: [
        { store_id: A, doc_num: docA.num, at: `${PERIOD}T23:59:00`, product_id: p1, product_name: `Вода ${tag}`, qty: 9, sum: 900 },
        { store_id: A, doc_num: docA.num, at: `${PERIOD}T23:59:00`, product_id: p3, product_name: `Стаканы ${tag}`, qty: 43, sum: 0 },
      ] as Correction[],
      balance: {
        [A]: [{ product_id: p1, amount: 15, sum: 1500 }, { product_id: p3, amount: -43, sum: 0 }],
        [D]: [{ product_id: p1, amount: 7, sum: 700 }],
      } as Record<string, { product_id: string; amount: number; sum: number }[]>,
      balanceCalls: [] as { store: string; at: string }[],
    };

    const iiko: IikoClient = {
      async inventoryDocs(date) {
        return state.docs[date] ?? [];
      },
      async corrections() {
        return state.corrections;
      },
      async balance(store, at) {
        state.balanceCalls.push({ store, at });
        return state.balance[store] ?? [];
      },
    };

    async function recon(store: string) {
      const [r] = await drizzleDb
        .select()
        .from(schema.inventory_reconciliations)
        .where(and(eq(schema.inventory_reconciliations.store_id, store), eq(schema.inventory_reconciliations.period, PERIOD)));
      return r;
    }
    async function lines(reconId: string) {
      return drizzleDb.select().from(schema.inventory_reconciliation_lines).where(eq(schema.inventory_reconciliation_lines.reconciliation_id, reconId));
    }
    async function events(reconId: string) {
      return drizzleDb.select().from(schema.inventory_reconciliation_events).where(eq(schema.inventory_reconciliation_events.reconciliation_id, reconId));
    }

    async function cleanup() {
      const stores = [A, B, C, D];
      await drizzleDb.delete(schema.inventory_reconciliations).where(inArray(schema.inventory_reconciliations.store_id, stores));
      await drizzleDb.delete(schema.inventory_counts).where(inArray(schema.inventory_counts.store_id, stores));
      await drizzleDb.delete(schema.nomenclature_element).where(inArray(schema.nomenclature_element.id, [p1, p2, p3]));
      await drizzleDb.delete(schema.measure_unit).where(eq(schema.measure_unit.id, unit));
      await drizzleDb.delete(schema.corporation_store).where(inArray(schema.corporation_store.id, stores));
    }

    return { A, B, C, D, p1, p2, p3, docA, docC, state, iiko, recon, lines, events, cleanup };
  }

  describe("reconcile: область и этапы", () => {
    it("область: «Месяц» за период и за 3 прошлых месяца + пересчёты админки; без «Месяц» — вне области", async () => {
      const w = await seed();
      try {
        const { scope } = await computeScope(drizzleDb, w.iiko, { period: PERIOD });
        expect(scope).toContain(w.A);
        expect(scope).toContain(w.B);
        expect(scope).toContain(w.D);
        expect(scope).not.toContain(w.C);
      } finally {
        await w.cleanup();
      }
    });

    it("склад с документом: ready, корректировки сохранены, учёт за минуту до документа, строки и итоги", async () => {
      const w = await seed();
      try {
        const res = await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        expect(res.received).toContainEqual({ store_id: w.A, num: w.docA.num });
        expect(res.missing).toContain(w.B);

        const a = await w.recon(w.A);
        expect(a.status).toBe("ready");
        expect(a.iiko_document_num).toBe(w.docA.num);
        expect(a.iiko_doc_state).toBe("posted");
        expect(a.admin_state).toBe("submitted");
        expect(w.state.balanceCalls).toContainEqual({ store: w.A, at: `${PERIOD}T23:58:00` });

        const ls = await w.lines(a.id);
        const p1 = ls.find((l) => l.product_id === w.p1)!;
        expect(Number(p1.book_qty)).toBe(15);
        expect(Number(p1.iiko_fact_qty)).toBe(24);
        expect(Number(p1.admin_qty)).toBe(20);
        expect(Number(p1.diff_ab_qty)).toBe(-4);
        const p2 = ls.find((l) => l.product_id === w.p2)!;
        expect(p2.admin_state).toBe("skipped");
        const p3 = ls.find((l) => l.product_id === w.p3)!;
        expect(p3.admin_state).toBe("absent");
        expect(Number(p3.iiko_fact_qty)).toBe(0);
        expect(a.lines_total).toBe(3);
        expect(a.mismatch_ab_count).toBe(1);
        expect(Number(a.diff_bc_sum)).toBe(900);

        const ev = await w.events(a.id);
        expect(ev.map((e) => e.type).sort()).toEqual(["calculated", "fetched"]);
      } finally {
        await w.cleanup();
      }
    });

    it("склад без документа: waiting_iiko, A − C считается, B пусто", async () => {
      const w = await seed();
      try {
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        const d = await w.recon(w.D);
        expect(d.status).toBe("waiting_iiko");
        expect(d.diff_bc_sum).toBeNull();
        const [p1] = await w.lines(d.id);
        expect(p1.iiko_fact_qty).toBeNull();
        expect(Number(p1.diff_ac_sum)).toBe(-200); // (5 − 7) × 100
        expect(w.state.balanceCalls).toContainEqual({ store: w.D, at: `${PERIOD}T23:58:00` });
      } finally {
        await w.cleanup();
      }
    });

    it("повторная загрузка без изменений не пишет событий; изменение корректировки — fetched со списком и changed_after_accept", async () => {
      const w = await seed();
      try {
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        const a0 = await w.recon(w.A);
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        expect((await w.events(a0.id)).length).toBe(2);

        await drizzleDb
          .update(schema.inventory_reconciliations)
          .set({ status: "accepted", accepted_totals: { lines_total: a0.lines_total, mismatch_ab_count: a0.mismatch_ab_count, diff_ab_sum: a0.diff_ab_sum, diff_ac_sum: a0.diff_ac_sum, diff_bc_sum: a0.diff_bc_sum } })
          .where(eq(schema.inventory_reconciliations.id, a0.id));
        w.state.corrections[0] = { ...w.state.corrections[0], qty: 5, sum: 500 };
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });

        const a1 = await w.recon(w.A);
        expect(a1.status).toBe("accepted");
        expect(a1.changed_after_accept).toBe(true);
        const fetched = (await w.events(a1.id)).filter((e) => e.type === "fetched");
        expect(fetched.length).toBe(2);
        const last = fetched.map((e) => e.payload as any).find((p) => p.changed?.length);
        expect(last.changed).toEqual([{ product_id: w.p1, product_name: expect.any(String), qty_before: 9, qty_after: 5 }]);
      } finally {
        await w.cleanup();
      }
    });

    it("документ пропал (распровели): строки и корректировки остаются, doc_missing один раз", async () => {
      const w = await seed();
      try {
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        const a0 = await w.recon(w.A);
        const before = await w.lines(a0.id);

        w.state.docs[PERIOD] = [w.docC];
        w.state.corrections = [];
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });

        const a1 = await w.recon(w.A);
        expect(a1.iiko_doc_state).toBe("unposted_after_fetch");
        expect(a1.iiko_document_num).toBe(w.docA.num);
        expect(a1.status).toBe("ready");
        const after = await w.lines(a1.id);
        expect(after.length).toBe(before.length);
        expect(Number(after.find((l) => l.product_id === w.p1)!.iiko_fact_qty)).toBe(24);
        const missing = (await w.events(a1.id)).filter((e) => e.type === "doc_missing");
        expect(missing.length).toBe(1);
      } finally {
        await w.cleanup();
      }
    });

    it("два «Месяц» — needs_choice с кандидатами; выбор офиса сохраняется при следующей загрузке", async () => {
      const w = await seed();
      try {
        const second = { ...w.docA, id: randomUUID(), num: `${w.docA.num}0` };
        w.state.docs[PERIOD] = [w.docA, second, w.docC];
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD });
        const a0 = await w.recon(w.A);
        expect(a0.status).toBe("needs_choice");
        expect((a0.iiko_candidates as any[]).map((c) => c.id).sort()).toEqual([w.docA.id, second.id].sort());

        await drizzleDb
          .update(schema.inventory_reconciliations)
          .set({ iiko_document_id: w.docA.id })
          .where(eq(schema.inventory_reconciliations.id, a0.id));
        await runReconcile(drizzleDb, w.iiko, { period: PERIOD, storeId: w.A });
        const a1 = await w.recon(w.A);
        expect(a1.status).toBe("ready");
        expect(a1.iiko_document_num).toBe(w.docA.num);
        expect(a1.iiko_candidates).toBeNull();
      } finally {
        await w.cleanup();
      }
    });
  });
}
```

- [ ] **Step 2: Запустить — падает**

```bash
cd backend && export TEST_DATABASE_URL=$(grep '^DATABASE_URL' .env | cut -d= -f2- | sed 's#/[^/]*$#/managers_tickets_test#')
bun run test:http:reconcile 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module './service'` (pure и iiko-client тесты в той же папке — PASS).

- [ ] **Step 3: `service.ts`**

```ts
// Этапы сверки с базой (spec 2026-10-06, §5). Этап 1 — документы и корректировки
// (секунды), этап 2 — учёт и расчёт строк (около минуты). iiko подаётся снаружи,
// чтобы тесты шли без сети.
import {
  corporation_store,
  inventory_counts,
  inventory_reconciliation_events,
  inventory_reconciliation_iiko_lines,
  inventory_reconciliation_lines,
  inventory_reconciliations,
} from "backend/drizzle/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { GROUP_NAME_SQL } from "../counts";
import type { IikoClient } from "./iiko-client";
import {
  bookAt,
  buildLines,
  correctionsFor,
  diffCorrections,
  isMonthly,
  pickDocument,
  previousPeriods,
  sameTotals,
  toIikoTimestamp,
  totals,
  totalsToDb,
  type AdminAgg,
  type CorrLine,
  type IikoDoc,
  type ProductMeta,
} from "./pure";
import type { ReconAdminState, ReconCandidate, ReconFetchStatus, ReconTotals } from "./types";

export type RunInput = { period: string; storeId?: string | null; userId?: string | null };
export type Stage1Result = { scope: string[]; received: { store_id: string; num: string }[]; missing: string[] };
export type Progress = (patch: Partial<ReconFetchStatus>) => Promise<void>;

type ReconRow = typeof inventory_reconciliations.$inferSelect;

const uuidList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

async function writeReconEvent(tx: DbLike, reconId: string, type: string, userId: string | null | undefined, payload: unknown) {
  await tx.insert(inventory_reconciliation_events).values({ reconciliation_id: reconId, type, user_id: userId ?? null, payload });
}

/** Склады, от которых ждём сверку (spec §5, этап 1, шаг 3). */
export async function computeScope(db: DbLike, iiko: IikoClient, input: RunInput): Promise<{ scope: string[]; docs: IikoDoc[] }> {
  const docs = await iiko.inventoryDocs(input.period);
  if (input.storeId) return { scope: [input.storeId], docs: docs.filter((d) => d.store_id === input.storeId) };

  const ids = new Set<string>(docs.filter((d) => isMonthly(d.comment)).map((d) => d.store_id));
  for (const p of previousPeriods(input.period, 3)) {
    for (const d of await iiko.inventoryDocs(p)) if (isMonthly(d.comment)) ids.add(d.store_id);
  }
  const admin = await db
    .selectDistinct({ store_id: inventory_counts.store_id })
    .from(inventory_counts)
    .where(and(eq(inventory_counts.period, input.period), inArray(inventory_counts.status, ["draft", "submitted"])));
  for (const a of admin) ids.add(a.store_id);
  if (!ids.size) return { scope: [], docs };

  // Только известные склады: без строки corporation_store нет названия и организации.
  const known = await db
    .select({ id: corporation_store.id })
    .from(corporation_store)
    .where(inArray(corporation_store.id, [...ids]));
  return { scope: known.map((k) => k.id), docs };
}

async function lockRecon(tx: DbLike, storeId: string, period: string): Promise<ReconRow> {
  const [store] = await tx
    .select({ organization_id: corporation_store.organization_id })
    .from(corporation_store)
    .where(eq(corporation_store.id, storeId));
  await tx
    .insert(inventory_reconciliations)
    .values({ store_id: storeId, period, organization_id: store?.organization_id ?? null })
    .onConflictDoNothing({ target: [inventory_reconciliations.store_id, inventory_reconciliations.period] });
  const [row] = await tx
    .select()
    .from(inventory_reconciliations)
    .where(and(eq(inventory_reconciliations.store_id, storeId), eq(inventory_reconciliations.period, period)))
    .for("update");
  return row;
}

const toCorrLine = (x: typeof inventory_reconciliation_iiko_lines.$inferSelect): CorrLine => ({
  product_id: x.product_id,
  product_name: x.product_name,
  qty: Number(x.qty),
  sum: Number(x.sum),
});

/** Этап 1: документы и корректировки. Сохраняется сразу — сигнал «данные сохранены». */
export async function runStage1(db: DbLike, iiko: IikoClient, input: RunInput): Promise<Stage1Result> {
  const { scope, docs } = await computeScope(db, iiko, input);
  const corrections = await iiko.corrections(input.period);
  const received: Stage1Result["received"] = [];
  const missing: string[] = [];

  for (const storeId of scope) {
    await db.transaction(async (tx) => {
      const row = await lockRecon(tx, storeId, input.period);
      const choice = pickDocument(docs.filter((d) => d.store_id === storeId), row.iiko_document_id);
      const base = { fetched_at: sql`now()`, fetched_by: input.userId ?? null, updated_at: sql`now()` };

      if (choice.kind === "chosen") {
        const doc = choice.doc;
        const c = correctionsFor(corrections, storeId, doc.num);
        const before = (
          await tx
            .select()
            .from(inventory_reconciliation_iiko_lines)
            .where(eq(inventory_reconciliation_iiko_lines.reconciliation_id, row.id))
        ).map(toCorrLine);
        const changes = diffCorrections(before, c.lines);
        const docChanged = row.iiko_document_id !== doc.id || row.iiko_document_num !== doc.num;

        await tx.delete(inventory_reconciliation_iiko_lines).where(eq(inventory_reconciliation_iiko_lines.reconciliation_id, row.id));
        for (let i = 0; i < c.lines.length; i += 500) {
          await tx.insert(inventory_reconciliation_iiko_lines).values(
            c.lines.slice(i, i + 500).map((l) => ({
              reconciliation_id: row.id,
              product_id: l.product_id,
              product_name: l.product_name,
              qty: String(l.qty),
              sum: String(l.sum),
            }))
          );
        }
        const docAt = c.at ?? `${input.period}T23:59:00`;
        await tx
          .update(inventory_reconciliations)
          .set({
            ...base,
            status: row.status === "waiting_iiko" || row.status === "needs_choice" ? "ready" : row.status,
            iiko_document_id: doc.id,
            iiko_document_num: doc.num,
            iiko_document_comment: doc.comment,
            iiko_document_at: docAt,
            book_at: bookAt(docAt, input.period),
            iiko_doc_state: "posted",
            iiko_candidates: null,
            changed_after_accept: row.changed_after_accept || (row.status === "accepted" && changes.length > 0),
          })
          .where(eq(inventory_reconciliations.id, row.id));
        if (docChanged || changes.length || row.iiko_doc_state !== "posted") {
          await writeReconEvent(tx, row.id, "fetched", input.userId, {
            document_id: doc.id,
            num: doc.num,
            comment: doc.comment,
            shortage_sum: doc.shortage_sum,
            surplus_sum: doc.surplus_sum,
            first: !row.iiko_document_id,
            changed: changes.slice(0, 500),
            changed_total: changes.length,
          });
        }
        received.push({ store_id: storeId, num: doc.num });
        return;
      }

      // Документа нет или нужен выбор. Ранее загруженные данные НЕ трогаем.
      const hadDoc = !!row.iiko_document_id;
      const candidates: ReconCandidate[] | null =
        choice.kind === "needs_choice"
          ? choice.candidates.map((d) => ({ id: d.id, num: d.num, comment: d.comment, date: d.date, shortage_sum: d.shortage_sum, surplus_sum: d.surplus_sum }))
          : null;
      const nextStatus =
        row.status === "in_review" || row.status === "accepted" || (hadDoc && row.status === "ready")
          ? row.status
          : choice.kind === "needs_choice"
            ? "needs_choice"
            : "waiting_iiko";
      await tx
        .update(inventory_reconciliations)
        .set({
          ...base,
          status: nextStatus,
          iiko_candidates: candidates,
          iiko_doc_state: hadDoc ? "unposted_after_fetch" : null,
        })
        .where(eq(inventory_reconciliations.id, row.id));
      if (hadDoc && row.iiko_doc_state === "posted") {
        await writeReconEvent(tx, row.id, "doc_missing", input.userId, { num: row.iiko_document_num });
      }
      missing.push(storeId);
    });
  }
  return { scope, received, missing };
}

async function adminAggregate(db: DbLike, storeId: string, period: string): Promise<{ admin: AdminAgg[]; state: ReconAdminState }> {
  const counts = await db
    .select({ id: inventory_counts.id, status: inventory_counts.status })
    .from(inventory_counts)
    .where(and(eq(inventory_counts.store_id, storeId), eq(inventory_counts.period, period), inArray(inventory_counts.status, ["draft", "submitted"])));
  const submitted = counts.filter((c) => c.status === "submitted").map((c) => c.id);
  const state: ReconAdminState = submitted.length ? "submitted" : counts.length ? "draft" : "none";
  if (!submitted.length) return { admin: [], state };
  const res = await db.execute(sql`
    select l.product_id::text as product_id, max(l.product_name) as product_name, max(l.unit_name) as unit_name,
      max(l.group_name) as group_name,
      (sum(l.fact_qty) filter (where not l.skipped))::text as qty,
      bool_and(l.skipped) as all_skipped,
      count(*)::int as counts_n
    from inventory_count_lines l
    where l.count_id in (${uuidList(submitted)})
    group by l.product_id`);
  const rows = res.rows as { product_id: string; product_name: string; unit_name: string | null; group_name: string; qty: string | null; all_skipped: boolean; counts_n: number }[];
  return {
    state,
    admin: rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      unit_name: r.unit_name,
      group_name: r.group_name,
      qty: r.all_skipped ? null : Number(r.qty ?? 0),
      state: r.all_skipped ? "skipped" : "counted",
      counts_n: r.counts_n,
    })),
  };
}

async function productMeta(db: DbLike, ids: string[]): Promise<Map<string, ProductMeta>> {
  const out = new Map<string, ProductMeta>();
  if (!ids.length) return out;
  const res = await db.execute(sql`
    select n.id::text as id, coalesce(n.name, '') as name, mu.name as unit_name, ${GROUP_NAME_SQL} as group_name
    from nomenclature_element n
    left join measure_unit mu on mu.id = n."mainUnit"
    left join nomenclature_group g on g.id = n.parent_id
    left join nomenclature_group gp on gp.id = g.parent_id
    where n.id in (${uuidList(ids)})`);
  for (const r of res.rows as { id: string; name: string; unit_name: string | null; group_name: string }[]) {
    out.set(r.id, { name: r.name, unit_name: r.unit_name, group_name: r.group_name });
  }
  return out;
}

const s = (x: number | null) => (x === null ? null : String(x));

/** Этап 2: учёт на book_at, A из админки, расчёт строк и итогов. Статусы не меняет. */
export async function runStage2(db: DbLike, iiko: IikoClient, input: RunInput & { scope: string[] }): Promise<void> {
  for (const storeId of input.scope) {
    const [row] = await db
      .select()
      .from(inventory_reconciliations)
      .where(and(eq(inventory_reconciliations.store_id, storeId), eq(inventory_reconciliations.period, input.period)));
    if (!row) continue;

    const book = await iiko.balance(storeId, toIikoTimestamp(row.book_at ?? `${input.period}T23:58:00`));
    const { admin, state } = await adminAggregate(db, storeId, input.period);
    const hasDoc = !!row.iiko_document_id;
    const corrections = hasDoc
      ? (
          await db
            .select()
            .from(inventory_reconciliation_iiko_lines)
            .where(eq(inventory_reconciliation_iiko_lines.reconciliation_id, row.id))
        ).map(toCorrLine)
      : null;
    const adminIds = new Set(admin.map((a) => a.product_id));
    const otherIds = [...new Set([...book.map((b) => b.product_id), ...(corrections ?? []).map((c) => c.product_id)])].filter(
      (id) => !adminIds.has(id)
    );
    const lines = buildLines({ admin, book, corrections, meta: await productMeta(db, otherIds) });
    const t = totalsToDb(totals(lines, hasDoc));

    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(inventory_reconciliations).where(eq(inventory_reconciliations.id, row.id)).for("update");
      await tx.delete(inventory_reconciliation_lines).where(eq(inventory_reconciliation_lines.reconciliation_id, row.id));
      for (let i = 0; i < lines.length; i += 500) {
        await tx.insert(inventory_reconciliation_lines).values(
          lines.slice(i, i + 500).map((l) => ({
            reconciliation_id: row.id,
            product_id: l.product_id,
            product_name: l.product_name,
            unit_name: l.unit_name,
            group_name: l.group_name,
            admin_state: l.admin_state,
            admin_qty: s(l.admin_qty),
            admin_counts_n: l.admin_counts_n,
            book_qty: String(l.book_qty),
            book_sum: String(l.book_sum),
            iiko_correction_qty: String(l.iiko_correction_qty),
            iiko_correction_sum: String(l.iiko_correction_sum),
            iiko_fact_qty: s(l.iiko_fact_qty),
            unit_cost: s(l.unit_cost),
            cost_source: l.cost_source,
            diff_ab_qty: s(l.diff_ab_qty),
            diff_ab_sum: s(l.diff_ab_sum),
            diff_ac_sum: s(l.diff_ac_sum),
          }))
        );
      }
      const prev: ReconTotals = {
        lines_total: locked.lines_total,
        mismatch_ab_count: locked.mismatch_ab_count,
        diff_ab_sum: locked.diff_ab_sum,
        diff_ac_sum: locked.diff_ac_sum,
        diff_bc_sum: locked.diff_bc_sum,
      };
      const changed = !locked.calculated_at || !sameTotals(prev, t);
      const accepted = locked.accepted_totals as ReconTotals | null;
      await tx
        .update(inventory_reconciliations)
        .set({
          ...t,
          admin_state: state,
          calculated_at: sql`now()`,
          updated_at: sql`now()`,
          changed_after_accept: locked.changed_after_accept || (locked.status === "accepted" && !sameTotals(accepted, t)),
        })
        .where(eq(inventory_reconciliations.id, row.id));
      if (changed) await writeReconEvent(tx, row.id, "calculated", input.userId, { before: locked.calculated_at ? prev : null, after: t });
    });
  }
}

export async function storeNames(db: DbLike, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: corporation_store.id, name: corporation_store.name }).from(corporation_store).where(inArray(corporation_store.id, ids));
  return new Map(rows.map((r) => [r.id, r.name ?? r.id]));
}

export async function runReconcile(db: DbLike, iiko: IikoClient, input: RunInput, progress: Progress = async () => {}): Promise<Stage1Result> {
  await progress({ state: "stage1", started_at: new Date().toISOString(), error: null });
  const s1 = await runStage1(db, iiko, input);
  const names = await storeNames(db, s1.scope);
  await progress({
    state: "stage2",
    stage1_done_at: new Date().toISOString(),
    received: s1.received.map((r) => ({ ...r, store_name: names.get(r.store_id) ?? r.store_id })),
    missing: s1.missing.map((id) => ({ store_id: id, store_name: names.get(id) ?? id })),
  });
  await runStage2(db, iiko, { ...input, scope: s1.scope });
  await progress({ state: "done", finished_at: new Date().toISOString() });
  return s1;
}
```

- [ ] **Step 4: Запустить тесты**

Run: `cd backend && bun run test:http:reconcile 2>&1 | tail -25`
Expected: PASS все три файла (pure, iiko-client, service). Тест «документ пропал»: `status` остаётся `ready` (строка `hadDoc && row.status === "ready"`).

- [ ] **Step 5: Коммит**

```bash
git add backend/src/modules/inventory/reconcile/service.ts backend/src/modules/inventory/reconcile/service.test.ts
git commit -m "feat(inventory/reconcile): этапы 1 и 2 — документы, корректировки, учёт, строки

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Очередь, задача, воркер, cron и ручной запуск

**Files:**
- Create: `backend/src/modules/inventory/reconcile/queue.ts`
- Create: `backend/src/modules/inventory/reconcile/job.ts`
- Create: `cron/inventory_reconcile_worker.ts`
- Create: `cron/inventory_reconcile_once.ts`
- Modify: `cron/pm2.config.js`
- Modify: `cron/src/index.ts`

**Interfaces:**
- Consumes: `runReconcile` (Task 7), `withIikoClient` (Task 6), `previousPeriod` (Task 3), `InventoryError` из `../errors`.
- Produces (`queue.ts`):
  - `reconcileQueueName(): string` (env `INVENTORY_RECONCILE_QUEUE`, по умолчанию `inventory_reconcile`);
  - `reconcileJobId(period: string): string` → `reconcile-<period>` (BullMQ не принимает `:` в своих id — поэтому дефис);
  - `statusKey(period: string): string` → `${PROJECT_PREFIX}inventory_reconcile:<period>`;
  - `type ReconcileJobData = { period: string; storeId: string | null; userId: string | null; statusKey: string }`;
  - `reconcileQueue(): Queue` (ленивый синглтон), `closeReconcileQueue(): Promise<void>`;
  - `enqueueReconcile(q: Queue, redis: Redis, input: { period; storeId?; userId? }): Promise<ReconFetchStatus>` — 409 `already_running`;
  - `readStatus(redis, period): Promise<ReconFetchStatus>`, `patchStatus(redis, key, patch): Promise<void>`.
- Produces (`job.ts`): `processReconcileJob(db: DbLike, redis: Redis, data: ReconcileJobData, iikoOpts?: IikoClientOptions): Promise<void>`.

- [ ] **Step 1: `queue.ts`**

```ts
// Очередь сверки (spec 2026-10-06, §5 «Очередь и запуск»). Одна задача на месяц:
// пока идёт загрузка периода, вторую (все склады или один) поставить нельзя.
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { InventoryError } from "../errors";
import type { ReconFetchStatus } from "./types";

export const reconcileQueueName = () => process.env.INVENTORY_RECONCILE_QUEUE ?? "inventory_reconcile";
// BullMQ не принимает ":" в собственных id задач.
export const reconcileJobId = (period: string) => `reconcile-${period}`;
// Ключ статуса считает тот, кто ставит задачу (бэкенд или cron), и передаёт в данных:
// у воркера в cron/ PROJECT_PREFIX может отличаться.
export const statusKey = (period: string) => `${process.env.PROJECT_PREFIX ?? ""}inventory_reconcile:${period}`;
const STATUS_TTL_S = 30 * 86400;

export type ReconcileJobData = { period: string; storeId: string | null; userId: string | null; statusKey: string };

let queue: Queue | null = null;

export function reconcileQueue(): Queue {
  queue ??= new Queue(reconcileQueueName(), {
    connection: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || "6379"),
      maxRetriesPerRequest: null,
    },
  });
  return queue;
}

export async function closeReconcileQueue() {
  await queue?.close();
  queue = null;
}

export function initialStatus(period: string, storeId: string | null): ReconFetchStatus {
  return { period, store_id: storeId, state: "queued", started_at: null, stage1_done_at: null, finished_at: null, received: [], missing: [], error: null };
}

const RUNNING = new Set(["waiting", "active", "delayed", "prioritized", "waiting-children"]);

export async function enqueueReconcile(
  q: Queue,
  redis: Redis,
  input: { period: string; storeId?: string | null; userId?: string | null }
): Promise<ReconFetchStatus> {
  const jobId = reconcileJobId(input.period);
  const existing = await q.getJob(jobId);
  if (existing) {
    if (RUNNING.has(await existing.getState())) throw new InventoryError(409, "already_running");
    await existing.remove();
  }
  const data: ReconcileJobData = {
    period: input.period,
    storeId: input.storeId ?? null,
    userId: input.userId ?? null,
    statusKey: statusKey(input.period),
  };
  const status = initialStatus(input.period, data.storeId);
  await redis.set(data.statusKey, JSON.stringify(status), "EX", STATUS_TTL_S);
  await q.add("reconcile", data, { jobId, attempts: 1, removeOnComplete: true, removeOnFail: true });
  return status;
}

export async function readStatus(redis: Redis, period: string): Promise<ReconFetchStatus> {
  const raw = await redis.get(statusKey(period));
  return raw ? (JSON.parse(raw) as ReconFetchStatus) : { ...initialStatus(period, null), state: "idle" };
}

export async function patchStatus(redis: Redis, key: string, patch: Partial<ReconFetchStatus>) {
  const raw = await redis.get(key);
  const cur = raw ? JSON.parse(raw) : {};
  await redis.set(key, JSON.stringify({ ...cur, ...patch }), "EX", STATUS_TTL_S);
}
```

- [ ] **Step 2: `job.ts`**

```ts
// Одна загрузка сверки: токен iiko, этапы 1–2, статус в Redis. Вызывают воркер
// очереди и ручной запуск cron/inventory_reconcile_once.ts.
import type Redis from "ioredis";
import type { DbLike } from "../access";
import { withIikoClient, type IikoClientOptions } from "./iiko-client";
import { patchStatus, type ReconcileJobData } from "./queue";
import { runReconcile } from "./service";

export async function processReconcileJob(db: DbLike, redis: Redis, data: ReconcileJobData, iikoOpts: IikoClientOptions = {}) {
  try {
    await withIikoClient(
      (iiko) =>
        runReconcile(db, iiko, { period: data.period, storeId: data.storeId, userId: data.userId }, (p) =>
          patchStatus(redis, data.statusKey, p)
        ),
      iikoOpts
    );
  } catch (e) {
    await patchStatus(redis, data.statusKey, {
      state: "failed",
      finished_at: new Date().toISOString(),
      error: (e as Error).message.slice(0, 500),
    });
    throw e;
  }
}
```

- [ ] **Step 3: Воркер `cron/inventory_reconcile_worker.ts`**

```ts
// Воркер сверки инвентаризаций с iiko (spec docs/superpowers/specs/2026-10-06-inventory-reconciliation-design.md).
// Задачи ставят бэкенд (кнопки офиса) и cron (1–7 числа). concurrency 1 — один токен iiko за раз.
import { Worker } from "bullmq";
import { drizzleDb } from "@backend/lib/db";
import { processReconcileJob } from "@backend/modules/inventory/reconcile/job";
import { reconcileQueueName, type ReconcileJobData } from "@backend/modules/inventory/reconcile/queue";
import client from "./src/redis";

const worker = new Worker(
  reconcileQueueName(),
  async (job) => {
    const data = job.data as ReconcileJobData;
    console.log(`[reconcile] job ${job.id}: ${data.period} ${data.storeId ?? "all"}`);
    await processReconcileJob(drizzleDb, client, data);
    console.log(`[reconcile] job ${job.id}: done`);
  },
  {
    // BullMQ требует отдельного соединения с maxRetriesPerRequest: null
    connection: {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      maxRetriesPerRequest: null,
    },
    concurrency: 1,
  }
);

worker.on("failed", (job, err) => console.error(`[reconcile] job ${job?.id} failed:`, err.message));

async function shutdown() {
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

- [ ] **Step 4: Ручной запуск без очереди `cron/inventory_reconcile_once.ts`**

```ts
/**
 * Разовая сверка без очереди — для проверки на локальной базе и ручных прогонов.
 *   bun inventory_reconcile_once.ts 2026-08-31            # все склады
 *   bun inventory_reconcile_once.ts 2026-08-31 <storeId>  # один склад
 * iiko — только чтение. Пишет в базу из DATABASE_URL.
 */
import { drizzleDb } from "@backend/lib/db";
import { processReconcileJob } from "@backend/modules/inventory/reconcile/job";
import { statusKey } from "@backend/modules/inventory/reconcile/queue";
import { isValidPeriod } from "@backend/modules/inventory/rules";
import client from "./src/redis";

const [period, storeId] = process.argv.slice(2);
if (!period || !isValidPeriod(period)) {
  console.error("usage: bun inventory_reconcile_once.ts YYYY-MM-DD(last day) [storeId]");
  process.exit(1);
}
const key = statusKey(period);
await processReconcileJob(drizzleDb, client, { period, storeId: storeId ?? null, userId: null, statusKey: key });
console.log(await client.get(key));
process.exit(0);
```

- [ ] **Step 5: PM2 и расписание**

В `cron/pm2.config.js`, в массив `apps`, после блока `iiko_document_worker` добавить:

```js
    {
      name: "inventory_reconcile_worker",
      script: "inventory_reconcile_worker.ts",
      interpreter: "bun",
    },
```

В `cron/src/index.ts` после существующих импортов добавить:

```ts
import { enqueueReconcile, reconcileQueue } from "@backend/modules/inventory/reconcile/queue";
import { previousPeriod } from "@backend/modules/inventory/rules";
```

и в конец файла:

```ts
// Сверка инвентаризаций с iiko за прошлый месяц: 1–7 числа, 07:00 по Ташкенту
// (spec 2026-10-06, §5). Задача уходит в очередь, считает inventory_reconcile_worker.
cron.schedule(
  "0 7 1-7 * *",
  async () => {
    const period = previousPeriod(new Date());
    try {
      await enqueueReconcile(reconcileQueue(), client, { period });
      console.log(`[reconcile] queued ${period}`);
    } catch (e) {
      console.error(`[reconcile] not queued ${period}:`, (e as Error).message);
    }
  },
  { timezone: "Asia/Tashkent" }
);
```

- [ ] **Step 6: Проверка компиляции и запуска воркера**

```bash
cd backend && bunx tsc --noEmit -p . 2>&1 | grep -E "inventory/reconcile" | head
cd ../cron && timeout 8 bun inventory_reconcile_worker.ts; echo "exit $?"
```
Expected: `tsc` по `inventory/reconcile` — пусто; воркер стартует без ошибок импорта и через 8 секунд завершается по `timeout` (exit 124). Ошибка вида `Cannot find module '@backend/…'` — стоп, проверить `cron/tsconfig.json` (должен наследовать корневой с алиасами, как у `product_links_sync.ts`).

- [ ] **Step 7: Коммит**

```bash
git add backend/src/modules/inventory/reconcile/queue.ts backend/src/modules/inventory/reconcile/job.ts cron/inventory_reconcile_worker.ts cron/inventory_reconcile_once.ts cron/pm2.config.js cron/src/index.ts
git commit -m "feat(inventory/reconcile): очередь, воркер, cron 1–7 числа и ручной запуск

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Запросы для экранов и маршруты (`read.ts`, `routes.ts`)

**Files:**
- Create: `backend/src/modules/inventory/reconcile/read.ts`
- Create: `backend/src/modules/inventory/reconcile/routes.ts`
- Modify: `backend/src/modules/inventory/controller.ts` (подключить плагин, убрать временный `/unlock` из Task 4)
- Test: `backend/src/modules/inventory/reconcile/routes.test.ts`

**Interfaces:**
- Consumes: `enqueueReconcile`, `readStatus`, `reconcileQueue`, `closeReconcileQueue` (Task 8), `unlockCount`, `userNames` из `../counts`, `inputDeadline`, `isInputOpen`, `isValidPeriod` из `../rules`, типы Task 5.
- Produces (`read.ts`):
  - `listReconciliations(db, period): Promise<ReconOverviewRow[]>`;
  - `loadReconciliation(db, id, now: Date): Promise<ReconDetail>`;
  - `reconTarget(db, id): Promise<{ store_id: string; period: string }>`;
  - `chooseDocument(db, id, documentId, userId): Promise<{ store_id: string; period: string }>`;
  - `setReconStatus(db, id, status: "in_review" | "accepted", comment: string | null, userId): Promise<{ ok: true }>`.
- Produces (`routes.ts`): `reconcileRoutes` (Elysia-плагин без префикса; префикс `/api` даёт `inventoryControllerImpl`). Маршруты — таблица spec §6.

- [ ] **Step 1: HTTP-тесты маршрутов**

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest || !prefixLooksLikeTest) {
  describe.skip("reconcile routes (пропущено: запускайте через bun run test:http:reconcile)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, closeTestRedis, ensureApp, withSession, sweepTestRoles } = await import("../../../../tests/helpers/http");
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { closeReconcileQueue, reconcileQueue } = await import("./queue");

  type Session = Awaited<ReturnType<typeof withSession>>;
  const PERIOD = "2026-08-31";

  async function api(s: Session | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = s ? { ...s.headers } : {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await callApi(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  async function seed() {
    const storeId = randomUUID();
    const tag = randomUUID().slice(0, 6);
    await drizzleDb.insert(schema.corporation_store).values({ id: storeId, name: `Склад сверки ${tag}`, type: "STORE" });
    const candA = { id: randomUUID(), num: "100", comment: "Месяц", date: PERIOD, shortage_sum: -10, surplus_sum: 5 };
    const candB = { id: randomUUID(), num: "101", comment: "Месяц", date: PERIOD, shortage_sum: -1, surplus_sum: 0 };
    const [ready] = await drizzleDb
      .insert(schema.inventory_reconciliations)
      .values({
        store_id: storeId, period: PERIOD, status: "ready", iiko_document_id: randomUUID(), iiko_document_num: "2115",
        iiko_document_comment: "Месяц", iiko_doc_state: "posted", lines_total: 1, mismatch_ab_count: 1,
        diff_ab_sum: "-100.00", diff_ac_sum: "50.00", diff_bc_sum: "-150.00", admin_state: "submitted",
      })
      .returning({ id: schema.inventory_reconciliations.id });
    await drizzleDb.insert(schema.inventory_reconciliation_lines).values({
      reconciliation_id: ready.id, product_id: randomUUID(), product_name: "Вода", unit_name: "шт", group_name: "Напитки",
      admin_state: "counted", admin_qty: "20", admin_counts_n: 1, book_qty: "15", book_sum: "1500",
      iiko_correction_qty: "9", iiko_correction_sum: "900", iiko_fact_qty: "24", unit_cost: "100", cost_source: "correction",
      diff_ab_qty: "-4", diff_ab_sum: "-400", diff_ac_sum: "500",
    });
    const otherStore = randomUUID();
    await drizzleDb.insert(schema.corporation_store).values({ id: otherStore, name: `Склад выбора ${tag}`, type: "STORE" });
    const [choice] = await drizzleDb
      .insert(schema.inventory_reconciliations)
      .values({ store_id: otherStore, period: PERIOD, status: "needs_choice", iiko_candidates: [candA, candB] })
      .returning({ id: schema.inventory_reconciliations.id });
    const waitingStore = randomUUID();
    await drizzleDb.insert(schema.corporation_store).values({ id: waitingStore, name: `Склад ожидания ${tag}`, type: "STORE" });
    const [waiting] = await drizzleDb
      .insert(schema.inventory_reconciliations)
      .values({ store_id: waitingStore, period: PERIOD, status: "waiting_iiko" })
      .returning({ id: schema.inventory_reconciliations.id });

    // Пересчёт склада: отправлен, после отправки добавлена запись — правка филиала.
    const author = randomUUID();
    const [count] = await drizzleDb
      .insert(schema.inventory_counts)
      .values({ store_id: storeId, template_name: "Все товары филиала", period: PERIOD, status: "submitted", created_by: author })
      .returning({ id: schema.inventory_counts.id });
    const [line] = await drizzleDb
      .insert(schema.inventory_count_lines)
      .values({ count_id: count.id, product_id: randomUUID(), product_name: "Соль", group_name: "Склад", source: "template" })
      .returning({ id: schema.inventory_count_lines.id });
    await drizzleDb.insert(schema.inventory_count_events).values({
      count_id: count.id, type: "submitted", user_id: author, created_at: "2026-08-31T10:00:00Z",
    });
    await drizzleDb.insert(schema.inventory_count_entries).values({
      id: randomUUID(), count_id: count.id, line_id: line.id, qty: "3", created_by: author,
      client_created_at: "2026-08-31T11:00:00Z", created_at: "2026-08-31T11:00:01Z",
    });

    async function cleanup() {
      const stores = [storeId, otherStore, waitingStore];
      await drizzleDb.delete(schema.inventory_reconciliations).where(inArray(schema.inventory_reconciliations.store_id, stores));
      await drizzleDb.delete(schema.inventory_counts).where(inArray(schema.inventory_counts.store_id, stores));
      await drizzleDb.delete(schema.corporation_store).where(inArray(schema.corporation_store.id, stores));
      const job = await reconcileQueue().getJob(`reconcile-${PERIOD}`);
      await job?.remove();
    }
    return { storeId, readyId: ready.id, choiceId: choice.id, waitingId: waiting.id, candA, countId: count.id, cleanup };
  }

  const office = () => withSession({ permissions: ["inventory.count", "inventory.reconcile"] });
  const branch = () => withSession({ permissions: ["inventory.count", "inventory.manage"] });

  beforeAll(async () => {
    await ensureApp();
  }, 180000);

  afterAll(async () => {
    await reconcileQueue().obliterate({ force: true });
    await closeReconcileQueue();
    await sweepTestRoles();
    await closeTestRedis();
  });

  describe("reconcile: доступ", () => {
    it("филиал (count + manage) — 403 на всех маршрутах сверки", async () => {
      const w = await seed();
      try {
        const b = await branch();
        const calls: [string, string, unknown?][] = [
          ["GET", `/api/inventory/reconciliations?period=${PERIOD}`],
          ["GET", `/api/inventory/reconciliations/${w.readyId}`],
          ["GET", `/api/inventory/reconciliations/fetch-status?period=${PERIOD}`],
          ["POST", "/api/inventory/reconciliations/fetch", { period: PERIOD }],
          ["POST", `/api/inventory/reconciliations/${w.readyId}/refresh`, {}],
          ["POST", `/api/inventory/reconciliations/${w.choiceId}/document`, { document_id: w.candA.id }],
          ["POST", `/api/inventory/reconciliations/${w.readyId}/status`, { status: "accepted" }],
          ["POST", `/api/inventory/counts/${w.countId}/unlock`, {}],
        ];
        for (const [m, p, body] of calls) {
          const r = await api(b, m, p, body);
          expect(`${m} ${p} ${r.status}`).toBe(`${m} ${p} 403`);
        }
      } finally {
        await w.cleanup();
      }
    });
  });

  describe("reconcile: чтение", () => {
    it("список за месяц; кривой период — 422", async () => {
      const w = await seed();
      try {
        const o = await office();
        const bad = await api(o, "GET", "/api/inventory/reconciliations?period=2026-08-30");
        expect(bad.status).toBe(422);
        const r = await api(o, "GET", `/api/inventory/reconciliations?period=${PERIOD}`);
        expect(r.status).toBe(200);
        const row = r.body.find((x: any) => x.id === w.readyId);
        expect(row.store_name).toContain("Склад сверки");
        expect(row.admin_state).toBe("submitted");
        expect(row.deadline).toBe("2026-09-02T07:00:00.000Z");
        expect(row.diff_ab_sum).toBe("-100.00");
      } finally {
        await w.cleanup();
      }
    });

    it("детали: строки, пересчёты, правки филиала после отправки", async () => {
      const w = await seed();
      try {
        const o = await office();
        const r = await api(o, "GET", `/api/inventory/reconciliations/${w.readyId}`);
        expect(r.status).toBe(200);
        expect(r.body.lines.length).toBe(1);
        expect(r.body.lines[0].iiko_fact_qty).toBe("24.0000");
        expect(r.body.counts).toEqual([
          expect.objectContaining({ id: w.countId, status: "submitted", input_open: false, unlocked_until: null }),
        ]);
        expect(r.body.branch_edits).toEqual([
          expect.objectContaining({ kind: "entry_added", count_id: w.countId, product_name: "Соль", qty: "3.0000" }),
        ]);
        const nf = await api(o, "GET", `/api/inventory/reconciliations/${randomUUID()}`);
        expect(nf.status).toBe(404);
      } finally {
        await w.cleanup();
      }
    });
  });

  describe("reconcile: действия", () => {
    it("статусы: без комментария «на разбор» — 422; ready → in_review → accepted фиксирует итоги; waiting — 409", async () => {
      const w = await seed();
      try {
        const o = await office();
        const noComment = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/status`, { status: "in_review" });
        expect(noComment.status).toBe(422);
        expect(noComment.body.error).toBe("comment_required");
        const review = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/status`, { status: "in_review", comment: "Проверить воду" });
        expect(review.status).toBe(200);
        const accept = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/status`, { status: "accepted" });
        expect(accept.status).toBe(200);
        const [row] = await drizzleDb.select().from(schema.inventory_reconciliations).where(eq(schema.inventory_reconciliations.id, w.readyId));
        expect(row.status).toBe("accepted");
        expect(row.review_comment).toBe("Проверить воду");
        expect(row.accepted_totals).toEqual({ lines_total: 1, mismatch_ab_count: 1, diff_ab_sum: "-100.00", diff_ac_sum: "50.00", diff_bc_sum: "-150.00" });
        expect(row.changed_after_accept).toBe(false);

        const waiting = await api(o, "POST", `/api/inventory/reconciliations/${w.waitingId}/status`, { status: "accepted" });
        expect(waiting.status).toBe(409);
        expect(waiting.body.error).toBe("not_ready");
      } finally {
        await w.cleanup();
      }
    });

    it("выбор документа: не из кандидатов — 422; из кандидатов — сохраняется и ставится загрузка склада", async () => {
      const w = await seed();
      try {
        const o = await office();
        const bad = await api(o, "POST", `/api/inventory/reconciliations/${w.choiceId}/document`, { document_id: randomUUID() });
        expect(bad.status).toBe(422);
        expect(bad.body.error).toBe("not_a_candidate");
        const ok = await api(o, "POST", `/api/inventory/reconciliations/${w.choiceId}/document`, { document_id: w.candA.id });
        expect(ok.status).toBe(200);
        expect(ok.body.state).toBe("queued");
        const [row] = await drizzleDb.select().from(schema.inventory_reconciliations).where(eq(schema.inventory_reconciliations.id, w.choiceId));
        expect(row.iiko_document_id).toBe(w.candA.id);
      } finally {
        await w.cleanup();
      }
    });

    it("загрузка: вторая во время первой — 409 already_running; статус — queued", async () => {
      const w = await seed();
      try {
        const o = await office();
        const first = await api(o, "POST", "/api/inventory/reconciliations/fetch", { period: PERIOD });
        expect(first.status).toBe(200);
        expect(first.body.state).toBe("queued");
        const second = await api(o, "POST", "/api/inventory/reconciliations/fetch", { period: PERIOD });
        expect(second.status).toBe(409);
        expect(second.body.error).toBe("already_running");
        const one = await api(o, "POST", `/api/inventory/reconciliations/${w.readyId}/refresh`, {});
        expect(one.status).toBe(409);
        const st = await api(o, "GET", `/api/inventory/reconciliations/fetch-status?period=${PERIOD}`);
        expect(st.status).toBe(200);
        expect(st.body.state).toBe("queued");
      } finally {
        await w.cleanup();
      }
    });
  });
}
```

- [ ] **Step 2: Запустить — падает**

Run: `cd backend && bun run test:http:reconcile 2>&1 | tail -20`
Expected: FAIL в `routes.test.ts` (404 на маршрутах сверки), остальные файлы — PASS.

- [ ] **Step 3: `read.ts`**

```ts
// Запросы экранов сверки (spec 2026-10-06, §6–7).
import {
  corporation_store,
  inventory_counts,
  inventory_reconciliation_events,
  inventory_reconciliation_lines,
  inventory_reconciliations,
} from "backend/drizzle/schema";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { userNames } from "../counts";
import { InventoryError } from "../errors";
import { inputDeadline, isInputOpen, UUID_RE } from "../rules";
import type {
  ReconAdminState,
  ReconBranchEdit,
  ReconCandidate,
  ReconDetail,
  ReconLine,
  ReconOverviewRow,
  ReconStatus,
  ReconTotals,
} from "./types";

type ReconRow = typeof inventory_reconciliations.$inferSelect;

// Живое состояние пересчётов админки за период, не снимок этапа 2.
const ADMIN_STATE_SQL = sql<ReconAdminState>`(
  select case when bool_or(c.status = 'submitted') then 'submitted' when count(*) > 0 then 'draft' else 'none' end
  from inventory_counts c
  where c.store_id = "inventory_reconciliations"."store_id" and c.period = "inventory_reconciliations"."period"
    and c.status <> 'cancelled')`;

function overviewRow(r: ReconRow, storeName: string | null, adminState: ReconAdminState): ReconOverviewRow {
  return {
    id: r.id,
    store_id: r.store_id,
    store_name: storeName ?? "",
    organization_id: r.organization_id,
    period: r.period,
    status: r.status as ReconStatus,
    admin_state: adminState,
    deadline: inputDeadline(r.period).toISOString(),
    iiko_document_num: r.iiko_document_num,
    iiko_document_comment: r.iiko_document_comment,
    iiko_doc_state: r.iiko_doc_state as ReconOverviewRow["iiko_doc_state"],
    changed_after_accept: r.changed_after_accept,
    fetched_at: r.fetched_at,
    calculated_at: r.calculated_at,
    lines_total: r.lines_total,
    mismatch_ab_count: r.mismatch_ab_count,
    diff_ab_sum: r.diff_ab_sum,
    diff_ac_sum: r.diff_ac_sum,
    diff_bc_sum: r.diff_bc_sum,
  };
}

export async function listReconciliations(db: DbLike, period: string): Promise<ReconOverviewRow[]> {
  const rows = await db
    .select({ r: inventory_reconciliations, store_name: corporation_store.name, admin_state: ADMIN_STATE_SQL })
    .from(inventory_reconciliations)
    .leftJoin(corporation_store, eq(corporation_store.id, inventory_reconciliations.store_id))
    .where(eq(inventory_reconciliations.period, period))
    .orderBy(asc(corporation_store.name));
  return rows.map((x) => overviewRow(x.r, x.store_name, x.admin_state));
}

async function getRow(db: DbLike, id: string) {
  if (!UUID_RE.test(id)) throw new InventoryError(404, "not_found");
  const [x] = await db
    .select({ r: inventory_reconciliations, store_name: corporation_store.name, admin_state: ADMIN_STATE_SQL })
    .from(inventory_reconciliations)
    .leftJoin(corporation_store, eq(corporation_store.id, inventory_reconciliations.store_id))
    .where(eq(inventory_reconciliations.id, id));
  if (!x) throw new InventoryError(404, "not_found");
  return x;
}

export async function reconTarget(db: DbLike, id: string) {
  const { r } = await getRow(db, id);
  return { store_id: r.store_id, period: r.period };
}

async function branchEdits(db: DbLike, countIds: string[]): Promise<ReconBranchEdit[]> {
  if (!countIds.length) return [];
  const ids = sql.join(countIds.map((id) => sql`${id}::uuid`), sql`, `);
  const res = await db.execute(sql`
    with firsts as (
      select count_id, min(created_at) as at from inventory_count_events
      where type = 'submitted' and count_id in (${ids}) group by count_id)
    select e.created_at as at, 'entry_added' as kind, e.created_by as user_id, e.count_id, l.product_name, e.qty::text as qty
      from inventory_count_entries e join inventory_count_lines l on l.id = e.line_id join firsts f on f.count_id = e.count_id
      where e.created_at > f.at
    union all
    select e.deleted_at, 'entry_deleted', e.deleted_by, e.count_id, l.product_name, e.qty::text
      from inventory_count_entries e join inventory_count_lines l on l.id = e.line_id join firsts f on f.count_id = e.count_id
      where e.deleted_at > f.at
    union all
    select ev.created_at, ev.type, ev.user_id, ev.count_id, null, null
      from inventory_count_events ev where ev.type in ('reopened', 'unlocked') and ev.count_id in (${ids})
    order by 1`);
  const rows = res.rows as { at: string | Date; kind: ReconBranchEdit["kind"]; user_id: string | null; count_id: string; product_name: string | null; qty: string | null }[];
  const names = await userNames(db, rows.map((r) => r.user_id ?? ""));
  return rows.map((r) => ({
    at: new Date(r.at).toISOString(),
    kind: r.kind,
    user_name: r.user_id ? names.get(r.user_id) ?? "—" : "—",
    count_id: r.count_id,
    product_name: r.product_name,
    qty: r.qty,
  }));
}

export async function loadReconciliation(db: DbLike, id: string, now: Date): Promise<ReconDetail> {
  const { r, store_name, admin_state } = await getRow(db, id);
  const l = inventory_reconciliation_lines;
  const lines = await db
    .select({
      product_id: l.product_id,
      product_name: l.product_name,
      unit_name: l.unit_name,
      group_name: l.group_name,
      admin_state: l.admin_state,
      admin_qty: l.admin_qty,
      admin_counts_n: l.admin_counts_n,
      book_qty: l.book_qty,
      iiko_correction_qty: l.iiko_correction_qty,
      iiko_correction_sum: l.iiko_correction_sum,
      iiko_fact_qty: l.iiko_fact_qty,
      unit_cost: l.unit_cost,
      cost_source: l.cost_source,
      diff_ab_qty: l.diff_ab_qty,
      diff_ab_sum: l.diff_ab_sum,
      diff_ac_sum: l.diff_ac_sum,
    })
    .from(l)
    .where(eq(l.reconciliation_id, id))
    .orderBy(asc(l.group_name), asc(l.product_name));

  const ev = inventory_reconciliation_events;
  const events = await db.select().from(ev).where(eq(ev.reconciliation_id, id)).orderBy(asc(ev.created_at));
  const counts = await db
    .select({
      id: inventory_counts.id,
      template_name: inventory_counts.template_name,
      status: inventory_counts.status,
      unlocked_until: inventory_counts.unlocked_until,
      period: inventory_counts.period,
    })
    .from(inventory_counts)
    .where(and(eq(inventory_counts.store_id, r.store_id), eq(inventory_counts.period, r.period), ne(inventory_counts.status, "cancelled")))
    .orderBy(asc(inventory_counts.created_at));
  const names = await userNames(db, [...events.map((e) => e.user_id ?? ""), r.reviewed_by ?? ""]);

  return {
    ...overviewRow(r, store_name, admin_state),
    iiko_document_id: r.iiko_document_id,
    iiko_document_at: r.iiko_document_at,
    book_at: r.book_at,
    iiko_candidates: (r.iiko_candidates as ReconCandidate[] | null) ?? null,
    review_comment: r.review_comment,
    reviewed_by_name: r.reviewed_by ? names.get(r.reviewed_by) ?? "—" : null,
    reviewed_at: r.reviewed_at,
    accepted_totals: (r.accepted_totals as ReconTotals | null) ?? null,
    counts: counts.map((c) => ({
      id: c.id,
      template_name: c.template_name,
      status: c.status,
      unlocked_until: c.unlocked_until,
      input_open: isInputOpen(c.period, c.unlocked_until, now),
    })),
    lines: lines.map((x) => ({
      ...x,
      admin_state: x.admin_state as ReconLine["admin_state"],
      cost_source: x.cost_source as ReconLine["cost_source"],
    })),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      user_name: e.user_id ? names.get(e.user_id) ?? "—" : null,
      payload: e.payload,
      created_at: e.created_at,
    })),
    branch_edits: await branchEdits(db, counts.map((c) => c.id)),
  };
}

export async function chooseDocument(db: DbLike, id: string, documentId: string, userId: string) {
  return db.transaction(async (tx) => {
    if (!UUID_RE.test(id)) throw new InventoryError(404, "not_found");
    const [row] = await tx.select().from(inventory_reconciliations).where(eq(inventory_reconciliations.id, id)).for("update");
    if (!row) throw new InventoryError(404, "not_found");
    const cand = ((row.iiko_candidates as ReconCandidate[] | null) ?? []).find((c) => c.id === documentId);
    if (!cand) throw new InventoryError(422, "not_a_candidate");
    await tx
      .update(inventory_reconciliations)
      .set({ iiko_document_id: documentId, updated_at: sql`now()` })
      .where(eq(inventory_reconciliations.id, id));
    await tx.insert(inventory_reconciliation_events).values({
      reconciliation_id: id,
      type: "doc_chosen",
      user_id: userId,
      payload: { document_id: documentId, num: cand.num },
    });
    return { store_id: row.store_id, period: row.period };
  });
}

const TRANSITIONS: Record<string, ("in_review" | "accepted")[]> = {
  ready: ["in_review", "accepted"],
  in_review: ["in_review", "accepted"],
  accepted: ["in_review"],
};

export async function setReconStatus(
  db: DbLike,
  id: string,
  status: "in_review" | "accepted",
  comment: string | null,
  userId: string
) {
  return db.transaction(async (tx) => {
    if (!UUID_RE.test(id)) throw new InventoryError(404, "not_found");
    const [row] = await tx.select().from(inventory_reconciliations).where(eq(inventory_reconciliations.id, id)).for("update");
    if (!row) throw new InventoryError(404, "not_found");
    if (!(TRANSITIONS[row.status] ?? []).includes(status)) throw new InventoryError(409, "not_ready", { status: row.status });
    const text = comment?.trim() || null;
    if (status === "in_review" && !text) throw new InventoryError(422, "comment_required");
    const totals: ReconTotals = {
      lines_total: row.lines_total,
      mismatch_ab_count: row.mismatch_ab_count,
      diff_ab_sum: row.diff_ab_sum,
      diff_ac_sum: row.diff_ac_sum,
      diff_bc_sum: row.diff_bc_sum,
    };
    await tx
      .update(inventory_reconciliations)
      .set({
        status,
        review_comment: text ?? row.review_comment,
        reviewed_by: userId,
        reviewed_at: sql`now()`,
        updated_at: sql`now()`,
        ...(status === "accepted" ? { accepted_totals: totals, changed_after_accept: false } : {}),
      })
      .where(eq(inventory_reconciliations.id, id));
    await tx.insert(inventory_reconciliation_events).values({
      reconciliation_id: id,
      type: "status_changed",
      user_id: userId,
      payload: { from: row.status, to: status, comment: text },
    });
    return { ok: true as const };
  });
}
```

- [ ] **Step 4: `routes.ts`**

```ts
// Маршруты сверки (spec 2026-10-06, §6). Плагин без своего префикса: подключается
// внутри inventoryControllerImpl, который даёт /api. Все — под inventory.reconcile:
// филиал цифр iiko не видит.
import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom } from "../access";
import { unlockCount } from "../counts";
import { InventoryError, run } from "../errors";
import { isValidPeriod } from "../rules";
import { enqueueReconcile, readStatus, reconcileQueue } from "./queue";
import { chooseDocument, listReconciliations, loadReconciliation, reconTarget, setReconStatus } from "./read";

function assertPeriod(period: string) {
  if (!isValidPeriod(period)) throw new InventoryError(422, "invalid_period");
}

const P = "inventory.reconcile";

export const reconcileRoutes = new Elysia({ name: "@api/inventory/reconcile" })
  .use(ctx)
  .get(
    "/inventory/reconciliations",
    async ({ query, drizzle, set }) =>
      run(set, async () => {
        assertPeriod(query.period);
        return listReconciliations(drizzle, query.period);
      }),
    { permission: P, query: t.Object({ period: t.String() }) }
  )
  .post(
    "/inventory/reconciliations/fetch",
    async ({ body, user, redis, set }) =>
      run(set, async () => {
        assertPeriod(body.period);
        return enqueueReconcile(reconcileQueue(), redis, { period: body.period, userId: user!.id });
      }),
    { permission: P, body: t.Object({ period: t.String() }) }
  )
  .get(
    "/inventory/reconciliations/fetch-status",
    async ({ query, redis, set }) =>
      run(set, async () => {
        assertPeriod(query.period);
        return readStatus(redis, query.period);
      }),
    { permission: P, query: t.Object({ period: t.String() }) }
  )
  .get(
    "/inventory/reconciliations/:id",
    async ({ params, drizzle, set }) => run(set, async () => loadReconciliation(drizzle, params.id, new Date())),
    { permission: P, params: t.Object({ id: t.String() }) }
  )
  .post(
    "/inventory/reconciliations/:id/refresh",
    async ({ params, drizzle, redis, user, set }) =>
      run(set, async () => {
        const target = await reconTarget(drizzle, params.id);
        return enqueueReconcile(reconcileQueue(), redis, { period: target.period, storeId: target.store_id, userId: user!.id });
      }),
    { permission: P, params: t.Object({ id: t.String() }) }
  )
  .post(
    "/inventory/reconciliations/:id/document",
    async ({ params, body, drizzle, redis, user, set }) =>
      run(set, async () => {
        const target = await chooseDocument(drizzle, params.id, body.document_id, user!.id);
        return enqueueReconcile(reconcileQueue(), redis, { period: target.period, storeId: target.store_id, userId: user!.id });
      }),
    { permission: P, params: t.Object({ id: t.String() }), body: t.Object({ document_id: t.String() }) }
  )
  .post(
    "/inventory/reconciliations/:id/status",
    async ({ params, body, drizzle, user, set }) =>
      run(set, async () => setReconStatus(drizzle, params.id, body.status, body.comment ?? null, user!.id)),
    {
      permission: P,
      params: t.Object({ id: t.String() }),
      body: t.Object({
        status: t.Union([t.Literal("in_review"), t.Literal("accepted")]),
        comment: t.Optional(t.String({ maxLength: 2000 })),
      }),
    }
  )
  .post(
    "/inventory/counts/:id/unlock",
    async ({ params, user, role, drizzle, cacheController, set }) =>
      run(set, async () => unlockCount(drizzle, await actorFrom(cacheController, user, role), params.id, new Date())),
    { permission: P, params: t.Object({ id: t.String() }) }
  );
```

- [ ] **Step 5: Подключить плагин в `controller.ts`**

1. Удалить временный маршрут `.post("/inventory/counts/:id/unlock", …)` из Task 4 и `unlockCount` из импорта `./counts`.
2. Добавить импорт `import { reconcileRoutes } from "./reconcile/routes";`.
3. Сразу после `.guard({ detail: { hide: true } })` вставить `.use(reconcileRoutes)`.

- [ ] **Step 6: Запустить все тесты модуля**

```bash
cd backend && bun run test:http:reconcile 2>&1 | tail -15 && bun run test:http:inventory 2>&1 | tail -8
```
Expected: PASS оба скрипта (в `test:http:inventory` — describe «срок ввода и разблокировка» с `/unlock`, теперь из плагина). Если `obliterate` в `afterAll` ругается на активные задачи — у `force: true` это не ошибка; если падает — проверить, что в тестовом окружении `INVENTORY_RECONCILE_QUEUE=inventory_reconcile_test` (скрипт из Task 2).

- [ ] **Step 7: Коммит**

```bash
git add backend/src/modules/inventory/reconcile/read.ts backend/src/modules/inventory/reconcile/routes.ts backend/src/modules/inventory/reconcile/routes.test.ts backend/src/modules/inventory/controller.ts
git commit -m "feat(inventory/reconcile): API сверки — обзор, детали, загрузка, выбор документа, статусы

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Админка — клиент API, форматирование, меню, тексты, экран обзора

**Files:**
- Modify: `admin/lib/inventory-api.ts`
- Create: `admin/lib/inventory/money.ts`, Test: `admin/lib/inventory/money.test.ts`
- Modify: `admin/components/layout/nav-config.tsx:76-84`
- Create: `<scratchpad>/i18n_reconcile.mjs` (одноразовый скрипт слияния переводов, не коммитится)
- Modify: `admin/messages/{ru,en,uz-Latn,uz-Cyrl}.json`
- Create: `admin/app/[locale]/inventory/reconciliation/page.tsx`
- Create: `admin/app/[locale]/inventory/reconciliation/_components/recon-status-badge.tsx`
- Create: `admin/app/[locale]/inventory/reconciliation/_components/fetch-panel.tsx`

**Interfaces:**
- Consumes: маршруты Task 9, типы `@backend/modules/inventory/reconcile/types`.
- Produces:
  - `inventoryApi.reconcile.{ list(period), fetch(period), status(period), get(id), refresh(id), chooseDocument(id, documentId), setStatus(id, status, comment?) }`, `inventoryApi.unlock(countId)`;
  - `formatMoney(v: string | number | null): string`, `formatQty(v: string | number | null): string`, `formatDateTime(iso: string | null, locale: string): string` в `admin/lib/inventory/money.ts`;
  - `<ReconStatusBadge status />`, `<FetchPanel period onDone />`;
  - ключи переводов `inventory.reconcile.*` и `inventory.deadline.*`.

- [ ] **Step 1: Тест форматирования**

`admin/lib/inventory/money.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { formatMoney, formatQty } from "./money";

const _ = "\u202F"; // узкий неразрывный пробел — разделитель тысяч

describe("formatMoney", () => {
  it("целые сумы с узкими пробелами, минус — настоящий минус, null — тире", () => {
    expect(formatMoney("-9905579.00")).toBe(`−9${_}905${_}579`);
    expect(formatMoney(14379599)).toBe(`14${_}379${_}599`);
    expect(formatMoney("0.40")).toBe("0");
    expect(formatMoney(null)).toBe("—");
  });
});

describe("formatQty", () => {
  it("до 3 знаков, без хвостовых нулей", () => {
    expect(formatQty("24.0000")).toBe("24");
    expect(formatQty("-0.1170")).toBe("−0,117");
    expect(formatQty("1234.5")).toBe(`1${_}234,5`);
    expect(formatQty(null)).toBe("—");
  });
});
```

Run: `cd admin && bun test lib/inventory/money.test.ts` → FAIL (нет модуля).

- [ ] **Step 2: `admin/lib/inventory/money.ts`**

```ts
// Форматирование цифр сверки. Ручное, без Intl: вывод одинаков на сервере и
// в браузере, и тесты не зависят от ICU. Разделитель тысяч — узкий неразрывный пробел.
const NNBSP = " ";
const MINUS = "−";

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

export function formatMoney(v: string | number | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return "—";
  return (n < 0 ? MINUS : "") + group(String(Math.abs(n)));
}

export function formatQty(v: string | number | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const [i, f] = Math.abs(n).toFixed(3).replace(/\.?0+$/, "").split(".");
  return (n < 0 ? MINUS : "") + group(i) + (f ? `,${f}` : "");
}

export function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const intl = locale === "uz-Latn" ? "uz" : locale;
  try {
    return d.toLocaleString(intl, { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}
```

Run: `cd admin && bun test lib/inventory/money.test.ts` → PASS.

- [ ] **Step 3: Клиент API**

В `admin/lib/inventory-api.ts`:

1. После существующего `import type { … } from "@backend/modules/inventory/types";` добавить:

```ts
import type { ReconDetail, ReconFetchStatus, ReconOverviewRow } from "@backend/modules/inventory/reconcile/types";
```

2. В объект `inventoryApi`, после `folders: …,` добавить:

```ts
  unlock: (countId: string) => call<{ unlocked_until: string }>(inv.counts({ id: countId }).unlock.post({})),
  reconcile: {
    list: (period: string) => call<ReconOverviewRow[]>(inv.reconciliations.get({ query: { period } })),
    fetch: (period: string) => call<ReconFetchStatus>(inv.reconciliations.fetch.post({ period })),
    status: (period: string) => call<ReconFetchStatus>(inv.reconciliations["fetch-status"].get({ query: { period } })),
    get: (id: string) => call<ReconDetail>(inv.reconciliations({ id }).get()),
    refresh: (id: string) => call<ReconFetchStatus>(inv.reconciliations({ id }).refresh.post({})),
    chooseDocument: (id: string, documentId: string) =>
      call<ReconFetchStatus>(inv.reconciliations({ id }).document.post({ document_id: documentId })),
    setStatus: (id: string, status: "in_review" | "accepted", comment?: string) =>
      call<{ ok: true }>(inv.reconciliations({ id }).status.post(comment ? { status, comment } : { status })),
  },
```

- [ ] **Step 4: Меню**

В `admin/components/layout/nav-config.tsx`, в группе «Инвентаризация» после пункта «Шаблоны инвентаризаций» добавить:

```tsx
        { title: "Сверка с iiko", href: p("/inventory/reconciliation"), permission: "inventory.reconcile" },
```

- [ ] **Step 5: Переводы**

Создать `<scratchpad>/i18n_reconcile.mjs` и выполнить `node <scratchpad>/i18n_reconcile.mjs` из корня репозитория. Скрипт дописывает ключи в `inventory.reconcile` и `inventory.deadline`, не трогая остальное:

```js
import { readFileSync, writeFileSync } from "node:fs";

const T = {
  ru: {
    reconcile: {
      title: "Сверка с iiko", period: "Месяц", fetch: "Загрузить из iiko", refresh: "Обновить из iiko",
      alreadyRunning: "Загрузка за этот месяц уже идёт",
      state: { idle: "Ещё не загружали", queued: "В очереди", stage1: "Загружаем документы iiko…", stage2: "Считаем учёт и расхождения…", done: "Готово", failed: "Ошибка: {error}" },
      saved: "Данные iiko сохранены: получено {received}, не получено {missing}",
      missingTitle: "Нет проведённого документа",
      empty: "За этот месяц сверки ещё нет — нажмите «Загрузить из iiko»",
      col: { store: "Склад", admin: "Админка", document: "Документ iiko", status: "Статус", mismatch: "A≠B", ab: "A − B, сум", ac: "A − C, сум", bc: "B − C, сум" },
      admin: { submitted: "Сдано", draft: "Черновик", none: "Нет пересчёта", overdue: "Не сдано" },
      status: { waiting_iiko: "Ждём документ iiko", needs_choice: "Нужен выбор документа", ready: "Готово к разбору", in_review: "На разборе", accepted: "Принято" },
      unposted: "распроведён после загрузки", changedAfterAccept: "изменено после принятия",
      all: "Все", organization: "Организация", open: "Открыть", back: "К сверке",
      fetchedAt: "Загружено {at}", bookAt: "Учёт на {at}",
      tabs: { lines: "Расхождения", log: "Журнал" }, onlyMismatch: "Только A ≠ B",
      line: { product: "Товар", a: "Админка (A)", b: "iiko (B)", c: "Учёт (C)", ab: "A − B", acSum: "A − C, сум", bcSum: "B − C, сум" },
      flag: { skipped: "не считали", absent: "не считали в админке", multi: "в нескольких пересчётах", noCost: "нет цены" },
      choose: { title: "Выберите документ iiko", hint: "Документов «Месяц» несколько или ни одного — укажите, какой сверять", pick: "Сверять этот", shortage: "недостача", surplus: "излишек" },
      review: { toReview: "На разбор", accept: "Принять", comment: "Комментарий", commentRequired: "Для «На разбор» нужен комментарий", reviewedBy: "{name}, {at}" },
      event: { fetched: "Загружен документ №{num}", changed: "изменено строк: {count}", doc_missing: "Документ №{num} пропал из iiko (распроведён)", doc_chosen: "Выбран документ №{num}", calculated: "Пересчитано", status_changed: "Статус → {to}" },
      edits: { title: "Правки филиала после отправки", entry_added: "добавил {qty}", entry_deleted: "удалил {qty}", reopened: "вернул в черновик", unlocked: "разблокировал", none: "Правок после отправки нет" },
      counts: { title: "Пересчёты в админке", unlock: "Разблокировать на 24 ч", unlocked: "Разблокировано до {until}", closed: "Срок ввода истёк", open: "Ввод открыт" },
    },
    deadline: { closed: "Срок ввода истёк {deadline}. Изменить может только офис.", unlocked: "Разблокировано офисом до {until}", until: "Срок ввода: {deadline}" },
  },
  en: {
    reconcile: {
      title: "iiko reconciliation", period: "Month", fetch: "Load from iiko", refresh: "Reload from iiko",
      alreadyRunning: "A load for this month is already running",
      state: { idle: "Not loaded yet", queued: "Queued", stage1: "Loading iiko documents…", stage2: "Calculating book stock and differences…", done: "Done", failed: "Error: {error}" },
      saved: "iiko data saved: received {received}, missing {missing}",
      missingTitle: "No posted document",
      empty: "No reconciliation for this month yet — press “Load from iiko”",
      col: { store: "Store", admin: "Admin count", document: "iiko document", status: "Status", mismatch: "A≠B", ab: "A − B, UZS", ac: "A − C, UZS", bc: "B − C, UZS" },
      admin: { submitted: "Submitted", draft: "Draft", none: "No count", overdue: "Not submitted" },
      status: { waiting_iiko: "Waiting for iiko document", needs_choice: "Choose a document", ready: "Ready for review", in_review: "Under review", accepted: "Accepted" },
      unposted: "unposted after load", changedAfterAccept: "changed after acceptance",
      all: "All", organization: "Organization", open: "Open", back: "Back to reconciliation",
      fetchedAt: "Loaded {at}", bookAt: "Book stock at {at}",
      tabs: { lines: "Differences", log: "Log" }, onlyMismatch: "Only A ≠ B",
      line: { product: "Product", a: "Admin (A)", b: "iiko (B)", c: "Book (C)", ab: "A − B", acSum: "A − C, UZS", bcSum: "B − C, UZS" },
      flag: { skipped: "not counted", absent: "not counted in admin", multi: "in several counts", noCost: "no price" },
      choose: { title: "Choose the iiko document", hint: "There are several “Месяц” documents or none — pick the one to reconcile", pick: "Use this one", shortage: "shortage", surplus: "surplus" },
      review: { toReview: "Under review", accept: "Accept", comment: "Comment", commentRequired: "A comment is required for “Under review”", reviewedBy: "{name}, {at}" },
      event: { fetched: "Document #{num} loaded", changed: "rows changed: {count}", doc_missing: "Document #{num} disappeared from iiko (unposted)", doc_chosen: "Document #{num} chosen", calculated: "Recalculated", status_changed: "Status → {to}" },
      edits: { title: "Branch edits after submission", entry_added: "added {qty}", entry_deleted: "deleted {qty}", reopened: "returned to draft", unlocked: "unlocked", none: "No edits after submission" },
      counts: { title: "Admin counts", unlock: "Unlock for 24 h", unlocked: "Unlocked until {until}", closed: "Input deadline passed", open: "Input open" },
    },
    deadline: { closed: "Input deadline passed {deadline}. Only the office can change it.", unlocked: "Unlocked by the office until {until}", until: "Input deadline: {deadline}" },
  },
  "uz-Latn": {
    reconcile: {
      title: "iiko bilan solishtirish", period: "Oy", fetch: "iiko'dan yuklash", refresh: "iiko'dan yangilash",
      alreadyRunning: "Bu oy uchun yuklash allaqachon ketmoqda",
      state: { idle: "Hali yuklanmagan", queued: "Navbatda", stage1: "iiko hujjatlari yuklanmoqda…", stage2: "Hisob qoldig'i va farqlar hisoblanmoqda…", done: "Tayyor", failed: "Xato: {error}" },
      saved: "iiko ma'lumotlari saqlandi: olindi {received}, olinmadi {missing}",
      missingTitle: "O'tkazilgan hujjat yo'q",
      empty: "Bu oy uchun solishtirish hali yo'q — «iiko'dan yuklash» ni bosing",
      col: { store: "Ombor", admin: "Admin", document: "iiko hujjati", status: "Holat", mismatch: "A≠B", ab: "A − B, so'm", ac: "A − C, so'm", bc: "B − C, so'm" },
      admin: { submitted: "Topshirilgan", draft: "Qoralama", none: "Sanoq yo'q", overdue: "Topshirilmagan" },
      status: { waiting_iiko: "iiko hujjati kutilmoqda", needs_choice: "Hujjatni tanlash kerak", ready: "Ko'rib chiqishga tayyor", in_review: "Ko'rib chiqilmoqda", accepted: "Qabul qilingan" },
      unposted: "yuklangandan keyin o'tkazish bekor qilingan", changedAfterAccept: "qabul qilingandan keyin o'zgargan",
      all: "Hammasi", organization: "Tashkilot", open: "Ochish", back: "Solishtirishga qaytish",
      fetchedAt: "Yuklangan {at}", bookAt: "{at} holatiga hisob",
      tabs: { lines: "Farqlar", log: "Jurnal" }, onlyMismatch: "Faqat A ≠ B",
      line: { product: "Mahsulot", a: "Admin (A)", b: "iiko (B)", c: "Hisob (C)", ab: "A − B", acSum: "A − C, so'm", bcSum: "B − C, so'm" },
      flag: { skipped: "sanalmagan", absent: "adminda sanalmagan", multi: "bir nechta sanoqda", noCost: "narx yo'q" },
      choose: { title: "iiko hujjatini tanlang", hint: "«Месяц» hujjatlari bir nechta yoki umuman yo'q — qaysi birini solishtirishni belgilang", pick: "Shuni solishtirish", shortage: "kamomad", surplus: "ortiqcha" },
      review: { toReview: "Ko'rib chiqishga", accept: "Qabul qilish", comment: "Izoh", commentRequired: "«Ko'rib chiqishga» uchun izoh kerak", reviewedBy: "{name}, {at}" },
      event: { fetched: "№{num} hujjat yuklandi", changed: "o'zgargan qatorlar: {count}", doc_missing: "№{num} hujjat iiko'dan yo'qoldi (o'tkazish bekor qilingan)", doc_chosen: "№{num} hujjat tanlandi", calculated: "Qayta hisoblandi", status_changed: "Holat → {to}" },
      edits: { title: "Yuborilgandan keyingi filial tuzatishlari", entry_added: "{qty} qo'shdi", entry_deleted: "{qty} o'chirdi", reopened: "qoralamaga qaytardi", unlocked: "blokdan chiqardi", none: "Yuborilgandan keyin tuzatish yo'q" },
      counts: { title: "Admindagi sanoqlar", unlock: "24 soatga blokdan chiqarish", unlocked: "{until} gacha blokdan chiqarilgan", closed: "Kiritish muddati tugagan", open: "Kiritish ochiq" },
    },
    deadline: { closed: "Kiritish muddati {deadline} da tugagan. Faqat ofis o'zgartira oladi.", unlocked: "Ofis tomonidan {until} gacha blokdan chiqarilgan", until: "Kiritish muddati: {deadline}" },
  },
  "uz-Cyrl": {
    reconcile: {
      title: "iiko билан солиштириш", period: "Ой", fetch: "iiko'дан юклаш", refresh: "iiko'дан янгилаш",
      alreadyRunning: "Бу ой учун юклаш аллақачон кетмоқда",
      state: { idle: "Ҳали юкланмаган", queued: "Навбатда", stage1: "iiko ҳужжатлари юкланмоқда…", stage2: "Ҳисоб қолдиғи ва фарқлар ҳисобланмоқда…", done: "Тайёр", failed: "Хато: {error}" },
      saved: "iiko маълумотлари сақланди: олинди {received}, олинмади {missing}",
      missingTitle: "Ўтказилган ҳужжат йўқ",
      empty: "Бу ой учун солиштириш ҳали йўқ — «iiko'дан юклаш» ни босинг",
      col: { store: "Омбор", admin: "Админ", document: "iiko ҳужжати", status: "Ҳолат", mismatch: "A≠B", ab: "A − B, сўм", ac: "A − C, сўм", bc: "B − C, сўм" },
      admin: { submitted: "Топширилган", draft: "Қоралама", none: "Саноқ йўқ", overdue: "Топширилмаган" },
      status: { waiting_iiko: "iiko ҳужжати кутилмоқда", needs_choice: "Ҳужжатни танлаш керак", ready: "Кўриб чиқишга тайёр", in_review: "Кўриб чиқилмоқда", accepted: "Қабул қилинган" },
      unposted: "юклангандан кейин ўтказиш бекор қилинган", changedAfterAccept: "қабул қилингандан кейин ўзгарган",
      all: "Ҳаммаси", organization: "Ташкилот", open: "Очиш", back: "Солиштиришга қайтиш",
      fetchedAt: "Юкланган {at}", bookAt: "{at} ҳолатига ҳисоб",
      tabs: { lines: "Фарқлар", log: "Журнал" }, onlyMismatch: "Фақат A ≠ B",
      line: { product: "Маҳсулот", a: "Админ (A)", b: "iiko (B)", c: "Ҳисоб (C)", ab: "A − B", acSum: "A − C, сўм", bcSum: "B − C, сўм" },
      flag: { skipped: "саналмаган", absent: "админда саналмаган", multi: "бир нечта саноқда", noCost: "нарх йўқ" },
      choose: { title: "iiko ҳужжатини танланг", hint: "«Месяц» ҳужжатлари бир нечта ёки умуман йўқ — қайси бирини солиштиришни белгиланг", pick: "Шуни солиштириш", shortage: "камомад", surplus: "ортиқча" },
      review: { toReview: "Кўриб чиқишга", accept: "Қабул қилиш", comment: "Изоҳ", commentRequired: "«Кўриб чиқишга» учун изоҳ керак", reviewedBy: "{name}, {at}" },
      event: { fetched: "№{num} ҳужжат юкланди", changed: "ўзгарган қаторлар: {count}", doc_missing: "№{num} ҳужжат iiko'дан йўқолди (ўтказиш бекор қилинган)", doc_chosen: "№{num} ҳужжат танланди", calculated: "Қайта ҳисобланди", status_changed: "Ҳолат → {to}" },
      edits: { title: "Юборилгандан кейинги филиал тузатишлари", entry_added: "{qty} қўшди", entry_deleted: "{qty} ўчирди", reopened: "қораламага қайтарди", unlocked: "блокдан чиқарди", none: "Юборилгандан кейин тузатиш йўқ" },
      counts: { title: "Админдаги саноқлар", unlock: "24 соатга блокдан чиқариш", unlocked: "{until} гача блокдан чиқарилган", closed: "Киритиш муддати тугаган", open: "Киритиш очиқ" },
    },
    deadline: { closed: "Киритиш муддати {deadline} да тугаган. Фақат офис ўзгартира олади.", unlocked: "Офис томонидан {until} гача блокдан чиқарилган", until: "Киритиш муддати: {deadline}" },
  },
};

for (const [locale, add] of Object.entries(T)) {
  const path = `admin/messages/${locale}.json`;
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.inventory = { ...json.inventory, ...add };
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}
console.log("ok");
```

Run: `node <scratchpad>/i18n_reconcile.mjs && git diff --stat admin/messages`
Expected: `ok`, изменены 4 файла. Если `git diff` показывает переформатирование всего файла (другие отступы) — откатить (`git checkout admin/messages`), выяснить отступ исходника (`head -3 admin/messages/ru.json`) и подставить его в `JSON.stringify(json, null, N)`.

- [ ] **Step 6: Бейдж статуса**

`admin/app/[locale]/inventory/reconciliation/_components/recon-status-badge.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { Badge } from "@admin/components/ui/badge";
import type { ReconStatus } from "@backend/modules/inventory/reconcile/types";

const VARIANT: Record<ReconStatus, "default" | "secondary" | "outline" | "destructive"> = {
  waiting_iiko: "outline",
  needs_choice: "destructive",
  ready: "secondary",
  in_review: "default",
  accepted: "outline",
};

export function ReconStatusBadge({ status }: { status: ReconStatus }) {
  const t = useTranslations("inventory.reconcile.status");
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
```

- [ ] **Step 7: Панель загрузки**

`admin/app/[locale]/inventory/reconciliation/_components/fetch-panel.tsx`:

```tsx
"use client";
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime } from "@admin/lib/inventory/money";
import type { ReconFetchState } from "@backend/modules/inventory/reconcile/types";

const RUNNING: ReconFetchState[] = ["queued", "stage1", "stage2"];

export function FetchPanel({ period }: { period: string }) {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["recon_status", period],
    queryFn: () => inventoryApi.reconcile.status(period),
    refetchInterval: (q) => (q.state.data && RUNNING.includes(q.state.data.state) ? 3000 : false),
  });
  const state = status.data?.state ?? "idle";
  const running = RUNNING.includes(state);

  // Сообщение «данные сохранены» — один раз, когда этап 1 закончился.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    const s = status.data;
    if (!s?.stage1_done_at || announced.current === s.stage1_done_at) return;
    if (announced.current !== null) toast.success(t("saved", { received: s.received.length, missing: s.missing.length }));
    announced.current = s.stage1_done_at;
    void qc.invalidateQueries({ queryKey: ["recon_list", period] });
  }, [status.data, period, qc, t]);
  useEffect(() => {
    if (state === "done") void qc.invalidateQueries({ queryKey: ["recon_list", period] });
  }, [state, period, qc]);

  const start = useMutation({
    mutationFn: () => inventoryApi.reconcile.fetch(period),
    onSuccess: () => {
      announced.current = "";
      void status.refetch();
    },
    onError: (e: Error) =>
      toast.error(e instanceof InventoryApiError && e.status === 409 ? t("alreadyRunning") : e.message),
  });

  const s = status.data;
  return (
    <div className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={running || start.isPending} onClick={() => start.mutate()}>
          {t("fetch")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {state === "failed" ? t("state.failed", { error: s?.error ?? "" }) : t(`state.${state}`)}
          {s?.finished_at && state === "done" ? ` · ${formatDateTime(s.finished_at, locale)}` : ""}
        </span>
      </div>
      {s && s.stage1_done_at && (
        <div className="text-sm">
          {t("saved", { received: s.received.length, missing: s.missing.length })}
          {s.missing.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-muted-foreground">{t("missingTitle")}</summary>
              <ul className="mt-1 list-disc pl-5">
                {s.missing.map((m) => (
                  <li key={m.store_id}>{m.store_name}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Экран обзора**

`admin/app/[locale]/inventory/reconciliation/page.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { Link } from "@admin/i18n/routing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatMoney } from "@admin/lib/inventory/money";
import { periodLabel, recentPeriods } from "@admin/lib/inventory/periods";
import type { ReconOverviewRow, ReconStatus } from "@backend/modules/inventory/reconcile/types";
import { FetchPanel } from "./_components/fetch-panel";
import { ReconStatusBadge } from "./_components/recon-status-badge";

const ALL = "__all__";
const STATUSES: ReconStatus[] = ["needs_choice", "ready", "in_review", "accepted", "waiting_iiko"];

function AdminCell({ row }: { row: ReconOverviewRow }) {
  const t = useTranslations("inventory.reconcile.admin");
  const overdue = row.admin_state !== "submitted" && Date.now() >= Date.parse(row.deadline);
  if (overdue) return <span className="text-destructive">{t("overdue")}</span>;
  return <span>{t(row.admin_state)}</span>;
}

function Overview() {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  // По умолчанию — прошлый месяц: его и сверяют 1–7 числа.
  const periods = useMemo(() => recentPeriods(new Date(), 13), []);
  const [period, setPeriod] = useState(periods[1]);
  const [status, setStatus] = useState<string>(ALL);
  const [org, setOrg] = useState<string>(ALL);

  const orgs = useQuery({ queryKey: ["inventory_orgs"], queryFn: inventoryApi.organizations });
  const list = useQuery({ queryKey: ["recon_list", period], queryFn: () => inventoryApi.reconcile.list(period) });

  const rows = (list.data ?? [])
    .filter((r) => status === ALL || r.status === status)
    .filter((r) => org === ALL || r.organization_id === org)
    .sort((a, b) => Math.abs(Number(b.diff_ab_sum ?? 0)) - Math.abs(Number(a.diff_ab_sum ?? 0)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-11 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p} value={p}>
                {periodLabel(p, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("all")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="h-11 w-56">
            <SelectValue placeholder={t("organization")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("all")}</SelectItem>
            {(orgs.data ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FetchPanel period={period} />

      {list.data && list.data.length === 0 ? (
        <div className="text-muted-foreground">{t("empty")}</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("col.store")}</TableHead>
                <TableHead>{t("col.admin")}</TableHead>
                <TableHead>{t("col.document")}</TableHead>
                <TableHead>{t("col.status")}</TableHead>
                <TableHead className="text-right">{t("col.mismatch")}</TableHead>
                <TableHead className="text-right">{t("col.ab")}</TableHead>
                <TableHead className="text-right">{t("col.ac")}</TableHead>
                <TableHead className="text-right">{t("col.bc")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link className="underline" href={`/inventory/reconciliation/${r.id}`}>
                      {r.store_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <AdminCell row={r} />
                  </TableCell>
                  <TableCell>
                    {r.iiko_document_num ? `№${r.iiko_document_num}` : "—"}
                    {r.iiko_document_comment && <span className="ml-1 text-xs text-muted-foreground">{r.iiko_document_comment}</span>}
                    {r.iiko_doc_state === "unposted_after_fetch" && <div className="text-xs text-orange-600">{t("unposted")}</div>}
                  </TableCell>
                  <TableCell>
                    <ReconStatusBadge status={r.status} />
                    {r.changed_after_accept && <div className="text-xs text-orange-600">{t("changedAfterAccept")}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.mismatch_ab_count || "—"}</TableCell>
                  <TableCell className={`text-right tabular-nums ${Number(r.diff_ab_sum ?? 0) !== 0 ? "text-orange-600" : ""}`}>
                    {formatMoney(r.diff_ab_sum)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.diff_ac_sum)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.diff_bc_sum)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function ReconciliationPage() {
  const t = useTranslations("inventory.reconcile");
  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CanAccess permission="inventory.reconcile">
        <Overview />
      </CanAccess>
    </div>
  );
}
```

Перед этим шагом проверить сигнатуру `CanAccess`: `sed -n 1,20p admin/components/can-access.tsx` — проп `permission: string`, рендер `children`. Если проп называется иначе — подставить его.

- [ ] **Step 9: Типы, линт и тесты**

```bash
cd admin && bunx tsc --noEmit -p . 2>&1 | grep -E "inventory|nav-config" | head -20; bun lint 2>&1 | grep -E "inventory|nav-config" | head; bun test lib/inventory/
```
Expected: `tsc` и `lint` по этим путям — пусто; тесты `lib/inventory` — PASS.

- [ ] **Step 10: Коммит**

```bash
git add admin/lib/inventory-api.ts admin/lib/inventory/money.ts admin/lib/inventory/money.test.ts admin/components/layout/nav-config.tsx admin/messages/ru.json admin/messages/en.json admin/messages/uz-Latn.json admin/messages/uz-Cyrl.json "admin/app/[locale]/inventory/reconciliation"
git commit -m "feat(admin/inventory): обзор сверки с iiko — месяц, загрузка, статусы, суммы

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Админка — экран сверки склада

**Files:**
- Create: `admin/app/[locale]/inventory/reconciliation/[id]/page.tsx`
- Create: `admin/app/[locale]/inventory/reconciliation/_components/recon-lines.tsx`
- Create: `admin/app/[locale]/inventory/reconciliation/_components/recon-log.tsx`
- Create: `admin/app/[locale]/inventory/reconciliation/_components/recon-actions.tsx`

**Interfaces:**
- Consumes: `inventoryApi.reconcile.*`, `inventoryApi.unlock`, `formatMoney`, `formatQty`, `formatDateTime`, `ReconStatusBadge` (Task 10), тип `ReconDetail`.
- Produces: страница `/<locale>/inventory/reconciliation/[id]`.

- [ ] **Step 1: Таблица расхождений**

`_components/recon-lines.tsx`:

```tsx
"use client";
import { Fragment, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@admin/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { formatMoney, formatQty } from "@admin/lib/inventory/money";
import type { ReconLine } from "@backend/modules/inventory/reconcile/types";

const mismatch = (l: ReconLine) => l.diff_ab_qty !== null && Number(l.diff_ab_qty) !== 0;

export function ReconLines({ lines }: { lines: ReconLine[] }) {
  const t = useTranslations("inventory.reconcile");
  const [only, setOnly] = useState(false);
  const groups = useMemo(() => {
    const by = new Map<string, ReconLine[]>();
    for (const l of lines) {
      if (only && !mismatch(l)) continue;
      by.set(l.group_name, [...(by.get(l.group_name) ?? []), l]);
    }
    return [...by.entries()];
  }, [lines, only]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={only} onCheckedChange={setOnly} />
        {t("onlyMismatch")}
      </label>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("line.product")}</TableHead>
              <TableHead className="text-right">{t("line.a")}</TableHead>
              <TableHead className="text-right">{t("line.b")}</TableHead>
              <TableHead className="text-right">{t("line.c")}</TableHead>
              <TableHead className="text-right">{t("line.ab")}</TableHead>
              <TableHead className="text-right">{t("line.acSum")}</TableHead>
              <TableHead className="text-right">{t("line.bcSum")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(([group, items]) => (
              <Fragment key={group}>
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={7} className="font-medium">
                    {group}
                  </TableCell>
                </TableRow>
                {items.map((l) => (
                  <TableRow key={l.product_id} className={mismatch(l) ? "bg-orange-500/10" : ""}>
                    <TableCell>
                      {l.product_name}
                      {l.unit_name && <span className="ml-1 text-xs text-muted-foreground">{l.unit_name}</span>}
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {l.admin_state === "skipped" && <span>{t("flag.skipped")}</span>}
                        {l.admin_state === "absent" && <span className="text-orange-600">{t("flag.absent")}</span>}
                        {l.admin_counts_n > 1 && <span>{t("flag.multi")}</span>}
                        {l.unit_cost === null && <span>{t("flag.noCost")}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(l.admin_qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(l.iiko_fact_qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(l.book_qty)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${mismatch(l) ? "font-semibold text-orange-600" : ""}`}>
                      {formatQty(l.diff_ab_qty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(l.diff_ac_sum)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(l.iiko_fact_qty === null ? null : l.iiko_correction_sum)}</TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Журнал**

`_components/recon-log.tsx`:

```tsx
"use client";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime, formatQty } from "@admin/lib/inventory/money";
import type { ReconBranchEdit, ReconEvent } from "@backend/modules/inventory/reconcile/types";

function EventText({ e }: { e: ReconEvent }) {
  const t = useTranslations("inventory.reconcile");
  const p = e.payload ?? {};
  switch (e.type) {
    case "fetched":
      return (
        <span>
          {t("event.fetched", { num: p.num ?? "" })}
          {p.changed_total > 0 && <> · {t("event.changed", { count: p.changed_total })}</>}
          {Array.isArray(p.changed) && p.changed.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {p.changed.slice(0, 50).map((c: any) => (
                <li key={c.product_id}>
                  {c.product_name}: {formatQty(c.qty_before)} → {formatQty(c.qty_after)}
                </li>
              ))}
            </ul>
          )}
        </span>
      );
    case "doc_missing":
      return <span className="text-orange-600">{t("event.doc_missing", { num: p.num ?? "" })}</span>;
    case "doc_chosen":
      return <span>{t("event.doc_chosen", { num: p.num ?? "" })}</span>;
    case "status_changed":
      return (
        <span>
          {t("event.status_changed", { to: t(`status.${p.to}`) })}
          {p.comment && <span className="text-muted-foreground"> — {p.comment}</span>}
        </span>
      );
    default:
      return <span>{t("event.calculated")}</span>;
  }
}

export function ReconLog({ events, edits }: { events: ReconEvent[]; edits: ReconBranchEdit[] }) {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  return (
    <div className="space-y-6">
      <ul className="space-y-2">
        {[...events].reverse().map((e) => (
          <li key={e.id} className="text-sm">
            <span className="mr-2 text-muted-foreground">{formatDateTime(e.created_at, locale)}</span>
            {e.user_name && <span className="mr-2">{e.user_name}:</span>}
            <EventText e={e} />
          </li>
        ))}
      </ul>
      <div>
        <h3 className="mb-2 font-medium">{t("edits.title")}</h3>
        {edits.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t("edits.none")}</div>
        ) : (
          <ul className="space-y-1">
            {edits.map((x, i) => (
              <li key={i} className="text-sm">
                <span className="mr-2 text-muted-foreground">{formatDateTime(x.at, locale)}</span>
                {x.user_name} — {t(`edits.${x.kind}`, { qty: formatQty(x.qty) })}
                {x.product_name && <span className="text-muted-foreground"> · {x.product_name}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Действия — выбор документа, статус, разблокировка, обновление**

`_components/recon-actions.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Textarea } from "@admin/components/ui/textarea";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime, formatMoney } from "@admin/lib/inventory/money";
import type { ReconDetail } from "@backend/modules/inventory/reconcile/types";

function useErr() {
  const t = useTranslations("inventory.reconcile");
  return (e: Error) =>
    toast.error(e instanceof InventoryApiError && e.status === 409 && e.message === "already_running" ? t("alreadyRunning") : e.message);
}

export function ChooseDocument({ detail, onDone }: { detail: ReconDetail; onDone: () => void }) {
  const t = useTranslations("inventory.reconcile");
  const onError = useErr();
  const choose = useMutation({
    mutationFn: (docId: string) => inventoryApi.reconcile.chooseDocument(detail.id, docId),
    onSuccess: onDone,
    onError,
  });
  if (detail.status !== "needs_choice" || !detail.iiko_candidates?.length) return null;
  return (
    <div className="space-y-2 rounded border border-destructive/40 p-3">
      <div className="font-medium">{t("choose.title")}</div>
      <div className="text-sm text-muted-foreground">{t("choose.hint")}</div>
      {detail.iiko_candidates.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            №{c.num} · {c.comment ?? "—"} · {t("choose.shortage")} {formatMoney(c.shortage_sum)} · {t("choose.surplus")} {formatMoney(c.surplus_sum)}
          </span>
          <Button size="sm" disabled={choose.isPending} onClick={() => choose.mutate(c.id)}>
            {t("choose.pick")}
          </Button>
        </div>
      ))}
    </div>
  );
}

export function ReviewControls({ detail, onDone }: { detail: ReconDetail; onDone: () => void }) {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  const onError = useErr();
  const [comment, setComment] = useState(detail.review_comment ?? "");
  const set = useMutation({
    mutationFn: (status: "in_review" | "accepted") => inventoryApi.reconcile.setStatus(detail.id, status, comment.trim() || undefined),
    onSuccess: onDone,
    onError,
  });
  if (!["ready", "in_review", "accepted"].includes(detail.status)) return null;
  return (
    <div className="space-y-2 rounded border p-3">
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("review.comment")} rows={2} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={set.isPending}
          onClick={() => (comment.trim() ? set.mutate("in_review") : toast.error(t("review.commentRequired")))}
        >
          {t("review.toReview")}
        </Button>
        {detail.status !== "accepted" && (
          <Button disabled={set.isPending} onClick={() => set.mutate("accepted")}>
            {t("review.accept")}
          </Button>
        )}
        {detail.reviewed_by_name && (
          <span className="text-xs text-muted-foreground">
            {t("review.reviewedBy", { name: detail.reviewed_by_name, at: formatDateTime(detail.reviewed_at, locale) })}
          </span>
        )}
      </div>
    </div>
  );
}

export function CountsPanel({ detail, onDone }: { detail: ReconDetail; onDone: () => void }) {
  const t = useTranslations("inventory.reconcile");
  const tStatus = useTranslations("inventory.status");
  const locale = useLocale();
  const onError = useErr();
  const unlock = useMutation({ mutationFn: (id: string) => inventoryApi.unlock(id), onSuccess: onDone, onError });
  if (!detail.counts.length) return null;
  return (
    <div className="space-y-2 rounded border p-3">
      <div className="font-medium">{t("counts.title")}</div>
      {detail.counts.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {c.template_name} · {tStatus(c.status as any)} ·{" "}
            {c.input_open
              ? c.unlocked_until
                ? t("counts.unlocked", { until: formatDateTime(c.unlocked_until, locale) })
                : t("counts.open")
              : t("counts.closed")}
          </span>
          {!c.input_open && (
            <Button size="sm" variant="outline" disabled={unlock.isPending} onClick={() => unlock.mutate(c.id)}>
              {t("counts.unlock")}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

export function RefreshButton({ detail, onQueued }: { detail: ReconDetail; onQueued: () => void }) {
  const t = useTranslations("inventory.reconcile");
  const onError = useErr();
  const refresh = useMutation({ mutationFn: () => inventoryApi.reconcile.refresh(detail.id), onSuccess: onQueued, onError });
  return (
    <Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
      {t("refresh")}
    </Button>
  );
}
```

- [ ] **Step 4: Страница**

`[id]/page.tsx`:

```tsx
"use client";
import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { Link } from "@admin/i18n/routing";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime, formatMoney } from "@admin/lib/inventory/money";
import { periodLabel } from "@admin/lib/inventory/periods";
import { ChooseDocument, CountsPanel, RefreshButton, ReviewControls } from "../_components/recon-actions";
import { ReconLines } from "../_components/recon-lines";
import { ReconLog } from "../_components/recon-log";
import { ReconStatusBadge } from "../_components/recon-status-badge";

function Detail({ id }: { id: string }) {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["recon_detail", id], queryFn: () => inventoryApi.reconcile.get(id) });
  const status = useQuery({
    queryKey: ["recon_status", q.data?.period],
    queryFn: () => inventoryApi.reconcile.status(q.data!.period),
    enabled: !!q.data,
    refetchInterval: (s) => (s.state.data && ["queued", "stage1", "stage2"].includes(s.state.data.state) ? 3000 : false),
  });
  const reload = () => {
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ["recon_list", q.data?.period] });
  };
  // Загрузка по складу закончилась — перечитать детали.
  const finished = status.data?.finished_at;
  const calculatedAt = q.data?.calculated_at;
  useEffect(() => {
    if (finished && (!calculatedAt || Date.parse(finished) > Date.parse(calculatedAt) + 1000)) void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  if (!q.data) return <div>{q.error ? (q.error as Error).message : "…"}</div>;
  const d = q.data;
  return (
    <div className="space-y-4">
      <Link href="/inventory/reconciliation" className="text-sm underline">
        ← {t("back")}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{d.store_name}</h1>
        <ReconStatusBadge status={d.status} />
        {d.changed_after_accept && <span className="text-sm text-orange-600">{t("changedAfterAccept")}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{periodLabel(d.period, locale)}</span>
        <span>
          {d.iiko_document_num ? `№${d.iiko_document_num}` : "—"}
          {d.iiko_document_comment ? ` · ${d.iiko_document_comment}` : ""}
        </span>
        {d.iiko_doc_state === "unposted_after_fetch" && <span className="text-orange-600">{t("unposted")}</span>}
        {d.book_at && <span>{t("bookAt", { at: d.book_at.replace("T", " ").slice(0, 16) })}</span>}
        <span>{t("fetchedAt", { at: formatDateTime(d.fetched_at, locale) })}</span>
        <RefreshButton detail={d} onQueued={() => void status.refetch()} />
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-4">
        <div className="rounded border p-2">
          {t("col.mismatch")}: <b>{d.mismatch_ab_count}</b>
        </div>
        <div className="rounded border p-2">
          {t("col.ab")}: <b>{formatMoney(d.diff_ab_sum)}</b>
        </div>
        <div className="rounded border p-2">
          {t("col.ac")}: <b>{formatMoney(d.diff_ac_sum)}</b>
        </div>
        <div className="rounded border p-2">
          {t("col.bc")}: <b>{formatMoney(d.diff_bc_sum)}</b>
        </div>
      </div>
      <ChooseDocument detail={d} onDone={() => { reload(); void status.refetch(); }} />
      <ReviewControls key={d.review_comment ?? ""} detail={d} onDone={reload} />
      <CountsPanel detail={d} onDone={reload} />
      <Tabs defaultValue="lines">
        <TabsList>
          <TabsTrigger value="lines">{t("tabs.lines")}</TabsTrigger>
          <TabsTrigger value="log">{t("tabs.log")}</TabsTrigger>
        </TabsList>
        <TabsContent value="lines" className="pt-4">
          <ReconLines lines={d.lines} />
        </TabsContent>
        <TabsContent value="log" className="pt-4">
          <ReconLog events={d.events} edits={d.branch_edits} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ReconciliationDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-3 pb-24 sm:p-4">
      <CanAccess permission="inventory.reconcile">
        <Detail id={id} />
      </CanAccess>
    </div>
  );
}
```

- [ ] **Step 5: Типы и линт**

```bash
cd admin && bunx tsc --noEmit -p . 2>&1 | grep -E "inventory" | head -20; bun lint 2>&1 | grep -E "inventory" | head
```
Expected: пусто. `Switch` и `Textarea` есть в `admin/components/ui/` — если их пропсы отличаются (`onCheckedChange`), подогнать по `admin/components/ui/switch.tsx`.

- [ ] **Step 6: Коммит**

```bash
git add "admin/app/[locale]/inventory/reconciliation"
git commit -m "feat(admin/inventory): экран сверки склада — расхождения, выбор документа, разбор, журнал

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Админка — срок ввода на экранах пересчёта

**Files:**
- Modify: `admin/app/[locale]/inventory/[id]/page.tsx:62`
- Modify: `admin/app/[locale]/inventory/_components/count-table.tsx:37`
- Modify: `admin/app/[locale]/inventory/_components/count-header.tsx`

**Interfaces:**
- Consumes: поля `input_open`, `deadline`, `unlocked_until` в `InventoryCountDetail` (Task 4), ключи `inventory.deadline.*` (Task 10), `formatDateTime` (Task 10).

- [ ] **Step 1: «Можно править» учитывает срок**

В `admin/app/[locale]/inventory/[id]/page.tsx` строку

```ts
  const editable = detail.status === "draft" && detail.access === "write";
```

заменить на

```ts
  // Срок ввода (2-е число 12:00) и разблокировку офисом считает сервер.
  const editable = detail.status === "draft" && detail.access === "write" && detail.input_open;
```

Ту же замену сделать в `admin/app/[locale]/inventory/_components/count-table.tsx` (строка `const editable = …`).

- [ ] **Step 2: Плашка срока в шапке**

В `count-header.tsx`:

1. Импорт: `import { formatDateTime } from "@admin/lib/inventory/money";`
2. В начале тела компонента: `const tDeadline = useTranslations("inventory.deadline");`
3. После `<div className="text-sm text-muted-foreground">…{periodLabel(detail.period, locale)}</div>` вставить:

```tsx
      {detail.status !== "cancelled" &&
        (!detail.input_open ? (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {tDeadline("closed", { deadline: formatDateTime(detail.deadline, locale) })}
          </div>
        ) : detail.unlocked_until && Date.parse(detail.unlocked_until) > Date.parse(detail.deadline) ? (
          <div className="rounded border border-orange-500/40 bg-orange-500/10 p-3 text-sm">
            {tDeadline("unlocked", { until: formatDateTime(detail.unlocked_until, locale) })}
          </div>
        ) : detail.status === "draft" ? (
          <div className="text-xs text-muted-foreground">
            {tDeadline("until", { deadline: formatDateTime(detail.deadline, locale) })}
          </div>
        ) : null)}
```

4. Условия `detail.status === "draft" && detail.access === "write"` в блоке отклонённых записей (две строки) заменить на `detail.status === "draft" && detail.access === "write" && detail.input_open`.

- [ ] **Step 3: Типы и линт**

```bash
cd admin && bunx tsc --noEmit -p . 2>&1 | grep -E "inventory" | head; bun lint 2>&1 | grep -E "inventory" | head; bun test lib/inventory/
```
Expected: пусто / PASS.

- [ ] **Step 4: Коммит**

```bash
git add "admin/app/[locale]/inventory/[id]/page.tsx" "admin/app/[locale]/inventory/_components/count-table.tsx" "admin/app/[locale]/inventory/_components/count-header.tsx"
git commit -m "feat(admin/inventory): срок ввода и разблокировка на экране пересчёта

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Сквозная проверка на локальной базе и в браузере

Ничего не коммитится, кроме исправлений найденных багов (каждое — отдельным коммитом с тестом).

**Files:**
- Нет новых файлов. Данные пишутся только в локальную базу `managers`.

- [ ] **Step 1: Все тесты и типы**

```bash
cd backend && export TEST_DATABASE_URL=$(grep '^DATABASE_URL' .env | cut -d= -f2- | sed 's#/[^/]*$#/managers_tickets_test#')
bun test src/modules/inventory/rules.test.ts && bun run test:http:inventory 2>&1 | tail -5 && bun run test:http:reconcile 2>&1 | tail -5
bunx tsc --noEmit -p . 2>&1 | grep -E "modules/inventory" | head
cd ../admin && bunx tsc --noEmit -p . 2>&1 | grep -E "inventory|nav-config" | head; bun lint 2>&1 | grep -E "inventory|nav-config" | head; bun test lib/inventory/
```
Expected: всё PASS, вывод `tsc`/`lint` по нашим путям пуст.

- [ ] **Step 2: Реальная сверка августа на локальной базе (iiko — только чтение)**

```bash
cd cron && bun inventory_reconcile_once.ts 2026-08-31
psql "$(grep '^DATABASE_URL' ../backend/.env | cut -d= -f2-)" -Atc "
  select status, count(*) from inventory_reconciliations where period = '2026-08-31' group by 1 order by 1;
  select r.iiko_document_num, r.lines_total, r.diff_bc_sum from inventory_reconciliations r
    where r.period = '2026-08-31' and r.store_id = '7e0661d8-0b59-4d57-a66e-6434a9895559';"
```
Expected:
- статус-JSON с `"state":"done"`, `received` ≈ 56;
- большинство строк `ready` (по числу документов «Месяц»), остальные `waiting_iiko`;
- для 19004: `2115`, `lines_total` ≈ 225, `diff_bc_sum` = `4474020.00` (14 379 599 − 9 905 579 — совпадает с отчётом iiko «Складские операции»).

Если `diff_bc_sum` не совпал — стоп, сравнить `inventory_reconciliation_iiko_lines` склада с OLAP.

- [ ] **Step 3: Сентябрь — склады без документа**

```bash
cd cron && bun inventory_reconcile_once.ts 2026-09-30
psql "$(grep '^DATABASE_URL' ../backend/.env | cut -d= -f2-)" -Atc "
  select status, count(*) from inventory_reconciliations where period = '2026-09-30' group by 1;
  select count(*) from inventory_reconciliations r join corporation_store c on c.id = r.store_id
    where r.period = '2026-09-30' and (c.name ilike '%Ошхона%' or c.name ilike '%Центральный%');"
```
Expected: филиалы без проведённого документа — `waiting_iiko` (на 06.10.2026 — все); «Ошхона» и «Центральный склад» в сверку не попали (`0`).

- [ ] **Step 4: Экраны в браузере (локально)**

Запустить бэкенд и админку (`cd backend && bun run --watch src/index.ts`, `cd admin && bun dev`), войти пользователем, чьей роли в локальной базе выданы `inventory.count`, `inventory.templates`, `inventory.reconcile`. Проверить, сверяясь с экраном, а не с кодом:
1. Меню «Инвентаризация → Сверка с iiko» видно.
2. `/ru/inventory/reconciliation`, месяц «август 2026»: таблица складов, у 19004 — №2115, B − C ≈ 4 474 020.
3. Открыть 19004: вкладка «Расхождения» — группы, у товаров без админки пометка «не считали в админке»; «Журнал» — «Загружен документ №2115».
4. «Принять» → статус «Принято»; «На разбор» без комментария — подсказка, с комментарием — статус меняется.
5. Пользователь только с `inventory.count` + `inventory.manage`: пункта меню нет, прямой URL сверки — пусто (CanAccess), API — 403.
6. Пересчёт за прошлый период (вставить в локальную базу черновик с `period = '2026-08-31'`): экран пересчёта показывает «Срок ввода истёк…», кнопок ввода нет; в сверке склада «Разблокировать на 24 ч» → в пересчёте плашка «Разблокировано офисом до …», ввод снова доступен.

Найденные расхождения с ожидаемым — чинить отдельными коммитами, каждый с тестом, воспроизводящим баг.

- [ ] **Step 5: Итог**

Доложить: результаты Step 1–4 с фактическими цифрами (число складов, суммы 19004), список коммитов ветки (`git log --oneline main..HEAD`), что осталось на выкатку:
- прод: миграция `0029`, сид `inventory.reconcile`, выдать право ролям офиса;
- `cron/.env`: `IIKO_LOGIN`, `IIKO_PASSWORD`, `PROJECT_PREFIX` (тот же, что у бэкенда — иначе статус cron-загрузок не виден на кнопке), `REDIS_HOST`, `DATABASE_URL`;
- PM2: `pm2 start pm2.config.js --only inventory_reconcile_worker` и перезапуск `office_cron`;
- подпроект 1 (ввод инвентаризации) тоже ещё не на проде — выкатывать вместе.
