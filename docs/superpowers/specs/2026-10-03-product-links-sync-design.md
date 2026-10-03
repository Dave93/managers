# Справочник «филиал → заказываемые товары» (exord → managers)

Источник правды: exord (`/products/links`). managers хранит read-only копию.

## Контракт exord
`GET {EXORD_API_URL}/api/product-links`, `Authorization: Bearer {EXORD_API_TOKEN}`.
200: `{version, generated_at, stores:[{user_id, name, terminal_iiko_id|null, product_ids[]}]}`.
Все uuid в нижнем регистре; `terminal_iiko_id` уникален (дубли exord сливает сам). 401 неверный токен, 503 токен на сервере не задан.

## Хранение
- `terminal_product_links(terminal_id uuid PK, product_ids uuid[], updated_at)` — по строке на филиал.
- `product_links_meta(id=1, version, generated_at, terminals_count, links_count, synced_at)`.
- Ключ филиала: `terminal_iiko_id` → `credentials(model='terminals', type='iiko_id').key` → `terminals.id`.
  Join с `terminals` обязателен: в `credentials` лежат строки удалённых терминалов (один iiko key встречается дважды).
  Сверено на локальной копии: 36 из 36 iiko id совпали, регистр нижний.
- Миграция: `0026_product_links`.

## Sync (`cron/product_links_sync.ts`, бинарь)
`bun build --compile product_links_sync.ts --outfile product_links_sync`, запуск из `crontab` раз в 15 минут:

    */15 * * * * cd /home/davr/managers/cron/ && flock -n /tmp/product_links_sync.lock ./product_links_sync >> /var/log/product_links_sync.log 2>&1

Порядок: fetch (таймаут 60 c) → валидация формы (`parsePayload`) → маппинг на terminals → если `version` и число филиалов не изменились, выход →
защита (`checkGuard`) → транзакция delete+insert+upsert meta → удаление Redis-ключей `${PROJECT_PREFIX}product_links:*`.
Защита: пустой ответ, ноль маппингов, ноль товаров, падение числа связей более чем на 50% — таблица не трогается, код выхода 1 (`--force` обходит падение).
Флаги: `--dry-run`, `--force`, `--file x.json`. Env: `EXORD_API_URL`, `EXORD_API_TOKEN` в `cron/.env`.
Филиалы без `terminal_iiko_id` или неизвестные managers пропускаются (счётчик `skipped` в логе).

## Чтение
`backend/src/modules/product_links/service.ts`: `getTerminalProductIds(redis, db, terminalId)` — Redis (TTL 15 мин) → Postgres → заливка в Redis;
для неизвестного филиала кэшируется `null`. HTTP: `GET /api/product_links/terminal/:terminalId` (сессия + терминал должен быть в `terminals` пользователя).

## Не проверено
Реальный ответ exord (эндпоинта ещё нет): существование `product_ids` в `nomenclature_element` проверить после первого настоящего sync.
