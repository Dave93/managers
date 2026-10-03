# Справочник «филиал → заказываемые товары» (exord → managers)

Источник правды: exord (`/products/links`). managers хранит read-only копию.

## Контракт exord
`GET {EXORD_API_URL}/api/product-links`, `Authorization: Bearer {EXORD_API_TOKEN}`.
200: `{version, generated_at, stores:[{user_id, name, store_iiko_id, terminal_iiko_id|null, product_ids[]}]}`.
Все uuid в нижнем регистре. Ключ: `store_iiko_id` (iiko store uuid склада, уникален; два пользователя с одним складом exord сливает сам).
`terminal_iiko_id` справочное поле, ключом не является. 401 неверный токен, 503 токен на сервере не задан.

## Хранение
- `store_product_links(store_id uuid PK, product_ids uuid[], updated_at)`: по строке на склад. `store_id` = `corporation_store.id` (тот же iiko store uuid, на него ссылаются `balance_store`, `internal_transfer`, `invoice_items`, `writeoff`, `orders.store_id`).
- `product_links_meta(id=1, version, generated_at, stores_count, links_count, synced_at)`.
- `terminal_product_links` (прошлая схема, ключ по терминалу, миграция `0026`) больше не пишется, оставлена для отката.
- Связь терминал → склад: `credentials(model='terminals', type='iiko_store_id', model_id=terminals.id::text, key=store uuid)`. На проде такая связь у 48 из 75 терминалов, три склада общие у двух терминалов.
- Миграции: `0026_product_links`, `0027_store_product_links` (создаёт таблицу, переименовывает `terminals_count` → `stores_count`).

## Sync (`cron/product_links_sync.ts`, бинарь)
`bun build --compile product_links_sync.ts --outfile product_links_sync`, запуск из `crontab` раз в 15 минут:

    */15 * * * * cd /home/davr/managers/cron/ && flock -n /tmp/product_links_sync.lock /home/davr/managers/cron/product_links_sync >> /root/product_links_sync.log 2>&1

Порядок: fetch (таймаут 60 c) → валидация формы (`parsePayload`) → маппинг склада на `corporation_store.id` →
если `version`, число складов и число связей совпадают с содержимым `store_product_links`, выход →
защита (`checkGuard`) → транзакция delete+insert+upsert meta → удаление Redis-ключей `${PROJECT_PREFIX}product_links:*`.
Защита сравнивается с фактическим содержимым таблицы, не с meta. Отказ (код выхода 1, таблица не тронута): пустой ответ, ноль маппингов, ноль товаров, падение числа связей более чем на 50% (`--force` обходит падение).
Записи без `store_iiko_id` считаются (`no_store`), склады, которых нет в `corporation_store`, перечисляются в логе с `user_id` и именем (`unknown_store`).
Флаги: `--dry-run`, `--force`, `--file x.json`. Env: `EXORD_API_URL`, `EXORD_API_TOKEN` в `cron/.env`.

## Чтение
`backend/src/modules/product_links/service.ts`: Redis (TTL 15 мин) → Postgres → заливка в Redis; для неизвестного id кэшируется `null`.
- `GET /api/product_links/store/:storeId`: склад должен принадлежать одному из терминалов пользователя (через `credentials`).
- `GET /api/product_links/terminal/:terminalId`: терминал должен быть в `terminals` пользователя; ответ объединяет товары всех его складов.
Оба требуют сессию (`userAuth`).
