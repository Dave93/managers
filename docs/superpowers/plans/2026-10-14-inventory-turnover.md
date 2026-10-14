# Оборотно-сальдовая ведомость склада — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ОСВ склада за календарный месяц (начало → обороты по типам проводок → конец) из снимка iiko в БД: офису — количество и суммы плюс сводная по складам, филиалу — количество по своему складу за открытые месяцы.

**Architecture:** BullMQ-задача (третий Worker в `cron/inventory_reconcile_worker.ts`) снимает из iiko `balance/stores` и OLAP `TRANSACTIONS` по складам и пишет сырые проводки по типам в `inventory_turnover*`. Модуль `backend/src/modules/inventory/turnover/` раскладывает типы по колонкам (чистые функции), отдаёт API с правилами доступа. Экран `/inventory/turnover` в админке.

**Tech Stack:** Bun, Elysia, Drizzle (PostgreSQL), BullMQ + ioredis, node-cron; Next.js 15 + React 19, TanStack Query, nuqs, next-intl.

**Spec:** `docs/superpowers/specs/2026-10-14-inventory-turnover-design.md`

## Global Constraints

- iiko — ТОЛЬКО ЧТЕНИЕ. Один токен на задачу (`withIikoClient`), `logout` в `finally`.
- Прод-БД (choparpizza.uz) — только чтение; миграции и сквозная проверка — на локальной БД.
- `period` везде — последний день месяца `YYYY-MM-DD` (`isValidPeriod` из `inventory/rules.ts`).
- Время — Asia/Tashkent (UTC+5, без летнего времени), как в `rules.ts`.
- Количества в API — строкой без хвостовых нулей (`normalizeNumeric`), numeric(14,4); суммы numeric(18,4).
- Филиалу суммы **не отдаются в API** (поля `sum` нет вовсе), не только скрываются на экране.
- Тождество: количество ±0,0005, сумма ±1.
- Новые маршруты — внутри `inventoryControllerImpl` (`/api`), ответы ошибок через `run()` + `InventoryError`.
- Тексты интерфейса — во всех 4 локалях `admin/messages/{ru,en,uz-Latn,uz-Cyrl}.json`.
- Коммиты — по задаче, сообщение на русском в стиле `feat(inventory/turnover): …`, с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Не коммитить чужие изменения рабочего дерева (`admin/lib/auth*`, `login/page.tsx`, `.DS_Store`, `tsconfig.tsbuildinfo`).

## Review Focus

1. **Филиал и прошлый месяц без пересчёта** — прошлый месяц, за который у склада нет месячного пересчёта, филиалу закрыт (иначе книжное на день, за который разрешён промежуточный). Тест — Task 5 (`branchMonthState`) и Task 7 (HTTP 403 `month_closed`).
2. **1-е число месяца** — у текущего месяца нет дня «по вчера»: загрузка не падает, снимок пуст, экран пишет «данных пока нет». Тест — Task 2 (`turnoverBounds` → null) и Task 4 (сервис ничего не пишет, статус done).
3. **Сбой iiko на одном складе** — прежний снимок склада остаётся, остальные грузятся, статус перечисляет `failed`. Тест — Task 4.
4. **Новый тип проводки iiko** — уходит в «Прочее ±», тождество не ломается. Тест — Task 2.
5. **Утечка сумм филиалу** — в ответе ведомости у филиала нет ключа `sum` ни в строках, ни `cost_correction` в колонках. Тест — Task 7.

## Поправки после ревью плана (14.10.2026) — имеют приоритет над кодом задач ниже

1. **Правило месяца филиала** (спека, решение 5, обновлено): вернуть/править можно и старые месячные пересчёты. `branchMonthState(period, now, m: { exists: boolean; changeable: boolean })`: текущий и будущий → `current`; `m.changeable` → `not_fixed`; прошлый и `!m.exists` → `not_fixed`; иначе открыт. В `read.ts` вместо `monthlyFixed` — `monthlyStates(db, storeId): Promise<Map<period, { exists; changeable }>>` (все неотменённые месячные пересчёты склада одним запросом, `changeable` = есть черновик или отправленный с `branchMayReopen`). Юнит-тест и HTTP-кейс: старый месяц с черновиком месячного → 403 `not_fixed`.
2. **Сводная — агрегатами SQL**, а не построчно в JS: `group by store_id, tx_type` (`sum(sum_in)`, `sum(sum_out)`) и `group by store_id` (`sum(start_sum)`, `sum(end_sum)`, `count(*) filter (where not consistent)`). `group()` — через `push`.
3. **Тестовая БД:** `TEST_DATABASE_URL` = `DATABASE_URL` из `backend/.env` с заменой имени БД на `managers_tickets_test` (а не `postgres:postgres@…`). Миграцию применять к ней же.
4. **service.test.ts:** загрузка «все склады» пишет снимки по всем `corporation_store` тестовой БД — в `afterAll` удалять `inventory_turnover*` по периодам `2026-09-30` и `2026-10-31`.
5. В `cron/inventory_reconcile_worker.ts` — комментарий: три Worker'а могут держать до трёх сессий iiko одновременно (сверка, книжное, ОСВ ~6 мин).

---

## File Structure

| Файл | Ответственность |
|---|---|
| `backend/drizzle/schema.ts` (modify) | 3 таблицы `inventory_turnover*` |
| `backend/drizzle/migrations/0034_inventory_turnover.sql` (generate) | миграция |
| `backend/src/modules/inventory/turnover/pure.ts` | границы периода, колонки, агрегация, снимок склада, правило месяца филиала |
| `backend/src/modules/inventory/turnover/types.ts` | типы ответов API (без импортов — admin берёт `import type`) |
| `backend/src/modules/inventory/reconcile/iiko-client.ts` (modify) | `TurnoverSource`: `balances(at, storeId?)`, `turnover(storeId, from, toInclusive)` |
| `backend/src/modules/inventory/turnover/service.ts` | загрузка из iiko и запись снимка |
| `backend/src/modules/inventory/turnover/queue.ts` | очередь, статус в Redis, 409 |
| `backend/src/modules/inventory/turnover/job.ts` | одна задача: токен iiko + сервис + статус |
| `backend/src/modules/inventory/turnover/read.ts` | выдача (месяцы, сводная, ведомость склада) с доступом |
| `backend/src/modules/inventory/turnover/routes.ts` | маршруты Elysia |
| `backend/src/modules/inventory/controller.ts` (modify) | `.use(turnoverRoutes)` |
| `backend/src/modules/inventory/reconcile/worker-health.ts` (modify) | очередь ведомости в проверке |
| `backend/src/modules/inventory/book/stock.ts` (modify) | `export` для `productInfo` |
| `cron/inventory_reconcile_worker.ts` (modify) | третий Worker |
| `cron/src/index.ts` (modify) | расписание 03:00 |
| `cron/inventory_turnover_once.ts` | ручной запуск для сквозной проверки |
| `backend/package.json` (modify) | `test:http:turnover` |
| `admin/lib/inventory-api.ts` (modify) | `turnover.*` |
| `admin/lib/inventory/turnover.ts` (+ test) | колонки экрана, знак, форматирование |
| `admin/app/[locale]/inventory/turnover/page.tsx` | экран |
| `admin/app/[locale]/inventory/turnover/_components/*.tsx` | сводная, ведомость склада, строка состояния |
| `admin/components/layout/nav-config.tsx`, `manager-layout.tsx` (modify) | пункт меню |
| `admin/messages/*.json` (modify) | тексты |

Тестовые команды:
- Юнит: `cd backend && bun test src/modules/inventory/turnover/pure.test.ts src/modules/inventory/reconcile/iiko-client.test.ts`
- С БД/Redis: `cd backend && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/managers_tickets_test bun run test:http:turnover`
- Админка: `cd admin && bun test lib/inventory/turnover.test.ts && bun lint`

---

### Task 1: Таблицы и миграция

**Files:**
- Modify: `backend/drizzle/schema.ts` (после `inventory_count_book_marks`, ~строка 2730)
- Create (generate): `backend/drizzle/migrations/0034_inventory_turnover.sql`, `meta/0034_snapshot.json`, `meta/_journal.json`

**Interfaces:**
- Produces: `inventory_turnover`, `inventory_turnover_balance`, `inventory_turnover_fetch` (drizzle tables) с колонками из спеки §5.

- [ ] **Step 1: Добавить таблицы в schema.ts**

```ts
// Оборотно-сальдовая ведомость (spec 2026-10-14, §5): снимок iiko за месяц по складу.
// Сырые проводки по типам; раскладку по колонкам делает inventory/turnover/pure.ts.
// Внешних ключей на corporation_store/номенклатуру нет намеренно (как у inventory_counts).
export const inventory_turnover = pgTable(
  "inventory_turnover",
  {
    period: date("period", { mode: "string" }).notNull(),
    store_id: uuid("store_id").notNull(),
    product_id: uuid("product_id").notNull(),
    tx_type: varchar("tx_type", { length: 40 }).notNull(),
    qty_in: numeric("qty_in", { precision: 14, scale: 4 }).notNull(),
    qty_out: numeric("qty_out", { precision: 14, scale: 4 }).notNull(),
    sum_in: numeric("sum_in", { precision: 18, scale: 4 }).notNull(),
    sum_out: numeric("sum_out", { precision: 18, scale: 4 }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.period, t.store_id, t.product_id, t.tx_type] }) })
);

export const inventory_turnover_balance = pgTable(
  "inventory_turnover_balance",
  {
    period: date("period", { mode: "string" }).notNull(),
    store_id: uuid("store_id").notNull(),
    product_id: uuid("product_id").notNull(),
    start_qty: numeric("start_qty", { precision: 14, scale: 4 }).notNull(),
    start_sum: numeric("start_sum", { precision: 18, scale: 4 }).notNull(),
    end_qty: numeric("end_qty", { precision: 14, scale: 4 }).notNull(),
    end_sum: numeric("end_sum", { precision: 18, scale: 4 }).notNull(),
    consistent: boolean("consistent").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.period, t.store_id, t.product_id] }) })
);

export const inventory_turnover_fetch = pgTable(
  "inventory_turnover_fetch",
  {
    period: date("period", { mode: "string" }).notNull(),
    store_id: uuid("store_id").notNull(),
    fetched_at: timestamp("fetched_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    // Последний день, вошедший в снимок: закрытый месяц — period, текущий — вчера.
    data_through: date("data_through", { mode: "string" }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.period, t.store_id] }) })
);
```

Проверить, что `date`, `varchar`, `boolean`, `numeric`, `primaryKey`, `timestamp`, `uuid` уже импортированы в начале schema.ts (`grep -n "^import" backend/drizzle/schema.ts`); добавить недостающие.

- [ ] **Step 2: Сгенерировать миграцию**

Run: `cd backend && bunx drizzle-kit generate --name inventory_turnover`
Expected: создан `drizzle/migrations/0034_inventory_turnover.sql` только с тремя `CREATE TABLE` (и PK). Если в SQL попало что-то ещё (дрейф схемы) — удалить лишние операторы из SQL, оставив только три таблицы.

- [ ] **Step 3: Применить к локальной и тестовой БД**

Run: `cd backend && bunx drizzle-kit migrate && DATABASE_URL=postgres://postgres:postgres@localhost:5432/managers_tickets_test bunx drizzle-kit migrate`
Expected: без ошибок; `psql ... -c "\d inventory_turnover"` показывает PK из 4 колонок.

- [ ] **Step 4: Commit**

```bash
git add backend/drizzle/schema.ts backend/drizzle/migrations/0034_inventory_turnover.sql backend/drizzle/migrations/meta/
git commit -m "feat(inventory/turnover): таблицы снимка оборотно-сальдовой ведомости"
```

---

### Task 2: Колонки, границы периода, агрегация (чистые функции)

**Files:**
- Create: `backend/src/modules/inventory/turnover/pure.ts`
- Create: `backend/src/modules/inventory/turnover/types.ts`
- Test: `backend/src/modules/inventory/turnover/pure.test.ts`

**Interfaces:**
- Consumes: `isValidPeriod`, `allowedPeriods` (`../rules`), `nextDay` (`../reconcile/pure`), `InventoryError` (`../errors`).
- Produces:
  - `type ColumnKey`, `COLUMN_ORDER: ColumnKey[]`, `columnOf(txType: string): ColumnKey`, `isOutflow(key): boolean`
  - `type Cells = Partial<Record<ColumnKey, number>>`
  - `type TxAgg = { tx_type: string; qty_in: number; qty_out: number; sum_in: number; sum_out: number }`
  - `type BalAgg = { start_qty: number; start_sum: number; end_qty: number; end_sum: number }`
  - `type Agg = { qty: Cells; sum: Cells; transfer: { qty_in: number; qty_out: number; sum_in: number; sum_out: number }; consistent: boolean }`
  - `aggregate(bal: BalAgg | undefined, txs: TxAgg[]): Agg`
  - `visibleColumns(aggs: Agg[], withSums: boolean): TurnoverColumn[]`
  - `turnoverBounds(period: string, now: Date): TurnoverBounds | null` (`TurnoverBounds = { from: string; to: string; startAt: string; endAt: string }`); бросает `InventoryError(422, "bad_period" | "future_period")`
  - `isConsistent(startQty, startSum, txs, endQty, endSum): boolean`
  - `type IikoBal = { store_id: string; product_id: string; amount: number; sum: number }`, `type IikoTx = { store_id: string; product_id: string; type: string; qty_in: number; qty_out: number; sum_in: number; sum_out: number }`
  - `buildStoreSnapshot(storeId: string, start: IikoBal[], end: IikoBal[], txs: IikoTx[]): { balances: SnapshotBalance[]; turnover: IikoTx[] }` (`SnapshotBalance = { product_id; start_qty; start_sum; end_qty; end_sum; consistent }`, числа)
  - `branchMonthState(period: string, now: Date, prevMonthFixed: boolean): { open: boolean; reason: "current" | "not_fixed" | null }`
  - types.ts: `TurnoverColumn = { key: ColumnKey; sum_only?: true }` и типы ответов (ниже).

- [ ] **Step 1: types.ts**

```ts
// Типы ответов оборотно-сальдовой ведомости (spec 2026-10-14, §7). Без импортов: admin берёт через `import type`.
// Числа — строкой без хвостовых нулей.

export type TurnoverColumnKey =
  | "start" | "invoice" | "sales" | "transfer" | "writeoff" | "inventory"
  | "outgoing_invoice" | "returned_invoice" | "transformation" | "production"
  | "cost_correction" | "other" | "end";

/** sum_only — колонка только для режима «Сумма» (корректировка себестоимости: количество всегда 0). */
export type TurnoverColumn = { key: TurnoverColumnKey; sum_only?: true };
export type TurnoverCells = Partial<Record<TurnoverColumnKey, string>>;

export interface TurnoverTransfer { qty_in: string; qty_out: string; sum_in?: string; sum_out?: string }

export interface TurnoverLine {
  product_id: string;
  code: string | null;
  name: string;
  unit_name: string | null;
  group_name: string;
  qty: TurnoverCells;
  /** Только офису. Филиалу ключа нет. */
  sum?: TurnoverCells;
  transfer: TurnoverTransfer;
  consistent: boolean;
}

export interface TurnoverSnapshotInfo { fetched_at: string | null; data_through: string | null }

export interface TurnoverStoreView extends TurnoverSnapshotInfo {
  period: string;
  store_id: string;
  store_name: string;
  with_sums: boolean;
  columns: TurnoverColumn[];
  lines: TurnoverLine[];
}

export interface TurnoverSummaryRow extends TurnoverSnapshotInfo {
  store_id: string;
  store_name: string;
  sum: TurnoverCells;
  inconsistent: number;
}

export type TurnoverFetchState = "idle" | "queued" | "running" | "done" | "failed";
export interface TurnoverFetchStatus {
  period: string;
  store_id: string | null;
  state: TurnoverFetchState;
  total: number;
  done: number;
  /** Склады, которые не загрузились (у них остался прежний снимок). */
  failed: string[];
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}
export interface TurnoverFetchOverview extends TurnoverFetchStatus { stores: TurnoverFetchStatus[] }

export interface TurnoverSummary {
  period: string;
  columns: TurnoverColumn[];
  rows: TurnoverSummaryRow[];
  total: TurnoverCells;
  status: TurnoverFetchOverview;
}

export interface TurnoverPeriod extends TurnoverSnapshotInfo {
  period: string;
  open: boolean;
  /** current — текущий месяц; not_fixed — месячный пересчёт не зафиксирован. */
  reason: "current" | "not_fixed" | null;
}
```

- [ ] **Step 2: Написать падающие тесты pure.test.ts**

```ts
import { describe, expect, it } from "bun:test";
import { InventoryError } from "../errors";
import { aggregate, branchMonthState, buildStoreSnapshot, columnOf, turnoverBounds, visibleColumns } from "./pure";

// 14.10.2026 10:00 по Ташкенту
const NOW = new Date("2026-10-14T05:00:00Z");

describe("columnOf", () => {
  it("известные типы и прочее", () => {
    expect(columnOf("INVOICE")).toBe("invoice");
    expect(columnOf("SESSION_WRITEOFF")).toBe("sales");
    expect(columnOf("STORE_COST_CORRECTION")).toBe("cost_correction");
    expect(columnOf("SOMETHING_NEW")).toBe("other");
  });
});

describe("turnoverBounds", () => {
  it("закрытый месяц — весь месяц, конец на 1-е следующего", () => {
    expect(turnoverBounds("2026-09-30", NOW)).toEqual({
      from: "2026-09-01", to: "2026-09-30", startAt: "2026-09-01T00:00:00", endAt: "2026-10-01T00:00:00",
    });
  });
  it("текущий месяц — по вчера", () => {
    expect(turnoverBounds("2026-10-31", NOW)).toEqual({
      from: "2026-10-01", to: "2026-10-13", startAt: "2026-10-01T00:00:00", endAt: "2026-10-14T00:00:00",
    });
  });
  it("1-е число текущего месяца — данных нет", () => {
    expect(turnoverBounds("2026-10-31", new Date("2026-10-01T03:00:00Z"))).toBeNull();
  });
  it("31.10 23:30 по Ташкенту — ещё октябрь (UTC уже 31.10 18:30)", () => {
    expect(turnoverBounds("2026-10-31", new Date("2026-10-31T18:30:00Z"))!.to).toBe("2026-10-30");
  });
  it("будущий и кривой месяц — 422", () => {
    expect(() => turnoverBounds("2026-11-30", NOW)).toThrow(InventoryError);
    expect(() => turnoverBounds("2026-09-15", NOW)).toThrow(InventoryError);
  });
});

describe("aggregate", () => {
  const txs = [
    { tx_type: "INVOICE", qty_in: 10, qty_out: 0, sum_in: 1000, sum_out: 0 },
    { tx_type: "SESSION_WRITEOFF", qty_in: 0, qty_out: 6, sum_in: 0, sum_out: 600 },
    { tx_type: "TRANSFER", qty_in: 2, qty_out: 3, sum_in: 200, sum_out: 300 },
    { tx_type: "INVENTORY_CORRECTION", qty_in: 0, qty_out: 1, sum_in: 0, sum_out: 100 },
    { tx_type: "STORE_COST_CORRECTION", qty_in: 0, qty_out: 0, sum_in: 5, sum_out: 0 },
    { tx_type: "NEW_TYPE", qty_in: 1, qty_out: 0, sum_in: 100, sum_out: 0 },
  ];
  it("расход положительным, ± со знаком, тождество", () => {
    const a = aggregate({ start_qty: 5, start_sum: 500, end_qty: 8, end_sum: 805 }, txs);
    expect(a.qty).toMatchObject({ start: 5, invoice: 10, sales: 6, transfer: -1, inventory: -1, other: 1, end: 8 });
    expect(a.sum).toMatchObject({ cost_correction: 5, sales: 600, end: 805 });
    expect(a.transfer).toEqual({ qty_in: 2, qty_out: 3, sum_in: 200, sum_out: 300 });
    expect(a.consistent).toBe(true);
  });
  it("не сходится по сумме больше чем на 1", () => {
    expect(aggregate({ start_qty: 5, start_sum: 500, end_qty: 8, end_sum: 807 }, txs).consistent).toBe(false);
  });
  it("без остатков — начало и конец 0", () => {
    const a = aggregate(undefined, [{ tx_type: "INVOICE", qty_in: 1, qty_out: 0, sum_in: 1, sum_out: 0 }]);
    expect(a.qty.start).toBe(0);
    expect(a.consistent).toBe(false);
  });
});

describe("visibleColumns", () => {
  const zero = aggregate({ start_qty: 1, start_sum: 1, end_qty: 1, end_sum: 1 }, []);
  it("всегда-колонки при нулях", () => {
    expect(visibleColumns([zero], true).map((c) => c.key)).toEqual(["start", "invoice", "sales", "transfer", "writeoff", "inventory", "end"]);
  });
  it("доп. колонки только если не ноль; cost_correction — sum_only и только с суммами", () => {
    const a = aggregate(undefined, [
      { tx_type: "PRODUCTION", qty_in: 1, qty_out: 0, sum_in: 1, sum_out: 0 },
      { tx_type: "STORE_COST_CORRECTION", qty_in: 0, qty_out: 0, sum_in: 3, sum_out: 0 },
    ]);
    expect(visibleColumns([a], true)).toContainEqual({ key: "cost_correction", sum_only: true });
    expect(visibleColumns([a], true).map((c) => c.key)).toContain("production");
    expect(visibleColumns([a], false).map((c) => c.key)).not.toContain("cost_correction");
  });
});

describe("buildStoreSnapshot", () => {
  it("только свой склад; товары с остатком или движением; consistent", () => {
    const s = buildStoreSnapshot(
      "s1",
      [{ store_id: "s1", product_id: "p1", amount: 5, sum: 50 }, { store_id: "s2", product_id: "p9", amount: 1, sum: 1 }],
      [{ store_id: "s1", product_id: "p1", amount: 7, sum: 70 }, { store_id: "s1", product_id: "p3", amount: 0, sum: 0 }],
      [
        { store_id: "s1", product_id: "p1", type: "INVOICE", qty_in: 2, qty_out: 0, sum_in: 20, sum_out: 0 },
        { store_id: "s1", product_id: "p2", type: "SESSION_WRITEOFF", qty_in: 0, qty_out: 1, sum_in: 0, sum_out: 10 },
      ]
    );
    expect(s.balances.map((b) => b.product_id).sort()).toEqual(["p1", "p2"]);
    expect(s.balances.find((b) => b.product_id === "p1")!.consistent).toBe(true);
    expect(s.balances.find((b) => b.product_id === "p2")!.consistent).toBe(false);
    expect(s.turnover).toHaveLength(2);
  });
});

describe("branchMonthState", () => {
  it("текущий — закрыт всегда", () => {
    expect(branchMonthState("2026-10-31", NOW, true)).toEqual({ open: false, reason: "current" });
  });
  it("прошлый — только с зафиксированным пересчётом", () => {
    expect(branchMonthState("2026-09-30", NOW, false)).toEqual({ open: false, reason: "not_fixed" });
    expect(branchMonthState("2026-09-30", NOW, true)).toEqual({ open: true, reason: null });
  });
  it("старше прошлого — открыт", () => {
    expect(branchMonthState("2026-08-31", NOW, false)).toEqual({ open: true, reason: null });
  });
});
```

- [ ] **Step 3: Run — должно упасть**

Run: `cd backend && bun test src/modules/inventory/turnover/pure.test.ts`
Expected: FAIL — `Cannot find module './pure'`.

- [ ] **Step 4: Реализовать pure.ts**

```ts
// Оборотно-сальдовая ведомость (spec 2026-10-14): границы периода, колонки, агрегация, правило месяца филиала.
// Без БД и iiko — только расчёт.
import { InventoryError } from "../errors";
import { nextDay } from "../reconcile/pure";
import { allowedPeriods, isValidPeriod } from "../rules";
import type { TurnoverColumn, TurnoverColumnKey } from "./types";

export type ColumnKey = TurnoverColumnKey;

export const COLUMN_ORDER: ColumnKey[] = [
  "start", "invoice", "sales", "transfer", "writeoff", "inventory",
  "outgoing_invoice", "returned_invoice", "transformation", "production", "cost_correction", "other", "end",
];
const ALWAYS = new Set<ColumnKey>(["start", "invoice", "sales", "transfer", "writeoff", "inventory", "end"]);
// Расход показываем положительным числом; остальные обороты — со знаком (+ приход, − расход).
const OUTFLOW = new Set<ColumnKey>(["sales", "writeoff", "outgoing_invoice", "returned_invoice"]);
const TYPE_COLUMN: Record<string, ColumnKey> = {
  INVOICE: "invoice",
  SESSION_WRITEOFF: "sales",
  TRANSFER: "transfer",
  WRITEOFF: "writeoff",
  INVENTORY_CORRECTION: "inventory",
  OUTGOING_INVOICE: "outgoing_invoice",
  RETURNED_INVOICE: "returned_invoice",
  TRANSFORMATION: "transformation",
  PRODUCTION: "production",
  STORE_COST_CORRECTION: "cost_correction",
};

export const columnOf = (txType: string): ColumnKey => TYPE_COLUMN[txType] ?? "other";
export const isOutflow = (key: ColumnKey) => OUTFLOW.has(key);

export type Cells = Partial<Record<ColumnKey, number>>;
export type TxAgg = { tx_type: string; qty_in: number; qty_out: number; sum_in: number; sum_out: number };
export type BalAgg = { start_qty: number; start_sum: number; end_qty: number; end_sum: number };
export type Agg = {
  qty: Cells;
  sum: Cells;
  transfer: { qty_in: number; qty_out: number; sum_in: number; sum_out: number };
  consistent: boolean;
};

const QTY_EPS = 0.0005;
const SUM_EPS = 1;

export function isConsistent(startQty: number, startSum: number, txs: TxAgg[], endQty: number, endSum: number): boolean {
  let q = startQty;
  let s = startSum;
  for (const t of txs) {
    q += t.qty_in - t.qty_out;
    s += t.sum_in - t.sum_out;
  }
  return Math.abs(q - endQty) <= QTY_EPS && Math.abs(s - endSum) <= SUM_EPS;
}

export function aggregate(bal: BalAgg | undefined, txs: TxAgg[]): Agg {
  const b = bal ?? { start_qty: 0, start_sum: 0, end_qty: 0, end_sum: 0 };
  const qty: Cells = { start: b.start_qty, end: b.end_qty };
  const sum: Cells = { start: b.start_sum, end: b.end_sum };
  const transfer = { qty_in: 0, qty_out: 0, sum_in: 0, sum_out: 0 };
  for (const t of txs) {
    const key = columnOf(t.tx_type);
    const sign = isOutflow(key) ? -1 : 1;
    qty[key] = (qty[key] ?? 0) + sign * (t.qty_in - t.qty_out);
    sum[key] = (sum[key] ?? 0) + sign * (t.sum_in - t.sum_out);
    if (key === "transfer") {
      transfer.qty_in += t.qty_in;
      transfer.qty_out += t.qty_out;
      transfer.sum_in += t.sum_in;
      transfer.sum_out += t.sum_out;
    }
  }
  return { qty, sum, transfer, consistent: isConsistent(b.start_qty, b.start_sum, txs, b.end_qty, b.end_sum) };
}

const nonZero = (v: number | undefined, eps: number) => v !== undefined && Math.abs(v) > eps;

/** Колонки выдачи: «всегда» + доп. с ненулевым значением. withSums=false — без cost_correction (филиал). */
export function visibleColumns(aggs: Agg[], withSums: boolean): TurnoverColumn[] {
  const out: TurnoverColumn[] = [];
  for (const key of COLUMN_ORDER) {
    if (key === "cost_correction") {
      if (withSums && aggs.some((a) => nonZero(a.sum[key], 0.005))) out.push({ key, sum_only: true });
      continue;
    }
    if (ALWAYS.has(key) || aggs.some((a) => nonZero(a.qty[key], 0.00005) || (withSums && nonZero(a.sum[key], 0.005)))) {
      out.push({ key });
    }
  }
  return out;
}

export type TurnoverBounds = { from: string; to: string; startAt: string; endAt: string };

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const tashkentToday = (now: Date) => new Date(now.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
const prevDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Границы снимка. null — у текущего месяца ещё нет прошедшего дня (1-е число). */
export function turnoverBounds(period: string, now: Date): TurnoverBounds | null {
  if (!isValidPeriod(period)) throw new InventoryError(422, "bad_period");
  const current = allowedPeriods(now)[0];
  if (period > current) throw new InventoryError(422, "future_period");
  const from = `${period.slice(0, 8)}01`;
  const yesterday = prevDay(tashkentToday(now));
  const to = period === current ? yesterday : period;
  if (to < from) return null;
  return { from, to, startAt: `${from}T00:00:00`, endAt: `${nextDay(to)}T00:00:00` };
}

export type IikoBal = { store_id: string; product_id: string; amount: number; sum: number };
export type IikoTx = { store_id: string; product_id: string; type: string; qty_in: number; qty_out: number; sum_in: number; sum_out: number };
export type SnapshotBalance = { product_id: string; start_qty: number; start_sum: number; end_qty: number; end_sum: number; consistent: boolean };

const isZeroBal = (b: IikoBal) => Math.abs(b.amount) <= 0.00005 && Math.abs(b.sum) <= 0.005;

/** Снимок одного склада: товары с ненулевым началом, концом или любым движением. */
export function buildStoreSnapshot(storeId: string, start: IikoBal[], end: IikoBal[], txs: IikoTx[]) {
  const s = new Map(start.filter((b) => b.store_id === storeId && !isZeroBal(b)).map((b) => [b.product_id, b]));
  const e = new Map(end.filter((b) => b.store_id === storeId && !isZeroBal(b)).map((b) => [b.product_id, b]));
  const turnover = txs.filter((t) => t.store_id === storeId);
  const byProduct = new Map<string, TxAgg[]>();
  for (const t of turnover) {
    const list = byProduct.get(t.product_id) ?? [];
    list.push({ tx_type: t.type, qty_in: t.qty_in, qty_out: t.qty_out, sum_in: t.sum_in, sum_out: t.sum_out });
    byProduct.set(t.product_id, list);
  }
  const ids = new Set([...s.keys(), ...e.keys(), ...byProduct.keys()]);
  const balances: SnapshotBalance[] = [...ids].map((id) => {
    const b = { start_qty: s.get(id)?.amount ?? 0, start_sum: s.get(id)?.sum ?? 0, end_qty: e.get(id)?.amount ?? 0, end_sum: e.get(id)?.sum ?? 0 };
    return { product_id: id, ...b, consistent: isConsistent(b.start_qty, b.start_sum, byProduct.get(id) ?? [], b.end_qty, b.end_sum) };
  });
  return { balances, turnover };
}

/**
 * Какие месяцы видит филиал (spec 2026-10-14, решение 5): текущий — никогда; прошлый — когда месячный
 * пересчёт склада за него зафиксирован (за дни прошлого месяца разрешён промежуточный); старше — всегда.
 */
export function branchMonthState(period: string, now: Date, prevMonthFixed: boolean): { open: boolean; reason: "current" | "not_fixed" | null } {
  const [current, previous] = allowedPeriods(now);
  if (period >= current) return { open: false, reason: "current" };
  if (period === previous) return prevMonthFixed ? { open: true, reason: null } : { open: false, reason: "not_fixed" };
  return { open: true, reason: null };
}
```

Примечание: в тесте «без остатков» `aggregate(undefined, INVOICE 1)` → consistent=false (0 + 1 ≠ 0) — ожидаемо.

- [ ] **Step 5: Run — должно пройти**

Run: `cd backend && bun test src/modules/inventory/turnover/pure.test.ts`
Expected: PASS, все тесты.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/inventory/turnover/pure.ts backend/src/modules/inventory/turnover/pure.test.ts backend/src/modules/inventory/turnover/types.ts
git commit -m "feat(inventory/turnover): колонки, границы месяца и агрегация оборотов"
```

---

### Task 3: Клиент iiko — остатки всех складов и обороты с суммами

**Files:**
- Modify: `backend/src/modules/inventory/reconcile/iiko-client.ts`
- Test: `backend/src/modules/inventory/reconcile/iiko-client.test.ts`

**Interfaces:**
- Consumes: `IikoBal`, `IikoTx` (`../turnover/pure`), `nextDay`.
- Produces:
  ```ts
  export interface TurnoverSource {
    /** balance/stores на момент at; без storeId — все склады. */
    balances(at: string, storeId?: string): Promise<IikoBal[]>;
    /** OLAP TRANSACTIONS склада за даты [from, toInclusive], все типы, с суммами. */
    turnover(storeId: string, from: string, toInclusive: string): Promise<IikoTx[]>;
  }
  ```
  `withIikoClient<T>(fn: (c: IikoClient & TurnoverSource) => Promise<T>, opts)` — тип параметра расширен; существующие вызовы и фейки `IikoClient` не меняются.

- [ ] **Step 1: Падающий тест** (добавить в конец `iiko-client.test.ts`)

```ts
describe("TurnoverSource", () => {
  it("balances без store и со store; turnover — все типы, суммы, Account.Id", async () => {
    const bodies: any[] = [];
    const { f, calls } = fakeFetch((url, init) => {
      if (url.includes("/auth?")) return new Response("KEY1");
      if (url.includes("/v2/reports/balance/stores")) return Response.json([{ store: "s1", product: "p1", amount: 4, sum: 40 }]);
      if (url.includes("/v2/reports/olap")) {
        bodies.push(JSON.parse(String(init!.body)));
        return Response.json({ data: [
          { "Product.Id": "p1", TransactionType: "INVOICE", "Amount.In": 3, "Amount.Out": 0, "Sum.Incoming": 30, "Sum.Outgoing": 0 },
          { "Product.Id": null, TransactionType: "INVOICE", "Amount.In": 1, "Amount.Out": 0, "Sum.Incoming": 1, "Sum.Outgoing": 0 },
        ] });
      }
      if (url.includes("/logout")) return new Response("");
      return new Response("nope", { status: 404 });
    });
    const res = await withIikoClient(async (c) => ({
      all: await c.balances("2026-09-01T00:00:00"),
      one: await c.balances("2026-09-01T00:00:00", "s1"),
      tx: await c.turnover("s1", "2026-09-01", "2026-09-30"),
    }), opts(f));
    expect(res.all).toEqual([{ store_id: "s1", product_id: "p1", amount: 4, sum: 40 }]);
    const balUrls = calls.filter((c) => c.url.includes("balance/stores")).map((c) => c.url);
    expect(balUrls[0]).not.toContain("store=");
    expect(balUrls[1]).toContain("store=s1");
    expect(res.tx).toEqual([{ store_id: "s1", product_id: "p1", type: "INVOICE", qty_in: 3, qty_out: 0, sum_in: 30, sum_out: 0 }]);
    expect(bodies[0].aggregateFields).toEqual(["Amount.In", "Amount.Out", "Sum.Incoming", "Sum.Outgoing"]);
    expect(bodies[0].filters["Account.Id"]).toEqual({ filterType: "IncludeValues", values: ["s1"] });
    expect(bodies[0].filters.TransactionType).toBeUndefined();
    expect(bodies[0].filters["DateTime.DateTyped"]).toMatchObject({ from: "2026-09-01", to: "2026-10-01", includeLow: true, includeHigh: false });
  });
});
```

- [ ] **Step 2: Run — упадёт** (`c.balances is not a function`)

Run: `cd backend && bun test src/modules/inventory/reconcile/iiko-client.test.ts`

- [ ] **Step 3: Реализация**

В `iiko-client.ts`:
1. Импорт: `import type { IikoBal, IikoTx } from "../turnover/pure";`
2. После `interface IikoClient` добавить `export interface TurnoverSource` (см. Interfaces).
3. Сигнатура: `export async function withIikoClient<T>(fn: (c: IikoClient & TurnoverSource) => Promise<T>, opts: IikoClientOptions = {}): Promise<T>`; `const client: IikoClient & TurnoverSource = { ... }`.
4. В объект `client` добавить:

```ts
    async balances(at, storeId) {
      const store = storeId ? `&store=${storeId}` : "";
      const res = await request(`${base}/v2/reports/balance/stores?key=${key}&timestamp=${encodeURIComponent(at)}${store}`);
      const j = (await res.json()) as { store: string; product: string; amount: number; sum: number }[];
      return j.map((x) => ({ store_id: x.store, product_id: x.product, amount: Number(x.amount), sum: Number(x.sum) }));
    },
    // ОСВ (spec 2026-10-14, §3): все типы, включая INVENTORY_CORRECTION, — начало 1-го + обороты = конец.
    async turnover(storeId, from, toInclusive) {
      const body = {
        reportType: "TRANSACTIONS",
        buildSummary: "false",
        groupByRowFields: ["Product.Id", "TransactionType"],
        aggregateFields: ["Amount.In", "Amount.Out", "Sum.Incoming", "Sum.Outgoing"],
        filters: {
          "DateTime.DateTyped": {
            filterType: "DateRange", periodType: "CUSTOM", from, to: nextDay(toInclusive), includeLow: true, includeHigh: false,
          },
          "Account.Id": { filterType: "IncludeValues", values: [storeId] },
        },
      };
      const res = await request(`${base}/v2/reports/olap?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { data?: Record<string, unknown>[] };
      return (j.data ?? [])
        .filter((r) => r["Product.Id"])
        .map((r) => ({
          store_id: storeId,
          product_id: String(r["Product.Id"]),
          type: String(r["TransactionType"] ?? ""),
          qty_in: Number(r["Amount.In"] ?? 0),
          qty_out: Number(r["Amount.Out"] ?? 0),
          sum_in: Number(r["Sum.Incoming"] ?? 0),
          sum_out: Number(r["Sum.Outgoing"] ?? 0),
        }));
    },
```

5. Обновить шапку-комментарий файла: добавить «balance/stores и OLAP TRANSACTIONS с суммами (ОСВ)».

- [ ] **Step 4: Run — проходит** (весь файл, старые тесты тоже)

Run: `cd backend && bun test src/modules/inventory/reconcile/iiko-client.test.ts`

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/inventory/reconcile/iiko-client.ts backend/src/modules/inventory/reconcile/iiko-client.test.ts
git commit -m "feat(inventory/turnover): клиент iiko — остатки всех складов и обороты с суммами"
```

---

### Task 4: Сервис загрузки, очередь, задача, воркер, расписание

**Files:**
- Create: `backend/src/modules/inventory/turnover/service.ts`, `queue.ts`, `job.ts`
- Test: `backend/src/modules/inventory/turnover/service.test.ts`
- Modify: `backend/src/modules/inventory/reconcile/worker-health.ts`, `cron/inventory_reconcile_worker.ts`, `cron/src/index.ts`, `backend/package.json`
- Create: `cron/inventory_turnover_once.ts`

**Interfaces:**
- Consumes: Task 1 таблицы; Task 2 `turnoverBounds`, `buildStoreSnapshot`; Task 3 `TurnoverSource`, `withIikoClient`; `TurnoverFetchStatus` (types.ts).
- Produces:
  - `fetchTurnover(db: DbLike, iiko: TurnoverSource, input: { period: string; storeId: string | null }, progress?: (p: Partial<TurnoverFetchStatus>) => Promise<void>, now?: Date): Promise<{ stores: number; failed: string[] }>`
  - `turnoverQueue(): Queue`, `closeTurnoverQueue()`, `turnoverQueueName()`, `type TurnoverJobData = { period: string; storeId: string | null; statusKey: string }`
  - `enqueueTurnover(q: Queue, redis: Redis, input: { period: string; storeId?: string | null }): Promise<TurnoverFetchStatus>` — 409 `already_running`
  - `readTurnoverStatus(redis, period, q?, storeId?)`, `readTurnoverOverview(redis, period, q?): Promise<TurnoverFetchOverview>`, `patchTurnoverStatus(redis, key, patch)`
  - `processTurnoverJob(db, redis, data: TurnoverJobData, iikoOpts?)`

- [ ] **Step 1: Падающий тест service.test.ts** (на тестовой БД, по образцу `book/service.test.ts`)

```ts
import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;

if (!dbLooksLikeTest) {
  describe.skip("turnover service (пропущено: запускайте через bun run test:http:turnover)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { drizzleDb } = await import("backend/src/lib/db");
  const schema = await import("backend/drizzle/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { fetchTurnover } = await import("./service");
  type TurnoverSource = import("../reconcile/iiko-client").TurnoverSource;

  const NOW = new Date("2026-10-14T05:00:00Z");

  async function seedStores(n: number) {
    const ids = Array.from({ length: n }, () => randomUUID());
    await drizzleDb.insert(schema.corporation_store).values(ids.map((id, i) => ({ id, name: `ОСВ склад ${i}`, type: "STORE" })));
    return {
      ids,
      async cleanup() {
        for (const t of [schema.inventory_turnover, schema.inventory_turnover_balance, schema.inventory_turnover_fetch]) {
          await drizzleDb.delete(t).where(inArray(t.store_id, ids));
        }
        await drizzleDb.delete(schema.corporation_store).where(inArray(schema.corporation_store.id, ids));
      },
    };
  }

  function fakeIiko(stores: string[], p: string, opts: { failStore?: string } = {}) {
    const calls: string[] = [];
    const iiko: TurnoverSource = {
      async balances(at, storeId) {
        calls.push(`balances ${at} ${storeId ?? "all"}`);
        const amount = at.startsWith("2026-09-01") ? 5 : 7;
        return (storeId ? [storeId] : stores).map((s) => ({ store_id: s, product_id: p, amount, sum: amount * 10 }));
      },
      async turnover(storeId, from, to) {
        calls.push(`turnover ${storeId} ${from}..${to}`);
        if (storeId === opts.failStore) throw new Error("iiko 500");
        return [{ store_id: storeId, product_id: p, type: "INVOICE", qty_in: 2, qty_out: 0, sum_in: 20, sum_out: 0 }];
      },
    };
    return { iiko, calls };
  }

  describe("fetchTurnover", () => {
    it("все склады: снимок, fetch, прогресс; склады из corporation_store тоже", async () => {
      const s = await seedStores(2);
      const p = randomUUID();
      // в балансах iiko только первый склад; второй — из corporation_store
      const { iiko, calls } = fakeIiko([s.ids[0]], p);
      const progress: any[] = [];
      try {
        const r = await fetchTurnover(drizzleDb, iiko, { period: "2026-09-30", storeId: null }, async (x) => { progress.push(x); }, NOW);
        expect(r.failed).toEqual([]);
        expect(calls).toContain("balances 2026-09-01T00:00:00 all");
        expect(calls).toContain("balances 2026-10-01T00:00:00 all");
        expect(calls).toContain(`turnover ${s.ids[1]} 2026-09-01..2026-09-30`);
        const bal = await drizzleDb.select().from(schema.inventory_turnover_balance).where(eq(schema.inventory_turnover_balance.store_id, s.ids[0]));
        expect(bal).toHaveLength(1);
        expect(bal[0]).toMatchObject({ period: "2026-09-30", product_id: p, start_qty: "5.0000", end_qty: "7.0000", consistent: true });
        const fetch = await drizzleDb.select().from(schema.inventory_turnover_fetch).where(inArray(schema.inventory_turnover_fetch.store_id, s.ids));
        expect(fetch.map((f) => f.data_through)).toEqual(["2026-09-30", "2026-09-30"]);
        expect(progress.at(-1)).toMatchObject({ state: "done", failed: [] });
      } finally {
        await s.cleanup();
      }
    });

    it("повторная загрузка заменяет снимок склада, а не дописывает", async () => {
      const s = await seedStores(1);
      const p = randomUUID();
      const { iiko } = fakeIiko(s.ids, p);
      try {
        await fetchTurnover(drizzleDb, iiko, { period: "2026-09-30", storeId: s.ids[0] }, undefined, NOW);
        await fetchTurnover(drizzleDb, iiko, { period: "2026-09-30", storeId: s.ids[0] }, undefined, NOW);
        const tx = await drizzleDb.select().from(schema.inventory_turnover).where(eq(schema.inventory_turnover.store_id, s.ids[0]));
        expect(tx).toHaveLength(1);
      } finally {
        await s.cleanup();
      }
    });

    it("сбой iiko на складе: прежний снимок остаётся, остальные грузятся", async () => {
      const s = await seedStores(2);
      const p = randomUUID();
      try {
        await fetchTurnover(drizzleDb, fakeIiko(s.ids, p).iiko, { period: "2026-09-30", storeId: null }, undefined, NOW);
        const before = await drizzleDb.select().from(schema.inventory_turnover_fetch).where(eq(schema.inventory_turnover_fetch.store_id, s.ids[0]));
        const r = await fetchTurnover(drizzleDb, fakeIiko(s.ids, p, { failStore: s.ids[0] }).iiko, { period: "2026-09-30", storeId: null }, undefined, NOW);
        expect(r.failed).toEqual([s.ids[0]]);
        const after = await drizzleDb.select().from(schema.inventory_turnover_fetch).where(eq(schema.inventory_turnover_fetch.store_id, s.ids[0]));
        expect(after[0].fetched_at).toBe(before[0].fetched_at);
        const tx = await drizzleDb.select().from(schema.inventory_turnover).where(eq(schema.inventory_turnover.store_id, s.ids[0]));
        expect(tx).toHaveLength(1);
      } finally {
        await s.cleanup();
      }
    });

    it("1-е число текущего месяца — iiko не трогаем, статус done", async () => {
      const { iiko, calls } = fakeIiko([], randomUUID());
      const progress: any[] = [];
      const r = await fetchTurnover(drizzleDb, iiko, { period: "2026-10-31", storeId: null }, async (x) => { progress.push(x); }, new Date("2026-10-01T03:00:00Z"));
      expect(r).toEqual({ stores: 0, failed: [] });
      expect(calls).toEqual([]);
      expect(progress.at(-1)).toMatchObject({ state: "done", total: 0 });
    });

    it("текущий месяц — по вчера", async () => {
      const s = await seedStores(1);
      const { iiko, calls } = fakeIiko(s.ids, randomUUID());
      try {
        await fetchTurnover(drizzleDb, iiko, { period: "2026-10-31", storeId: s.ids[0] }, undefined, NOW);
        expect(calls).toContain(`turnover ${s.ids[0]} 2026-10-01..2026-10-13`);
        expect(calls).toContain(`balances 2026-10-14T00:00:00 ${s.ids[0]}`);
        const [f] = await drizzleDb.select().from(schema.inventory_turnover_fetch).where(eq(schema.inventory_turnover_fetch.store_id, s.ids[0]));
        expect(f.data_through).toBe("2026-10-13");
      } finally {
        await s.cleanup();
      }
    });
  });
}
```

- [ ] **Step 2: Добавить скрипт и проверить, что тест падает**

В `backend/package.json` → `scripts`:
```json
"test:http:turnover": "PROJECT_PREFIX=managers_test_ INVENTORY_TURNOVER_QUEUE=inventory_turnover_test INVENTORY_RECONCILE_QUEUE=inventory_reconcile_test INVENTORY_BOOK_QUEUE=inventory_book_test DATABASE_URL=$TEST_DATABASE_URL bun test src/modules/inventory/turnover/",
```
Run: `cd backend && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/managers_tickets_test bun run test:http:turnover`
Expected: FAIL — `Cannot find module './service'`.

- [ ] **Step 3: service.ts**

```ts
// Загрузка снимка ОСВ из iiko (spec 2026-10-14, §6). Склады — по одному: OLAP по всем складам
// идёт ~100 с, по складу ~4 с, и сбой одного склада не теряет остальные.
import { corporation_store, inventory_turnover, inventory_turnover_balance, inventory_turnover_fetch } from "backend/drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import type { TurnoverSource } from "../reconcile/iiko-client";
import { buildStoreSnapshot, turnoverBounds, type IikoBal, type IikoTx } from "./pure";
import type { TurnoverFetchStatus } from "./types";

type Progress = (p: Partial<TurnoverFetchStatus>) => Promise<void>;

const CHUNK = 1000;
const q4 = (n: number) => n.toFixed(4);

async function writeStoreSnapshot(db: DbLike, period: string, storeId: string, dataThrough: string, start: IikoBal[], end: IikoBal[], txs: IikoTx[]) {
  const snap = buildStoreSnapshot(storeId, start, end, txs);
  await db.transaction(async (tx) => {
    const where = (t: typeof inventory_turnover | typeof inventory_turnover_balance) => and(eq(t.period, period), eq(t.store_id, storeId));
    await tx.delete(inventory_turnover).where(where(inventory_turnover));
    await tx.delete(inventory_turnover_balance).where(where(inventory_turnover_balance));
    // Одна строка на товар × тип: OLAP группирует по ним, но на всякий случай сводим.
    const byKey = new Map<string, IikoTx>();
    for (const t of snap.turnover) {
      const k = `${t.product_id}|${t.type}`;
      const cur = byKey.get(k);
      byKey.set(k, cur ? { ...cur, qty_in: cur.qty_in + t.qty_in, qty_out: cur.qty_out + t.qty_out, sum_in: cur.sum_in + t.sum_in, sum_out: cur.sum_out + t.sum_out } : t);
    }
    const turnoverRows = [...byKey.values()].map((t) => ({
      period, store_id: storeId, product_id: t.product_id, tx_type: t.type.slice(0, 40),
      qty_in: q4(t.qty_in), qty_out: q4(t.qty_out), sum_in: q4(t.sum_in), sum_out: q4(t.sum_out),
    }));
    for (let i = 0; i < turnoverRows.length; i += CHUNK) await tx.insert(inventory_turnover).values(turnoverRows.slice(i, i + CHUNK));
    const balanceRows = snap.balances.map((b) => ({
      period, store_id: storeId, product_id: b.product_id,
      start_qty: q4(b.start_qty), start_sum: q4(b.start_sum), end_qty: q4(b.end_qty), end_sum: q4(b.end_sum), consistent: b.consistent,
    }));
    for (let i = 0; i < balanceRows.length; i += CHUNK) await tx.insert(inventory_turnover_balance).values(balanceRows.slice(i, i + CHUNK));
    await tx
      .insert(inventory_turnover_fetch)
      .values({ period, store_id: storeId, data_through: dataThrough })
      .onConflictDoUpdate({
        target: [inventory_turnover_fetch.period, inventory_turnover_fetch.store_id],
        set: { fetched_at: sql`now()`, data_through: dataThrough },
      });
  });
}

export async function fetchTurnover(
  db: DbLike,
  iiko: TurnoverSource,
  input: { period: string; storeId: string | null },
  progress: Progress = async () => {},
  now = new Date()
): Promise<{ stores: number; failed: string[] }> {
  const startedAt = new Date().toISOString();
  const bounds = turnoverBounds(input.period, now);
  if (!bounds) {
    await progress({ state: "done", total: 0, done: 0, failed: [], started_at: startedAt, finished_at: new Date().toISOString() });
    return { stores: 0, failed: [] };
  }
  const start = await iiko.balances(bounds.startAt, input.storeId ?? undefined);
  const end = await iiko.balances(bounds.endAt, input.storeId ?? undefined);
  let stores: string[];
  if (input.storeId) stores = [input.storeId];
  else {
    // Склад с движением, но нулевыми остатками на начало и конец, есть только в corporation_store.
    const known = await db.select({ id: corporation_store.id }).from(corporation_store);
    stores = [...new Set([...start.map((b) => b.store_id), ...end.map((b) => b.store_id), ...known.map((k) => k.id)])].sort();
  }
  await progress({ state: "running", total: stores.length, done: 0, failed: [], started_at: startedAt });
  const failed: string[] = [];
  for (let i = 0; i < stores.length; i++) {
    const storeId = stores[i];
    try {
      const txs = await iiko.turnover(storeId, bounds.from, bounds.to);
      await writeStoreSnapshot(db, input.period, storeId, bounds.to, start, end, txs);
    } catch (e) {
      console.error(`[turnover] ${input.period} ${storeId} failed:`, (e as Error).message);
      failed.push(storeId);
    }
    await progress({ done: i + 1, failed });
  }
  await progress({ state: "done", finished_at: new Date().toISOString(), failed });
  return { stores: stores.length, failed };
}
```

- [ ] **Step 4: Run — service-тесты проходят**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/managers_tickets_test bun test src/modules/inventory/turnover/service.test.ts` с теми же env, что в скрипте (или `bun run test:http:turnover`).
Expected: PASS 5 тестов.

- [ ] **Step 5: queue.ts** (по образцу `reconcile/queue.ts`)

```ts
// Очередь снимков ОСВ (spec 2026-10-14, §6). «Все склады» месяца — одна задача; один склад — своя.
// Воркер — concurrency 1, один токен iiko.
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { InventoryError } from "../errors";
import type { TurnoverFetchOverview, TurnoverFetchStatus } from "./types";

export const turnoverQueueName = () => process.env.INVENTORY_TURNOVER_QUEUE ?? "inventory_turnover";
// BullMQ не принимает ":" в собственных id задач.
export const turnoverJobId = (period: string, storeId?: string | null) => (storeId ? `turnover-${period}-${storeId}` : `turnover-${period}`);
// Ключ считает тот, кто ставит задачу (бэкенд или cron): у воркера PROJECT_PREFIX может отличаться.
export const turnoverStatusKey = (period: string, storeId?: string | null) =>
  `${process.env.PROJECT_PREFIX ?? ""}inventory_turnover:${period}${storeId ? `:${storeId}` : ""}`;
const storesKey = (period: string) => `${turnoverStatusKey(period)}:stores`;
const STATUS_TTL_S = 30 * 86400;

export type TurnoverJobData = { period: string; storeId: string | null; statusKey: string };

let queue: Queue | null = null;

export function turnoverQueue(): Queue {
  queue ??= new Queue(turnoverQueueName(), {
    connection: { host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT || "6379"), maxRetriesPerRequest: null },
  });
  return queue;
}

export async function closeTurnoverQueue() {
  await queue?.close();
  queue = null;
}

export function initialTurnoverStatus(period: string, storeId: string | null): TurnoverFetchStatus {
  return { period, store_id: storeId, state: "queued", total: 0, done: 0, failed: [], started_at: null, finished_at: null, error: null };
}

const RUNNING = new Set(["waiting", "active", "delayed", "prioritized", "waiting-children"]);

async function isRunning(q: Queue, period: string, storeId?: string | null): Promise<boolean> {
  const job = await q.getJob(turnoverJobId(period, storeId));
  return !!job && RUNNING.has(await job.getState());
}

/** 409, пока идёт загрузка месяца или этого склада. */
export async function enqueueTurnover(q: Queue, redis: Redis, input: { period: string; storeId?: string | null }): Promise<TurnoverFetchStatus> {
  const storeId = input.storeId ?? null;
  if ((await isRunning(q, input.period)) || (storeId && (await isRunning(q, input.period, storeId)))) {
    throw new InventoryError(409, "already_running");
  }
  const jobId = turnoverJobId(input.period, storeId);
  const existing = await q.getJob(jobId);
  if (existing) await existing.remove();
  const data: TurnoverJobData = { period: input.period, storeId, statusKey: turnoverStatusKey(input.period, storeId) };
  const status = initialTurnoverStatus(input.period, storeId);
  await redis.set(data.statusKey, JSON.stringify(status), "EX", STATUS_TTL_S);
  if (storeId) {
    await redis.sadd(storesKey(input.period), storeId);
    await redis.expire(storesKey(input.period), STATUS_TTL_S);
  }
  await q.add("turnover", data, { jobId, attempts: 1, removeOnComplete: true, removeOnFail: true });
  return status;
}

const IN_PROGRESS = new Set(["queued", "running"]);

/** Воркер упал посреди задачи — в Redis «идёт», а задачи нет: отдаём failed/stale, чтобы кнопка ожила. */
export async function readTurnoverStatus(redis: Redis, period: string, q?: Queue, storeId?: string | null): Promise<TurnoverFetchStatus> {
  const raw = await redis.get(turnoverStatusKey(period, storeId));
  if (!raw) return { ...initialTurnoverStatus(period, storeId ?? null), state: "idle" };
  const s = JSON.parse(raw) as TurnoverFetchStatus;
  if (q && IN_PROGRESS.has(s.state) && !(await isRunning(q, period, storeId))) return { ...s, state: "failed", error: "stale" };
  return s;
}

export async function readTurnoverOverview(redis: Redis, period: string, q?: Queue): Promise<TurnoverFetchOverview> {
  const ids = await redis.smembers(storesKey(period));
  const stores = (await Promise.all(ids.map((id) => readTurnoverStatus(redis, period, q, id)))).filter((s) => s.state !== "idle");
  return { ...(await readTurnoverStatus(redis, period, q)), stores };
}

export async function patchTurnoverStatus(redis: Redis, key: string, patch: Partial<TurnoverFetchStatus>) {
  const raw = await redis.get(key);
  const cur = raw ? JSON.parse(raw) : {};
  await redis.set(key, JSON.stringify({ ...cur, ...patch }), "EX", STATUS_TTL_S);
}
```

- [ ] **Step 6: job.ts**

```ts
// Одна загрузка ОСВ: токен iiko, снимок, статус в Redis. Вызывают воркер и cron/inventory_turnover_once.ts.
import type Redis from "ioredis";
import type { DbLike } from "../access";
import { withIikoClient, type IikoClientOptions } from "../reconcile/iiko-client";
import { patchTurnoverStatus, type TurnoverJobData } from "./queue";
import { fetchTurnover } from "./service";

export async function processTurnoverJob(db: DbLike, redis: Redis, data: TurnoverJobData, iikoOpts: IikoClientOptions = {}) {
  try {
    return await withIikoClient(
      (iiko) => fetchTurnover(db, iiko, { period: data.period, storeId: data.storeId }, (p) => patchTurnoverStatus(redis, data.statusKey, p)),
      iikoOpts
    );
  } catch (e) {
    await patchTurnoverStatus(redis, data.statusKey, { state: "failed", finished_at: new Date().toISOString(), error: (e as Error).message.slice(0, 500) });
    throw e;
  }
}
```

- [ ] **Step 7: worker-health, воркер, cron, ручной запуск**

`reconcile/worker-health.ts`: импорт `import { turnoverQueue } from "../turnover/queue";`, в `readWorkerStatus` — `[bookQueue(), reconcileQueue(), turnoverQueue()]`; в шапке-комментарии «книжного, сверки и ОСВ».

`cron/inventory_reconcile_worker.ts` — после `bookWorker`:
```ts
// Снимки оборотно-сальдовой ведомости (spec 2026-10-14, §6): тот же процесс, своя очередь.
const turnoverWorker = new Worker(
  turnoverQueueName(),
  async (job) => {
    const data = job.data as TurnoverJobData;
    console.log(`[turnover] job ${job.id}: ${data.period} ${data.storeId ?? "all"}`);
    const r = await processTurnoverJob(drizzleDb, client, data);
    console.log(`[turnover] job ${job.id}: ${r.stores} stores, failed ${r.failed.length}`);
  },
  {
    connection: { host: process.env.REDIS_HOST || "localhost", port: parseInt(process.env.REDIS_PORT || "6379"), maxRetriesPerRequest: null },
    concurrency: 1,
  }
);
turnoverWorker.on("failed", (job, err) => console.error(`[turnover] job ${job?.id} failed:`, err.message));
```
импорты: `import { processTurnoverJob } from "@backend/modules/inventory/turnover/job";`, `import { turnoverQueueName, type TurnoverJobData } from "@backend/modules/inventory/turnover/queue";`; в `shutdown` — `turnoverWorker.close()`.

`cron/src/index.ts` — после сверки:
```ts
// ОСВ: каждую ночь текущий и прошлый месяц, все склады (spec 2026-10-14, §6).
cron.schedule(
  "0 3 * * *",
  async () => {
    for (const period of allowedPeriods(new Date())) {
      try {
        await enqueueTurnover(turnoverQueue(), client, { period });
        console.log(`[turnover] queued ${period}`);
      } catch (e) {
        console.error(`[turnover] not queued ${period}:`, (e as Error).message);
      }
    }
  },
  { timezone: "Asia/Tashkent" }
);
```
импорты: `allowedPeriods` (рядом с `previousPeriod`), `enqueueTurnover, turnoverQueue` из `@backend/modules/inventory/turnover/queue`.

`cron/inventory_turnover_once.ts`:
```ts
// Ручная загрузка ОСВ без очереди: bun --env-file=../backend/.env inventory_turnover_once.ts 2026-09-30 [storeId]
import { drizzleDb } from "@backend/lib/db";
import { withIikoClient } from "@backend/modules/inventory/reconcile/iiko-client";
import { fetchTurnover } from "@backend/modules/inventory/turnover/service";

const [period, storeId] = process.argv.slice(2);
if (!period) throw new Error("usage: inventory_turnover_once.ts <period> [storeId]");
const t0 = Date.now();
const r = await withIikoClient((iiko) =>
  fetchTurnover(drizzleDb, iiko, { period, storeId: storeId ?? null }, async (p) => {
    if (p.done !== undefined) process.stdout.write(`\r${p.done}/${p.total ?? "?"}`);
  })
);
console.log(`\n${r.stores} stores, failed: ${r.failed.join(", ") || "—"}, ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(0);
```

- [ ] **Step 8: Проверить сборку импортов**

Run: `cd cron && bun build inventory_reconcile_worker.ts src/index.ts inventory_turnover_once.ts --target=bun --outdir=/private/tmp/claude-501/turnover-build >/dev/null && echo OK`
Expected: `OK`. Плюс `cd backend && bun test src/modules/inventory/reconcile/worker-health.test.ts` — PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/inventory/turnover/{service,service.test,queue,job}.ts backend/src/modules/inventory/reconcile/worker-health.ts backend/package.json cron/inventory_reconcile_worker.ts cron/src/index.ts cron/inventory_turnover_once.ts
git commit -m "feat(inventory/turnover): загрузка снимка ОСВ — сервис, очередь, воркер, ночной запуск"
```

---

### Task 5: Чтение — месяцы, сводная, ведомость склада

**Files:**
- Create: `backend/src/modules/inventory/turnover/read.ts`
- Modify: `backend/src/modules/inventory/book/stock.ts` (`export async function productInfo`)

**Interfaces:**
- Consumes: Task 2 `aggregate`, `visibleColumns`, `branchMonthState`, `turnoverBounds`; `storeAccess`, `Actor` (`../access`); `branchMayReopen`, `normalizeNumeric`, `assertUuid` (`../counts`); `productInfo` (`../book/stock`); `allowedPeriods`, `isValidPeriod`, `lastDayOfMonth` (`../rules`); Task 4 `readTurnoverOverview`, `turnoverQueue`.
- Produces:
  - `monthlyFixed(db, storeId, period): Promise<boolean>`
  - `listTurnoverPeriods(db, actor, storeId: string | undefined, now): Promise<TurnoverPeriod[]>`
  - `loadTurnoverSummary(db, redis, period, now): Promise<TurnoverSummary>`
  - `loadStoreTurnover(db, actor, period, storeId, now): Promise<TurnoverStoreView>`
  - `isOffice(actor) = actor.perms.includes("inventory.templates")`

- [ ] **Step 1: Экспортировать `productInfo`** в `book/stock.ts`: `async function productInfo` → `export async function productInfo`.

- [ ] **Step 2: read.ts**

```ts
// Выдача ОСВ (spec 2026-10-14, §7). Офис (inventory.templates) — все склады, количество и суммы.
// Филиал — свой склад (users_stores), только количество, только открытые месяцы (branchMonthState).
import { corporation_store, inventory_counts, inventory_turnover, inventory_turnover_balance, inventory_turnover_fetch } from "backend/drizzle/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type Redis from "ioredis";
import { storeAccess, type Actor, type DbLike } from "../access";
import { productInfo } from "../book/stock";
import { assertUuid, branchMayReopen, normalizeNumeric } from "../counts";
import { InventoryError } from "../errors";
import { allowedPeriods, isValidPeriod, lastDayOfMonth } from "../rules";
import { aggregate, branchMonthState, visibleColumns, type Agg, type BalAgg, type Cells, type TxAgg } from "./pure";
import { readTurnoverOverview, turnoverQueue } from "./queue";
import type { TurnoverCells, TurnoverLine, TurnoverPeriod, TurnoverStoreView, TurnoverSummary, TurnoverSummaryRow } from "./types";

/** Первый месяц в списке: раньше снимков нет (кнопкой можно загрузить любой из списка). */
const FIRST_PERIOD = "2026-01-31";

export const isOffice = (actor: Actor) => actor.perms.includes("inventory.templates");

const str = (n: number) => normalizeNumeric(n.toFixed(4));
const cells = (c: Cells): TurnoverCells => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, str(v ?? 0)]));

function periodsDesc(now: Date): string[] {
  const out: string[] = [];
  let p = allowedPeriods(now)[0];
  while (p >= FIRST_PERIOD) {
    out.push(p);
    const [y, m] = p.split("-").map(Number);
    p = m === 1 ? lastDayOfMonth(y - 1, 12) : lastDayOfMonth(y, m - 1);
  }
  return out;
}

function assertPeriod(period: string) {
  if (!isValidPeriod(period)) throw new InventoryError(422, "bad_period");
}

/** Месячный пересчёт склада за период есть и весь зафиксирован (нет черновиков и того, что филиал может вернуть). */
export async function monthlyFixed(db: DbLike, storeId: string, period: string): Promise<boolean> {
  const counts = await db
    .select({ status: inventory_counts.status, store_id: inventory_counts.store_id, period: inventory_counts.period, kind: inventory_counts.kind })
    .from(inventory_counts)
    .where(and(eq(inventory_counts.store_id, storeId), eq(inventory_counts.period, period), eq(inventory_counts.kind, "monthly"), ne(inventory_counts.status, "cancelled")));
  if (!counts.length || counts.some((c) => c.status === "draft")) return false;
  for (const c of counts) if (await branchMayReopen(db, c)) return false;
  return true;
}

async function fetchInfo(db: DbLike, period: string | null, storeId?: string) {
  const rows = await db
    .select({ period: inventory_turnover_fetch.period, store_id: inventory_turnover_fetch.store_id, fetched_at: inventory_turnover_fetch.fetched_at, data_through: inventory_turnover_fetch.data_through })
    .from(inventory_turnover_fetch)
    .where(and(period ? eq(inventory_turnover_fetch.period, period) : undefined, storeId ? eq(inventory_turnover_fetch.store_id, storeId) : undefined));
  return rows;
}

export async function listTurnoverPeriods(db: DbLike, actor: Actor, storeId: string | undefined, now: Date): Promise<TurnoverPeriod[]> {
  const office = isOffice(actor);
  if (!office) {
    if (!storeId) throw new InventoryError(422, "store_required");
    assertUuid(storeId);
    if ((await storeAccess(db, actor, storeId)) !== "write") throw new InventoryError(403, "forbidden");
  } else if (storeId) assertUuid(storeId);
  const info = await fetchInfo(db, null, storeId);
  // Без склада (офис) — самая свежая загрузка по месяцу.
  const byPeriod = new Map<string, { fetched_at: string | null; data_through: string | null }>();
  for (const r of info) {
    const cur = byPeriod.get(r.period);
    if (!cur || (cur.fetched_at ?? "") < r.fetched_at) byPeriod.set(r.period, { fetched_at: r.fetched_at, data_through: r.data_through });
  }
  const previous = allowedPeriods(now)[1];
  const prevFixed = office ? true : await monthlyFixed(db, storeId!, previous);
  return periodsDesc(now).map((period) => {
    const state = office ? { open: true, reason: null } : branchMonthState(period, now, prevFixed);
    return { period, ...state, fetched_at: byPeriod.get(period)?.fetched_at ?? null, data_through: byPeriod.get(period)?.data_through ?? null };
  });
}

type RawTx = TxAgg & { store_id: string; product_id: string };
type RawBal = BalAgg & { store_id: string; product_id: string };

async function loadRaw(db: DbLike, period: string, storeId?: string) {
  const txs = (await db
    .select({
      store_id: inventory_turnover.store_id, product_id: inventory_turnover.product_id, tx_type: inventory_turnover.tx_type,
      qty_in: inventory_turnover.qty_in, qty_out: inventory_turnover.qty_out, sum_in: inventory_turnover.sum_in, sum_out: inventory_turnover.sum_out,
    })
    .from(inventory_turnover)
    .where(and(eq(inventory_turnover.period, period), storeId ? eq(inventory_turnover.store_id, storeId) : undefined))
  ).map((r) => ({ ...r, qty_in: Number(r.qty_in), qty_out: Number(r.qty_out), sum_in: Number(r.sum_in), sum_out: Number(r.sum_out) })) as RawTx[];
  const bals = (await db
    .select({
      store_id: inventory_turnover_balance.store_id, product_id: inventory_turnover_balance.product_id,
      start_qty: inventory_turnover_balance.start_qty, start_sum: inventory_turnover_balance.start_sum,
      end_qty: inventory_turnover_balance.end_qty, end_sum: inventory_turnover_balance.end_sum, consistent: inventory_turnover_balance.consistent,
    })
    .from(inventory_turnover_balance)
    .where(and(eq(inventory_turnover_balance.period, period), storeId ? eq(inventory_turnover_balance.store_id, storeId) : undefined))
  ).map((r) => ({ ...r, start_qty: Number(r.start_qty), start_sum: Number(r.start_sum), end_qty: Number(r.end_qty), end_sum: Number(r.end_sum) })) as (RawBal & { consistent: boolean })[];
  return { txs, bals };
}

function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
}

export async function loadSummary(db: DbLike, redis: Redis, period: string): Promise<TurnoverSummary> {
  assertPeriod(period);
  const { txs, bals } = await loadRaw(db, period);
  const txByStore = group(txs, (r) => r.store_id);
  const balByStore = group(bals, (r) => r.store_id);
  const info = new Map((await fetchInfo(db, period)).map((r) => [r.store_id, r]));
  const storeIds = [...new Set([...txByStore.keys(), ...balByStore.keys()])];
  const names = new Map(
    storeIds.length
      ? (await db.select({ id: corporation_store.id, name: corporation_store.name }).from(corporation_store).where(inArray(corporation_store.id, storeIds))).map((s) => [s.id, s.name ?? ""])
      : []
  );
  // Склад в суммах = сумма агрегатов его товаров; итог — по всем складам.
  const storeAggs: { id: string; agg: Agg; inconsistent: number }[] = storeIds.map((id) => {
    const sb = balByStore.get(id) ?? [];
    const st = txByStore.get(id) ?? [];
    const bal = sb.reduce((a, b) => ({ start_qty: 0, start_sum: a.start_sum + b.start_sum, end_qty: 0, end_sum: a.end_sum + b.end_sum }), { start_qty: 0, start_sum: 0, end_qty: 0, end_sum: 0 });
    const agg = aggregate(bal, st.map((t) => ({ ...t, qty_in: 0, qty_out: 0 })));
    return { id, agg, inconsistent: sb.filter((b) => !b.consistent).length };
  });
  const total: Cells = {};
  for (const s of storeAggs) for (const [k, v] of Object.entries(s.agg.sum)) total[k as keyof Cells] = (total[k as keyof Cells] ?? 0) + (v ?? 0);
  const rows: TurnoverSummaryRow[] = storeAggs
    .map((s) => ({
      store_id: s.id, store_name: names.get(s.id) ?? "", sum: cells(s.agg.sum), inconsistent: s.inconsistent,
      fetched_at: info.get(s.id)?.fetched_at ?? null, data_through: info.get(s.id)?.data_through ?? null,
    }))
    .sort((a, b) => a.store_name.localeCompare(b.store_name, "ru"));
  // Колонки — по суммам (sum_only cost_correction тоже: сводная только в суммах).
  const columns = visibleColumns(storeAggs.map((s) => ({ ...s.agg, qty: {} })), true).map((c) => ({ key: c.key }));
  return { period, columns, rows, total: cells(total), status: await readTurnoverOverview(redis, period, turnoverQueue()) };
}

export async function loadStoreTurnover(db: DbLike, actor: Actor, period: string, storeId: string, now: Date): Promise<TurnoverStoreView> {
  assertPeriod(period);
  assertUuid(storeId);
  const office = isOffice(actor);
  if (!office) {
    if ((await storeAccess(db, actor, storeId)) !== "write") throw new InventoryError(403, "forbidden");
    const state = branchMonthState(period, now, period === allowedPeriods(now)[1] ? await monthlyFixed(db, storeId, period) : false);
    if (!state.open) throw new InventoryError(403, "month_closed", { reason: state.reason });
  }
  const { txs, bals } = await loadRaw(db, period, storeId);
  const txByProduct = group(txs, (r) => r.product_id);
  const balByProduct = new Map(bals.map((b) => [b.product_id, b]));
  const ids = [...new Set([...txByProduct.keys(), ...balByProduct.keys()])];
  const info = await productInfo(db, ids);
  const aggs = ids.map((id) => ({ id, agg: aggregate(balByProduct.get(id), txByProduct.get(id) ?? []), consistent: balByProduct.get(id)?.consistent ?? false }));
  const lines: TurnoverLine[] = aggs
    .map(({ id, agg, consistent }) => {
      const p = info.get(id);
      const transfer = office
        ? { qty_in: str(agg.transfer.qty_in), qty_out: str(agg.transfer.qty_out), sum_in: str(agg.transfer.sum_in), sum_out: str(agg.transfer.sum_out) }
        : { qty_in: str(agg.transfer.qty_in), qty_out: str(agg.transfer.qty_out) };
      const qty = { ...agg.qty };
      delete qty.cost_correction;
      const line: TurnoverLine = {
        product_id: id, code: p?.code ?? null, name: p?.name ?? id, unit_name: p?.unit_name ?? null, group_name: p?.group_name ?? "Без группы",
        qty: cells(qty), transfer, consistent,
      };
      if (office) line.sum = cells(agg.sum);
      return line;
    })
    .sort((a, b) => a.group_name.localeCompare(b.group_name, "ru") || a.name.localeCompare(b.name, "ru"));
  const [store] = await db.select({ name: corporation_store.name }).from(corporation_store).where(eq(corporation_store.id, storeId));
  const [fetch] = await fetchInfo(db, period, storeId);
  return {
    period, store_id: storeId, store_name: store?.name ?? "", with_sums: office,
    columns: visibleColumns(aggs.map((a) => a.agg), office), lines,
    fetched_at: fetch?.fetched_at ?? null, data_through: fetch?.data_through ?? null,
  };
}
```

Примечание к `loadSummary`: агрегат склада в суммах строится той же `aggregate`, но с обнулённым количеством, чтобы знаки колонок совпадали с ведомостью товаров. Прежде чем двигаться дальше, убедиться, что сравнение строк `cur.fetched_at < r.fetched_at` в `listTurnoverPeriods` работает для формата drizzle `mode: "string"` (ISO-подобная строка из Postgres, лексикографически сравнима).

- [ ] **Step 3: Проверить типы**

Run: `cd backend && bunx tsc --noEmit -p . 2>&1 | grep -E "turnover|book/stock" | head`
Expected: пусто (ошибок в новых файлах нет; чужие старые ошибки проекта не трогаем).

- [ ] **Step 4: Commit** — вместе с Task 6 (чтение без маршрутов не проверяется HTTP-тестами; отдельный коммит после Task 6 Step 4). Если Task 6 откладывается — коммитить сейчас:

```bash
git add backend/src/modules/inventory/turnover/read.ts backend/src/modules/inventory/book/stock.ts
git commit -m "feat(inventory/turnover): выдача ОСВ — месяцы, сводная, ведомость склада с правилами доступа"
```

---

### Task 6: Маршруты и HTTP-тесты

**Files:**
- Create: `backend/src/modules/inventory/turnover/routes.ts`
- Modify: `backend/src/modules/inventory/controller.ts` (`.use(turnoverRoutes)` рядом с `bookRoutes`)
- Test: `backend/src/modules/inventory/turnover/routes.test.ts`

**Interfaces:**
- Consumes: Task 5 функции, Task 4 `enqueueTurnover`, `turnoverQueue`, `readTurnoverOverview`; Task 2 `turnoverBounds` (валидация `refresh`).
- Produces: маршруты из спеки §7 (пути ниже — их использует admin в Task 7).

- [ ] **Step 1: routes.ts**

```ts
// Маршруты ОСВ (spec 2026-10-14, §7). Плагин без префикса: подключается внутри inventoryControllerImpl (/api).
import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom } from "../access";
import { assertUuid } from "../counts";
import { run } from "../errors";
import { turnoverBounds } from "./pure";
import { enqueueTurnover, readTurnoverOverview, turnoverQueue } from "./queue";
import { listTurnoverPeriods, loadStoreTurnover, loadSummary } from "./read";

export const turnoverRoutes = new Elysia({ name: "@api/inventory/turnover" })
  .use(ctx)
  .get(
    "/inventory/turnover/periods",
    async ({ query, user, role, drizzle, cacheController, set }) =>
      run(set, async () => listTurnoverPeriods(drizzle, await actorFrom(cacheController, user, role), query.store_id, new Date())),
    { permission: "inventory.count", query: t.Object({ store_id: t.Optional(t.String()) }) }
  )
  .get(
    "/inventory/turnover/summary",
    async ({ query, drizzle, redis, set }) => run(set, async () => loadSummary(drizzle, redis, query.period)),
    { permission: "inventory.templates", query: t.Object({ period: t.String() }) }
  )
  .get(
    "/inventory/turnover/status",
    async ({ query, redis, set }) => run(set, async () => readTurnoverOverview(redis, query.period, turnoverQueue())),
    { permission: "inventory.templates", query: t.Object({ period: t.String() }) }
  )
  .get(
    "/inventory/turnover",
    async ({ query, user, role, drizzle, cacheController, set }) =>
      run(set, async () => loadStoreTurnover(drizzle, await actorFrom(cacheController, user, role), query.period, query.store_id, new Date())),
    { permission: "inventory.count", query: t.Object({ period: t.String(), store_id: t.String() }) }
  )
  .post(
    "/inventory/turnover/refresh",
    async ({ body, drizzle: _db, redis, set }) =>
      run(set, async () => {
        turnoverBounds(body.period, new Date()); // 422 на кривой/будущий месяц
        if (body.store_id) assertUuid(body.store_id);
        return enqueueTurnover(turnoverQueue(), redis, { period: body.period, storeId: body.store_id ?? null });
      }),
    { permission: "inventory.reconcile", body: t.Object({ period: t.String(), store_id: t.Optional(t.String()) }) }
  );
```
(Если `redis` в контексте называется иначе — посмотреть `reconcile/routes.ts`, где `enqueueReconcile(reconcileQueue(), redis, …)`, и сделать так же; `drizzle: _db` убрать, если не используется.)

В `controller.ts`: `import { turnoverRoutes } from "./turnover/routes";` и `.use(turnoverRoutes)` после `.use(bookRoutes)`.

- [ ] **Step 2: routes.test.ts** (по образцу `book/routes.test.ts`: тот же guard на тестовое окружение, `api()`-обёртка, `withSession`, `sweepTestRoles`, `closeTestRedis`, `turnoverQueue().obliterate({ force: true })` в `beforeAll`/`afterAll`)

Сид: склад `store` с менеджером (`users_stores`), чужой склад `other`, товар `p`; в `inventory_turnover_balance`/`inventory_turnover`/`inventory_turnover_fetch` — данные за три месяца относительно реального «сейчас»: `[current, previous] = allowedPeriods(new Date())`, `older` = месяц до `previous` (через `lastDayOfMonth`). Для каждого: баланс `start 5/50, end 7/70`, проводки `INVOICE 2/20` и `STORE_COST_CORRECTION 0/0 sum_in 3` (тогда end_sum = 73 — записать 73, consistent true).

Сессии:
- `office = withSession({ permissions: ["inventory.count", "inventory.templates", "inventory.reconcile"] })`
- `branch = withSession({ userId: managerId, permissions: ["inventory.count", "inventory.manage"] })`

Тесты:
```ts
it("офис: ведомость склада с суммами и cost_correction", async () => {
  const r = await api(office, "GET", `/api/inventory/turnover?period=${older}&store_id=${store}`);
  expect(r.status).toBe(200);
  expect(r.body.with_sums).toBe(true);
  expect(r.body.lines[0].sum.cost_correction).toBe("3");
  expect(r.body.columns).toContainEqual({ key: "cost_correction", sum_only: true });
});
it("филиал: старый месяц — только количество, ключа sum нет, без cost_correction", async () => {
  const r = await api(branch, "GET", `/api/inventory/turnover?period=${older}&store_id=${store}`);
  expect(r.status).toBe(200);
  expect(r.body.with_sums).toBe(false);
  expect("sum" in r.body.lines[0]).toBe(false);
  expect("sum_in" in r.body.lines[0].transfer).toBe(false);
  expect(r.body.columns.map((c: any) => c.key)).not.toContain("cost_correction");
});
it("филиал: текущий месяц — 403 month_closed/current", async () => {
  const r = await api(branch, "GET", `/api/inventory/turnover?period=${current}&store_id=${store}`);
  expect(r.status).toBe(403);
  expect(r.body).toMatchObject({ error: "month_closed", reason: "current" });
});
it("филиал: прошлый без пересчёта — 403 not_fixed; с принятой сверкой — 200", async () => {
  const r1 = await api(branch, "GET", `/api/inventory/turnover?period=${previous}&store_id=${store}`);
  expect(r1.body).toMatchObject({ error: "month_closed", reason: "not_fixed" });
  // месячный пересчёт submitted + сверка accepted → branchMayReopen = false → зафиксирован
  await drizzleDb.insert(schema.inventory_counts).values({ store_id: store, template_name: "Месяц", period: previous, kind: "monthly", count_date: previous, status: "submitted", created_by: managerId });
  await drizzleDb.insert(schema.inventory_reconciliations).values({ store_id: store, period: previous, status: "accepted" } as any);
  const r2 = await api(branch, "GET", `/api/inventory/turnover?period=${previous}&store_id=${store}`);
  expect(r2.status).toBe(200);
});
it("филиал: чужой склад — 403; сводная — 403; refresh — 403", async () => {
  expect((await api(branch, "GET", `/api/inventory/turnover?period=${older}&store_id=${other}`)).status).toBe(403);
  expect((await api(branch, "GET", `/api/inventory/turnover/summary?period=${older}`)).status).toBe(403);
  expect((await api(branch, "POST", `/api/inventory/turnover/refresh`, { period: older })).status).toBe(403);
});
it("филиал: periods — свои месяцы с причинами; без store_id — 422", async () => {
  const r = await api(branch, "GET", `/api/inventory/turnover/periods?store_id=${store}`);
  expect(r.body[0]).toMatchObject({ period: current, open: false, reason: "current" });
  expect((await api(branch, "GET", `/api/inventory/turnover/periods`)).status).toBe(422);
});
it("офис: сводная — строка склада в суммах и итог", async () => {
  const r = await api(office, "GET", `/api/inventory/turnover/summary?period=${older}`);
  const row = r.body.rows.find((x: any) => x.store_id === store);
  expect(row.sum).toMatchObject({ start: "50", invoice: "20", cost_correction: "3", end: "73" });
  expect(row.inconsistent).toBe(0);
});
it("refresh: ставит задачу, повтор — 409, будущий месяц — 422", async () => {
  const r1 = await api(office, "POST", `/api/inventory/turnover/refresh`, { period: older });
  expect(r1.status).toBe(200);
  expect(r1.body.state).toBe("queued");
  expect((await api(office, "POST", `/api/inventory/turnover/refresh`, { period: older })).status).toBe(409);
  expect((await api(office, "POST", `/api/inventory/turnover/refresh`, { period: "2099-12-31" })).status).toBe(422);
});
```
Колонки `inventory_reconciliations` для вставки посмотреть в schema.ts (обязательные поля) и заполнить их, убрав `as any`. Сводная по тестовой БД содержит и чужие данные — проверять только свою строку. Очистка в `afterAll`: удалить строки `inventory_turnover*` по `store_id in (store, other)`, пересчёты/сверки склада, `users_stores`, `corporation_store`, номенклатуру.

- [ ] **Step 3: Run**

Run: `cd backend && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/managers_tickets_test bun run test:http:turnover`
Expected: PASS (service + routes). Также `bun run test:http:book` и `bun run test:http:inventory` с тем же `TEST_DATABASE_URL` — без новых падений (контроллер изменился).

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/inventory/turnover/read.ts backend/src/modules/inventory/turnover/routes.ts backend/src/modules/inventory/turnover/routes.test.ts backend/src/modules/inventory/controller.ts backend/src/modules/inventory/book/stock.ts
git commit -m "feat(inventory/turnover): API ОСВ — месяцы, сводная, ведомость склада, обновление из iiko"
```

---

### Task 7: Экран в админке

**Files:**
- Modify: `admin/lib/inventory-api.ts`
- Create: `admin/lib/inventory/turnover.ts`, `admin/lib/inventory/turnover.test.ts`
- Create: `admin/app/[locale]/inventory/turnover/page.tsx`, `_components/summary-table.tsx`, `_components/store-table.tsx`, `_components/status-line.tsx`
- Modify: `admin/components/layout/nav-config.tsx`, `admin/components/layout/manager-layout.tsx`, `admin/messages/{ru,en,uz-Latn,uz-Cyrl}.json`

**Interfaces:**
- Consumes: типы из `@backend/modules/inventory/turnover/types`; маршруты Task 6.
- Produces: `inventoryApi.turnover.{periods, summary, store, status, refresh}`; страница.

- [ ] **Step 1: Падающий тест lib/inventory/turnover.test.ts**

```ts
import { describe, expect, it } from "bun:test";
import { columnsFor, isSigned, cellOf } from "./turnover";

describe("turnover helpers", () => {
  const cols = [{ key: "start" }, { key: "transfer" }, { key: "cost_correction", sum_only: true }, { key: "end" }] as const;
  it("режим «Количество» прячет sum_only", () => {
    expect(columnsFor([...cols], "qty").map((c) => c.key)).toEqual(["start", "transfer", "end"]);
    expect(columnsFor([...cols], "sum").map((c) => c.key)).toEqual(["start", "transfer", "cost_correction", "end"]);
  });
  it("± колонки — со знаком, расход и остатки — без", () => {
    expect(isSigned("transfer")).toBe(true);
    expect(isSigned("inventory")).toBe(true);
    expect(isSigned("sales")).toBe(false);
    expect(isSigned("end")).toBe(false);
  });
  it("cellOf — нет значения → 0", () => {
    expect(cellOf({ qty: { start: "5" } } as any, "start", "qty")).toBe("5");
    expect(cellOf({ qty: {} } as any, "invoice", "qty")).toBe("0");
    expect(cellOf({ qty: {}, sum: { end: "7" } } as any, "end", "sum")).toBe("7");
  });
});
```

Run: `cd admin && bun test lib/inventory/turnover.test.ts` — FAIL (нет модуля).

- [ ] **Step 2: lib/inventory/turnover.ts**

```ts
// Экран ОСВ: какие колонки показывать в режиме, какие со знаком. Колонки и значения считает сервер.
import type { TurnoverCells, TurnoverColumn, TurnoverColumnKey } from "@backend/modules/inventory/turnover/types";

export type TurnoverMode = "qty" | "sum";

const SIGNED = new Set<TurnoverColumnKey>(["transfer", "inventory", "transformation", "production", "cost_correction", "other"]);
export const isSigned = (key: TurnoverColumnKey) => SIGNED.has(key);

export function columnsFor(columns: TurnoverColumn[], mode: TurnoverMode): TurnoverColumn[] {
  return mode === "qty" ? columns.filter((c) => !c.sum_only) : columns;
}

export function cellOf(row: { qty?: TurnoverCells; sum?: TurnoverCells }, key: TurnoverColumnKey, mode: TurnoverMode): string {
  return (mode === "sum" ? row.sum : row.qty)?.[key] ?? "0";
}
```

Run: `cd admin && bun test lib/inventory/turnover.test.ts` — PASS.

- [ ] **Step 3: inventory-api.ts**

Импорт типов:
```ts
import type { TurnoverFetchOverview, TurnoverFetchStatus, TurnoverPeriod, TurnoverStoreView, TurnoverSummary } from "@backend/modules/inventory/turnover/types";
```
В `inventoryApi`:
```ts
  turnover: {
    periods: (storeId?: string) => call<TurnoverPeriod[]>(inv.turnover.periods.get({ query: storeId ? { store_id: storeId } : {} })),
    summary: (period: string) => call<TurnoverSummary>(inv.turnover.summary.get({ query: { period } })),
    store: (period: string, storeId: string) => call<TurnoverStoreView>(inv.turnover.get({ query: { period, store_id: storeId } })),
    status: (period: string) => call<TurnoverFetchOverview>(inv.turnover.status.get({ query: { period } })),
    refresh: (period: string, storeId?: string) =>
      call<TurnoverFetchStatus>(inv.turnover.refresh.post(storeId ? { period, store_id: storeId } : { period })),
  },
```

- [ ] **Step 4: Тексты (ru; en/uz-Latn/uz-Cyrl — переводы тех же ключей)** — в `inventory` добавить:

```json
"turnover": {
  "title": "Оборотная ведомость",
  "month": "Месяц",
  "store": "Склад",
  "allStores": "Все склады",
  "mode": { "qty": "Количество", "sum": "Сумма" },
  "search": "Поиск по названию",
  "through": "Данные по {date} включительно",
  "fetched": "загружено {at}",
  "noData": "Данных за этот месяц пока нет",
  "refresh": "Обновить из iiko",
  "loading": "Загрузка из iiko: {done} / {total}",
  "failedStores": "Не загружены: {stores}",
  "closed": { "current": "Текущий месяц недоступен", "not_fixed": "Откроется после фиксации пересчёта" },
  "inconsistent": "не сходится",
  "inconsistentCount": "{n} не сходится",
  "transferHint": "Приход {in} · расход {out}",
  "total": "Итого",
  "col": {
    "code": "Код", "product": "Товар", "unit": "Ед.", "store": "Склад",
    "start": "Начало", "invoice": "Приход (накладные)", "sales": "Реализация", "transfer": "Перемещения ±",
    "writeoff": "Списания", "inventory": "Инвентаризация ±", "outgoing_invoice": "Расходные накладные",
    "returned_invoice": "Возврат поставщику", "transformation": "Переработка ±", "production": "Приготовление ±",
    "cost_correction": "Корректировка себестоимости", "other": "Прочее ±", "end": "Конец"
  }
}
```
Проверка: `cd admin && node -e "for (const l of ['ru','en','uz-Latn','uz-Cyrl']) { const j=require('./messages/'+l+'.json'); if(!j.inventory.turnover.col.end) throw l }"`.

- [ ] **Step 5: Компоненты**

`_components/status-line.tsx` — строка «Данные по … включительно · загружено …», у офиса кнопка ↻ и прогресс; опрос статуса каждые 3 с, пока `state` ∈ queued/running; по завершении инвалидирует `["inventory_turnover"]`:

```tsx
"use client";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@admin/components/ui/button";
import CanAccess from "@admin/components/can-access";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime } from "@admin/lib/inventory/money";
import { formatDay } from "@admin/lib/inventory/periods";
import { WorkerWarning } from "../../reconciliation/_components/worker-warning";

export function StatusLine({ period, fetchedAt, dataThrough, storeId }: { period: string; fetchedAt: string | null; dataThrough: string | null; storeId?: string }) {
  const t = useTranslations("inventory.turnover");
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      {dataThrough ? (
        <span>
          {t("through", { date: formatDay(dataThrough) })}
          {fetchedAt && ` · ${t("fetched", { at: formatDateTime(fetchedAt, locale) })}`}
        </span>
      ) : (
        <span>{t("noData")}</span>
      )}
      <CanAccess permission="inventory.reconcile">
        <Refresh period={period} storeId={storeId} />
      </CanAccess>
    </div>
  );
}

function Refresh({ period, storeId }: { period: string; storeId?: string }) {
  const t = useTranslations("inventory.turnover");
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["inventory_turnover_status", period],
    queryFn: () => inventoryApi.turnover.status(period),
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.state) ? 3000 : false),
  });
  const s = status.data;
  const mine = storeId ? s?.stores.find((x) => x.store_id === storeId) : s;
  const active = !!mine && ["queued", "running"].includes(mine.state);
  useEffect(() => {
    if (mine?.state === "done") qc.invalidateQueries({ queryKey: ["inventory_turnover"] });
  }, [mine?.state, qc]);
  const m = useMutation({
    mutationFn: () => inventoryApi.turnover.refresh(period, storeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory_turnover_status", period] }),
  });
  return (
    <>
      <Button size="sm" variant="outline" disabled={active || m.isPending} onClick={() => m.mutate()}>
        <RefreshCw className={`mr-1 h-4 w-4 ${active ? "animate-spin" : ""}`} />
        {t("refresh")}
      </Button>
      {active && mine && mine.total > 0 && <span>{t("loading", { done: mine.done, total: mine.total })}</span>}
      {mine && mine.failed.length > 0 && <span className="text-destructive">{t("failedStores", { stores: mine.failed.length })}</span>}
      {m.error && <span className="text-destructive">{(m.error as Error).message}</span>}
      <WorkerWarning active={active} />
    </>
  );
}
```

`_components/summary-table.tsx` — таблица складов в суммах (офис): колонки из `summary.columns`, строка «Итого», клик по строке — `onPick(store_id)`; «не сходится» — бейдж с числом:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import type { TurnoverSummary } from "@backend/modules/inventory/turnover/types";
import { diffClass, formatDiff, formatQty } from "@admin/lib/inventory/money";
import { isSigned } from "@admin/lib/inventory/turnover";

export function SummaryTable({ data, onPick }: { data: TurnoverSummary; onPick: (storeId: string) => void }) {
  const t = useTranslations("inventory.turnover");
  const fmt = (key: string, v: string | undefined) => (isSigned(key as any) ? formatDiff(v ?? "0") : formatQty(v ?? "0"));
  const cls = (key: string, v: string | undefined) => (isSigned(key as any) ? diffClass(v ?? "0") : "");
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("col.store")}</TableHead>
            {data.columns.map((c) => <TableHead key={c.key} className="text-right whitespace-nowrap">{t(`col.${c.key}`)}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r) => (
            <TableRow key={r.store_id} className="cursor-pointer" onClick={() => onPick(r.store_id)}>
              <TableCell className="whitespace-nowrap">
                {r.store_name}
                {r.inconsistent > 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t("inconsistentCount", { n: r.inconsistent })}</span>}
              </TableCell>
              {data.columns.map((c) => <TableCell key={c.key} className={`text-right tabular-nums ${cls(c.key, r.sum[c.key])}`}>{fmt(c.key, r.sum[c.key])}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">{t("total")}</TableCell>
            {data.columns.map((c) => <TableCell key={c.key} className="text-right font-semibold tabular-nums">{fmt(c.key, data.total[c.key])}</TableCell>)}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
```
(Если `TableFooter` нет в `admin/components/ui/table` — использовать `TableRow` с `className="font-semibold"` в конце `TableBody`.)

`_components/store-table.tsx` — ведомость склада по группам (как `stock/page.tsx`): поиск, `mode` (qty/sum, переключатель только при `with_sums`), колонки `columnsFor(view.columns, mode)`; «Перемещения ±» — `title={t("transferHint", {in, out})}`; строка с `!consistent` — бейдж «не сходится»:

```tsx
"use client";
import { Fragment, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@admin/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import type { TurnoverLine, TurnoverStoreView } from "@backend/modules/inventory/turnover/types";
import { diffClass, formatDiff, formatQty } from "@admin/lib/inventory/money";
import { cellOf, columnsFor, isSigned, type TurnoverMode } from "@admin/lib/inventory/turnover";

export function StoreTable({ view }: { view: TurnoverStoreView }) {
  const t = useTranslations("inventory.turnover");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<TurnoverMode>("qty");
  const cols = columnsFor(view.columns, view.with_sums ? mode : "qty");
  const m = view.with_sums ? mode : "qty";
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const by = new Map<string, TurnoverLine[]>();
    for (const l of view.lines) {
      if (q && !l.name.toLowerCase().includes(q) && !(l.code ?? "").toLowerCase().includes(q)) continue;
      by.set(l.group_name, [...(by.get(l.group_name) ?? []), l]);
    }
    return [...by.entries()];
  }, [view.lines, search]);
  const span = 3 + cols.length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-11 w-full sm:w-80" placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        {view.with_sums && (
          <div className="inline-flex rounded border">
            {(["qty", "sum"] as const).map((x) => (
              <button key={x} type="button" onClick={() => setMode(x)} className={`px-3 py-2 text-sm ${mode === x ? "bg-primary text-primary-foreground" : ""}`}>
                {t(`mode.${x}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.code")}</TableHead>
              <TableHead>{t("col.product")}</TableHead>
              <TableHead>{t("col.unit")}</TableHead>
              {cols.map((c) => <TableHead key={c.key} className="text-right whitespace-nowrap">{t(`col.${c.key}`)}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(([group, items]) => (
              <Fragment key={group}>
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={span} className="font-medium">{group}</TableCell>
                </TableRow>
                {items.map((l) => (
                  <TableRow key={l.product_id}>
                    <TableCell className="tabular-nums text-xs">{l.code ?? "—"}</TableCell>
                    <TableCell>
                      {l.name}
                      {!l.consistent && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t("inconsistent")}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m === "qty" ? l.unit_name ?? "" : ""}</TableCell>
                    {cols.map((c) => {
                      const v = cellOf(l, c.key, m);
                      const hint = c.key === "transfer"
                        ? t("transferHint", {
                            in: formatQty(m === "sum" ? l.transfer.sum_in ?? "0" : l.transfer.qty_in),
                            out: formatQty(m === "sum" ? l.transfer.sum_out ?? "0" : l.transfer.qty_out),
                          })
                        : undefined;
                      return (
                        <TableCell key={c.key} title={hint} className={`text-right tabular-nums ${isSigned(c.key) ? diffClass(v) : ""}`}>
                          {isSigned(c.key) ? formatDiff(v) : formatQty(v)}
                        </TableCell>
                      );
                    })}
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

- [ ] **Step 6: page.tsx**

```tsx
"use client";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import CanAccess from "@admin/components/can-access";
import { inventoryApi } from "@admin/lib/inventory-api";
import { periodLabel } from "@admin/lib/inventory/periods";
import { usePermissions } from "@admin/lib/inventory/use-permissions";
import { StatusLine } from "./_components/status-line";
import { StoreTable } from "./_components/store-table";
import { SummaryTable } from "./_components/summary-table";

const ALL = "__all__";

export default function TurnoverPage() {
  return (
    <CanAccess permission="inventory.count">
      <Turnover />
    </CanAccess>
  );
}

function Turnover() {
  const t = useTranslations("inventory.turnover");
  const locale = useLocale();
  const perms = usePermissions();
  const office = perms.has("inventory.templates");
  const [periodQ, setPeriod] = useQueryState("period", parseAsString);
  const [storeQ, setStore] = useQueryState("store", parseAsString);

  // Филиал — свои склады; офис — склады из сводной.
  const own = useQuery({ queryKey: ["inventory_stores"], queryFn: () => inventoryApi.stores(), enabled: !office });
  const storeId = office ? (storeQ ?? ALL) : (storeQ ?? own.data?.[0]?.id ?? "");
  const periods = useQuery({
    queryKey: ["inventory_turnover", "periods", office ? null : storeId],
    queryFn: () => inventoryApi.turnover.periods(office ? undefined : storeId),
    enabled: office || !!storeId,
  });
  // По умолчанию — прошлый месяц (второй в списке), если он открыт; иначе первый открытый.
  const period = useMemo(() => {
    const list = periods.data ?? [];
    if (periodQ && list.some((p) => p.period === periodQ && p.open)) return periodQ;
    return (list[1]?.open ? list[1] : list.find((p) => p.open))?.period ?? "";
  }, [periods.data, periodQ]);

  const summary = useQuery({
    queryKey: ["inventory_turnover", "summary", period],
    queryFn: () => inventoryApi.turnover.summary(period),
    enabled: office && !!period && storeId === ALL,
  });
  const view = useQuery({
    queryKey: ["inventory_turnover", "store", period, storeId],
    queryFn: () => inventoryApi.turnover.store(period, storeId),
    enabled: !!period && !!storeId && storeId !== ALL,
  });
  const stores = office
    ? (summary.data?.rows ?? []).map((r) => ({ id: r.store_id, name: r.store_name }))
    : (own.data ?? []).map((s) => ({ id: s.id, name: s.name }));
  const selectedPeriod = periods.data?.find((p) => p.period === period);

  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <div className="flex flex-wrap gap-3">
        <Select value={period} onValueChange={(v) => setPeriod(v)}>
          <SelectTrigger className="h-11 w-full sm:w-56"><SelectValue placeholder={t("month")} /></SelectTrigger>
          <SelectContent>
            {(periods.data ?? []).map((p) => (
              <SelectItem key={p.period} value={p.period} disabled={!p.open}>
                {periodLabel(p.period, locale)}
                {!p.open && p.reason && <span className="ml-2 text-xs text-muted-foreground">{t(`closed.${p.reason}`)}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(office || stores.length > 1) && (
          <Select value={storeId} onValueChange={(v) => setStore(v === ALL ? null : v)}>
            <SelectTrigger className="h-11 w-full sm:w-96"><SelectValue placeholder={t("store")} /></SelectTrigger>
            <SelectContent>
              {office && <SelectItem value={ALL}>{t("allStores")}</SelectItem>}
              {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              {office && storeId !== ALL && !stores.some((s) => s.id === storeId) && view.data && (
                <SelectItem value={storeId}>{view.data.store_name}</SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
      </div>
      {period && (
        <StatusLine
          period={period}
          storeId={storeId === ALL ? undefined : storeId}
          fetchedAt={storeId === ALL ? selectedPeriod?.fetched_at ?? null : view.data?.fetched_at ?? null}
          dataThrough={storeId === ALL ? selectedPeriod?.data_through ?? null : view.data?.data_through ?? null}
        />
      )}
      {(summary.error || view.error) && <div className="text-sm text-destructive">{((summary.error || view.error) as Error).message}</div>}
      {storeId === ALL && summary.data && <SummaryTable data={summary.data} onPick={(id) => setStore(id)} />}
      {storeId !== ALL && view.data && <StoreTable view={view.data} />}
    </div>
  );
}
```
Перед этим проверить: `usePermissions` в `admin/lib/inventory/use-permissions.ts` — как он называется и что возвращает (`grep -n export admin/lib/inventory/use-permissions.ts`); подставить фактический API. `periodLabel(period, locale)` уже есть в `periods.ts`. Список складов офиса берётся из сводной — при ссылке `?store=<id>` на склад вне сводной показывается имя из `view.data`.

- [ ] **Step 7: Меню**

`nav-config.tsx` — после «Остатки склада»: `{ title: "Оборотная ведомость", href: p("/inventory/turnover"), permission: "inventory.count" },`.
`manager-layout.tsx` — по образцу блока `/inventory/stock` (строки ~91–100), но под `<CanAccess permission="inventory.count">`, `href="/inventory/turnover"`, подпись `useTranslations("inventory.turnover")("title")`.

- [ ] **Step 8: Проверки**

Run: `cd admin && bun test lib/inventory/turnover.test.ts && bun lint`
Expected: тесты PASS, lint без новых ошибок в изменённых файлах.
Run: `cd admin && bunx tsc --noEmit 2>&1 | grep -E "turnover|inventory-api|nav-config|manager-layout" | head` — пусто.

- [ ] **Step 9: Commit**

```bash
git add admin/lib/inventory-api.ts admin/lib/inventory/turnover.ts admin/lib/inventory/turnover.test.ts "admin/app/[locale]/inventory/turnover" admin/components/layout/nav-config.tsx admin/components/layout/manager-layout.tsx admin/messages/*.json
git commit -m "feat(admin/inventory): экран «Оборотная ведомость» — сводная по складам и ведомость склада"
```

---

### Task 8: Сквозная проверка на iiko и в браузере

**Files:** нет изменений кода (только при найденных ошибках).

- [ ] **Step 1: Загрузить сентябрь 2026 по всем складам в локальную БД (iiko — только чтение)**

Run: `cd cron && bun --env-file=../backend/.env inventory_turnover_once.ts 2026-09-30`
Expected: `~94 stores, failed: —`, ~5–7 мин.

- [ ] **Step 2: Тождество**

Run: `psql "$DATABASE_URL" -Atc "select count(*), count(*) filter (where not consistent) from inventory_turnover_balance where period='2026-09-30'"`
Expected: ~47–48 тыс. строк, `0` несходящихся (на пробе 14.10 — 47 817 / 0).

- [ ] **Step 3: Текущий месяц и один склад**

Run: `cd cron && bun --env-file=../backend/.env inventory_turnover_once.ts 2026-10-31 <uuid склада 21027>` (uuid: `psql ... -Atc "select id from corporation_store where code='21027'"`; если `code` не совпадает — по имени).
Expected: `1 stores`, `data_through` = вчера, все строки `consistent`.

- [ ] **Step 4: Экран**

Запустить backend и admin локально (`superpowers` skill `run` или `cd backend && bun run --watch src/index.ts`, `cd admin && bun dev`), открыть `/ru/inventory/turnover` под офисной ролью: сводная за сентябрь, итог, клик по складу → ведомость, переключатель «Количество / Сумма», подсказка перемещений, ссылка с `?store=` открывается напрямую. Под ролью филиала: нет «Все склады», текущий месяц неактивен, сумм нет.

- [ ] **Step 5: Пользователь сверяет 2–3 товара склада 21027 с ОСВ iikoOffice за сентябрь** (вручную, у исполнителя iikoOffice нет).
