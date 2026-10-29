# KPI — План 4: Telegram-бот, доставка уведомлений, напоминания

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Отдельный бот KPI. Сотрудники и оценщики привязываются по ссылке-приглашению. Воркер `office_kpi_worker` доставляет строки `kpi_notifications`, раз в день напоминает оценщикам и шлёт HR сводку. Сотрудник открывает спор кнопкой под сообщением. В админке видно, кто привязан, и есть ссылка с QR.

**Architecture:** Сервисы плана 1 пишут уведомления в транзакции. `run()` собирает id новых строк через `AsyncLocalStorage` и после коммита ставит задачи в BullMQ `kpi-notify`. Логика доставки и расписания лежит в `backend/src/modules/kpi/worker/` и проверяется тестами на `managers_tickets_test`. `cron/kpi_worker.ts` остаётся тонкой оболочкой BullMQ без своего drizzle: в `cron` стоит drizzle-orm 0.33, в backend 0.44, и `tsc -p cron` уже сыплет ошибками на `tickets_worker.ts`. Вебхук `POST /api/kpi/bot/webhook` разбирает апдейт чистой функцией и отвечает через интерфейс `BotApi`, который тесты подменяют. Тексты на двух языках собраны чистыми функциями.

**Tech Stack:** Bun 1.4, Elysia 1.4, Drizzle ORM 0.44 / drizzle-kit 0.31, PostgreSQL, ioredis, BullMQ 5.81 (backend) / 5.80 (cron), Telegram Bot API, Next.js 15, TanStack Query 5, qrcode.react 4.2.0, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-25-kpi-design.md` (разделы 6.8, 6.10, 7.1, 7.5, 7.6, 9, 11, 13, 14)

Предыдущие планы: `2026-10-25-kpi-1-backend-core.md` (блоки Interfaces задач 4 и 6–10), `2026-10-25-kpi-2-admin.md` (клиент `admin/lib/kpi-api.ts`, вкладки настроек), `2026-09-14-tickets-2-notifications.md` (как сделаны бот и воркер заявок).

## Global Constraints

- Рабочая копия `/Users/macbookpro/development/managers-kpi`, ветка `feature/kpi`. Каталог `/Users/macbookpro/development/managers` не трогать.
- Коммитить только свои файлы поимённо. `git add -A` и `git add .` запрещены. Никаких `git push`, ssh, `pm2 start/restart`, деплоя. `cron/pm2.config.js` только правится.
- Локальную базу `managers` не мигрировать и не писать в неё. Миграции и тесты идут только на `managers_tickets_test`:
  ```bash
  cd backend && export TEST_DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | sed -E 's#/managers(\?.*)?$#/managers_tickets_test#')
  case "$TEST_DATABASE_URL" in *managers_tickets_test) ;; *) echo "не тестовая база"; exit 1;; esac
  ```
- Новые роуты монтируются в `backend/src/modules/kpi/controller.ts`; контроллер уже зарегистрирован в `app.ts`.
- Статусы хранятся в `varchar`. У `kpi_notifications`: `pending | sent | failed | skipped`, плюс промежуточный `sending` на время отправки (захват строки, как в `ticket_notifications`).
- Время: Asia/Tashkent = UTC+5 без летнего времени. Период: `YYYY-MM-01`. «Сейчас» в бизнес-логике берётся только из `now()` в `kpi/clock.ts`.
- Ошибки API: `{ error: "<code>", ...extra }`; 422 ввод, 403 права, 404 нет объекта, 409 конфликт.
- Уведомления отправляет только воркер. Вебхук отвечает лишь на апдейт, который сам получил, и после проверки секрета всегда возвращает 200, даже при внутренней ошибке.
- Каждая задача BullMQ несёт `removeOnComplete` и `removeOnFail` (значения в задаче 3).
- Из `tickets/` импортируется только `@backend/modules/tickets/telegram` (`sendMessage`, `interpretResponse`, `TgResult`).
- Код воркера не импортирует `@backend/context`, `routes/*` и `controller.ts`: конструктор `CacheControlService` пишет в Redis. `cron/kpi_worker.ts` не импортирует `drizzle-orm`.
- Тексты Telegram: русский и узбекский на латинице, `parse_mode: HTML`. Любой вставляемый текст (комментарий, имя, название пункта) проходит `escapeHtml`. В узбекском `oʻ` и `gʻ` пишутся с U+02BB, знак тутуқ белгиси (`eʼtiroz`, `maʼlumot`) пишется с U+02BC. ASCII-апострофа в узбекских строках нет. Подпись кнопки: «Оспорить» / «Eʼtiroz bildirish».
- Строки админки по-русски прямо в коде, без next-intl.
- Никаких реальных имён: «Тест Повар», «Тест Оценщик».
- Проверка типов backend: `admin/node_modules/.bin/tsc --noEmit -p backend --incremental false 2>&1 | grep modules/kpi` печатает пусто. Для `cron`: `admin/node_modules/.bin/tsc --noEmit -p cron --incremental false 2>&1 | grep -e kpi_worker -e modules/kpi` тоже пусто (общий фон ~177 ошибок `cron` не наш; модули tickets под `-p cron` проверены 2026-10-25 — 0 ошибок). Цель `cron` — ES2021: в коде этого плана, который импортирует воркер, не использовать `.at()`, `Object.hasOwn` и прочее из ES2022+. Ошибка под `-p cron` в файле плана 1, которой нет под `-p backend`, — доложить, не чинить.
- Юнит-тесты: `cd backend && bun test src/modules/kpi/*.test.ts src/modules/kpi/tg src/modules/kpi/worker`. HTTP-тесты: `cd backend && bun run test:http:kpi` (с `TEST_DATABASE_URL`).
- Админка: проверки типов, линта и тестов те же, что в Global Constraints плана 2 (база 3 ошибки, `bun test ./lib/kpi ./lib/kpi-api.test.ts`).

## Review Focus

1. Telegram повторяет апдейт: вебхук ответил медленно или не 2xx. Повторный `/start kpi_<token>` того же человека с того же телефона отвечает «Готово!», а не «ссылка недействительна», и привязку не плодит. Повторная причина спора после успеха даёт подсказку, второго спора нет. Закреплено в задаче 7.
2. Бота добавили в группу или пишут из канала. Оценки не должны уйти в общий чат: апдейты не из `private` игнорируются. Тесты `parseUpdate` в задаче 2 и тест про сообщение из группы в задаче 7.
3. Внутренняя ошибка в вебхуке после проверки секрета (упала база, `send` бросил исключение). Глобальный `onError` в `app.ts` ответил бы 500, и Telegram повторял бы апдейт бесконечно. Ответ всегда 200; тест на брошенное исключение в задаче 7.
4. Подделанная кнопка `dispute:review:<чужой id>` или смена привязки между нажатием и ответом. Спор не открывается, ответ «Эту запись оспорить нельзя». Владелец проверяется и при нажатии, и при получении причины; оба случая проверяет задача 7.
5. `<`, `&` и огромные комментарии или списки в тексте. Без экранирования Telegram отвечает «can't parse entities», без обрезки отвечает «message is too long», и строка пять раз ретраится впустую. Экранирование и длину ≤ 4096 проверяет задача 2.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `backend/drizzle/schema.ts` (правка, в конец) | `kpi_tg_bindings`, `kpi_tg_invites` |
| `backend/drizzle/migrations/00NN_kpi_telegram.sql` + `meta/` | Миграция; номер выдаёт drizzle-kit (0038 после плана 3, иначе 0037) |
| `backend/src/modules/kpi/tg/messages.ts` + `.test.ts` | Тексты уведомлений и ответов бота, клавиатуры |
| `backend/src/modules/kpi/tg/updates.ts` + `.test.ts` | Разбор апдейта Telegram, проверка секрета |
| `backend/src/modules/kpi/tg/bot-api.ts` | Клиент Bot API и тестовая подмена |
| `backend/src/modules/kpi/tg/bindings.ts` | Приглашения, привязки, получатель уведомления |
| `backend/src/modules/kpi/tg/bot.ts` | Обработка апдейта: `/start`, язык, `/my`, спор |
| `backend/src/modules/kpi/queue.ts` | Имя очереди, имена задач, опции |
| `backend/src/modules/kpi/notify.ts` (правка) | `enqueue` → id, `collectDeliveries`, `scheduleDelivery` |
| `backend/src/modules/kpi/errors.ts` (правка) | `run()` внутри `collectDeliveries` |
| `backend/src/modules/kpi/{reviews,violations,disputes,raises}.ts` (правка) | Поля payload по контракту задачи 2 |
| `backend/src/modules/kpi/periods.ts` (правка) | Экспорт `laggingEvaluators` |
| `backend/src/modules/kpi/worker/deliver.ts` | `deliverOne`, `pendingIds`, `stuckSendingCount` |
| `backend/src/modules/kpi/worker/daily-plan.ts` + `.test.ts` | Чистый план дня: кому и что |
| `backend/src/modules/kpi/worker/daily.ts` | `runDaily`: данные из базы → строки уведомлений |
| `backend/src/modules/kpi/routes/telegram.ts` | `POST /kpi/invites`, `GET/DELETE /kpi/tg/bindings` |
| `backend/src/modules/kpi/routes/bot.ts` | `POST /kpi/bot/webhook` |
| `backend/src/modules/kpi/{controller,types}.ts` (правка) | Монтирование, типы ответов |
| `backend/src/modules/kpi/http/fixtures.ts` (правка) | `makeUser`, `bindTelegram`, `newTelegramId`, `fakeBotApi`, уборка |
| `backend/src/modules/kpi/http/{notify,telegram,delivery,daily,bot}.test.ts` | HTTP-тесты |
| `backend/package.json` (правка) | Переменные в `test:http:kpi` |
| `cron/kpi_worker.ts` | Процесс: очередь, подметалка, ежедневная задача |
| `cron/pm2.config.js` (правка) | `office_kpi_worker` |
| `docs/superpowers/kpi-deploy.md` | Раздел «Фаза 4. Telegram» |
| `admin/lib/kpi-api.ts`, `admin/lib/kpi-api.test.ts`, `admin/lib/kpi/errors.ts`, `admin/lib/kpi/errors.test.ts` (правка) | Клиент `tg.*`, коды ошибок |
| `admin/lib/kpi/telegram.ts` + `.test.ts` | Чистые помощники колонки «Telegram» |
| `admin/app/[locale]/kpi/settings/_components/{tg-cell,invite-dialog,use-tg-bindings}.tsx/.ts` | Колонка, диалог со ссылкой и QR, запрос привязок |
| `admin/app/[locale]/kpi/settings/_components/{employees-tab,evaluators-tab}.tsx` (правка) | Колонка «Telegram» |

---

### Task 1: Таблицы, миграция и фикстуры

**Files:**
- Modify: `backend/drizzle/schema.ts` (в конец), `backend/src/modules/kpi/http/fixtures.ts`, `backend/package.json`
- Create: `backend/drizzle/migrations/00NN_kpi_telegram.sql`, `meta/00NN_snapshot.json`, правка `meta/_journal.json` (генерирует drizzle-kit)

**Interfaces:**
- Produces: экспорты `kpi_tg_bindings`, `kpi_tg_invites` из `backend/drizzle/schema`; фикстуры:
  ```ts
  export function newTelegramId(): number;   // 9_000_000_000 + случайное до 1e8
  export async function makeUser(db: DrizzleDB, o?: { perms?: string[]; status?: "active" | "blocked"; first_name?: string }): Promise<{ id: string }>;
  export async function bindTelegram(db: DrizzleDB, o: { employee_id?: string; user_id?: string; telegram_id?: number; lang?: "ru" | "uz"; active?: boolean }): Promise<{ id: string; telegram_id: number }>;
  ```

| Таблица | Колонки и индексы |
|---|---|
| `kpi_tg_bindings` | `id` uuid PK; `telegram_id bigint({mode:"number"}) not null`; `employee_id uuid`; `user_id uuid`; `lang varchar(2) default 'ru' not null`; `active boolean default true not null`; `created_at timestamptz default now() not null`. `uniqueIndex("kpi_tg_bindings_telegram_uq").on(telegram_id)`; частичные уникальные `kpi_tg_bindings_employee_active_uq` на `employee_id` `where active and employee_id is not null` и `kpi_tg_bindings_user_active_uq` на `user_id` `where active and user_id is not null`; `check("kpi_tg_bindings_one_person", sql\`(employee_id is null) <> (user_id is null)\`)` |
| `kpi_tg_invites` | `id` uuid PK; `token varchar(64) not null`; `employee_id uuid`; `user_id uuid`; `expires_at timestamptz not null`; `used_at timestamptz`; `created_by uuid not null`; `created_at timestamptz default now() not null`. `uniqueIndex("kpi_tg_invites_token_uq").on(token)`; `check("kpi_tg_invites_one_person", …)` как выше |

Внешних ключей нет, как у остальных `kpi_*`. Время — `timestamp(..., { withTimezone: true, mode: "string" })`.

`makeUser`: строка `users` с `login = "test_kpi_<8 hex>"`, `password = "x"`, `status` (по умолчанию `active`), `first_name ?? "Тест"`, `last_name = "Оценщик"`. С `perms` создаёт роль `roles { name: "test_kpi", code: "test_kpi_<8 hex>" }`, строки `roles_permissions` по `permissions.slug` и ставит `users.role_id`. Нет такого slug в тестовой базе — бросить ошибку «запустите seed-permissions на managers_tickets_test». `bindTelegram` пишет строку `kpi_tg_bindings` напрямую (по умолчанию `newTelegramId()`, `ru`, `active`).

`cleanupKpi` дополнительно, до удаления сотрудников: `kpi_tg_invites`, `kpi_tg_bindings` целиком; `roles_permissions` ролей с `code LIKE 'test\_kpi\_%'`; сами эти роли; `users` с `login LIKE 'test\_kpi\_%'`.

Скрипт `test:http:kpi` в `backend/package.json` (новые переменные перед `DATABASE_URL`):
```
PROJECT_PREFIX=managers_test_ KPI_UPLOADS_DIR=/tmp/kpi_test_uploads KPI_NOTIFY_QUEUE=kpi_notify_test KPI_BOT_USERNAME=kpi_test_bot KPI_WEBHOOK_SECRET=kpi_test_secret DATABASE_URL=$TEST_DATABASE_URL bun test src/modules/kpi/http/
```

- [ ] **Step 0: Проверить, что план 1 закончен, и снять базу тестов**

```bash
cd /Users/macbookpro/development/managers-kpi
grep -q "export async function openDispute" backend/src/modules/kpi/disputes.ts || echo "нет openDispute (план 1, задача 8)"
grep -q "employee_actor" backend/src/modules/kpi/disputes.ts || echo "openDispute без employee_actor"
grep -q '"dispute_resolved"' backend/src/modules/kpi/disputes.ts || echo "нет dispute_resolved"
grep -q '"raise_approved"' backend/src/modules/kpi/raises.ts || echo "нет raise_approved (план 1, задача 9)"
grep -q "routes/disputes" backend/src/modules/kpi/controller.ts || echo "споры не смонтированы"
grep -q "routes/raises" backend/src/modules/kpi/controller.ts || echo "повышения не смонтированы"
grep -q "KpiUserOption" backend/src/modules/kpi/types.ts || echo "нет задачи 10 плана 1"
ls backend/drizzle/migrations | grep -E '^00[0-9]{2}_' | tail -2
```
Expected: ни одной строки «нет …» или «не смонтированы»; последняя миграция `0036_kpi_core` или миграция плана 3 (`0037_…`). Любая строка «нет» — остановиться и доложить. Затем `cd backend && bun run test:http:kpi` — Expected: PASS, записать число тестов.

- [ ] **Step 1: Схема в согласии до правки.** Run: `cd backend && bunx drizzle-kit generate --name probe`. Expected: `No schema changes, nothing to migrate`. Иначе остановиться и доложить.

- [ ] **Step 2: Дописать две таблицы в конец `schema.ts`.** `check` и `bigint` добавить в верхний импорт `drizzle-orm/pg-core`, если их там нет.

- [ ] **Step 3: Сгенерировать миграцию.** Run: `cd backend && bunx drizzle-kit generate --name kpi_telegram`. Expected: новый файл `drizzle/migrations/00NN_kpi_telegram.sql` со следующим свободным номером. Внутри только `CREATE TABLE "kpi_tg_…"`, `CHECK` и `CREATE [UNIQUE] INDEX` по ним. Строка про чужую таблицу — остановиться и доложить.

- [ ] **Step 4: Применить к тестовой базе**

```bash
cd backend && export TEST_DATABASE_URL=...   # см. Global Constraints
DATABASE_URL="$TEST_DATABASE_URL" bunx drizzle-kit migrate
psql "$TEST_DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_name like 'kpi\_tg\_%'"
bunx drizzle-kit generate --name probe
```
Expected: `2`, затем `No schema changes, nothing to migrate`. `psql` лежит в `/opt/homebrew/opt/postgresql@17/bin/`.

- [ ] **Step 5: Фикстуры и скрипт.** Дописать `newTelegramId`, `makeUser`, `bindTelegram`, уборку в `cleanupKpi` и переменные скрипта. Run: `bun run test:http:kpi`. Expected: PASS, число тестов как на шаге 0.

- [ ] **Step 6: Commit**

```bash
git add backend/drizzle/schema.ts backend/drizzle/migrations/00NN_kpi_telegram.sql backend/drizzle/migrations/meta/00NN_snapshot.json backend/drizzle/migrations/meta/_journal.json backend/src/modules/kpi/http/fixtures.ts backend/package.json
git commit -m "feat(kpi): таблицы привязок и приглашений Telegram"
```

---

### Task 2: Тексты, разбор апдейтов и payload событий

**Files:**
- Create: `backend/src/modules/kpi/tg/messages.ts`, `tg/messages.test.ts`, `tg/updates.ts`, `tg/updates.test.ts`
- Modify: `backend/src/modules/kpi/reviews.ts`, `violations.ts`, `disputes.ts`, `raises.ts` (только поля payload); `http/reviews.test.ts`, `http/violations.test.ts`, `http/disputes.test.ts`, `http/raises.test.ts` (по одной проверке)

**Interfaces:**
- Produces:
  ```ts
  // tg/messages.ts
  export type Lang = "ru" | "uz";
  export type OutMessage = { text: string; reply_markup?: object };
  export type MessageCtx = { lang: Lang; disputeUntil: string | null }; // ISO срока спора, если кнопку надо показать
  export class UnknownKindError extends Error {}
  export const KPI_KINDS: readonly string[];          // восемь kind из таблицы ниже
  export const DISPUTABLE_KINDS: readonly ["review_submitted", "review_changed", "violation_recorded"];
  export function buildMessage(kind: string, payload: Record<string, unknown>, ctx: MessageCtx): OutMessage;
  export function escapeHtml(s: string): string;      // & < >
  export function monthLabel(period: string, lang: Lang): string;   // "октябрь 2025" / "2025-yil oktabr"
  export function quarterLabel(q: string, lang: Lang): string;      // "IV квартал 2025" / "2025-yil IV chorak"
  export function fmtPct(n: number | string | null | undefined): string; // "83,33 %", "94 %", "—"; строка numeric ("83.33") тоже
  export function fmtSum(n: number | string): string;                // "300 000"; строка numeric ("300000.00") тоже
  export function fmtDateTime(iso: string): string;                 // "10.11.2025 23:59" по Ташкенту
  export function ruPlural(n: number, forms: [string, string, string]): string;
  export type BotTextKey = "start_ok" | "start_bad" | "not_bound" | "already_bound" | "lang_set" | "help" | "ask_reason" | "dispute_ok"
    | "err_window" | "err_exists" | "err_short" | "err_unavailable" | "err_closed" | "err_generic";
  export const BOT_TEXT_KEYS: readonly BotTextKey[];
  export function botText(key: BotTextKey, lang: Lang, vars?: { min?: number }): string;
  export const LANG_KEYBOARD: { inline_keyboard: { text: string; callback_data: string }[][] };
  export function myEmployeeText(lang: Lang, reviews: { period: string; score_pct: number | null }[],
    violations: { occurred_at: string; title_ru: string | null; title_uz: string | null }[]): string;
  export function myUserText(lang: Lang, period: string, pending: number, deadline: string): string;

  // tg/updates.ts
  export type CallbackAction =
    | { kind: "lang"; lang: "ru" | "uz" }
    | { kind: "dispute"; subject_type: "review" | "violation"; subject_id: string }
    | { kind: "unknown" };
  export type BotUpdate =
    | { type: "start"; chatId: number; fromId: number; token: string | null; hasPayload: boolean }
    | { type: "my"; chatId: number; fromId: number }
    | { type: "help"; chatId: number; fromId: number }
    | { type: "text"; chatId: number; fromId: number; text: string }
    | { type: "callback"; chatId: number; fromId: number; callbackId: string; action: CallbackAction }
    | { type: "ignore" };
  export function parseUpdate(body: unknown): BotUpdate;
  export function secretOk(received: unknown, expected: string): boolean; // timingSafeEqual, длины сравниваются раньше
  ```

**Контракт payload.** Поля, которые читает `buildMessage`. Недостающее или кривое поле не роняет сборку: строка с ним пропускается или вместо значения ставится `—`. Кнопка спора появляется, только если `review_id` / `violation_id` — uuid. `score_pct`, `amount`, `pending`, `old`, `new` пишутся числом: колонки `numeric` drizzle отдаёт строкой (`"300000.00"`), такое значение перед записью в payload проходит `Number(...)`.

| kind | Кто пишет | Поля payload | Правка |
|---|---|---|---|
| `review_submitted` | `reviews.ts` `submitReview` | `period`, `review_id`, `score_pct` | нет |
| `review_changed` | `reviews.ts` `changeReview` | `period`, `review_id`, `score_pct`, `version`, `comment`, `changes[]: {item_id, title_ru, title_uz, old, new}` | добавить `title_uz` в элементы `changes` (только в payload, событие не трогать); `WorkItem.title_uz` уже есть |
| `violation_recorded` | `violations.ts` `createViolation` | `violation_id`, `period`, `item_title_ru`, `item_title_uz`, `occurred_at` (ISO), `comment` | выбрать `title_uz` пункта вместе с `title_ru`; добавить два поля |
| `dispute_opened` | `disputes.ts` `openDispute` | `dispute_id`, `subject_type`, `subject_id`, `period`, `employee_name` («Имя Фамилия»), `reason` | дописать недостающие |
| `dispute_resolved` | `disputes.ts` `resolveDispute` | `dispute_id`, `subject_type`, `subject_id`, `period`, `decision`, `comment`, `score_pct` (новый процент, только у принятого спора по оценке) | дописать недостающие |
| `raise_approved` | `raises.ts` `decideRaise` | `raise_id`, `quarter_start`, `amount` | дописать недостающие |
| `remind_evaluate` | `worker/daily-plan.ts` (задача 6) | `period`, `pending`, `deadline` | — |
| `overdue_summary` | `worker/daily-plan.ts` (задача 6) | `period`, `lagging[]: {user_name, pending}` (до 100), `lagging_total` | — |

**Тексты.** Строки разделяются `\n`. `{month}` = `monthLabel(period)`, `{quarter}` = `quarterLabel(quarter_start)`, `{pct}` = `fmtPct`, даты — `fmtDateTime`. Свободный текст перед экранированием режется до 500 символов (имена и названия пунктов — до 100) с `…` в конце. Готовый текст длиннее 4096 укорачивается по границе строки с `\n…` в конце.

| kind | ru | uz |
|---|---|---|
| `review_submitted` | `<b>Оценка за {month}</b>` · `Итог: {pct}.` | `<b>{month} uchun baho</b>` · `Natija: {pct}.` |
| `review_changed` | `<b>Оценка за {month} изменена</b>` · `Новый итог: {pct}.` · до 15 строк `• {title_ru}: {old} → {new}` (null → `—`), затем `• …и ещё {n}` · `Комментарий: {comment}` | `<b>{month} uchun baho oʻzgartirildi</b>` · `Yangi natija: {pct}.` · `• {title_uz ?? title_ru}: …`, `• …yana {n} ta` · `Izoh: {comment}` |
| `violation_recorded` | `<b>Зафиксировано нарушение</b>` · `Пункт: {item_title_ru ?? «без пункта карты»}` · `Когда: {occurred_at}` (если есть) · `Комментарий: {comment}` | `<b>Qoidabuzarlik qayd etildi</b>` · `Band: {item_title_uz ?? item_title_ru ?? «kartadan tashqari»}` · `Qachon: …` · `Izoh: …` |
| строка спора у трёх kind выше, если `disputeUntil` | `Не согласны — нажмите «Оспорить» до {until}.` | `Rozi boʻlmasangiz, {until} gacha «Eʼtiroz bildirish» tugmasini bosing.` |
| `dispute_resolved`, оценка, принят | `<b>Спор по оценке за {month} принят</b>` · `Новый итог: {pct}.` (если есть `score_pct`) · `Комментарий: …` | `<b>{month} bahosi boʻyicha eʼtiroz qabul qilindi</b>` · `Yangi natija: {pct}.` · `Izoh: …` |
| оценка, отклонён | `<b>Спор по оценке за {month} отклонён</b>` · `Комментарий: …` | `<b>{month} bahosi boʻyicha eʼtiroz rad etildi</b>` · `Izoh: …` |
| нарушение, принят | `<b>Спор по нарушению принят</b>` · `Нарушение отменено.` · `Комментарий: …` | `<b>Qoidabuzarlik boʻyicha eʼtiroz qabul qilindi</b>` · `Qoidabuzarlik bekor qilindi.` · `Izoh: …` |
| нарушение, отклонён | `<b>Спор по нарушению отклонён</b>` · `Нарушение остаётся.` · `Комментарий: …` | `<b>Qoidabuzarlik boʻyicha eʼtiroz rad etildi</b>` · `Qoidabuzarlik kuchda qoladi.` · `Izoh: …` |
| `raise_approved`, сумма > 0 | `<b>Повышение оклада: {quarter}</b>` · `Решение HR: +{sum} сум.` (`300 000`, обычные пробелы) | `<b>Maosh oshirilishi: {quarter}</b>` · `HR qarori: +{sum} soʻm.` |
| `raise_approved`, 0 | `<b>Итоги квартала: {quarter}</b>` · `Решение HR: без повышения.` | `<b>Chorak yakunlari: {quarter}</b>` · `HR qarori: oshirishsiz.` |
| `remind_evaluate` | `<b>Оценки за {month}</b>` · `Ждут вашей оценки: {n} {сотрудник/сотрудника/сотрудников}.` · `Срок: {deadline}.` | `<b>{month} baholari</b>` · `Baho kutayotgan xodimlar: {n} ta.` · `Muddat: {deadline}.` |
| `dispute_opened` | `<b>Новый спор</b>` · `Сотрудник: {employee_name}` · `Предмет: оценка за {month}` или `Предмет: нарушение, {month}` · `Причина: {reason}` · `Разберите в админке: KPI → Споры.` | `<b>Yangi eʼtiroz</b>` · `Xodim: …` · `Mavzu: {month} bahosi` или `Mavzu: qoidabuzarlik, {month}` · `Sabab: …` · `Admin panelda koʻrib chiqing: KPI → Споры.` |
| `overdue_summary` | `<b>Срок оценок за {month} прошёл</b>` · `Не отправили оценки:` · до 20 строк `• {user_name} — {pending}`, затем `• …и ещё {lagging_total − 20}`; пусто: `Все оценщики отправили оценки.` | `<b>{month}: baholash muddati tugadi</b>` · `Baho yubormaganlar:` · `• …yana {n} ta`; пусто: `Barcha baholovchilar baholarni yubordi.` |

Кнопка у трёх kind со строкой спора: `{ inline_keyboard: [[{ text: "Оспорить" | "Eʼtiroz bildirish", callback_data: "dispute:review:<review_id>" | "dispute:violation:<violation_id>" }]] }`. У остальных kind кнопки нет при любом `disputeUntil`.

| `BotTextKey` | ru | uz |
|---|---|---|
| `start_ok` * | `Готово! Уведомления KPI будут приходить сюда.\nTayyor! KPI xabarlari shu yerga keladi.\n\nВыберите язык / Tilni tanlang:` | то же |
| `start_bad` * | `Ссылка недействительна или устарела. Попросите новую у HR.\nHavola yaroqsiz yoki eskirgan. HR dan yangisini soʻrang.` | то же |
| `not_bound` * | `Этот чат не подключён к KPI. Откройте ссылку-приглашение от HR.\nBu chat KPI ga ulanmagan. HR bergan taklif havolasini oching.` | то же |
| `already_bound` | `Вы уже подключены. Команда /my — ваша сводка.` | `Siz allaqachon ulangansiz. /my buyrugʻi — qisqacha maʼlumot.` |
| `lang_set` | `Язык: русский. Команда /my — ваша сводка.` | `Til: oʻzbekcha. /my buyrugʻi — qisqacha maʼlumot.` |
| `help` | `Команда /my — ваша сводка.` | `/my buyrugʻi — qisqacha maʼlumot.` |
| `ask_reason` | `Напишите причину спора ответом на это сообщение, не короче {min} символов. Ждём 15 минут.` | `Eʼtiroz sababini shu xabarga javob qilib yozing, kamida {min} ta belgi. 15 daqiqa kutamiz.` |
| `dispute_ok` | `Спор открыт. Решение придёт сюда.` | `Eʼtirozingiz yuborildi. Qaror shu yerga keladi.` |
| `err_window` | `Срок споров за этот месяц прошёл.` | `Bu oy uchun eʼtiroz muddati tugagan.` |
| `err_exists` | `Спор по этой записи уже открыт.` | `Bu yozuv boʻyicha eʼtiroz allaqachon ochilgan.` |
| `err_short` | `Причина слишком короткая: нужно не меньше {min} символов. Напишите ещё раз.` | `Sabab juda qisqa: kamida {min} ta belgi kerak. Qaytadan yozing.` |
| `err_unavailable` | `Эту запись оспорить нельзя.` | `Bu yozuvga eʼtiroz bildirib boʻlmaydi.` |
| `err_closed` | `Месяц уже закрыт.` | `Oy allaqachon yopilgan.` |
| `err_generic` | `Не получилось. Попробуйте позже.` | `Xatolik yuz berdi. Keyinroq urinib koʻring.` |

\* двуязычный текст, `lang` не влияет. `LANG_KEYBOARD`: «Русский» → `lang:ru`, «Oʻzbekcha» → `lang:uz`, одной строкой.

`/my`: `myEmployeeText` — заголовок `<b>Ваши оценки</b>` / `<b>Sizning baholaringiz</b>`, строки `• {month} — {pct}` или `Отправленных оценок пока нет.` / `Hozircha yuborilgan baho yoʻq.`; пустая строка; `<b>Нарушения в этом месяце</b>` / `<b>Shu oydagi qoidabuzarliklar</b>`, строки `• {DD.MM.YYYY} {title}` (нет названия → «без пункта карты» / «kartadan tashqari») или `Нарушений в этом месяце нет.` / `Bu oyda qoidabuzarlik yoʻq.` `myUserText` при `pending > 0` совпадает с `remind_evaluate`, при 0: `<b>Оценки за {month}</b>\nВсе ваши сотрудники оценены.` / `<b>{month} baholari</b>\nBarcha xodimlaringiz baholangan.`

Правила `parseUpdate`:
- Берутся только `message` и `callback_query`. `edited_message`, `channel_post` и всё прочее → `ignore`.
- Чат обязан быть `private` (`message.chat.type` или `callback_query.message.chat.type`), `from.is_bot !== true`, `chat.id` и `from.id` — числа. Иначе `ignore`.
- Сообщение без `text` → `ignore`.
- `/start` (или `/start@<бот>`) без аргумента → `start`, `token: null`, `hasPayload: false`. С аргументом: `kpi_` + ровно 32 hex в нижнем регистре → `token`, иначе `token: null`, `hasPayload: true`.
- `/my` и `/my@<бот>` → `my`. Любая другая строка на `/` → `help`. Остальное → `text` (обрезка пробелов по краям).
- `callback_data`: `lang:ru|uz`; `dispute:review|violation:<uuid>`; прочее → `{ kind: "unknown" }`.

- [ ] **Step 1: Написать `tg/messages.test.ts`**

```ts
import { describe, expect, it } from "bun:test";
import * as M from "./messages";

const R = "11111111-2222-3333-4444-555555555555";
const V = "66666666-7777-8888-9999-000000000000";
const UNTIL = "2025-11-10T18:59:59.999Z";
const ETIROZ = "Eʼtiroz bildirish";
const ru = (until: string | null = UNTIL) => ({ lang: "ru" as const, disputeUntil: until });
const uz = (until: string | null = UNTIL) => ({ lang: "uz" as const, disputeUntil: until });
const SUB = { period: "2025-10-01", review_id: R, score_pct: 83.33 };

describe("форматы", () => {
  it("месяц, квартал, проценты, дата по Ташкенту, экранирование", () => {
    expect([M.monthLabel("2025-10-01", "ru"), M.monthLabel("2025-10-01", "uz")]).toEqual(["октябрь 2025", "2025-yil oktabr"]);
    expect([M.quarterLabel("2025-10-01", "ru"), M.quarterLabel("2025-10-01", "uz")]).toEqual(["IV квартал 2025", "2025-yil IV chorak"]);
    expect([M.fmtPct(83.33), M.fmtPct(94), M.fmtPct(90.5), M.fmtPct(null)]).toEqual(["83,33 %", "94 %", "90,50 %", "—"]);
    expect(M.fmtDateTime(UNTIL)).toBe("10.11.2025 23:59");
    expect(M.escapeHtml("<b>x</b> & y")).toBe("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });
  it("ruPlural", () => {
    const f: [string, string, string] = ["сотрудник", "сотрудника", "сотрудников"];
    expect([1, 2, 5, 11, 21, 22, 112].map((n) => M.ruPlural(n, f))).toEqual(["сотрудник", "сотрудника", "сотрудников", "сотрудников", "сотрудник", "сотрудника", "сотрудников"]);
  });
});

describe("сотруднику", () => {
  it("review_submitted ru и uz с кнопкой", () => {
    expect(M.buildMessage("review_submitted", SUB, ru())).toEqual({
      text: "<b>Оценка за октябрь 2025</b>\nИтог: 83,33 %.\nНе согласны — нажмите «Оспорить» до 10.11.2025 23:59.",
      reply_markup: { inline_keyboard: [[{ text: "Оспорить", callback_data: `dispute:review:${R}` }]] },
    });
    expect(M.buildMessage("review_submitted", SUB, uz())).toEqual({
      text: `<b>2025-yil oktabr uchun baho</b>\nNatija: 83,33 %.\nRozi boʻlmasangiz, 10.11.2025 23:59 gacha «${ETIROZ}» tugmasini bosing.`,
      reply_markup: { inline_keyboard: [[{ text: ETIROZ, callback_data: `dispute:review:${R}` }]] },
    });
  });
  it("после срока спора нет ни строки, ни кнопки", () => {
    expect(M.buildMessage("review_submitted", SUB, ru(null))).toEqual({ text: "<b>Оценка за октябрь 2025</b>\nИтог: 83,33 %." });
  });
  it("review_changed: изменения, запасное русское название, экранирование", () => {
    const p = { period: "2025-10-01", review_id: R, score_pct: 90, version: 2, comment: "Ошибся <b>", changes: [
      { item_id: "a", title_ru: "Чистота кухни", title_uz: "Oshxona tozaligi", old: 50, new: 100 },
      { item_id: "b", title_ru: "Гигиена", old: null, new: 80 },
    ] };
    expect(M.buildMessage("review_changed", p, ru(null)).text).toBe("<b>Оценка за октябрь 2025 изменена</b>\nНовый итог: 90 %.\n• Чистота кухни: 50 → 100\n• Гигиена: — → 80\nКомментарий: Ошибся &lt;b&gt;");
    expect(M.buildMessage("review_changed", p, uz(null)).text).toBe("<b>2025-yil oktabr uchun baho oʻzgartirildi</b>\nYangi natija: 90 %.\n• Oshxona tozaligi: 50 → 100\n• Гигиена: — → 80\nIzoh: Ошибся &lt;b&gt;");
  });
  it("violation_recorded: без пункта, время по Ташкенту, кнопка по нарушению", () => {
    const p = { violation_id: V, period: "2025-10-01", item_title_ru: null, item_title_uz: null, occurred_at: "2025-10-15T07:00:00.000Z", comment: "Грязный пол" };
    expect(M.buildMessage("violation_recorded", p, ru())).toEqual({
      text: "<b>Зафиксировано нарушение</b>\nПункт: без пункта карты\nКогда: 15.10.2025 12:00\nКомментарий: Грязный пол\nНе согласны — нажмите «Оспорить» до 10.11.2025 23:59.",
      reply_markup: { inline_keyboard: [[{ text: "Оспорить", callback_data: `dispute:violation:${V}` }]] },
    });
    expect(Buffer.byteLength(`dispute:violation:${V}`)).toBeLessThanOrEqual(64);
  });
  it("violation_recorded старого формата: без «Когда», русское название", () => {
    expect(M.buildMessage("violation_recorded", { violation_id: V, period: "2025-10-01", item_title_ru: "Чистота кухни", comment: "x" }, uz(null)).text)
      .toBe("<b>Qoidabuzarlik qayd etildi</b>\nBand: Чистота кухни\nIzoh: x");
  });
  it("dispute_resolved: четыре исхода", () => {
    const b = { dispute_id: "d1", period: "2025-10-01", comment: "Проверили" };
    expect(M.buildMessage("dispute_resolved", { ...b, subject_type: "review", subject_id: R, decision: "accepted", score_pct: 95 }, ru(null)).text).toBe("<b>Спор по оценке за октябрь 2025 принят</b>\nНовый итог: 95 %.\nКомментарий: Проверили");
    expect(M.buildMessage("dispute_resolved", { ...b, subject_type: "review", subject_id: R, decision: "rejected" }, ru(null)).text).toBe("<b>Спор по оценке за октябрь 2025 отклонён</b>\nКомментарий: Проверили");
    expect(M.buildMessage("dispute_resolved", { ...b, subject_type: "violation", subject_id: V, decision: "accepted" }, uz(null)).text).toBe("<b>Qoidabuzarlik boʻyicha eʼtiroz qabul qilindi</b>\nQoidabuzarlik bekor qilindi.\nIzoh: Проверили");
    expect(M.buildMessage("dispute_resolved", { ...b, subject_type: "violation", subject_id: V, decision: "rejected" }, ru(UNTIL))).toEqual({ text: "<b>Спор по нарушению отклонён</b>\nНарушение остаётся.\nКомментарий: Проверили" });
  });
  it("raise_approved", () => {
    const p = { raise_id: "x", quarter_start: "2025-10-01", amount: 300000 };
    expect(M.buildMessage("raise_approved", p, ru(null)).text).toBe("<b>Повышение оклада: IV квартал 2025</b>\nРешение HR: +300 000 сум.");
    expect(M.buildMessage("raise_approved", p, uz(null)).text).toBe("<b>Maosh oshirilishi: 2025-yil IV chorak</b>\nHR qarori: +300 000 soʻm.");
    expect(M.buildMessage("raise_approved", { ...p, amount: 0 }, ru(null)).text).toBe("<b>Итоги квартала: IV квартал 2025</b>\nРешение HR: без повышения.");
  });
});

describe("оценщику и HR", () => {
  it("remind_evaluate", () => {
    const p = { period: "2025-10-01", pending: 5, deadline: "2025-11-07T18:59:59.999Z" };
    expect(M.buildMessage("remind_evaluate", p, ru(null)).text).toBe("<b>Оценки за октябрь 2025</b>\nЖдут вашей оценки: 5 сотрудников.\nСрок: 07.11.2025 23:59.");
    expect(M.buildMessage("remind_evaluate", p, uz(null)).text).toBe("<b>2025-yil oktabr baholari</b>\nBaho kutayotgan xodimlar: 5 ta.\nMuddat: 07.11.2025 23:59.");
    expect(M.buildMessage("remind_evaluate", { ...p, pending: 1 }, ru(null)).text).toContain("Ждут вашей оценки: 1 сотрудник.");
  });
  it("dispute_opened: имя экранируется, кнопки нет", () => {
    const m = M.buildMessage("dispute_opened", { dispute_id: "d1", subject_type: "violation", subject_id: V, period: "2025-10-01", employee_name: "Тест <Повар>", reason: "Я был на смене" }, ru());
    expect(m).toEqual({ text: "<b>Новый спор</b>\nСотрудник: Тест &lt;Повар&gt;\nПредмет: нарушение, октябрь 2025\nПричина: Я был на смене\nРазберите в админке: KPI → Споры." });
  });
  it("overdue_summary: 20 строк и «и ещё», пустая сводка", () => {
    const lagging = Array.from({ length: 25 }, (_, i) => ({ user_name: `Тест ${i + 1}`, pending: 2 }));
    const t = M.buildMessage("overdue_summary", { period: "2025-10-01", lagging, lagging_total: 30 }, ru(null)).text;
    expect(t.startsWith("<b>Срок оценок за октябрь 2025 прошёл</b>\nНе отправили оценки:\n• Тест 1 — 2\n")).toBe(true);
    expect(t.split("\n").filter((l) => l.startsWith("• Тест"))).toHaveLength(20);
    expect(t.endsWith("\n• …и ещё 10")).toBe(true);
    expect(M.buildMessage("overdue_summary", { period: "2025-10-01", lagging: [], lagging_total: 0 }, uz(null)).text)
      .toBe("<b>2025-yil oktabr: baholash muddati tugadi</b>\nBarcha baholovchilar baholarni yubordi.");
  });
});

describe("защита", () => {
  const samples: [string, Record<string, unknown>][] = [
    ["review_submitted", SUB],
    ["review_changed", { ...SUB, version: 2, comment: "c", changes: [{ item_id: "a", title_ru: "А", title_uz: "A", old: 1, new: 2 }] }],
    ["violation_recorded", { violation_id: V, period: "2025-10-01", item_title_ru: null, item_title_uz: null, occurred_at: UNTIL, comment: "c" }],
    ["dispute_resolved", { dispute_id: "d", subject_type: "review", subject_id: R, period: "2025-10-01", decision: "accepted", comment: "c", score_pct: 90 }],
    ["raise_approved", { raise_id: "x", quarter_start: "2025-10-01", amount: 1 }],
    ["remind_evaluate", { period: "2025-10-01", pending: 2, deadline: UNTIL }],
    ["dispute_opened", { dispute_id: "d", subject_type: "review", subject_id: R, period: "2025-10-01", employee_name: "Тест", reason: "r" }],
    ["overdue_summary", { period: "2025-10-01", lagging: [{ user_name: "Тест", pending: 1 }], lagging_total: 1 }],
  ];
  it("все восемь kind собираются; в узбекском нет ASCII-апострофа", () => {
    expect(samples.map(([k]) => k).sort()).toEqual([...M.KPI_KINDS].sort());
    for (const [k, p] of samples) {
      expect(M.buildMessage(k, p, ru()).text.length).toBeGreaterThan(0);
      expect(M.buildMessage(k, p, uz()).text).not.toMatch(/['`’]/);
    }
    for (const key of M.BOT_TEXT_KEYS) expect(M.botText(key, "uz", { min: 5 })).not.toMatch(/['`’]/);
  });
  it("неизвестный kind — UnknownKindError", () => {
    expect(() => M.buildMessage("weird", {}, ru())).toThrow(M.UnknownKindError);
  });
  it("кривой payload не роняет сборку; кнопка только при uuid", () => {
    const bad: Record<string, unknown>[] = [{}, { period: "x", quarter_start: 5, changes: null, lagging: "x", score_pct: "abc", amount: "abc", pending: null, occurred_at: "not-a-date", review_id: 1, violation_id: "v" }];
    for (const k of M.KPI_KINDS) for (const p of bad) for (const ctx of [ru(), uz(null)]) {
      expect(() => M.buildMessage(k, p, ctx)).not.toThrow();
    }
    expect(M.buildMessage("review_submitted", {}, ru()).reply_markup).toBeUndefined();
  });
  it("numeric строкой форматируется как число", () => {
    expect(M.buildMessage("raise_approved", { raise_id: "x", quarter_start: "2025-10-01", amount: "300000.00" }, ru(null)).text).toBe("<b>Повышение оклада: IV квартал 2025</b>\nРешение HR: +300 000 сум.");
    expect([M.fmtPct("83.33"), M.fmtSum("300000.00")]).toEqual(["83,33 %", "300 000"]);
  });
  it("длинный комментарий и длинные названия: не длиннее 4096, без разорванных сущностей", () => {
    const big = M.buildMessage("review_changed", { ...SUB, version: 2, comment: "<".repeat(5000),
      changes: Array.from({ length: 40 }, (_, i) => ({ item_id: `i${i}`, title_ru: "&".repeat(300), old: 1, new: 2 })) }, ru()).text;
    expect(big.length).toBeLessThanOrEqual(4096);
    expect(big).toContain("…");
    expect(big).not.toMatch(/&(?!amp;|lt;|gt;)/);
  });
});

describe("бот", () => {
  it("клавиатура языка и тексты", () => {
    expect(M.LANG_KEYBOARD).toEqual({ inline_keyboard: [[{ text: "Русский", callback_data: "lang:ru" }, { text: "Oʻzbekcha", callback_data: "lang:uz" }]] });
    for (const key of M.BOT_TEXT_KEYS) for (const l of ["ru", "uz"] as const) expect(M.botText(key, l, { min: 5 }).length).toBeGreaterThan(0);
    expect(M.botText("ask_reason", "ru", { min: 5 })).toBe("Напишите причину спора ответом на это сообщение, не короче 5 символов. Ждём 15 минут.");
    expect(M.botText("start_bad", "uz")).toBe(M.botText("start_bad", "ru"));
  });
  it("/my сотрудника и оценщика", () => {
    expect(M.myEmployeeText("ru", [{ period: "2025-10-01", score_pct: 83.33 }, { period: "2025-09-01", score_pct: 90 }],
      [{ occurred_at: "2025-11-03T05:00:00.000Z", title_ru: "Чистота кухни", title_uz: "Oshxona tozaligi" }]))
      .toBe("<b>Ваши оценки</b>\n• октябрь 2025 — 83,33 %\n• сентябрь 2025 — 90 %\n\n<b>Нарушения в этом месяце</b>\n• 03.11.2025 Чистота кухни");
    expect(M.myEmployeeText("uz", [], [])).toBe("<b>Sizning baholaringiz</b>\nHozircha yuborilgan baho yoʻq.\n\n<b>Shu oydagi qoidabuzarliklar</b>\nBu oyda qoidabuzarlik yoʻq.");
    expect(M.myUserText("ru", "2025-10-01", 0, "2025-11-07T18:59:59.999Z")).toBe("<b>Оценки за октябрь 2025</b>\nВсе ваши сотрудники оценены.");
    expect(M.myUserText("ru", "2025-10-01", 2, "2025-11-07T18:59:59.999Z")).toBe("<b>Оценки за октябрь 2025</b>\nЖдут вашей оценки: 2 сотрудника.\nСрок: 07.11.2025 23:59.");
  });
});
```

- [ ] **Step 2: Написать `tg/updates.test.ts`**

```ts
import { describe, expect, it } from "bun:test";
import { parseUpdate, secretOk } from "./updates";

const TOKEN = "0123456789abcdef0123456789abcdef";
const UUID = "11111111-2222-3333-4444-555555555555";
const msg = (text: unknown, chat: object = { id: 501, type: "private" }, from: object = { id: 501, is_bot: false }) =>
  ({ update_id: 1, message: { message_id: 7, chat, from, text } });
const cb = (data: string, type = "private") =>
  ({ update_id: 2, callback_query: { id: "cb1", from: { id: 501, is_bot: false }, data, message: { message_id: 8, chat: { id: 501, type } } } });
const ids = { chatId: 501, fromId: 501 };

describe("parseUpdate", () => {
  it("/start", () => {
    expect(parseUpdate(msg(`/start kpi_${TOKEN}`))).toEqual({ type: "start", ...ids, token: TOKEN, hasPayload: true });
    expect(parseUpdate(msg("/start kpi_XYZ"))).toEqual({ type: "start", ...ids, token: null, hasPayload: true });
    expect(parseUpdate(msg(`/start inv_${TOKEN}`))).toEqual({ type: "start", ...ids, token: null, hasPayload: true });
    expect(parseUpdate(msg("/start"))).toEqual({ type: "start", ...ids, token: null, hasPayload: false });
  });
  it("команды и текст", () => {
    expect(parseUpdate(msg("/my"))).toEqual({ type: "my", ...ids });
    expect(parseUpdate(msg("/my@kpi_test_bot"))).toEqual({ type: "my", ...ids });
    expect(parseUpdate(msg("/help"))).toEqual({ type: "help", ...ids });
    expect(parseUpdate(msg("  не согласен  "))).toEqual({ type: "text", ...ids, text: "не согласен" });
  });
  it("кнопки", () => {
    expect(parseUpdate(cb("lang:uz"))).toEqual({ type: "callback", ...ids, callbackId: "cb1", action: { kind: "lang", lang: "uz" } });
    expect(parseUpdate(cb(`dispute:violation:${UUID}`))).toEqual({ type: "callback", ...ids, callbackId: "cb1", action: { kind: "dispute", subject_type: "violation", subject_id: UUID } });
    expect((parseUpdate(cb("dispute:review:not-a-uuid")) as any).action).toEqual({ kind: "unknown" });
    expect((parseUpdate(cb("lang:en")) as any).action).toEqual({ kind: "unknown" });
  });
  it("группа, канал, бот, правка, фото, мусор — ignore", () => {
    for (const u of [
      msg("/my", { id: -100, type: "group" }), msg("/my", { id: -100, type: "supergroup" }), cb("lang:ru", "group"),
      msg("/my", { id: 501, type: "private" }, { id: 501, is_bot: true }), msg(undefined),
      { update_id: 3, edited_message: msg("/my").message }, { update_id: 4, channel_post: { chat: { id: -1, type: "channel" }, text: "x" } },
      null, "x", 5, [],
    ]) expect(parseUpdate(u)).toEqual({ type: "ignore" });
  });
});

describe("secretOk", () => {
  it("равенство за постоянное время", () => {
    expect(secretOk("kpi_test_secret", "kpi_test_secret")).toBe(true);
    expect(secretOk("kpi_test_secreT", "kpi_test_secret")).toBe(false);
    expect(secretOk("short", "kpi_test_secret")).toBe(false);
    expect(secretOk(undefined, "kpi_test_secret")).toBe(false);
  });
});
```

- [ ] **Step 3: Run** `cd backend && bun test src/modules/kpi/tg` — Expected: FAIL (`Cannot find module './messages'`).

- [ ] **Step 4: Реализовать `tg/messages.ts` и `tg/updates.ts`.** Дата по Ташкенту — сдвиг `+5 ч` через `Date.UTC`, как в `time.ts`. Числа сумм — свои пробелы-разделители, без `toLocaleString`. Обрезка: сначала `clip(raw, 500 | 100)`, потом `escapeHtml`, в конце `fitTelegram(text)` по строкам.

- [ ] **Step 5: Run** тот же тест — Expected: PASS.

- [ ] **Step 6: Привести payload к контракту и закрепить проверками.** Правки в сервисах — только поля из таблицы. По одной проверке в существующие HTTP-тесты, в тот тест, где строка уведомления уже читается:
  - `reviews.test.ts`, тест изменения с комментарием: у строки `review_changed:<id>:2` выполняется `typeof payload.changes[0].title_uz === "string"`;
  - `violations.test.ts`, тест записи с двумя PNG: у `violation_recorded:<id>` выполняется `expect(Object.keys(payload)).toEqual(expect.arrayContaining(["item_title_uz", "occurred_at"]))`;
  - `disputes.test.ts`: у `dispute_opened` проверка `toMatchObject({ subject_type, subject_id, period, reason })` и строковый `employee_name`; у `dispute_resolved` — `decision` и `comment`, у принятого спора по оценке ещё числовой `score_pct`;
  - `raises.test.ts`, тест утверждения: у `raise_approved` проверка `toMatchObject({ quarter_start, amount })` и `typeof payload.amount === "number"`.

  Run: `bun run test:http:kpi` — Expected: PASS. Типы: `grep modules/kpi` пусто.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/kpi/tg/messages.ts backend/src/modules/kpi/tg/messages.test.ts backend/src/modules/kpi/tg/updates.ts backend/src/modules/kpi/tg/updates.test.ts backend/src/modules/kpi/reviews.ts backend/src/modules/kpi/violations.ts backend/src/modules/kpi/disputes.ts backend/src/modules/kpi/raises.ts backend/src/modules/kpi/http/reviews.test.ts backend/src/modules/kpi/http/violations.test.ts backend/src/modules/kpi/http/disputes.test.ts backend/src/modules/kpi/http/raises.test.ts
git commit -m "feat(kpi): тексты Telegram на двух языках, разбор апдейтов, payload уведомлений"
```

---

### Task 3: Очередь, постановка после коммита, клиент Bot API

**Files:**
- Create: `backend/src/modules/kpi/queue.ts`, `backend/src/modules/kpi/tg/bot-api.ts`, `backend/src/modules/kpi/http/notify.test.ts`
- Modify: `backend/src/modules/kpi/notify.ts`, `backend/src/modules/kpi/errors.ts`, `backend/src/modules/kpi/http/fixtures.ts`

**Interfaces:**
- Consumes: `OutMessage` (задача 2); `TgResult`, `sendMessage`, `interpretResponse` из `@backend/modules/tickets/telegram`.
- Produces:
  ```ts
  // queue.ts
  export const KPI_DELIVER_JOB = "deliver";
  export const KPI_SWEEP_JOB = "kpi-sweep";
  export const KPI_DAILY_JOB = "kpi-daily";
  export function kpiQueueName(): string;            // process.env.KPI_NOTIFY_QUEUE || "kpi-notify", читается при вызове
  export const deliverJobOptions: { attempts: 5; backoff: { type: "exponential"; delay: 5000 }; removeOnComplete: { age: 3600; count: 1000 }; removeOnFail: { age: 86400 } };
  export const schedulerJobOptions: { removeOnComplete: { count: 10 }; removeOnFail: { age: 86400 } };
  export function redisConnection(): { host: string; port: number }; // REDIS_HOST ?? "localhost", REDIS_PORT ?? 6379
  export function getKpiQueue(): Queue;              // ленивый синглтон, queue.on("error") только логирует

  // notify.ts (дополнение)
  export async function enqueue(tx: DbLike, n: NotifyInput): Promise<string | null>; // id новой строки (returning) или null при дубле dedupe_key
  export async function collectDeliveries<T>(fn: () => Promise<T>, schedule?: (ids: string[]) => void): Promise<T>;
  export function scheduleDelivery(ids: string[]): void;

  // tg/bot-api.ts
  export type { TgResult };
  export interface BotApi {
    send(chatId: number, msg: OutMessage): Promise<TgResult>;
    answerCallback(callbackId: string, text?: string): Promise<TgResult>;
  }
  export function realBotApi(token: string): BotApi;
  export function botApi(): BotApi | null;           // тестовая подмена, иначе realBotApi(KPI_BOT_TOKEN), без токена null
  export function setTestBotApi(api: BotApi | null): void; // действует только при PROJECT_PREFIX === "managers_test_"

  // http/fixtures.ts (дополнение)
  export function fakeBotApi(results?: TgResult[]): { api: BotApi; sent: { chatId: number; msg: OutMessage }[]; answered: string[] };
  // send берёт ответы из results по очереди, когда они кончились — { ok: true, message_id: 42 }
  ```

Решения:
- `collectDeliveries` держит массив в `AsyncLocalStorage<string[]>`. `enqueue` кладёт туда id новой строки, если сборщик есть. После успешного `fn` вызывается `schedule(ids)` (по умолчанию `scheduleDelivery`), если `ids` не пуст. При исключении `schedule` не вызывается, исключение пробрасывается. Вложенный вызов собирает своё и сам же ставит.
- `run(set, fn)` в `errors.ts` вызывает `collectDeliveries(fn)` внутри своего `try`. Так все роуты KPI ставят задачи после коммита без правки сервисов. Сервис возвращается только после `transaction()`, значит, коммит уже прошёл.
- `scheduleDelivery` повторяет `tickets/queue.ts` `enqueueNotifications`: fire-and-forget, `getKpiQueue().add(KPI_DELIVER_JOB, { notificationId: id }, { ...deliverJobOptions, jobId: id })`, ошибка — `console.error`; строку подберёт подметалка (задача 6).
- `realBotApi.send` — `sendMessage(token, chatId, msg)` из tickets. `answerCallback` — свой `fetch` на `answerCallbackQuery` с `{ callback_query_id, text }` и разбором через `interpretResponse`; сетевая ошибка — `{ ok: false, permanent: false, error }`.
- `cleanupKpi` в конце: если `kpiQueueName() === "kpi-notify"`, бросить ошибку (тесты не трогают боевую очередь), иначе `obliterate({ force: true })` очереди теста.

- [ ] **Step 1: Написать `http/notify.test.ts`** (guard и `beforeAll/afterAll` как в `violations.test.ts`; период `2025-10-01`)

```ts
it("очередь теста — не боевая", () => expect(kpiQueueName()).toBe("kpi_notify_test"));

it("id из транзакции доходят до schedule после коммита; дубль dedupe_key — null", async () => {
  const e = await makeEmployee(db);
  const n = { recipient_kind: "employee" as const, employee_id: e.id, kind: "review_submitted", payload: { period: "2025-10-01" }, dedupe_key: `test:${e.id}` };
  const got: string[][] = [];
  let first: string | null = null;
  await collectDeliveries(() => db.transaction(async (tx) => {
    first = await enqueue(tx, n);
    expect(await enqueue(tx, n)).toBeNull();
  }), (ids) => got.push(ids));
  expect(first).not.toBeNull();
  expect(got).toEqual([[first!]]);
});

it("откат транзакции — schedule не зовётся, строки нет", async () => {
  const e = await makeEmployee(db);
  const key = `test:rollback:${e.id}`;
  const got: string[][] = [];
  await expect(collectDeliveries(() => db.transaction(async (tx) => {
    await enqueue(tx, { recipient_kind: "employee", employee_id: e.id, kind: "review_submitted", payload: {}, dedupe_key: key });
    throw new Error("откат");
  }), (ids) => got.push(ids))).rejects.toThrow("откат");
  expect(got).toEqual([]);
  expect(await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, key))).toHaveLength(0);
});

it("отправка оценки через API ставит задачу deliver с jobId = id уведомления", async () => {
  // как в reviews.test.ts: setNow("2025-10-25T10:00:00+05:00"), повар, оценщик с назначением на его филиал,
  // черновик со всеми ручными пунктами = 100, затем POST /submit
  const [row] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `review_submitted:${reviewId}`));
  let job = null;
  for (let i = 0; i < 20 && !job; i++) { job = await getKpiQueue().getJob(row.id); if (!job) await Bun.sleep(100); }
  expect(job?.name).toBe("deliver");
  expect(job?.data).toEqual({ notificationId: row.id });
  expect(job?.opts.removeOnComplete).toEqual({ age: 3600, count: 1000 });
  expect(job?.opts.removeOnFail).toEqual({ age: 86400 });
});

it("botApi: подмена в тестах, без токена и подмены — null", () => {
  const f = fakeBotApi();
  setTestBotApi(f.api);
  expect(botApi()).toBe(f.api);
  setTestBotApi(null);
  const saved = process.env.KPI_BOT_TOKEN;
  delete process.env.KPI_BOT_TOKEN;
  try { expect(botApi()).toBeNull(); } finally { if (saved !== undefined) process.env.KPI_BOT_TOKEN = saved; }
});
```

- [ ] **Step 2: Run** `bun run test:http:kpi` — Expected: новые тесты FAIL (нет `collectDeliveries`).

- [ ] **Step 3: Реализовать `queue.ts`, `tg/bot-api.ts`, правки `notify.ts`, `errors.ts`, `fixtures.ts`.** Если тест «id из транзакции…» падает из-за потери контекста `AsyncLocalStorage` внутри `transaction()` под Bun, не обходить его: вместо ALS добавить в `enqueue` необязательный параметр `outbox?: string[]`, прокинуть его из `run()` через сервисы и доложить об этом в отчёте задачи.

- [ ] **Step 4: Run** `bun run test:http:kpi` и `bun test src/modules/kpi/*.test.ts src/modules/kpi/tg` — Expected: PASS всё. Типы чисты.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/kpi/queue.ts backend/src/modules/kpi/tg/bot-api.ts backend/src/modules/kpi/notify.ts backend/src/modules/kpi/errors.ts backend/src/modules/kpi/http/fixtures.ts backend/src/modules/kpi/http/notify.test.ts
git commit -m "feat(kpi): очередь kpi-notify, постановка после коммита, клиент Bot API"
```

---

### Task 4: Приглашения и привязки

**Files:**
- Create: `backend/src/modules/kpi/tg/bindings.ts`, `backend/src/modules/kpi/routes/telegram.ts`, `backend/src/modules/kpi/http/telegram.test.ts`
- Modify: `backend/src/modules/kpi/controller.ts`, `backend/src/modules/kpi/types.ts`

**Interfaces:**
- Consumes: таблицы (задача 1); `now` из `clock.ts`; `KpiError`, `run`.
- Produces:
  ```ts
  // types.ts
  export interface KpiInvite { token: string; link: string; expires_at: string }
  export interface TgBindingRow { id: string; employee_id: string | null; user_id: string | null; lang: "ru" | "uz"; active: boolean; created_at: string }
  // tg/bindings.ts
  export const INVITE_DAYS = 7;
  export type ActiveBinding = { id: string; telegram_id: number; employee_id: string | null; user_id: string | null; lang: "ru" | "uz" };
  export async function createInvite(db: DbLike, createdBy: string, target: { employee_id?: unknown; user_id?: unknown }): Promise<KpiInvite>;
  export async function listBindings(db: DbLike, q: { employee_ids: string[]; user_ids: string[] }): Promise<TgBindingRow[]>;
  export async function unbind(db: DbLike, id: string): Promise<void>;
  export async function redeemInvite(db: DbLike, token: string, telegramId: number): Promise<"bound" | "already" | "invalid">;
  export async function bindingOf(db: DbLike, telegramId: number): Promise<ActiveBinding | null>;           // только active
  export async function setLang(db: DbLike, telegramId: number, lang: "ru" | "uz"): Promise<ActiveBinding | null>;
  export async function recipientOf(db: DbLike, r: { recipient_kind: string; employee_id: string | null; user_id: string | null }): Promise<{ chat_id: number; lang: "ru" | "uz" } | null>;
  ```
- Роуты (все `permission: "kpi.manage"`, ответы через `run`):
  - `POST /kpi/invites` `{ employee_id } | { user_id }` → `KpiInvite`;
  - `GET /kpi/tg/bindings?employee_ids=a,b&user_ids=c` → `TgBindingRow[]`;
  - `DELETE /kpi/tg/bindings/:id` → `{ ok: true }`.

Правила:
- **Приглашение.**
  - Ровно одно из `employee_id`/`user_id`, и это uuid-строка, иначе 422 `bad_target`.
  - Сотрудник должен существовать и быть `active`, пользователь — существовать со `status = 'active'`, иначе 404 `not_found`.
  - Пустой `KPI_BOT_USERNAME` — 409 `bot_not_configured`; проверяется первым.
  - Неиспользованные непросроченные приглашения того же человека гасятся (`expires_at = now()`), чтобы старая разосланная ссылка не привязала чужой телефон.
  - Токен: `randomBytes(16).toString("hex")`, срок `now() + INVITE_DAYS` дней.
  - `link = https://t.me/<KPI_BOT_USERNAME>?start=kpi_<token>`, `expires_at` — `toISOString()` вычисленной даты, а не строка из базы.
- **Погашение** (одна транзакция, приглашение `FOR UPDATE`):
  - Токен не 32 hex или не найден — `invalid`.
  - Уже использовано: активная привязка этого `telegram_id` того же человека — `already`, иначе `invalid`.
  - Просрочено (`expires_at <= now()`) — `invalid`.
  - Иначе: активные привязки того же человека с другим `telegram_id` получают `active = false`. Затем upsert по `telegram_id`: нужный id человека, второй id `null`, `active = true`, язык при конфликте не меняется. Приглашение получает `used_at = now()`. Результат — `bound`.
- **Список привязок.**
  - Списки через запятую, пустые части отбрасываются. Не uuid — 422 `bad_id`, больше 200 id в одном списке — 422 `too_many_ids`.
  - Отдаются только активные, по `created_at`.
- **Отвязка.** `active = false`; повтор — 200; кривой или неизвестный id — 404 `not_found`.

- [ ] **Step 1: Написать `http/telegram.test.ts`** (guard, `setup`, `cleanupKpi` до и после, `setNow(null)` в `afterAll`)

```ts
it("приглашение: права и ввод", async () => {
  const view = await withSession({ permissions: ["kpi.view"] });
  expect((await api(view, "POST", "/api/kpi/invites", { employee_id: randomUUID() })).status).toBe(403);
  const hr = await withSession({ permissions: ["kpi.manage"] });
  for (const body of [{}, { employee_id: randomUUID(), user_id: randomUUID() }, { employee_id: "x" }]) {
    expect((await api(hr, "POST", "/api/kpi/invites", body)).body).toEqual({ error: "bad_target" });
  }
  const r = await api(hr, "POST", "/api/kpi/invites", { employee_id: randomUUID() });
  expect([r.status, r.body]).toEqual([404, { error: "not_found" }]);
});

it("приглашение сотруднику: токен, ссылка на бота, 7 дней", async () => {
  setNow("2025-10-25T10:00:00+05:00");
  const e = await makeEmployee(db);
  const hr = await withSession({ permissions: ["kpi.manage"] });
  const r = await api(hr, "POST", "/api/kpi/invites", { employee_id: e.id });
  expect(r.status).toBe(200);
  expect(r.body.token).toMatch(/^[0-9a-f]{32}$/);
  expect(r.body.link).toBe(`https://t.me/kpi_test_bot?start=kpi_${r.body.token}`);
  expect(r.body.expires_at).toBe("2025-11-01T05:00:00.000Z");
});

it("приглашение пользователю — только активному; без KPI_BOT_USERNAME — 409", async () => {
  const hr = await withSession({ permissions: ["kpi.manage"] });
  const ok = await makeUser(db);
  const blocked = await makeUser(db, { status: "blocked" });
  expect((await api(hr, "POST", "/api/kpi/invites", { user_id: ok.id })).status).toBe(200);
  expect((await api(hr, "POST", "/api/kpi/invites", { user_id: blocked.id })).status).toBe(404);
  const saved = process.env.KPI_BOT_USERNAME!;
  delete process.env.KPI_BOT_USERNAME;
  try { expect((await api(hr, "POST", "/api/kpi/invites", { user_id: ok.id })).body).toEqual({ error: "bot_not_configured" }); }
  finally { process.env.KPI_BOT_USERNAME = saved; }
});

it("погашение: bound → already → чужой telegram invalid; новое приглашение гасит старое; просрочка", async () => {
  setNow("2025-10-25T10:00:00+05:00");
  const e = await makeEmployee(db);
  const u = await makeUser(db);
  const [t1, t2, t3] = [newTelegramId(), newTelegramId(), newTelegramId()];
  const a = await createInvite(db, u.id, { employee_id: e.id });
  const b = await createInvite(db, u.id, { employee_id: e.id });
  expect(await redeemInvite(db, a.token, t1)).toBe("invalid");
  expect(await redeemInvite(db, b.token, t1)).toBe("bound");
  expect(await redeemInvite(db, b.token, t1)).toBe("already");
  expect(await redeemInvite(db, b.token, t2)).toBe("invalid");
  const c = await createInvite(db, u.id, { employee_id: e.id });
  setNow("2025-11-01T10:00:01+05:00");
  expect(await redeemInvite(db, c.token, t3)).toBe("invalid");
  expect(await redeemInvite(db, "not-a-token", t3)).toBe("invalid");
});

it("перепривязка: один telegram — один человек; второй телефон гасит первый", async () => {
  setNow("2025-10-25T10:00:00+05:00");
  const [e1, e2] = [await makeEmployee(db), await makeEmployee(db)];
  const u = await makeUser(db);
  const [t1, t2] = [newTelegramId(), newTelegramId()];
  await redeemInvite(db, (await createInvite(db, u.id, { employee_id: e1.id })).token, t1);
  await redeemInvite(db, (await createInvite(db, u.id, { employee_id: e2.id })).token, t1);
  const byTg = await db.select().from(kpi_tg_bindings).where(eq(kpi_tg_bindings.telegram_id, t1));
  expect(byTg.map((r) => [r.employee_id, r.user_id, r.active])).toEqual([[e2.id, null, true]]);
  await redeemInvite(db, (await createInvite(db, u.id, { employee_id: e2.id })).token, t2);
  const byEmp = await db.select().from(kpi_tg_bindings).where(eq(kpi_tg_bindings.employee_id, e2.id));
  expect(byEmp.find((r) => r.telegram_id === t1)?.active).toBe(false);
  expect(byEmp.find((r) => r.telegram_id === t2)?.active).toBe(true);
  await redeemInvite(db, (await createInvite(db, u.id, { user_id: u.id })).token, t2);
  expect(await bindingOf(db, t2)).toMatchObject({ employee_id: null, user_id: u.id });
});

it("привязки: только активные, проверка id, отвязка", async () => {
  const hr = await withSession({ permissions: ["kpi.manage"] });
  const e = await makeEmployee(db);
  const b = await bindTelegram(db, { employee_id: e.id, lang: "uz" });
  const u = await makeUser(db);
  await bindTelegram(db, { user_id: u.id, active: false });
  const r = await api(hr, "GET", `/api/kpi/tg/bindings?employee_ids=${e.id}&user_ids=${u.id}`);
  expect(r.body.map((x: TgBindingRow) => [x.id, x.employee_id, x.user_id, x.lang, x.active])).toEqual([[b.id, e.id, null, "uz", true]]);
  expect((await api(hr, "GET", "/api/kpi/tg/bindings?employee_ids=bad")).body).toEqual({ error: "bad_id" });
  const many = Array.from({ length: 201 }, () => randomUUID()).join(",");
  expect((await api(hr, "GET", `/api/kpi/tg/bindings?employee_ids=${many}`)).body).toEqual({ error: "too_many_ids" });
  expect((await api(hr, "DELETE", `/api/kpi/tg/bindings/${b.id}`)).status).toBe(200);
  expect((await api(hr, "DELETE", `/api/kpi/tg/bindings/${b.id}`)).status).toBe(200);
  expect((await api(hr, "DELETE", `/api/kpi/tg/bindings/${randomUUID()}`)).status).toBe(404);
  expect((await api(hr, "GET", `/api/kpi/tg/bindings?employee_ids=${e.id}`)).body).toEqual([]);
  const view = await withSession({ permissions: ["kpi.view"] });
  expect((await api(view, "GET", `/api/kpi/tg/bindings?employee_ids=${e.id}`)).status).toBe(403);
});
```

- [ ] **Step 2: Run** `bun run test:http:kpi` — Expected: новые тесты FAIL (404 на `/api/kpi/invites`).
- [ ] **Step 3: Реализовать `tg/bindings.ts`, `routes/telegram.ts`, типы; `.use(telegramRoutes)` в `controller.ts`.**
- [ ] **Step 4: Run** — Expected: PASS всё; типы чисты.
- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/kpi/tg/bindings.ts backend/src/modules/kpi/routes/telegram.ts backend/src/modules/kpi/controller.ts backend/src/modules/kpi/types.ts backend/src/modules/kpi/http/telegram.test.ts
git commit -m "feat(kpi): приглашения в бота и привязки Telegram"
```

---

### Task 5: Доставка одного уведомления и подметалка

**Files:**
- Create: `backend/src/modules/kpi/worker/deliver.ts`, `backend/src/modules/kpi/http/delivery.test.ts`

**Interfaces:**
- Consumes: `buildMessage`, `DISPUTABLE_KINDS`, `UnknownKindError` (задача 2); `BotApi` (задача 3); `recipientOf` (задача 4); `loadSettings`, `isPeriodClosed`, `disputeDeadline`, `isPeriod`, `now`.
- Produces:
  ```ts
  export type DeliverOutcome =
    | { result: "noop" }
    | { result: "sent" }
    | { result: "skipped"; reason: "no_token" | "no_binding" }
    | { result: "failed"; error: string }
    | { result: "retry"; error: string; retryAfterMs?: number };
  export async function deliverOne(db: DbLike, id: string, deps: { api: BotApi | null; lastAttempt: boolean }): Promise<DeliverOutcome>;
  export async function pendingIds(db: DbLike, olderThanSec: number, limit: number): Promise<string[]>; // pending, created_at < now() − olderThanSec, старые первыми
  export async function stuckSendingCount(db: DbLike, olderThanMin: number): Promise<number>;
  ```

Порядок `deliverOne`:
1. Захват строки: `UPDATE … SET status = 'sending', attempts = attempts + 1 WHERE id = $1 AND status = 'pending' RETURNING *`. Нет строки — `noop`.
2. `api === null` — `skipped` / `no_token`.
3. `recipientOf` вернул `null` — `skipped` / `no_binding`.
4. Для `DISPUTABLE_KINDS` при `isPeriod(payload.period)`: `disputeUntil = disputeDeadline(period, settings.dispute_deadline_day).toISOString()`, если `now()` не позже срока и месяц не закрыт; иначе `null`. Для остальных kind — `null`.
5. `UnknownKindError` — `failed`, `last_error = "unknown_kind:<kind>"`. Любое другое исключение `buildMessage` — `failed` с его текстом.
6. Ошибка чтения базы на шагах 3–4 — `retry` (строка `pending`), на последней попытке — `failed`. Исключение наружу не выходит.
7. Отправка. Успех — `sent`, `tg_message_id = String(message_id)` (если не `null`), `sent_at`. `permanent` — `failed`. Есть `retryAfterMs` — строка `pending`, `retry` с паузой. Прочая ошибка и исключение из `api.send` — `pending` и `retry`, на последней попытке `failed`.

После захвата ни одна ветка не оставляет строку в `sending`: это ровно та поломка, о которой предупреждают комментарии `tickets_worker.ts`.

Во всех исходах кроме `sent` и `noop` пишется `last_error` (`no_token`, `no_binding` или текст ошибки).

- [ ] **Step 1: Написать `http/delivery.test.ts`** (guard и уборка как в соседних файлах)

```ts
const P10 = "2025-10-01";
const RID = randomUUID();
const row = async (id: string) => (await db.select().from(kpi_notifications).where(eq(kpi_notifications.id, id)))[0];
const note = async (o: { employee_id?: string; user_id?: string; kind?: string; payload?: Record<string, unknown> }) =>
  (await enqueue(db, {
    recipient_kind: o.user_id ? "user" : "employee", employee_id: o.employee_id, user_id: o.user_id,
    kind: o.kind ?? "review_submitted", payload: o.payload ?? { period: P10, review_id: RID, score_pct: 83.33 },
    dedupe_key: `t:${randomUUID()}`,
  }))!;
const go = (id: string, api: BotApi | null, lastAttempt = false) => deliverOne(db, id, { api, lastAttempt });

it("без токена — skipped no_token, без отправки", async () => {
  const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
  const id = await note({ employee_id: e.id });
  expect(await go(id, null)).toEqual({ result: "skipped", reason: "no_token" });
  const r = await row(id);
  expect([r.status, r.last_error, r.attempts]).toEqual(["skipped", "no_token", 1]);
});

it("без привязки и с неактивной — skipped no_binding", async () => {
  const f = fakeBotApi();
  const a = await makeEmployee(db);
  const b = await makeEmployee(db); await bindTelegram(db, { employee_id: b.id, active: false });
  for (const e of [a, b]) expect(await go(await note({ employee_id: e.id }), f.api)).toEqual({ result: "skipped", reason: "no_binding" });
  expect(f.sent).toHaveLength(0);
});

it("успех до срока споров: текст, кнопка, sent; повтор — noop", async () => {
  setNow("2025-11-05T10:00:00+05:00");
  const e = await makeEmployee(db); const b = await bindTelegram(db, { employee_id: e.id });
  const id = await note({ employee_id: e.id });
  const f = fakeBotApi();
  expect(await go(id, f.api)).toEqual({ result: "sent" });
  expect(f.sent[0].chatId).toBe(b.telegram_id);
  expect(f.sent[0].msg.text).toContain("Итог: 83,33 %.");
  expect((f.sent[0].msg.reply_markup as any).inline_keyboard[0][0].callback_data).toBe(`dispute:review:${RID}`);
  const r = await row(id);
  expect([r.status, r.tg_message_id, r.attempts]).toEqual(["sent", "42", 1]);
  expect(r.sent_at).not.toBeNull();
  expect(await go(id, f.api)).toEqual({ result: "noop" });
  expect(f.sent).toHaveLength(1);
});

it("после срока споров и в закрытом месяце кнопки нет", async () => {
  const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
  const f = fakeBotApi();
  setNow("2025-11-11T10:00:00+05:00");
  await go(await note({ employee_id: e.id }), f.api);
  setNow("2025-11-05T10:00:00+05:00");
  await db.insert(kpi_periods).values({ period: P10, status: "closed" });
  try { await go(await note({ employee_id: e.id }), f.api); }
  finally { await db.delete(kpi_periods).where(eq(kpi_periods.period, P10)); }
  expect(f.sent.map((s) => s.msg.reply_markup)).toEqual([undefined, undefined]);
});

it("узбекская привязка — узбекский текст и кнопка", async () => {
  setNow("2025-11-05T10:00:00+05:00");
  const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id, lang: "uz" });
  const f = fakeBotApi();
  await go(await note({ employee_id: e.id }), f.api);
  expect(f.sent[0].msg.text).toContain("Natija: 83,33 %.");
  expect((f.sent[0].msg.reply_markup as any).inline_keyboard[0][0].text).toBe("Eʼtiroz bildirish");
});

it("429 — retry с паузой, строка снова pending", async () => {
  const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
  const id = await note({ employee_id: e.id });
  const f = fakeBotApi([{ ok: false, permanent: false, retryAfterMs: 7000, error: "Too Many Requests" }]);
  expect(await go(id, f.api)).toEqual({ result: "retry", error: "Too Many Requests", retryAfterMs: 7000 });
  expect([(await row(id)).status, (await row(id)).last_error]).toEqual(["pending", "Too Many Requests"]);
});

it("постоянная ошибка — failed; временная — pending, на последней попытке — failed", async () => {
  const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
  const blocked = { ok: false as const, permanent: true, error: "Forbidden: bot was blocked by the user" };
  const temp = { ok: false as const, permanent: false, error: "Bad Gateway" };
  const a = await note({ employee_id: e.id });
  expect(await go(a, fakeBotApi([blocked]).api)).toEqual({ result: "failed", error: blocked.error });
  const b = await note({ employee_id: e.id });
  expect(await go(b, fakeBotApi([temp]).api)).toEqual({ result: "retry", error: "Bad Gateway" });
  expect((await row(b)).status).toBe("pending");
  expect(await go(b, fakeBotApi([temp]).api, true)).toEqual({ result: "failed", error: "Bad Gateway" });
  expect([(await row(b)).status, (await row(b)).attempts]).toEqual(["failed", 2]);
});

it("неизвестный kind — failed unknown_kind", async () => {
  const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
  const id = await note({ employee_id: e.id, kind: "weird", payload: {} });
  expect(await go(id, fakeBotApi().api)).toEqual({ result: "failed", error: "unknown_kind:weird" });
});

it("получатель-пользователь находится по user_id", async () => {
  const u = await makeUser(db); const b = await bindTelegram(db, { user_id: u.id });
  const f = fakeBotApi();
  await go(await note({ user_id: u.id, kind: "remind_evaluate", payload: { period: P10, pending: 2, deadline: "2025-11-07T18:59:59.999Z" } }), f.api);
  expect(f.sent[0].chatId).toBe(b.telegram_id);
  expect(f.sent[0].msg.text).toContain("Ждут вашей оценки: 2 сотрудника.");
});

it("подметалка: только pending старше 60 с; зависшие sending считаются", async () => {
  const e = await makeEmployee(db);
  const old = await note({ employee_id: e.id });
  const fresh = await note({ employee_id: e.id });
  const stuck = await note({ employee_id: e.id });
  await db.update(kpi_notifications).set({ created_at: sql`now() - interval '2 minutes'` as any }).where(eq(kpi_notifications.id, old));
  await db.update(kpi_notifications).set({ status: "sending", created_at: sql`now() - interval '20 minutes'` as any }).where(eq(kpi_notifications.id, stuck));
  const ids = await pendingIds(db, 60, 200);
  expect(ids).toContain(old);
  expect(ids).not.toContain(fresh);
  expect(ids).not.toContain(stuck);
  expect(await stuckSendingCount(db, 15)).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run** `bun run test:http:kpi` — Expected: FAIL (`Cannot find module '../worker/deliver'`).
- [ ] **Step 3: Реализовать `worker/deliver.ts`.**
- [ ] **Step 4: Run** — Expected: PASS всё; типы чисты.
- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/kpi/worker/deliver.ts backend/src/modules/kpi/http/delivery.test.ts
git commit -m "feat(kpi): доставка уведомления в Telegram и подметалка"
```

---

### Task 6: Ежедневные напоминания, процесс-воркер, PM2

**Files:**
- Create: `backend/src/modules/kpi/worker/daily-plan.ts`, `worker/daily-plan.test.ts`, `worker/daily.ts`, `backend/src/modules/kpi/http/daily.test.ts`, `cron/kpi_worker.ts`
- Modify: `backend/src/modules/kpi/periods.ts`, `cron/pm2.config.js`

**Interfaces:**
- Consumes: `currentReviewPeriod`, `reminderFrom`, `reviewDeadline`, `periodOf`, `addMonths`, `tashkentDay` (`time.ts`); `NotifyInput`, `enqueue`; `deliverOne`, `pendingIds`, `stuckSendingCount` (задача 5); `botApi` (задача 3); всё из `queue.ts`.
- Produces:
  ```ts
  // periods.ts — блок «Отстающие» из periodSummary выносится без изменения логики
  export type Lagging = { user_id: string; user_name: string; pending: number };
  export async function laggingEvaluators(db: DbLike, period: Period, rows?: EmployeeRow[]): Promise<Lagging[]>; // без rows грузит сеть сам
  // worker/daily-plan.ts — чистые
  export type DailyTargets = { today: string; remind: { period: Period; deadline: string } | null; overdue: { period: Period } | null };
  export function dailyTargets(at: Date, s: { review_deadline_day: number; reminder_days_before: number }): DailyTargets;
  export function remindNotifications(remind: { period: Period; deadline: string }, today: string, lagging: { user_id: string; pending: number }[]): NotifyInput[];
  export function overdueNotifications(period: Period, lagging: Lagging[], approverIds: string[]): NotifyInput[];
  export function tashkentHour(at: Date): number;
  // worker/daily.ts
  export async function runDaily(db: DbLike, at: Date): Promise<string[]>; // id новых строк
  export async function approverUserIds(db: DbLike): Promise<string[]>;    // users.status active, роль активна, право kpi.approve активно
  export async function activeUserIds(db: DbLike, ids: string[]): Promise<Set<string>>;
  ```

Алгоритм `dailyTargets` (тесты ниже его фиксируют):
```
today = tashkentDay(at)
P = currentReviewPeriod(at, rd)
remind = reminderFrom(P, rd, before) <= at <= reviewDeadline(P, rd) ? { period: P, deadline: reviewDeadline(P, rd).toISOString() } : null
yesterday = at − 24 ч; Q = addMonths(periodOf(yesterday), −1)
overdue = tashkentDay(reviewDeadline(Q, rd)) === tashkentDay(yesterday) ? { period: Q } : null
```
Через «вчера» сводка не теряется, когда срок — последний день месяца (28 февраля → 1 марта).

`remindNotifications`: для `pending > 0` — `{ recipient_kind: "user", user_id, kind: "remind_evaluate", payload: { period, pending, deadline }, dedupe_key: "remind:<user_id>:<today>" }`. `overdueNotifications`: каждому из `approverIds` — `kind: "overdue_summary"`, `payload: { period, lagging: lagging.slice(0, 100).map(({ user_name, pending }) => …), lagging_total: lagging.length }`, `dedupe_key: "overdue:<period>:<user_id>"`.

`runDaily`: `loadSettings` → `dailyTargets`. Для `remind`: `laggingEvaluators` по месяцу напоминания, отбор через `activeUserIds`. Для `overdue`: `laggingEvaluators` по его месяцу (с заблокированными: HR должен видеть всех) и `approverUserIds`. Затем `enqueue` каждой строки. Повторный запуск в тот же день ничего не добавляет: срабатывают ключи dedupe.

`cron/kpi_worker.ts` повторяет каркас `cron/tickets_worker.ts` с такими отличиями:
- импортирует только `bullmq` (`Queue`, `Worker`, `DelayedError`, тип `Job`), `drizzleDb` из `@backend/lib/db` и функции KPI; `drizzle-orm` не импортирует;
- без `KPI_BOT_TOKEN` не завершается: `api = botApi()` равен `null`, строки получают `skipped`, в лог одна строка-предупреждение;
- `upsertJobScheduler(KPI_SWEEP_JOB, { pattern: "* * * * *" }, { name: KPI_SWEEP_JOB, opts: schedulerJobOptions })` и `upsertJobScheduler(KPI_DAILY_JOB, { pattern: "0 10 * * *", tz: "Asia/Tashkent" }, { name: KPI_DAILY_JOB, opts: schedulerJobOptions })`;
- задача `deliver`: `deliverOne(drizzleDb, job.data.notificationId, { api, lastAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) })`. `retry` с `retryAfterMs` превращается в `job.moveToDelayed(Date.now() + ms, token)` и `throw new DelayedError()`, `retry` без паузы — в `throw new Error(error)`. Прочие исходы возвращаются как результат;
- подметалка: `pendingIds(drizzleDb, 60, 200)` → `queue.add(KPI_DELIVER_JOB, { notificationId }, { ...deliverJobOptions, jobId })`; `stuckSendingCount(drizzleDb, 15) > 0` → `console.warn`, статус не трогается;
- ежедневная задача: `runDaily(drizzleDb, new Date())` → постановка `deliver` для каждого id;
- при старте, если `tashkentHour(new Date()) >= 10`, ежедневная задача запускается сразу (догоняет пропущенные 10:00; повторы гасит dedupe);
- `concurrency: 5`, `limiter: { max: 25, duration: 1000 }`, корректное завершение по `SIGTERM`/`SIGINT`, лог `kpi worker started (queue <name>, token: есть|нет)`.

Запись в `cron/pm2.config.js` (в конец `apps`):
```js
{
  name: "office_kpi_worker",
  script: "kpi_worker.ts",
  interpreter: "bun",
  // Как у office_tickets_worker: SIGTERM должен успеть дождаться вызова Telegram.
  kill_timeout: 10000,
},
```

- [ ] **Step 1: Написать `worker/daily-plan.test.ts`**

```ts
import { describe, expect, it } from "bun:test";
import { dailyTargets, overdueNotifications, remindNotifications, tashkentHour } from "./daily-plan";

const S = { review_deadline_day: 7, reminder_days_before: 7 };
const at = (s: string) => new Date(s);
const OCT = { period: "2026-10-01", deadline: "2026-11-07T18:59:59.999Z" };

describe("dailyTargets", () => {
  it("до окна — ничего", () => {
    expect(dailyTargets(at("2026-10-30T10:00:00+05:00"), S)).toEqual({ today: "2026-10-30", remind: null, overdue: null });
  });
  it("окно с 31 октября по 7 ноября включительно", () => {
    for (const d of ["2026-10-31", "2026-11-03", "2026-11-07"]) expect(dailyTargets(at(`${d}T10:00:00+05:00`), S).remind).toEqual(OCT);
  });
  it("8 ноября — только сводка за октябрь, 9 ноября — ничего", () => {
    expect(dailyTargets(at("2026-11-08T10:00:00+05:00"), S)).toEqual({ today: "2026-11-08", remind: null, overdue: { period: "2026-10-01" } });
    expect(dailyTargets(at("2026-11-09T10:00:00+05:00"), S)).toEqual({ today: "2026-11-09", remind: null, overdue: null });
  });
  it("граница суток по Ташкенту, а не по UTC", () => {
    expect(dailyTargets(at("2026-11-07T18:30:00Z"), S).remind).toEqual(OCT);
    expect(dailyTargets(at("2026-11-07T19:30:00Z"), S)).toEqual({ today: "2026-11-08", remind: null, overdue: { period: "2026-10-01" } });
  });
  it("reminder_days_before = 0 — только в день срока", () => {
    const s0 = { review_deadline_day: 7, reminder_days_before: 0 };
    expect(dailyTargets(at("2026-11-06T10:00:00+05:00"), s0).remind).toBeNull();
    expect(dailyTargets(at("2026-11-07T10:00:00+05:00"), s0).remind).toEqual(OCT);
  });
  it("срок 28-го: январь напоминает 28 февраля, сводка 1 марта", () => {
    const s28 = { review_deadline_day: 28, reminder_days_before: 7 };
    expect(dailyTargets(at("2027-02-28T10:00:00+05:00"), s28).remind).toEqual({ period: "2027-01-01", deadline: "2027-02-28T18:59:59.999Z" });
    expect(dailyTargets(at("2027-03-01T10:00:00+05:00"), s28)).toEqual({ today: "2027-03-01", remind: null, overdue: { period: "2027-01-01" } });
  });
});

describe("строки уведомлений", () => {
  it("напоминание только при pending > 0, ключ с датой", () => {
    expect(remindNotifications(OCT, "2026-11-05", [{ user_id: "u1", pending: 3 }, { user_id: "u2", pending: 0 }])).toEqual([
      { recipient_kind: "user", user_id: "u1", kind: "remind_evaluate", payload: { period: "2026-10-01", pending: 3, deadline: "2026-11-07T18:59:59.999Z" }, dedupe_key: "remind:u1:2026-11-05" },
    ]);
  });
  it("сводка — каждому HR одна за месяц, список до 100", () => {
    const lag = [{ user_id: "u1", user_name: "Тест Оценщик", pending: 2 }];
    expect(overdueNotifications("2026-10-01", lag, ["h1", "h2"])).toEqual(["h1", "h2"].map((h) => ({
      recipient_kind: "user", user_id: h, kind: "overdue_summary",
      payload: { period: "2026-10-01", lagging: [{ user_name: "Тест Оценщик", pending: 2 }], lagging_total: 1 },
      dedupe_key: `overdue:2026-10-01:${h}`,
    })));
    expect(overdueNotifications("2026-10-01", lag, [])).toEqual([]);
    const many = Array.from({ length: 150 }, (_, i) => ({ user_id: `u${i}`, user_name: `Тест ${i}`, pending: 1 }));
    const p = overdueNotifications("2026-10-01", many, ["h1"])[0].payload as { lagging: unknown[]; lagging_total: number };
    expect([p.lagging.length, p.lagging_total]).toEqual([100, 150]);
  });
  it("tashkentHour", () => {
    expect([tashkentHour(at("2026-11-05T04:59:00Z")), tashkentHour(at("2026-11-05T05:00:00Z")), tashkentHour(at("2026-11-05T19:00:00Z"))]).toEqual([9, 10, 0]);
  });
});
```

- [ ] **Step 2: Написать `http/daily.test.ts`**

```ts
it("напоминание: раз в день, только активному оценщику с неоценёнными", async () => {
  const ev = await makeUser(db);
  const blocked = await makeUser(db, { status: "blocked" });
  const e = await makeEmployee(db, { role_code: "cook" });
  await makeScope(db, ev.id, { terminal_id: e.terminal_id });
  await makeScope(db, blocked.id, { terminal_id: e.terminal_id });
  const ids = await runDaily(db, new Date("2025-11-05T10:00:00+05:00"));
  const rows = await db.select().from(kpi_notifications).where(eq(kpi_notifications.kind, "remind_evaluate"));
  const mine = rows.filter((r) => r.user_id === ev.id);
  expect(mine.map((r) => [r.dedupe_key, r.payload])).toEqual([[`remind:${ev.id}:2025-11-05`, { period: "2025-10-01", pending: 1, deadline: "2025-11-07T18:59:59.999Z" }]]);
  expect(ids).toContain(mine[0].id);
  expect(rows.some((r) => r.user_id === blocked.id)).toBe(false);
  expect(await runDaily(db, new Date("2025-11-05T15:00:00+05:00"))).toEqual([]);
});

it("на следующий день после срока: сводка активному HR, напоминаний нет", async () => {
  const hr = await makeUser(db, { perms: ["kpi.approve"] });
  const hrBlocked = await makeUser(db, { perms: ["kpi.approve"], status: "blocked" });
  const ids = await runDaily(db, new Date("2025-11-08T10:00:00+05:00"));
  const [s] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `overdue:2025-10-01:${hr.id}`));
  expect(s.kind).toBe("overdue_summary");
  expect((s.payload as any).lagging).toContainEqual({ user_name: "Тест Оценщик", pending: 1 });
  expect(ids).toContain(s.id);
  const all = await db.select().from(kpi_notifications);
  expect(all.some((r) => r.dedupe_key === `overdue:2025-10-01:${hrBlocked.id}`)).toBe(false);
  expect(all.some((r) => r.dedupe_key.startsWith("remind:") && r.dedupe_key.endsWith(":2025-11-08"))).toBe(false);
});
```
Второй тест опирается на оценщика и сотрудника первого: в файле они идут по порядку, `cleanupKpi` только в `beforeAll` и `afterAll`.

- [ ] **Step 3: Run** `bun test src/modules/kpi/worker` и `bun run test:http:kpi` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 4: Вынести `laggingEvaluators` в `periods.ts`** (`periodSummary` зовёт его со своими `netRows`) **и реализовать `daily-plan.ts`, `daily.ts`.**
- [ ] **Step 5: Run** оба набора — Expected: PASS всё, включая сводку месяца плана 1 (`lagging` не изменился).
- [ ] **Step 6: Написать `cron/kpi_worker.ts` и запись PM2.** Проверка типов `cron` из Global Constraints — пусто.
- [ ] **Step 7: Дымовой прогон процесса на тестовой базе и отдельной очереди**

```bash
cd /Users/macbookpro/development/managers-kpi/cron
DATABASE_URL="$TEST_DATABASE_URL" PROJECT_PREFIX=managers_test_ KPI_NOTIFY_QUEUE=kpi_notify_smoke \
  bun -e 'const p = Bun.spawn(["bun", "kpi_worker.ts"], { stdout: "inherit", stderr: "inherit", env: process.env }); await Bun.sleep(15000); p.kill("SIGTERM"); console.log("exit", await p.exited)'
cd ../backend && bun -e 'import { Queue } from "bullmq"; const q = new Queue("kpi_notify_smoke", { connection: { host: process.env.REDIS_HOST ?? "localhost", port: 6379 } }); await q.obliterate({ force: true }); await q.close()'
```
Expected: строка `kpi worker started (queue kpi_notify_smoke, token: нет)`, без стектрейсов, после `SIGTERM` — сообщение о закрытии и `exit 0`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/kpi/periods.ts backend/src/modules/kpi/worker/daily-plan.ts backend/src/modules/kpi/worker/daily-plan.test.ts backend/src/modules/kpi/worker/daily.ts backend/src/modules/kpi/http/daily.test.ts cron/kpi_worker.ts cron/pm2.config.js
git commit -m "feat(kpi): воркер office_kpi_worker — доставка, напоминания оценщикам, сводка HR"
```

---

### Task 7: Вебхук бота и заметки к деплою

**Files:**
- Create: `backend/src/modules/kpi/tg/bot.ts`, `backend/src/modules/kpi/routes/bot.ts`, `backend/src/modules/kpi/http/bot.test.ts`, `docs/superpowers/kpi-deploy.md` (если файла нет; иначе дописать раздел)
- Modify: `backend/src/modules/kpi/controller.ts`; `disputes.ts` — только если тест покажет, что `openDispute` с `employee_actor` пишет `actor.userId` в uuid-колонку

**Interfaces:**
- Consumes: `parseUpdate`, `secretOk`, `botText`, `LANG_KEYBOARD`, `myEmployeeText`, `myUserText` (задача 2); `BotApi`, `botApi`, `collectDeliveries` (задача 3); `redeemInvite`, `bindingOf`, `setLang` (задача 4); `laggingEvaluators` (задача 6); `openDispute` (план 1); `loadSettings`, `disputeDeadline`, `currentReviewPeriod`, `reviewDeadline`, `periodOf`, `now`.
- Produces:
  ```ts
  // tg/bot.ts
  export const DISPUTE_STATE_TTL = 900;
  export function disputeStateKey(chatId: number): string;   // `${PROJECT_PREFIX}kpi_tg_dispute:${chatId}`
  export async function handleUpdate(u: BotUpdate, deps: { db: DrizzleDB; redis: Redis; api: BotApi }): Promise<void>; // Redis из ioredis
  ```
- Роут `POST /kpi/bot/webhook`, `body: t.Any()`, без макросов прав:
  1. Нет `KPI_WEBHOOK_SECRET` — `console.error` и `{ ok: true }` (как у tickets: Telegram не должен копить повторы из-за нашей конфигурации).
  2. `!secretOk(headers["x-telegram-bot-api-secret-token"], secret)` — 401 `{ ok: false }`.
  3. Всё дальнейшее под `try/catch` с `console.error`. `parseUpdate`; `ignore` — сразу `{ ok: true }`; `botApi()` равен `null` — `console.error` и `{ ok: true }`; иначе `collectDeliveries(() => handleUpdate(u, { db: drizzle, redis, api }))`.
  4. Ответ всегда `{ ok: true }` со статусом 200.

Поведение `handleUpdate` («привязка» = `bindingOf(fromId)`, ответы уходят в `chatId`):

| Апдейт | Действие |
|---|---|
| `start` с `token` | `redeemInvite`: `bound` или `already` → `start_ok` с `LANG_KEYBOARD`; `invalid` → `start_bad` |
| `start` без `token`, `hasPayload` | `start_bad` |
| `start` без аргумента | привязка есть → `already_bound`, нет → `not_bound` |
| кнопка `lang` | `answerCallback`; `setLang` вернул привязку → `lang_set` на новом языке, иначе `not_bound` |
| кнопка `dispute` | `answerCallback`. Привязка не к сотруднику → `not_bound`. Владелец предмета (`kpi_reviews` или `kpi_violations` по id: `employee_id`, `period`) не тот сотрудник → `err_unavailable`. `now() > disputeDeadline(period, dispute_deadline_day)` → `err_window`. Иначе в Redis кладётся `{subject_type, subject_id, employee_id}` с `EX DISPUTE_STATE_TTL` и уходит `ask_reason` (`min = change_comment_min`) с `reply_markup: { force_reply: true }` |
| кнопка `unknown` | только `answerCallback` |
| `my` | нет привязки → `not_bound`. Сотрудник → `myEmployeeText`: 3 последние `submitted`-оценки по `period desc` и активные нарушения месяца `periodOf(now())` по `occurred_at` (название: снимок `item_title_ru`, узбекское — из `kpi_card_items.title_uz`). Пользователь → `myUserText` по `currentReviewPeriod` и своей строке `laggingEvaluators` (нет строки — 0) |
| `help` | привязка есть → `help`, нет → `not_bound` |
| `text` без состояния | как `help` |
| `text` с состоянием | Привязка не к тому же сотруднику или владелец предмета сменился → удалить состояние, `err_unavailable`. Иначе `openDispute(db, TG_ACTOR, { subject_type, subject_id, reason: text, via: "telegram", employee_actor: true })` с `TG_ACTOR = { userId: "", perms: new Set(), isHq: false, terminals: [] }`. Успех → удалить состояние, `dispute_ok`. `KpiError` `comment_required` → `err_short`, состояние живёт. `dispute_window_closed` → `err_window`, `dispute_exists` → `err_exists`, `period_closed` → `err_closed`, `not_submitted`/`already_cancelled`/`not_found`/`out_of_scope`/`forbidden` → `err_unavailable`, прочее → `err_generic`. Во всех этих случаях состояние удаляется |

Язык ответа — `lang` привязки, без привязки — русский (двуязычные тексты от языка не зависят).

- [ ] **Step 1: Написать `http/bot.test.ts`** (guard; `setup`; `cleanupKpi` до и после; свой `new Redis()` для проверки состояния, `quit()` в `afterAll`; `setTestBotApi(null)` и `setNow(null)` в `afterAll`; `cookItems` и id карты повара — из `GET /api/kpi/cards`, как в `reviews.test.ts`)

```ts
const SECRET = process.env.KPI_WEBHOOK_SECRET!;
const P10 = "2025-10-01";
const hook = (update: unknown, secret: string | null = SECRET) => callApi("/api/kpi/bot/webhook", {
  method: "POST",
  headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
  body: JSON.stringify(update),
});
const say = (tg: number, text: string, type = "private") =>
  ({ update_id: 1, message: { message_id: 1, chat: { id: tg, type }, from: { id: tg, is_bot: false }, text } });
const press = (tg: number, data: string) =>
  ({ update_id: 2, callback_query: { id: `cb-${tg}`, from: { id: tg, is_bot: false }, data, message: { message_id: 2, chat: { id: tg, type: "private" } } } });
let f: ReturnType<typeof fakeBotApi>;
beforeEach(() => { f = fakeBotApi(); setTestBotApi(f.api); });
const last = () => f.sent.at(-1)!.msg;

async function submittedReview() {
  setNow("2025-10-25T10:00:00+05:00");
  const e = await makeEmployee(db, { role_code: "cook" });
  const ev = await withSession({ permissions: ["kpi.evaluate"] });
  await makeScope(db, ev.userId, { terminal_id: e.terminal_id });
  const d = await api(ev, "PUT", "/api/kpi/reviews/draft", { period: P10, employee_id: e.id, items: cookItems.slice(1).map((item_id) => ({ item_id, score: 100 })) });
  await api(ev, "POST", `/api/kpi/reviews/${d.body.review.id}/submit`, {});
  return { reviewId: d.body.review.id as string, employee: e, evaluatorId: ev.userId };
}

it("секрет: без заголовка и чужой — 401; без KPI_WEBHOOK_SECRET — 200 и тишина", async () => {
  expect((await hook(say(1, "/my"), null)).status).toBe(401);
  expect((await hook(say(1, "/my"), "wrong")).status).toBe(401);
  delete process.env.KPI_WEBHOOK_SECRET;
  try { expect((await hook(say(1, "/my"))).status).toBe(200); } finally { process.env.KPI_WEBHOOK_SECRET = SECRET; }
  expect(f.sent).toHaveLength(0);
});

it("/start по приглашению: привязка и выбор языка; повтор апдейта — снова «Готово!»; чужой телефон — недействительно", async () => {
  setNow("2025-10-25T10:00:00+05:00");
  const e = await makeEmployee(db); const hr = await makeUser(db);
  const inv = await createInvite(db, hr.id, { employee_id: e.id });
  const tg = newTelegramId();
  expect((await hook(say(tg, `/start kpi_${inv.token}`))).status).toBe(200);
  expect(last().text).toContain("Готово!");
  expect(last().reply_markup).toEqual(LANG_KEYBOARD);
  await hook(say(tg, `/start kpi_${inv.token}`));
  expect(last().text).toContain("Готово!");
  const rows = await db.select().from(kpi_tg_bindings).where(eq(kpi_tg_bindings.telegram_id, tg));
  expect(rows.map((r) => [r.employee_id, r.active, r.lang])).toEqual([[e.id, true, "ru"]]);
  await hook(say(newTelegramId(), `/start kpi_${inv.token}`));
  expect(last().text).toContain("Ссылка недействительна");
});

it("просроченное приглашение и /start без кода", async () => {
  setNow("2025-10-25T10:00:00+05:00");
  const e = await makeEmployee(db); const hr = await makeUser(db);
  const inv = await createInvite(db, hr.id, { employee_id: e.id });
  setNow("2025-11-02T10:00:00+05:00");
  const tg = newTelegramId();
  await hook(say(tg, `/start kpi_${inv.token}`));
  expect(last().text).toContain("Ссылка недействительна");
  await hook(say(tg, "/start"));
  expect(last().text).toContain("Этот чат не подключён");
});

it("язык: lang:uz сохраняется, ответ по-узбекски", async () => {
  const e = await makeEmployee(db); const b = await bindTelegram(db, { employee_id: e.id });
  await hook(press(b.telegram_id, "lang:uz"));
  expect(f.answered).toContain(`cb-${b.telegram_id}`);
  expect(last().text).toBe("Til: oʻzbekcha. /my buyrugʻi — qisqacha maʼlumot.");
  expect((await bindingOf(db, b.telegram_id))?.lang).toBe("uz");
});

it("/my сотрудника: три последние оценки и нарушения текущего месяца", async () => {
  setNow("2025-11-05T10:00:00+05:00");
  const e = await makeEmployee(db, { role_code: "cook" }); const b = await bindTelegram(db, { employee_id: e.id });
  const base = { employee_id: e.id, terminal_id: e.terminal_id, card_id: cookCardId, evaluator_user_id: randomUUID(), status: "submitted", submitted_at: "2025-11-01T05:00:00.000Z" };
  await db.insert(kpi_reviews).values([["2025-07-01", "70.00"], ["2025-08-01", "80.00"], ["2025-09-01", "90.00"], ["2025-10-01", "83.33"]].map(([period, score_pct]) => ({ ...base, period, score_pct })));
  const v = { terminal_id: e.terminal_id, employee_id: e.id, card_item_id: null, item_title_ru: null, comment: "Тест", recorded_by: randomUUID() };
  await db.insert(kpi_violations).values([
    { ...v, period: "2025-11-01", occurred_at: "2025-11-03T05:00:00.000Z", status: "active" },
    { ...v, period: "2025-11-01", occurred_at: "2025-11-04T05:00:00.000Z", status: "cancelled" },
    { ...v, period: "2025-10-01", occurred_at: "2025-10-20T05:00:00.000Z", status: "active" },
  ]);
  await hook(say(b.telegram_id, "/my"));
  expect(last().text).toBe("<b>Ваши оценки</b>\n• октябрь 2025 — 83,33 %\n• сентябрь 2025 — 90 %\n• август 2025 — 80 %\n\n<b>Нарушения в этом месяце</b>\n• 03.11.2025 без пункта карты");
});

it("/my оценщика: сколько ждут оценки", async () => {
  setNow("2025-11-05T10:00:00+05:00");
  const ev = await makeUser(db); const e = await makeEmployee(db, { role_code: "cook" });
  await makeScope(db, ev.id, { terminal_id: e.terminal_id });
  const b = await bindTelegram(db, { user_id: ev.id });
  await hook(say(b.telegram_id, "/my"));
  expect(last().text).toBe("<b>Оценки за октябрь 2025</b>\nЖдут вашей оценки: 1 сотрудник.\nСрок: 07.11.2025 23:59.");
});

it("спор из бота: кнопка → короткая причина → причина → спор opened_via telegram; повтор текста — подсказка", async () => {
  const { reviewId, employee, evaluatorId } = await submittedReview();
  const b = await bindTelegram(db, { employee_id: employee.id });
  setNow("2025-11-05T10:00:00+05:00");
  await hook(press(b.telegram_id, `dispute:review:${reviewId}`));
  expect(f.answered).toContain(`cb-${b.telegram_id}`);
  expect(last()).toEqual({ text: "Напишите причину спора ответом на это сообщение, не короче 5 символов. Ждём 15 минут.", reply_markup: { force_reply: true } });
  await hook(say(b.telegram_id, "нет"));
  expect(last().text).toContain("Причина слишком короткая");
  expect(await redis.get(disputeStateKey(b.telegram_id))).not.toBeNull();
  await hook(say(b.telegram_id, "Не согласен с баллом за чистоту"));
  expect(last().text).toBe("Спор открыт. Решение придёт сюда.");
  const ds = await db.select().from(kpi_disputes).where(eq(kpi_disputes.subject_id, reviewId));
  expect(ds.map((d) => [d.opened_via, d.opened_by_user_id, d.status, d.reason])).toEqual([["telegram", null, "open", "Не согласен с баллом за чистоту"]]);
  const [n] = await db.select().from(kpi_notifications).where(and(eq(kpi_notifications.kind, "dispute_opened"), eq(kpi_notifications.user_id, evaluatorId)));
  expect(n.payload).toMatchObject({ subject_type: "review", subject_id: reviewId, period: P10, reason: "Не согласен с баллом за чистоту" });
  expect(await redis.get(disputeStateKey(b.telegram_id))).toBeNull();
  await hook(say(b.telegram_id, "Не согласен с баллом за чистоту"));
  expect(last().text).toBe("Команда /my — ваша сводка.");
  await hook(press(b.telegram_id, `dispute:review:${reviewId}`));
  await hook(say(b.telegram_id, "Всё ещё не согласен"));
  expect(last().text).toBe("Спор по этой записи уже открыт.");
  expect(await db.select().from(kpi_disputes).where(eq(kpi_disputes.subject_id, reviewId))).toHaveLength(1);
});

it("чужая оценка и смена привязки между кнопкой и причиной — «нельзя оспорить»", async () => {
  const { reviewId, employee } = await submittedReview();
  setNow("2025-11-05T10:00:00+05:00");
  const stranger = await makeEmployee(db); const s = await bindTelegram(db, { employee_id: stranger.id });
  await hook(press(s.telegram_id, `dispute:review:${reviewId}`));
  expect(last().text).toBe("Эту запись оспорить нельзя.");
  expect(await redis.get(disputeStateKey(s.telegram_id))).toBeNull();
  const b = await bindTelegram(db, { employee_id: employee.id });
  await hook(press(b.telegram_id, `dispute:review:${reviewId}`));
  // привязку сменили; сначала гасим старую привязку stranger, иначе сработает частичный уникальный индекс
  await db.update(kpi_tg_bindings).set({ active: false }).where(eq(kpi_tg_bindings.id, s.id));
  await db.update(kpi_tg_bindings).set({ employee_id: stranger.id }).where(eq(kpi_tg_bindings.id, b.id));
  await hook(say(b.telegram_id, "Не согласен с баллом за чистоту"));
  expect(last().text).toBe("Эту запись оспорить нельзя.");
  expect(await db.select().from(kpi_disputes).where(eq(kpi_disputes.subject_id, reviewId))).toHaveLength(0);
});

it("после срока споров — «срок прошёл», состояния нет", async () => {
  const { reviewId, employee } = await submittedReview();
  const b = await bindTelegram(db, { employee_id: employee.id });
  setNow("2025-11-11T10:00:00+05:00");
  await hook(press(b.telegram_id, `dispute:review:${reviewId}`));
  expect(last().text).toBe("Срок споров за этот месяц прошёл.");
  expect(await redis.get(disputeStateKey(b.telegram_id))).toBeNull();
});

it("группа — тишина; исключение в отправке — всё равно 200", async () => {
  const e = await makeEmployee(db); const b = await bindTelegram(db, { employee_id: e.id });
  expect((await hook(say(b.telegram_id, "/my", "group"))).status).toBe(200);
  expect(f.sent).toHaveLength(0);
  setTestBotApi({ send: async () => { throw new Error("boom"); }, answerCallback: async () => ({ ok: true, message_id: null }) });
  expect((await hook(say(b.telegram_id, "/my"))).status).toBe(200);
});
```

- [ ] **Step 2: Run** `bun run test:http:kpi` — Expected: FAIL (404 на вебхук).
- [ ] **Step 3: Реализовать `tg/bot.ts`, `routes/bot.ts`; `.use(botRoutes)` в `controller.ts`.** Если спор из бота падает на `invalid input syntax for type uuid: ""`, в `openDispute` при `employee_actor: true` писать `opened_by_user_id = null`, `actor_kind = "employee"`, `actor_user_id = null` и прогнать `disputes.test.ts`.
- [ ] **Step 4: Run** все тесты модуля (юнит и HTTP) — Expected: PASS; типы backend и cron чисты.
- [ ] **Step 5: Заметки к деплою.** В `docs/superpowers/kpi-deploy.md` раздел «Фаза 4. Telegram»:
  - BotFather: создать бота, взять токен и имя; `/setcommands`: `my - Моя сводка`; `/setjoingroups` → Disable.
  - `backend/.env`: `KPI_BOT_TOKEN`, `KPI_BOT_USERNAME` (без `@`), `KPI_WEBHOOK_SECRET` (`openssl rand -hex 32`; Telegram пускает только `A-Z a-z 0-9 _ -`). Перед дописыванием проверить `tail -c 1 .env`: файл без завершающего перевода строки склеит переменные.
  - `cron/.env`: `KPI_BOT_TOKEN`, а `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT` — те же, что у backend. `KPI_NOTIFY_QUEUE` не задавать ни там, ни там: по умолчанию обе стороны берут `kpi-notify`.
  - Миграция `00NN_kpi_telegram` вместе с остальными KPI (номер сверить с прод-`main`).
  - Вебхук:
    ```bash
    curl -sS "https://api.telegram.org/bot$KPI_BOT_TOKEN/setWebhook" \
      -d "url=https://api.office.lesailes.uz/api/kpi/bot/webhook" \
      -d "secret_token=$KPI_WEBHOOK_SECRET" \
      --data-urlencode 'allowed_updates=["message","callback_query"]'
    curl -sS "https://api.telegram.org/bot$KPI_BOT_TOKEN/getWebhookInfo"
    ```
    Префикс `/api` обязателен.
  - Воркер: `cd /home/davr/managers/cron && pm2 start pm2.config.js --only office_kpi_worker && pm2 save`; в логе `kpi worker started (queue kpi-notify, token: есть)`. Тексты и логика доставки живут в backend, поэтому после каждого деплоя backend перезапускать и `office_kpi_worker`.
  - Проверка: выдать себе приглашение в «Настройки KPI → Оценщики», пройти по ссылке, выбрать язык, отправить `/my`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/kpi/tg/bot.ts backend/src/modules/kpi/routes/bot.ts backend/src/modules/kpi/controller.ts backend/src/modules/kpi/http/bot.test.ts docs/superpowers/kpi-deploy.md
# и backend/src/modules/kpi/disputes.ts, если правился на шаге 3
git commit -m "feat(kpi): вебхук бота — привязка, язык, /my, спор из Telegram"
```

---

### Task 8: Админка — колонка «Telegram» и ссылка-приглашение

**Files:**
- Modify: `admin/lib/kpi-api.ts`, `admin/lib/kpi-api.test.ts`, `admin/lib/kpi/errors.ts`, `admin/lib/kpi/errors.test.ts`, `admin/app/[locale]/kpi/_components/use-kpi.ts` (ключи), `admin/app/[locale]/kpi/settings/_components/employees-tab.tsx`, `evaluators-tab.tsx`
- Create: `admin/lib/kpi/telegram.ts`, `admin/lib/kpi/telegram.test.ts`, `admin/app/[locale]/kpi/settings/_components/use-tg-bindings.ts`, `tg-cell.tsx`, `invite-dialog.tsx`

**Interfaces:**
- Consumes: `KpiInvite`, `TgBindingRow` из `@backend/modules/kpi/types` (задача 4); `createKpiApi`, `compact`, `call` (план 2, задача 1); `formatTashkent` (`admin/lib/kpi/format.ts`); `QRCodeSVG` из `qrcode.react` (4.2.0 установлен, тот же импорт в `passport/enrollments/_components/invite-print.tsx`).
- Produces:
  ```ts
  // admin/lib/kpi-api.ts
  export type { KpiInvite, TgBindingRow } from "@backend/modules/kpi/types";
  // в объекте createKpiApi:
  tg: {
    invite(target: { employee_id: string } | { user_id: string }): Promise<KpiInvite>;          // POST /api/kpi/invites
    bindings(q: { employee_ids?: string[]; user_ids?: string[] }): Promise<TgBindingRow[]>;      // GET, списки через запятую, пустые не уходят
    unbind(id: string): Promise<unknown>;                                                        // DELETE /api/kpi/tg/bindings/:id
  };
  // admin/lib/kpi/telegram.ts
  export function chunkIds(ids: readonly string[], size?: number): string[][];   // без повторов и пустых, по 100
  export function indexBindings(rows: readonly TgBindingRow[]): { employee: Map<string, TgBindingRow>; user: Map<string, TgBindingRow> };
  export function bindingLabel(b: TgBindingRow | undefined): string;            // "Привязан · RU" | "Привязан · UZ" | "Не привязан"
  export function inviteHint(expiresAt: string): string;
  // settings/_components
  export function useTgBindings(kind: "employee" | "user", ids: string[]): { data: Map<string, TgBindingRow> | undefined; isLoading: boolean };
  export function TgCell(props: { target: { employee_id: string } | { user_id: string }; binding: TgBindingRow | undefined; name: string }): JSX.Element;
  export function InviteDialog(props: { target: { employee_id: string } | { user_id: string }; name: string; open: boolean; onClose(): void }): JSX.Element;
  ```

Решения:
- `KPI_ERROR_TEXT` пополняется: `bad_target` — «Укажите сотрудника или пользователя», `bot_not_configured` — «Бот KPI не настроен на сервере», `too_many_ids` — «Слишком много записей в одном запросе», `bad_id` — «Неверный идентификатор».
- Ключи запросов: `qk.tgBindings(kind, ids)` = `["kpi", "tg_bindings", kind, ids.join(",")]`, сброс по префиксу `qk.tgBindingsAll` = `["kpi", "tg_bindings"]`.
- `useTgBindings`: `useQuery` с `retry: shouldRetry`, `enabled: ids.length > 0`; запросы по `chunkIds(ids)` через `Promise.all`, результат — `indexBindings(...)[kind]`.
- `TgCell`: бейдж `bindingLabel` (тон «успех» у привязанного), кнопка «Ссылка-приглашение» открывает `InviteDialog`. Если привязка есть, рядом «Отвязать»: `AlertDialog` «Отвязать Telegram у {name}? Уведомления перестанут приходить.», затем `kpiApi.tg.unbind`, сброс `qk.tgBindingsAll`, тост «Telegram отвязан».
- `InviteDialog`: ссылка не создаётся при открытии, чтобы случайное открытие не гасило уже разосланную. Кнопка «Создать ссылку» → `kpiApi.tg.invite(target)`. После ответа:
  - `QRCodeSVG` (`value = link`, `size = 200`, `marginSize = 4`, `level = "M"`);
  - ссылка в `Input readOnly` и кнопка «Скопировать» (`navigator.clipboard.writeText`, тост «Ссылка скопирована»);
  - текст `inviteHint(expires_at)`;
  - кнопка «Обновить статус» сбрасывает `qk.tgBindingsAll`.

  Ошибки — `toast.error(kpiErrorText(e))`.
- `EmployeesTab`: колонка «Telegram» перед кнопкой «Карта…», `useTgBindings("employee", rows.map((r) => r.id))`. `EvaluatorsTab`: та же колонка по `user_id` строки назначения, `useTgBindings("user", уникальные user_id)`. У нескольких назначений одного пользователя статус одинаковый.

- [ ] **Step 0: Проверить, что план 2 сделан**

```bash
cd /Users/macbookpro/development/managers-kpi/admin
for f in lib/kpi-api.ts lib/kpi-api.test.ts lib/kpi/errors.ts "app/[locale]/kpi/_components/use-kpi.ts" "app/[locale]/kpi/settings/_components/employees-tab.tsx" "app/[locale]/kpi/settings/_components/evaluators-tab.tsx"; do
  [ -f "$f" ] || echo "нет $f"
done
grep -q "export function createKpiApi" lib/kpi-api.ts || echo "нет createKpiApi"
```
Expected: пусто. Иначе остановиться и доложить. Затем снять базу типов (команда плана 2): `3` и пусто.

- [ ] **Step 1: Написать `admin/lib/kpi/telegram.test.ts`**

```ts
import { describe, expect, it } from "bun:test";
import type { TgBindingRow } from "@admin/lib/kpi-api";
import { bindingLabel, chunkIds, indexBindings, inviteHint } from "./telegram";

const row = (o: Partial<TgBindingRow>): TgBindingRow =>
  ({ id: "b1", employee_id: null, user_id: null, lang: "ru", active: true, created_at: "2025-10-25T05:00:00.000Z", ...o });

describe("telegram", () => {
  it("chunkIds: без повторов и пустых, по 100", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    expect(chunkIds([...ids, "id1", ""]).map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunkIds([])).toEqual([]);
  });
  it("indexBindings разделяет сотрудников и пользователей", () => {
    const ix = indexBindings([row({ id: "b1", employee_id: "e1" }), row({ id: "b2", user_id: "u1", lang: "uz" })]);
    expect([ix.employee.get("e1")?.id, ix.user.get("u1")?.id, ix.employee.has("u1")]).toEqual(["b1", "b2", false]);
  });
  it("bindingLabel", () => {
    expect(bindingLabel(row({ employee_id: "e1" }))).toBe("Привязан · RU");
    expect(bindingLabel(row({ employee_id: "e1", lang: "uz" }))).toBe("Привязан · UZ");
    expect(bindingLabel(undefined)).toBe("Не привязан");
  });
  it("inviteHint — срок по Ташкенту", () => {
    expect(inviteHint("2025-11-01T05:00:00.000Z")).toBe("Ссылка одноразовая, действует до 01.11.2025 10:00. Новая ссылка отменяет прежнюю.");
  });
});
```

В `admin/lib/kpi-api.test.ts` добавить в `cases`:
```ts
["tg.invite сотруднику", (a) => a.tg.invite({ employee_id: "e1" }), "POST", "/api/kpi/invites", { employee_id: "e1" }],
["tg.invite пользователю", (a) => a.tg.invite({ user_id: "u1" }), "POST", "/api/kpi/invites", { user_id: "u1" }],
["tg.bindings без пустых списков", (a) => a.tg.bindings({ employee_ids: ["e1", "e2"], user_ids: [] }), "GET", "/api/kpi/tg/bindings?employee_ids=e1%2Ce2", null],
["tg.unbind", (a) => a.tg.unbind("b1"), "DELETE", "/api/kpi/tg/bindings/b1", null],
```
В `admin/lib/kpi/errors.test.ts` к проверяемым кодам добавить `"bad_target", "bot_not_configured", "too_many_ids", "bad_id"`. Eden кодирует значения query через `encodeURIComponent`, отсюда `%2C`.

- [ ] **Step 2: Run** `cd admin && bun test ./lib/kpi ./lib/kpi-api.test.ts` — Expected: FAIL (нет `./telegram`, нет `tg`).
- [ ] **Step 3: Реализовать `lib/kpi/telegram.ts`, `tg` в `kpi-api.ts`, коды ошибок.** Run — Expected: PASS.
- [ ] **Step 4: Реализовать `use-tg-bindings.ts`, `tg-cell.tsx`, `invite-dialog.tsx`, ключи в `use-kpi.ts` и колонки во вкладках.**
- [ ] **Step 5: Проверки.** Тесты: PASS. Типы: `3` и пусто. Линт: `ESLINT_USE_FLAT_CONFIG=false ./node_modules/.bin/eslint "app/[locale]/kpi" lib/kpi lib/kpi-api.ts lib/kpi-api.test.ts` — чисто.
- [ ] **Step 6: Commit**

```bash
git add admin/lib/kpi-api.ts admin/lib/kpi-api.test.ts admin/lib/kpi/errors.ts admin/lib/kpi/errors.test.ts admin/lib/kpi/telegram.ts admin/lib/kpi/telegram.test.ts "admin/app/[locale]/kpi/_components/use-kpi.ts" "admin/app/[locale]/kpi/settings/_components/use-tg-bindings.ts" "admin/app/[locale]/kpi/settings/_components/tg-cell.tsx" "admin/app/[locale]/kpi/settings/_components/invite-dialog.tsx" "admin/app/[locale]/kpi/settings/_components/employees-tab.tsx" "admin/app/[locale]/kpi/settings/_components/evaluators-tab.tsx"
git commit -m "feat(kpi-admin): статус привязки Telegram и ссылка-приглашение с QR"
```

---

## Покрытие спеки

| Раздел спеки | Задача |
|---|---|
| 6.8 доставка `kpi_notifications`, статусы | 3, 5, 6 |
| 6.10 `kpi_tg_bindings`, `kpi_tg_invites` | 1, 4 |
| 7.1 напоминания в 10:00 с `срок − reminder_days_before` по срок, сводка HR на следующий день | 6 |
| 7.5 спор сотрудника через Telegram | 7 |
| 7.6 `raise_approved` только после утверждения | 2 (payload, текст), 5 (доставка) |
| 9 `POST /kpi/invites`, `POST /kpi/bot/webhook` | 4, 7 |
| 11 привязка, язык, сообщения, «Оспорить», `/my`, доставка, `skipped`, ежедневная задача | 2–7 |
| 10.6 привязка Telegram во вкладке «Сотрудники» (и «Оценщики») | 8 |
| 13 тексты на двух языках, HTTP-тесты | 2, 4–7 |
| 14 переменные, `setWebhook`, PM2 `office_kpi_worker` | 6, 7 |
