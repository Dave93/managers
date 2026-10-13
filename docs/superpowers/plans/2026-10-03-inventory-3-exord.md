# Инвентаризации, план 3: товары филиала из exord — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** в инвентаризацию попадают только товары, которые филиал использует по exord (шаблон ∩ товары филиала); «+ товар» ищет только среди них; без данных exord — весь шаблон с предупреждением.

**Architecture:** связь склад → филиал выводится из продаж (`orders.store_id` + `restaurant_group_id`) суточным cron в таблицу `store_terminal_links`. Бэкенд берёт товары склада через эту таблицу и уже готовый `getTerminalProductIds` (Redis → Postgres) из модуля `product_links`. Фильтр применяется при создании инвентаризации и запоминается в `inventory_counts.exord_filtered`.

**Tech Stack:** Bun, Elysia, Drizzle, ioredis, Next.js 15, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-02-inventory-counts-design.md`, раздел 13.

## Global Constraints
- Миграции только в локальные базы (`managers`, `managers_tickets_test`), прод только для чтения.
- Номер миграции `0028` (0026 — product_links, 0027 — инвентаризация).
- Без внешних ключей из `store_terminal_links`.
- Ответы по-прежнему без учётных цифр iiko.
- Тексты — через `useTranslations("inventory")` во всех 4 локалях.

## Review Focus
- Пустой список товаров филиала (exord прислал филиал без пересечения с шаблоном): инвентаризация создаётся с 0 строк, не падает (`IN ()`).
- Кэш `null` в Redis для филиала, которого ещё не было в exord: после появления связи — данные через 15 минут или после очистки кэша синком (поведение модуля product_links, не меняем).
- Склад, у которого за 90 дней нет продаж: связь не удаляется.
- Равенство числа заказов у двух групп одного склада: выбирается группа с более поздним заказом, стабильно.
- `addLine` в отфильтрованной инвентаризации, когда данные exord пропали (`null`): разрешаем (как «без фильтра»), чтобы не блокировать менеджера.

---

### Task 1: Таблица, миграция, cron связи склад → филиал
**Files:** `backend/drizzle/schema.ts`, `backend/drizzle/migrations/0028_*`, `cron/src/modules/terminals_by_iiko.ts` (новый, вынос из `cron/product_links_sync.ts`), `cron/product_links_sync.ts`, `cron/src/modules/store_terminal/pick.ts` + `pick.test.ts`, `cron/store_terminal_sync.ts`.

- [ ] Тест `pick.test.ts` (RED): выбор группы с максимумом заказов; равенство → поздний `last_order_at`; группа без терминала пропускается и считается в `unmapped`; uuid сравниваются без учёта регистра.
- [ ] `pick.ts`: `pickTerminalPerStore(rows: OrderAgg[], terminalByIiko: Map<string,string>): { links: StoreTerminal[]; unmapped: number }`.
- [ ] Схема:
```ts
export const store_terminal_links = pgTable("store_terminal_links", {
  store_id: uuid("store_id").primaryKey().notNull(),
  terminal_id: uuid("terminal_id").notNull(),
  orders_90d: integer("orders_90d").notNull(),
  last_order_at: timestamp("last_order_at", { withTimezone: true, mode: "string" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});
```
  и в `inventory_counts`: `exord_filtered: boolean("exord_filtered").default(false).notNull()`.
- [ ] `bunx drizzle-kit generate --name=store_terminal_links`, проверить SQL (только `CREATE TABLE store_terminal_links` + `ALTER TABLE inventory_counts ADD COLUMN exord_filtered`), `migrate` в обе локальные базы.
- [ ] `terminals_by_iiko.ts`: `loadTerminalByIikoId(): Promise<Map<string,string>>` (код из `product_links_sync.ts` без изменений), `product_links_sync.ts` импортирует его.
- [ ] `store_terminal_sync.ts`: заказы за 90 дней `GROUP BY store_id, restaurant_group_id` → `pickTerminalPerStore` → 0 связей = ошибка, выход 1 → иначе upsert батчами по 100 (`ON CONFLICT (store_id) DO UPDATE`), `--dry-run` ничего не пишет. Шапка с crontab `30 3 * * *`.
- [ ] Прогон `--dry-run` на локальной базе, затем настоящий; проверить число строк.
- [ ] `bun test src/modules/store_terminal/ src/modules/product_links/` в `cron/` — PASS. Commit.

### Task 2: Бэкенд — фильтр по товарам филиала
**Files:** `backend/src/modules/inventory/{branch-products,counts,templates,controller,types}.ts`, `routes.test.ts`.

- [ ] Тесты (RED) в новом `describe("inventory: товары филиала из exord")`. В `seedWorld` добавить `terminalId` и `linkBranch(productIds)` (вставляет `store_terminal_links` склад→терминал и `terminal_product_links`), cleanup удаляет обе строки. Шаблон мира = [p1, p2], филиал = [p1, p3]:
  - `available` для склада со связью: `items_for_store = 1`, `exord_filtered = true`; для `otherStoreId` (пользователь привязан к нему): `items_for_store = 2`, `exord_filtered = false`.
  - `POST /counts` со связью: строки только p1, `exord_filtered = true`; без связи: p1 и p2, `false`.
  - `POST lines` p2 в отфильтрованной → 422 `not_branch_product`; p3 → 200.
  - `GET products?q=<tag>&count_id=` → только p3; без `count_id` → три товара.
  - `GET overview`: `exord = true` у склада со связью, `false` у второго.
  - филиал без пересечения с шаблоном (`linkBranch([p3])`): инвентаризация создаётся с 0 строк.
- [ ] `branch-products.ts`: `storeProductIds(redis, db, storeId): Promise<string[] | null>`.
- [ ] `types.ts`: `exord_filtered` в `InventoryCountSummary`; `InventoryAvailableTemplate = InventoryTemplateSummary & { items_for_store: number; exord_filtered: boolean }`; `exord: boolean` в `InventoryOverviewRow`.
- [ ] `counts.ts`: `availableTemplates(db, redis, actor, storeId)` считает `items_for_store` в JS по множеству товаров филиала (и существующим в номенклатуре); `createCount(db, redis, …)` добавляет в INSERT условие `and ti.product_id in (…)` (пустой список → `and false`) и пишет `exord_filtered`; `addLine(db, redis, …)` проверяет товар; `searchProducts(db, q, limit, { only?, exclude? })`; новый `productScope(db, redis, actor, countId)` для `products?count_id`; `summaryColumns` + `summaries` отдают `exord_filtered`.
- [ ] `templates.ts` `overview`: флаг `exord` одним запросом `store_terminal_links ⋈ terminal_product_links`.
- [ ] `controller.ts`: прокинуть `redis` из `ctx`, `count_id` в `/inventory/products`.
- [ ] `bun run test:http:inventory` — PASS (все старые + новые). Commit.

### Task 3: Админка
**Files:** `admin/lib/inventory-api.ts`, `admin/app/[locale]/inventory/_components/{start-dialog,add-product-dialog,overview}.tsx`, `admin/messages/*.json`.

- [ ] Ключи: `noExord`, `itemsCount`, `overview.noExord` во всех 4 локалях (проверка паритета ключей).
- [ ] `inventoryApi.availableTemplates` → `InventoryAvailableTemplate[]`; `inventoryApi.products(q, countId?)`.
- [ ] StartDialog: «{name} · {itemsCount}» по `items_for_store`; плашка `noExord`, если у шаблонов `exord_filtered = false`.
- [ ] AddProductDialog передаёт `countId`.
- [ ] Overview: пометка `overview.noExord` у склада без exord.
- [ ] `bunx tsc` без новых ошибок, `bun test lib/inventory/` — PASS. Commit.

### Task 4: Ручная проверка
- [ ] Локально: `bun run cron/store_terminal_sync.ts` наполнил связи; в локальной базе `terminal_product_links` пуст (синк exord не запускался) — заполнить одну строку для филиала склада 19004 из прода (только чтение) или вручную, проверить окно «Начать» (число позиций, плашка у склада без exord), создание, «+ товар», обзор.
- [ ] Финальный прогон всех тестов, пуш ветки.
