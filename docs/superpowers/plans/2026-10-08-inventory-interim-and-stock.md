# Промежуточные пересчёты, книжное количество, «Остатки склада» — Implementation Plan

> Исполнение: inline (executing-plans), TDD на каждый шаг. План компактный (задачи, интерфейсы, тесты): пользователь попросил сразу приступать к реализации.

**Goal:** промежуточные пересчёты за прошедший день, снимок книжного количества iiko по любому пересчёту с разбивкой, таблица «Факт / Книжн. / Разница», экран «Остатки склада» с правилом скрытия от филиала.

**Spec:** `docs/superpowers/specs/2026-10-08-inventory-interim-and-stock-design.md`

**Ветка:** `feature/inventory-interim-stock` (от `feature/inventory-lock-after-submit`, PR #43 — нужен `mayReopen`).

## Global Constraints
- Прод — только чтение; миграции только локально (`managers`, `managers_tickets_test`).
- iiko — только чтение (`balance/stores`, OLAP), `logout` в `finally`.
- Только количество, без сумм.
- Даты — Asia/Tashkent (UTC+5). Промежуточный — только прошедший день.
- Тесты с базой — `bun run test:http:inventory`, `test:http:reconcile` и новый `test:http:book` (папка `backend/src/modules/inventory/book/`).
- Коммит после каждой задачи, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Tasks

1. **Схема и миграция 0032.** `inventory_counts.kind` (default 'monthly'), `count_date` (date, NOT NULL — в SQL: добавить nullable, `UPDATE … SET count_date = period`, `SET NOT NULL`), `book_fetched_at`; уникальные индексы: месячные — существующие + `kind='monthly'`, промежуточные — по `count_date`; таблица `inventory_count_book`. Применить к обеим базам.
2. **Даты промежуточного (`rules.ts`).** `interimDates(now): { min, max, default }` — min = 1-е число прошлого месяца, max = default = вчера (Ташкент); `isValidInterimDate(date, now)`; `lastDayOf(date)`. Юнит-тесты (граница суток по Ташкенту, переход месяца/года, сегодня — нельзя).
3. **Создание промежуточного (`counts.ts`, контроллер).** `createCount(..., { store_id, template_id?, period?, kind?, count_date? })`: monthly — как сейчас (`count_date = period`); interim — `count_date` проверяется `isValidInterimDate`, `period = lastDayOf(count_date)`; `findActive` по kind. `GET /inventory/interim-dates`. Summary/detail: `kind`, `count_date`. HTTP-тесты.
4. **Сверка — только месячные.** `adminAggregate`, `computeScope`, `refreshIfStale`, `read.ts` (`ADMIN_STATE_SQL`, `REOPEN_COUNT_SQL`, список пересчётов) фильтруют `kind = 'monthly'`. Тест: промежуточный не складывается в A.
5. **Книжное — чистая логика (`book/pure.ts`).** `buildBook({ productIds, start, end, movements }) → BookLine[]` (разбивка по типам, `consistent`). Юнит-тесты.
6. **Клиент iiko.** `IikoClient.movements(storeId, from, toInclusive)` — OLAP `Product.Id × TransactionType`, `Amount.In/Out`, `TransactionType ExcludeValues [INVENTORY_CORRECTION]`. Тест на тело запроса.
7. **Снимок и очередь (`book/service.ts`, `book/queue.ts`, воркер).** `fetchBook(db, iiko, countId)` пишет `inventory_count_book` + `book_fetched_at`; очередь `inventory_count_book` (`jobId book-<countId>`), постановка после `submitCount` и по `POST /counts/:id/book/refresh`; второй `Worker` в `cron/inventory_reconcile_worker.ts`. Тесты с фальшивым iiko.
8. **API книжного и остатков (`book/routes.ts`).** `GET /counts/:id/book` (офис всегда; филиал — свой склад и `submitted && !mayReopen`), `POST /counts/:id/book/refresh` (`inventory.reconcile`), `GET /stock`, `GET /stock/movements` (офис `inventory.templates` — любой склад; филиал — свой, если нет незафиксированного пересчёта; иначе `{ hidden: true }`). iiko для остатков — через подменяемую фабрику (тесты без сети). HTTP-тесты видимости.
9. **Админка.** «Начать»: тип и дата; карточка/шапка — «Промежуточный · дата»; вкладка «Сравнение с учётом» (таблица + раскрытие разбивки + «Обновить книжное»); страница `/inventory/stock`; пункты меню (админ-сайдбар и «Ещё» у менеджера); переводы ×4. `tsc`, `lint`.
10. **Сквозная проверка** на локальной базе: 21027, промежуточный за вчера → снимок → книжное = `balance/stores`, `consistent` у всех строк; экраны — ручная проверка пользователем.
