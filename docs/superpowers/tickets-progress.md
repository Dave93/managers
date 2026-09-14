# Заявки (tickets) — журнал выполнения плана 1

План: `docs/superpowers/plans/2026-09-12-tickets-1-backend-core.md`. Ветка: `feature/tickets`, HEAD на момент прогона — `ce4ae73`.

## Статус

Полный прогон модуля выполнен 2026-09-14 (Task 11). Все тесты модуля и обеих соседних сюит проходят, роуты отвечают ожидаемыми кодами, посторонних файлов в коммитах ветки нет. Модуль не задеплоен — прогон делался на отдельном порту 6799, продовый бэкенд не трогали.

## Задачи и коммиты

| Задача | Коммиты (feat + fix/refactor) |
|---|---|
| 1. Схема заявок (9 таблиц, enum-ы) | `0beb53d` + `f921b80` |
| 2. Машина состояний заявки | `97fb582` |
| 3. Валидация схемы полей и значений | `586b8e2` + `79de846` |
| 4. Акт выполненных работ | `62b1d46` + `7c64ae8` |
| 5. Правила и хранилище вложений | `f2a1724` + `aaadb11` |
| 6. Создание/список/карточка/вложения | `97d6f5d` + `0d1a1dc` |
| 7. Приёмка, возврат, отмена, комментарии, seen | `a200d92` + `c22e796` |
| 8. Утверждение/отклонение сумм пачкой | `b531091` + `308e3fc` |
| 9. Справочники типов, фирм, исполнителей | `e23f414` + `dfd88dd` |
| 10. Сиды прав и двух стартовых типов | `ce4ae73` |
| 11. Полный прогон и проверка модуля (этот журнал) | без кода, только `docs/` |

Диапазон коммитов ветки: `4d6ee21..HEAD`. В нём 18 коммитов, не 11 и не 12, как предполагали более ранние оценки, — почти каждая задача обросла отдельным ревью-фиксом, а две (7, 8) ещё и рефактором для устранения дублирования. Само по себе это не проблема: проверка по списку файлов (см. ниже) показывает, что все 18 коммитов остались в границах модуля.

## Тесты модуля (Task 11, шаг 1)

```
cd backend && bun test src/modules/tickets/
```

| Файл | pass |
|---|---|
| `state.test.ts` | 10 |
| `fields.test.ts` | 25 |
| `act.test.ts` | 19 |
| `storage.test.ts` | 26 |
| **Итого** | **80** |

0 fail, 173 `expect()`. Вывод чистый — ни одного warning или постороннего лога. Число 80 совпадает с суммой, которую дали ревью задач 1–10 (35 из исходного плана — устаревшая оценка до ревью).

## Соседние сюиты (шаг 2)

`bun test src/modules/passport/ src/modules/credit/` даёт 32 pass, 0 fail — но это только `passport`: у `src/modules/credit/` нет тестовых файлов, реальные тесты кредитного модуля лежат в `backend/tests/credit/`. Прогон `bun test tests/credit/` отдельно: 95 pass, 0 fail, 279 `expect()`. Итого по соседям — 127 pass, 0 fail. Модуль заявок ничего чужого не сломал.

В рабочей копии сервера есть незакоммиченные правки `backend/src/modules/credit/internal-app.ts` и `backend/tests/credit/internal-api.test.ts` — это чужая незавершённая работа, не связанная с веткой `feature/tickets`, и она не мешает прогону.

## tsc --noEmit (шаг 3)

`bunx tsc --noEmit -p .` из `backend/` даёт 16 ошибок. Две — в модуле заявок, обе в `src/modules/tickets/storage.test.ts`, обе одного типа: `TS2339: Property 'path' does not exist on type 'Dirent<string>'` (строки 152 и 154). Причина — `@types/node` в этой версии убрал `Dirent.path` в пользу `Dirent.parentPath`, а тестовый хелпер очистки временной директории всё ещё читает `file.path`. На прохождение тестов это не влияет: обращение обёрнуто в `try/catch`, ошибка только типовая. Хелпер локальный, чинить — в рамках задачи, которая владеет `storage.test.ts`, не здесь.

Остальные 14 ошибок — не из этой ветки:
- `src/app.ts:15` и `src/controllers.ts:48` — `TS2589` (превышена глубина инстанцирования типа), известная проблема регистрации контроллеров.
- `src/lib/pagination_interface.ts:1-2` — `TS2307`, не хватает типов `prisma-extension-pagination`.
- `tests/credit/admin_money.test.ts` — 9 ошибок (`TS18048`, `TS2769`), существующие пробелы в типах кредитного модуля.
- `../merchants_api/src/context/index.ts` — `TS2345`, рассинхрон версий `ioredis` между `backend` и `merchants_api`.

Всё это уже было до ветки `feature/tickets` и в её файлы не входит.

## Карта роутов (шаг 4)

Отдельный процесс `bun src/index.ts` на `PORT=6799`, холодный старт занял около 50 секунд (первый лог `🦊 Elysia is running` появился на этой отметке). Каждый роут модуля дал 401 или 422, ни одного 404 или 500:

| Роут | Метод | Код |
|---|---|---|
| `/api/tickets` | GET | 401 |
| `/api/tickets/:id` | GET | 401 |
| `/api/tickets/attachments/:id/file` | GET | 401 |
| `/api/ticket_types` | GET | 401 |
| `/api/ticket_contractors` | GET | 401 |
| `/api/ticket_executors` | GET | 401 |
| `/api/tickets` | POST | 422 |
| `/api/tickets/:id/close` | POST | 401 |
| `/api/tickets/:id/reopen` | POST | 422 |
| `/api/tickets/:id/cancel` | POST | 422 |
| `/api/tickets/:id/comments` | POST | 422 |
| `/api/tickets/:id/seen` | POST | 401 |
| `/api/tickets/payment/approve` | POST | 422 |
| `/api/tickets/payment/reject` | POST | 422 |
| `/api/ticket_types` | POST | 422 |
| `/api/ticket_contractors` | POST | 422 |
| `/api/ticket_executors` | POST | 422 |
| `/api/ticket_executors/:id/invite` | POST | 401 |
| `/api/ticket_types/:id` | PUT | 422 |
| `/api/ticket_contractors/:id` | PUT | 422 |
| `/api/ticket_executors/:id` | PUT | 422 |

Роуты без тела (`close`, `seen`, `invite`) упираются в проверку авторизации раньше валидации схемы и дают 401; роуты с обязательным телом дают 422 ещё до того, как выполняется проверка авторизации, — оба исхода ожидались по условию задачи. Лог процесса за всё время проверки не содержит ни одной ошибки или стектрейса. Процесс остановлен по PID после проверки, продовые pm2-процессы не трогали.

## Проверка файлов коммитов (шаг 5)

```
git log --format="" --name-only 4d6ee21..HEAD | sort -u
```

Список файлов — только:
- `backend/drizzle/migrations/0024_tickets_core.sql`, `0025_late_the_anarchist.sql`
- `backend/drizzle/migrations/meta/0024_snapshot.json`, `0025_snapshot.json`, `_journal.json`
- `backend/drizzle/schema.ts`
- `backend/src/controllers.ts`
- `backend/src/modules/tickets/*` (все `.ts` файлы модуля, включая тесты)

Посторонних файлов нет.

## Отложено (не чинить, зафиксировано по итогам ревью)

- `POST /ticket_types` проверяет только «external требует contractor_id»; зеркальная проверка («staff не должен иметь contractor_id») есть в `PUT` и в `ticket_executors`, но не здесь.
- Сид-скрипты не обёрнуты в транзакции; они идемпотентны, так что частичный прогон лечится повторным запуском.
- `tsc` показывает ошибки вне ветки (глубина инстанцирования в `app.ts`/`controllers.ts`, `pagination_interface.ts`) — существовали до этой ветки.

## Итог

DONE. 80/80 тестов модуля, 127/127 в соседних сюитах, 21/21 роут отвечает 401 или 422 без единого 404/500, файлы коммитов чистые. Единственная типовая проблема (`Dirent.path`, 2 ошибки tsc) — известна и осознанно оставлена задаче-владельцу `storage.test.ts`.
