# KPI — План 6: мини-приложение «Мой KPI», backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend мини-приложения сотрудника: две привязки на один Telegram, вход по `initData`, сессия с перепроверкой привязки, эндпоинты `/api/kpi/tg/*` с готовыми числами для экранов, подсказка о прибавке и кнопки «Открыть» в сообщениях бота.

**Architecture:** Код живёт в `backend/src/modules/kpi/tg-app/`: чистые правила (`rules.ts`), загрузка из базы (`load.ts`, `home.ts`, `review.ts`), вход и сессия (`auth.ts`, `ctx.ts`) и файл типов без импортов (`types.ts`), который мини-приложение берёт через `import type`. Роуты собраны в плагине `routes/tg-app.ts`: публичный `POST /kpi/tg/auth`, за ним Bearer-guard `.as("scoped")`, как в паспорте стажёра. Плагин монтируется последним в `kpi/controller.ts`. Бот получает вторую привязку на тот же `telegram_id` и кнопки `web_app` на `KPI_MINIAPP_URL`.

**Tech Stack:** Bun 1.4, Elysia 1.4, Drizzle ORM 0.44.6 / drizzle-kit 0.31, PostgreSQL, ioredis, Telegram Bot API (`setChatMenuButton`, inline `web_app`), bun:test.

**Spec:** `docs/superpowers/specs/2026-10-26-kpi-employee-miniapp-design.md` (разделы 3, 5, 6, 7, 8, 11, 12). Основная спека: `docs/superpowers/specs/2026-10-25-kpi-design.md`.

Предыдущие планы: `2026-10-25-kpi-4-telegram.md` (бот, привязки, доставка; блоки Interfaces задач 2–5 и 7), `2026-10-25-kpi-1-backend-core.md` (`openDispute`, `quarterRow`, сроки). Образец входа: `backend/src/modules/passport/tg-auth.ts`, `tg-ctx.ts`, `tg-controller.ts:335-543`. Фронт мини-приложения — план 7 (`2026-10-26-kpi-7-miniapp-front.md`), он потребляет раздел «Типы ответов» этого плана как есть.

## Global Constraints

- Рабочая копия `/Users/macbookpro/development/managers-kpi`, ветка `feature/kpi`. Каталог `/Users/macbookpro/development/managers` не трогать. Git-команды — через `git -C /Users/macbookpro/development/managers-kpi`.
- Коммитить только свои файлы поимённо. `git add -A` и `git add .` запрещены. Никаких `git push`, ssh, docker, `pm2`, деплоя.
- Базу с именем `managers` не трогать: не мигрировать, не читать скриптами, не писать. Миграции и тесты идут только на `managers_tickets_test` через `TEST_DATABASE_URL`:
  ```bash
  cd backend && export TEST_DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | sed -E 's#/managers(\?.*)?$#/managers_tickets_test#')
  case "$TEST_DATABASE_URL" in *managers_tickets_test) ;; *) echo "не тестовая база"; exit 1;; esac
  ```
- Runtime — Bun. Тесты — `bun:test`.
- Регистрация модуля как у KPI: контроллер `new Elysia({ name: "@api/kpi", prefix: "/api" })` уже зарегистрирован в `backend/src/app.ts` и экспортируется `as unknown as Elysia` (иначе TS2589). Новые роуты — плагин `routes/tg-app.ts`, он подключается в `backend/src/modules/kpi/controller.ts` последним `.use(...)`. `app.ts` и `controllers.ts` не трогать.
- Комментарии в коде по-русски, как в окружающем коде.
- Статусы — `varchar`, не `pgEnum`. Ошибки — `{ error: "<code>", ...extra }` через `KpiError` и `run()` из `kpi/errors.ts`: 401 нет сессии, 403 нет доступа, 404 нет объекта, 409 конфликт, 422 ввод, 503 не настроено.
- «Сейчас» в бизнес-логике — только `now()` из `kpi/clock.ts` (`KPI_FAKE_NOW` действует лишь при `PROJECT_PREFIX=managers_test_`). Исключение: свежесть `initData` (24 часа) проверяется по `Date.now()`, как в паспорте.
- Сотрудник видит только своё. `employee_id` берётся только из сессии, ни один эндпоинт `/api/kpi/tg/*` его не принимает. Чужой и несуществующий объект неотличимы: 404 `not_found`.
- В ответах `/api/kpi/tg/*` нет `evaluator_user_id`, `recorded_by`, `actor_user_id`, имён оценщиков и авторов, комментария HR к прибавке (`kpi_raise_decisions.comment`), черновиков и балла филиала (спека, раздел 6).
- `init_data`, токен сессии и токен бота не попадают ни в логи, ни в тексты ошибок.
- `KPI_BOT_TOKEN` в скрипт `test:http:kpi` не добавлять: с ним `botApi()` без подмены ходит в настоящий Telegram. Тесты мини-приложения выставляют `process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN` в `beforeAll` и возвращают прежнее значение в `afterAll`; в `beforeEach` ставят `setTestBotApi(fakeBotApi().api)`.
- `backend/src/modules/kpi/tg-app/types.ts` не импортирует ничего: `grep -c '^import' backend/src/modules/kpi/tg-app/types.ts` печатает `0`.
- Тексты Telegram: русский и узбекский на латинице, `parse_mode: HTML`, вставки через `escapeHtml`. В узбекском `oʻ`, `gʻ` пишутся с U+02BB, тутуқ белгиси (`eʼtiroz`) — с U+02BC. ASCII-апострофа нет.
- Никаких реальных имён: «Тест Повар», «Тест Оценщик».
- Проверка типов backend: `admin/node_modules/.bin/tsc --noEmit -p backend --incremental false 2>&1 | grep modules/kpi` печатает пусто (база 2026-10-26: 0 строк). Для `cron`: `admin/node_modules/.bin/tsc --noEmit -p cron --incremental false 2>&1 | grep -e kpi_worker -e modules/kpi` пусто. Код `tg/*` и `worker/*` исполняет воркер с целью ES2021: без `.at()`, `Object.hasOwn` и прочего из ES2022+.
- Админка проверяет backend через свои типы: `cd admin && ./node_modules/.bin/tsc --noEmit -p . --incremental false 2>&1 | grep "error TS"` печатает пусто (база 2026-10-26: 0).
- Юнит-тесты: `cd backend && bun test src/modules/kpi/*.test.ts src/modules/kpi/tg src/modules/kpi/worker src/modules/kpi/tg-app`. HTTP-тесты: `cd backend && bun run test:http:kpi` (с `TEST_DATABASE_URL`). Один файл: те же переменные из `backend/package.json` и `--timeout 30000`.

## Решения плана

1. **Типы.** Новый файл `backend/src/modules/kpi/tg-app/types.ts` без единого импорта. Мини-приложение импортирует его `import type` через алиас `@backend/*`, который план 7 прописывает в своём `tsconfig.json` (`"paths": { "@backend/*": ["../backend/src/*"] }`). Почему не `kpi/types.ts`: он импортирует `./rules`, и строгий `tsc` мини-приложения (`noUncheckedIndexedAccess`) проверял бы `rules.ts` и падал на `RANGES[k]`. Почему не копия: один источник, сервис объявляет эти же типы возвращаемыми, расхождение ловит `tsc` с обеих сторон. `import type` при `verbatimModuleSyntax` стирается, Vite backend не резолвит. На проде `backend/` лежит рядом с `kpi_miniapp/` в одной копии репозитория. Из `kpi/types.ts` не реэкспортируется: админке эти типы не нужны.
2. **`verifyInitData`** импортируется из `@backend/modules/passport/tg-auth` как есть (зависит только от `crypto`). Обратная функция `signInitData` — новая, в `tg-app/init-data.ts`: ею пользуются тесты и dev-режим плана 7.
3. **Индексы привязок** по спеке буквально: `(telegram_id) where employee_id is not null` и `(telegram_id) where user_id is not null`, без `active`. На один `telegram_id` — не больше одной строки каждого вида за всё время, повторная ссылка того же вида переиспользует строку через upsert.
4. **Язык второй привязки** копируется из уже активной привязки другого вида того же `telegram_id`. Иначе руководитель, выбравший UZ, после второй ссылки получал бы оценки по-узбекски, а напоминания по-русски.
5. **Заблокированный пользователь** (`users.status <> 'active'`) с одной привязкой оценщика получает 403 `inactive`, как уволенный сотрудник.
6. **R и «квартал кончился».** `R` — месяцы квартала не раньше отчётного (`currentReviewPeriod`) без отправленной оценки. Прошлые неоценённые месяцы в `R` не входят: срок их проверки прошёл. Квартал кончился, если `addMonths(quarter_start, 2) < reportPeriod`. Отправленная оценка с `score_pct = null` (все пункты «нет данных») даёт состояние `not_rated` и не входит ни в `S`, ни в `R`.
7. **Порядок веток подсказки:** решение HR → квартал кончился → `k = 0` → `k < min` → квартал идёт. Квартал кончился при `k < min`: «Ждём решения HR», предварительно 0.
8. **«Держите уровень <месяц>»** относится ко всем оценённым месяцам квартала (`keep_periods`). При `min = 3` и `k = 2` это «октября и ноября».
9. **Квартал карточки:** квартал отчётного месяца. Если в нём нет отправленной оценки, а в прошлом квартале есть отправленная оценка или решение HR, — прошлый квартал.
10. **Главный месяц:** отчётный, если по нему есть отправленная оценка (балл может быть `null`, тогда карточка с прочерком). Иначе прошлый, если по нему есть отправленная оценка. Иначе карточки нет. Короткая карточка `pending` — только когда у отчётного месяца нет отправленной оценки. Строка «Нарушения в <месяц>» берёт месяц главной карточки, без неё — отчётный. Считаются только действующие нарушения.
11. **История:** 4 квартала всего, квартал отчётного месяца и три прошлых. Квартал показывается, если в нём есть отправленная оценка или решение. Квартал отчётного месяца показывается всегда, когда у сотрудника есть карта.
12. **Статус оценки:** открытый спор → `dispute_open`; иначе был разобранный спор → `dispute_resolved`; иначе есть событие `changed` или `hr_adjusted` → `changed`; иначе `ready`.
13. **Состояние спора:** у нарушения `cancelled` → `open` → `period_closed` → `window_closed` → `can`. У оценки — то же без `cancelled`.
14. **Черновик** в мини-приложении не существует: `GET review` и спор по черновику дают 404 `not_found`, а не 409 `not_submitted`. Это сознательно сужает «те же коды, что у `openDispute`» из раздела 7 спеки: 409 выдал бы, что черновик есть.
15. **Ссылка оценщика в админку** собирается из новой переменной `KPI_ADMIN_URL` (`http(s)://хост` без пути; хвостовой `/` срезается) плюс `/ru/kpi/reviews`. Не задана или кривая — `admin_url: null`, и клиент ссылку не рисует.
16. **Кнопка меню.** У `setChatMenuButton` нет `language_code`. Поэтому `set-menu.ts` ставит всем кнопку по умолчанию «Мой KPI», а чатам с узбекской привязкой — свою «Mening KPI». Смена языка в боте переставляет кнопку чата (в обработчике вебхука, с ожиданием). Смена языка в мини-приложении — fire-and-forget, ответ не ждёт Telegram. И там и там Telegram вызывается, только если язык действительно сменился: иначе повтор `PUT /lang` в цикле упирал бы бота в лимит Telegram (429) и задерживал все уведомления.
17. **`KPI_MINIAPP_URL`** принимается только с `https://`; хвостовой `/` дописывается. Иначе переменная считается незаданной и кнопок «Открыть» нет: Telegram отвергает `web_app` не по https, и каждое уведомление стало бы `failed` навсегда.
18. **Адреса экранов** в кнопках: `<url>#/review/YYYY-MM`, `#/violations/YYYY-MM`, `#/history`. API при этом принимает `period=YYYY-MM-01`.
19. **Сессия:** токен `randomBytes(32).toString("hex")`, ключ `${PROJECT_PREFIX}kpi_tg_session:<token>`, TTL 43 200 с. Язык ответа берётся из привязки на каждом запросе.
20. **Ничья в «Где потеряны баллы»** решается по `kpi_card_items.sort` пункта; пункт, которого в карте уже нет, идёт после остальных.
21. **Тестовые токены бота не работают вне тестов.** Оба тестовых токена лежат в репозитории (`123456:kpi-test-bot-token` здесь, `123456:kpi-smoke-dev-token` в плане 7), и кто угодно с доступом к репозиторию подписал бы ими `initData`. Чистая функция `tokenAllowed(token, projectPrefix)` отвергает токен, начинающийся с `123456:kpi-`, если `PROJECT_PREFIX` не `managers_test_` и не `managers_smoke_`; тогда вход отвечает 503 `not_configured`. Образец — `now()` в `clock.ts` и `setTestBotApi` в `bot-api.ts`, они тоже смотрят на `PROJECT_PREFIX`. Функция живёт в `tg-app/init-data.ts` рядом с `signInitData`: там нет импортов базы, и юнит-тест не тянет за собой модули KPI.
22. **Решение HR** в мини-приложении — только строка `kpi_raise_decisions` со статусом `approved` или `rejected`, и на главном экране, и в истории. Строки `proposed` и `insufficient` появляются у всех после «Рассчитать» и решением не считаются.

## Review Focus

1. Спор по чужой записи из мини-приложения. `openDispute` с `employee_actor: true` владельца не проверяет. Подставленный `subject_id` чужой оценки или нарушения должен дать 404, и строки в `kpi_disputes` быть не должно. Тест в задаче 5.
2. `KPI_MINIAPP_URL` задан как `http://…` или без схемы. Telegram отвергает такую кнопку, и все уведомления сотрудникам становятся `failed` без повторов. `miniAppUrl()` возвращает `null`, сообщение уходит без кнопки. Тест в задаче 6.
3. Сессия переживает привязку. Привязку сняли или сотрудника уволили через минуту после входа, а приложение работает ещё 12 часов. Следующий запрос должен дать 401 (или отрезать часть сотрудника у руководителя). Тест в задаче 3.
4. Черновик утекает на экран. У черновика уже есть `score_pct`; он не должен попасть ни в главный экран, ни в подсказку, ни в историю, а `GET review` по нему — 404. Тест в задаче 4.
5. Bearer-guard расползается на cookie-роуты. Подключённый не туда `.as("scoped")` потребует токен от `/api/kpi/tg/bindings` админки и от вебхука бота. Тест в задаче 3 проверяет оба.
6. Прод с тестовым токеном. Сервер, поднятый с `.env` стенда или тестов, иначе принимал бы `initData`, подписанный токеном из репозитория, для любого `telegram_id`. `tokenAllowed` (решение 21) и его юнит-тест в задаче 3.

---

## Типы ответов

Файл `backend/src/modules/kpi/tg-app/types.ts` создаётся задачей 2 ровно в этом виде; задачи 3–5 возвращают эти типы, план 7 их рисует.

```ts
// Ответы API мини-приложения «Мой KPI» (/api/kpi/tg/*). Файл без импортов:
// kpi_miniapp берёт его через import type и проверяет своим tsc.
// Периоды — "YYYY-MM-01", время — ISO 8601 UTC, проценты и суммы — числа.

export type TgLang = "ru" | "uz";
export type TgRole = "employee" | "evaluator";
export type TgItemSource = "manual" | "attendance" | "cooking_speed" | "sales_plan" | "food_cost";

export type TgErrorCode =
  | "not_configured" | "bad_init_data" | "not_bound" | "inactive" | "unauthorized"
  | "not_employee" | "bad_period" | "bad_lang" | "not_found" | "bad_subject_type"
  | "comment_required" | "dispute_window_closed" | "dispute_exists" | "period_closed" | "already_cancelled";
export interface TgError { error: TgErrorCode; min?: number }

// POST /api/kpi/tg/auth
export interface TgAuthRequest { init_data: string }
export interface TgAuthResponse { token: string; roles: TgRole[]; lang: TgLang }

// PUT /api/kpi/tg/lang
export interface TgLangRequest { lang: TgLang }
export interface TgLangResponse { lang: TgLang }

export type TgReviewStatus = "ready" | "dispute_open" | "dispute_resolved" | "changed";
export type TgDisputeState = "can" | "open" | "window_closed" | "period_closed" | "cancelled";
export interface TgDisputeInfo {
  state: TgDisputeState;
  deadline: string;          // конец окна спора
  opened_at: string | null;  // только при state = "open"
  last_resolved: { decision: "accepted" | "rejected"; comment: string | null; resolved_at: string } | null;
}

export type TgMonthState = "scored" | "pending" | "upcoming" | "not_rated";
export interface TgMonth { period: string; state: TgMonthState; score_pct: number | null; opens_at: string }

export interface TgTier { min_pct: number; amount: number } // по возрастанию min_pct
export type TgNextTier =
  | { amount: number; reachable: true; need_pct: number; periods: string[] }
  | { amount: number; reachable: false };
export type TgRaiseHint =
  | { kind: "decided"; amount: number }       // 0 — «Без прибавки»
  | { kind: "waiting_hr"; amount: number }
  | { kind: "none" }
  | { kind: "too_few"; scored: number; min_months: number; keep_periods: string[]; amount: number; next: TgNextTier | null }
  | { kind: "running"; amount: number; keep: { need_pct: number; periods: string[] } | null; next: TgNextTier | null };
export interface TgRaiseCard { quarter_start: string; tiers: TgTier[]; avg_pct: number | null; months: TgMonth[]; hint: TgRaiseHint }

export interface TgLostItem { item_id: string; title_ru: string; title_uz: string; score: number }
export interface TgMonthCard { period: string; review_id: string; score_pct: number | null; status: TgReviewStatus; dispute: TgDisputeInfo; lost: TgLostItem[] }
export interface TgPendingMonth { period: string; submit_opens_at: string; review_deadline: string; violations: number }
export interface TgEvaluatorCard { period: string; pending: number; review_deadline: string; admin_url: string | null }

export interface TgEmployeeHome {
  first_name: string;
  last_name: string;
  position_ru: string | null;
  position_uz: string | null;
  terminal_name: string | null;
  has_card: boolean;
  pending: TgPendingMonth | null;   // отчётный месяц ещё не оценён
  month: TgMonthCard | null;        // главный оценённый месяц
  raise: TgRaiseCard | null;        // null без карты
  violations: { period: string; count: number };
  has_history: boolean;
}

// GET /api/kpi/tg/home
export interface TgHome { lang: TgLang; roles: TgRole[]; evaluator: TgEvaluatorCard | null; employee: TgEmployeeHome | null }

// GET /api/kpi/tg/review?period=YYYY-MM-01
export interface TgReviewItem { item_id: string; title_ru: string; title_uz: string; group_key: "base" | "extra"; score: number | null; source: TgItemSource; note: string | null }
export interface TgReviewChange { at: string; old_score_pct: number | null; new_score_pct: number | null; comment: string | null }
export interface TgReview {
  period: string; review_id: string; score_pct: number | null; status: TgReviewStatus; submitted_at: string;
  items: TgReviewItem[];      // сначала base, потом extra; внутри по sort карты
  changes: TgReviewChange[];  // события changed и hr_adjusted по времени
  dispute: TgDisputeInfo;
  reason_min: number;         // change_comment_min
}

// GET /api/kpi/tg/violations?period=YYYY-MM-01
export interface TgViolation {
  id: string; item_title_ru: string | null; item_title_uz: string | null; occurred_at: string; comment: string;
  status: "active" | "cancelled"; cancel_reason: string | null; photo_ids: string[]; dispute: TgDisputeInfo;
}
export interface TgViolations { period: string; items: TgViolation[]; reason_min: number } // новые сверху

// GET /api/kpi/tg/history
export type TgQuarterResult = { kind: "running" } | { kind: "waiting_hr" } | { kind: "decided"; amount: number };
export interface TgHistoryQuarter { quarter_start: string; months: TgMonth[]; avg_pct: number | null; result: TgQuarterResult }
export interface TgHistory { quarters: TgHistoryQuarter[] } // новые сверху, не больше 4

// POST /api/kpi/tg/disputes
export interface TgDisputeRequest { subject_type: "review" | "violation"; subject_id: string; reason: string }
export interface TgDisputeCreated { id: string; subject_type: "review" | "violation"; subject_id: string; created_at: string }

// GET /api/kpi/tg/violation-photos/:id/file — тело: файл image/jpeg или image/png
```

| Метод и путь | 200 | Ошибки |
|---|---|---|
| `POST /api/kpi/tg/auth` | `TgAuthResponse` | 503 `not_configured`, 401 `bad_init_data`, 403 `not_bound`, 403 `inactive` |
| любой роут ниже без сессии | — | 401 `unauthorized` |
| `GET /api/kpi/tg/home` | `TgHome` | — |
| `GET /api/kpi/tg/review?period=` | `TgReview` | 403 `not_employee`, 422 `bad_period`, 404 `not_found` |
| `GET /api/kpi/tg/violations?period=` | `TgViolations` | 403 `not_employee`, 422 `bad_period` |
| `GET /api/kpi/tg/violation-photos/:id/file` | файл | 403 `not_employee`, 404 `not_found` |
| `GET /api/kpi/tg/history` | `TgHistory` | 403 `not_employee` |
| `POST /api/kpi/tg/disputes` | `TgDisputeCreated` | 403 `not_employee`, 422 `bad_subject_type`, 404 `not_found`, 422 `comment_required` + `min`, 409 `dispute_window_closed` / `dispute_exists` / `period_closed` / `already_cancelled` |
| `PUT /api/kpi/tg/lang` | `TgLangResponse` | 422 `bad_lang` |

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `backend/drizzle/schema.ts` (правка) | Индексы `kpi_tg_bindings`; комментарий `opened_via` у `kpi_disputes` |
| `backend/drizzle/migrations/0040_kpi_tg_dual.sql` + `meta/` | Миграция индексов (генерирует drizzle-kit) |
| `backend/src/modules/kpi/tg/bindings.ts` (правка) | Пара привязок, погашение по виду, язык, `hasAnyActiveBinding` |
| `backend/src/modules/kpi/tg/bot.ts` (правка) | `/start` с двумя привязками, `/my` двумя текстами, кнопка «Открыть Мой KPI», меню при смене языка |
| `backend/src/modules/kpi/tg/messages.ts` (правка) | `start_ok_dual`, `joinMy`, кнопка «Открыть» у пяти видов уведомлений |
| `backend/src/modules/kpi/tg/miniapp-url.ts` | `miniAppUrl()`, `appRoute()` |
| `backend/src/modules/kpi/tg/menu.ts` + `.test.ts` | Тексты кнопки меню, `menuPlan`, `syncMenuButton` |
| `backend/src/modules/kpi/tg/set-menu.ts` | Ручной скрипт: кнопка меню по умолчанию и узбекским чатам |
| `backend/src/modules/kpi/tg/bot-api.ts` (правка) | `setMenuButton` |
| `backend/src/modules/kpi/worker/deliver.ts` (правка) | `appUrl` в контекст сообщения |
| `backend/src/modules/kpi/storage.ts` + `storage.test.ts`, `violations.ts` (правка) | `resolveUploadFile` — общая проверка пути фото для админки и мини-приложения |
| `backend/src/modules/kpi/disputes.ts`, `types.ts` (правка) | `opened_via` `"miniapp"` |
| `backend/src/modules/kpi/tg-app/types.ts` | Типы ответов (раздел выше), без импортов |
| `backend/src/modules/kpi/tg-app/rules.ts` + `.test.ts` | Чистые правила: подсказка, состояния месяцев, квартал карточки, потерянные баллы, статусы |
| `backend/src/modules/kpi/tg-app/init-data.ts` + `.test.ts` | `signInitData`, `tokenAllowed` |
| `backend/src/modules/kpi/tg-app/auth.ts`, `ctx.ts` | Вход, сессия, guard |
| `backend/src/modules/kpi/tg-app/load.ts` | Общие загрузки: отправленные оценки, споры, закрытые месяцы |
| `backend/src/modules/kpi/tg-app/home.ts` | Главный экран, история |
| `backend/src/modules/kpi/tg-app/review.ts` | Разбор оценки, нарушения, фото, спор |
| `backend/src/modules/kpi/tg-app/dev-data.ts` | Запись оценок, нарушений, споров и решений мимо правил: только тесты и smoke-seed плана 7, вне `managers_test_` и `managers_smoke_` бросает ошибку |
| `backend/src/modules/kpi/routes/tg-app.ts` | Роуты `/kpi/tg/*` мини-приложения |
| `backend/src/modules/kpi/controller.ts` (правка) | `.use(tgAppRoutes)` последним |
| `backend/src/modules/kpi/http/fixtures.ts` (правка) | `TG_TEST_BOT_TOKEN`, `tgLogin`, `tgApi`, `tgRaw`, `fakeBotApi().menus` |
| `backend/src/modules/kpi/http/tg-app-auth.test.ts`, `tg-app-home.test.ts`, `tg-app-review.test.ts` | HTTP-тесты мини-приложения |
| `backend/src/modules/kpi/http/{telegram,bot,delivery,disputes}.test.ts`, `tg/messages.test.ts` (правка) | Ожидания под две привязки и кнопки |

---

### Task 1: Две привязки на один Telegram

**Files:**
- Modify: `backend/drizzle/schema.ts` (индексы `kpi_tg_bindings`), `backend/src/modules/kpi/tg/bindings.ts`, `tg/bot.ts`, `tg/messages.ts`, `tg/messages.test.ts`, `http/telegram.test.ts`, `http/bot.test.ts`, `http/delivery.test.ts`
- Create: `backend/drizzle/migrations/0040_kpi_tg_dual.sql`, `meta/0040_snapshot.json`, правка `meta/_journal.json` (генерирует drizzle-kit)

**Interfaces:**
- Consumes: `ActiveBinding`, `redeemInvite`, `recipientOf`, `deactivateByTelegramId` (план 4, задача 4); `myEmployeeText`, `myUserText`, `botText` (план 4, задача 2).
- Produces:
  ```ts
  // tg/bindings.ts
  export type BindingPair = { employee: ActiveBinding | null; user: ActiveBinding | null };
  export function langOf(p: BindingPair): "ru" | "uz";                       // employee?.lang ?? user?.lang ?? "ru"
  export async function bindingOf(db: DbLike, telegramId: number): Promise<BindingPair>; // активные привязки активных людей
  export async function hasAnyActiveBinding(db: DbLike, telegramId: number): Promise<boolean>; // active = true, человек не проверяется
  export async function setLang(db: DbLike, telegramId: number, lang: "ru" | "uz"): Promise<BindingPair | null>; // null — нет ни одной
  export type RedeemResult =
    | { status: "bound" | "already"; name: string; dual: boolean }
    | { status: "invalid"; name: null; dual: false };
  // redeemInvite, recipientOf, deactivateByTelegramId — сигнатуры прежние
  // tg/messages.ts
  export type BotTextKey = /* прежние */ | "start_ok_dual";
  export function joinMy(parts: string[]): string; // через "\n\n", затем fitTelegram
  ```

Схема, вместо `uniqueIndex("kpi_tg_bindings_telegram_uq")`:
```ts
uniqueIndex("kpi_tg_bindings_tg_employee_uq").on(t.telegram_id).where(sql`${t.employee_id} is not null`),
uniqueIndex("kpi_tg_bindings_tg_user_uq").on(t.telegram_id).where(sql`${t.user_id} is not null`),
```
Индексы `kpi_tg_bindings_employee_active_uq`, `kpi_tg_bindings_user_active_uq` и проверка `kpi_tg_bindings_one_person` остаются.

Правила `redeemInvite` (остальное как в плане 4):
- Гашение привязок того же человека на других `telegram_id` — без изменений.
- Upsert по виду: `onConflictDoUpdate({ target: kpi_tg_bindings.telegram_id, targetWhere: sql\`employee_id is not null\` /* или user_id */, set: { employee_id /* или user_id */: id, active: true, created_at: sql\`now()\` } })`. Колонка другого вида не трогается.
- `lang` = язык активной привязки другого вида этого `telegram_id`, если она есть (решение 4), и при вставке, и при обновлении: в `set` upsert тогда входит и `lang`. Иначе переиспользованная старая строка того же вида сохраняла бы свой прежний язык, и две привязки одного Telegram расходились бы. Привязки другого вида нет — при обновлении язык строки не трогается.
- `dual` = после погашения у `telegram_id` активны обе привязки и оба человека активны. Ветка `already` тоже считает `dual`.

`start_ok_dual` (двуязычный, `lang` не влияет, `{name}` как в `start_ok`; первая строка — как в разделе 8.1 спеки, с точкой):
```
Готово. Теперь здесь и ваши оценки, и напоминания оценщика.
Tayyor. Endi bu yerda baholaringiz ham, baholovchi eslatmalari ham keladi.

Вы подключены как <b>{name}</b>. Если это не вы — сообщите HR.
Siz <b>{name}</b> sifatida ulandingiz. Agar bu siz boʻlmasangiz, HRga xabar bering.

Выберите язык / Tilni tanlang:
```

Бот (`tg/bot.ts`) на паре привязок:
- `/start` с токеном: `dual ? "start_ok_dual" : "start_ok"`, клавиатура языка. Без токена: есть хоть одна → `already_bound` на `langOf`, иначе `not_bound`.
- Кнопка языка: `setLang` → `lang_set`, `null` → `not_bound`.
- Кнопка «Оспорить» и причина спора — только при `pair.employee`, сверка владельца как раньше; у одной привязки оценщика ответ `not_bound`.
- `/my`: `joinMy([...(pair.user ? [текст оценщика] : []), ...(pair.employee ? [текст сотрудника] : [])])`, сначала оценщик.
- `help` и прочий текст — по `langOf`.

- [ ] **Step 1: Схема в согласии до правки.** Run: `cd backend && bunx drizzle-kit generate --name probe`. Expected: `No schema changes, nothing to migrate`. Иначе drizzle-kit уже записал `drizzle/migrations/*_probe.sql`, снимок и запись в `meta/_journal.json`: удалить все три, остановиться и доложить.

- [ ] **Step 2: Написать тесты.** В `http/telegram.test.ts` тест «перепривязка: один telegram — один человек; второй телефон гасит первый» заменить на:

```ts
it("на один telegram — по одной привязке каждого вида; тот же вид заменяет, другой добавляет", async () => {
  setNow("2025-10-25T10:00:00+05:00");
  const [e1, e2] = [await makeEmployee(db), await makeEmployee(db)];
  const u = await makeUser(db);
  const [t1, t2] = [newTelegramId(), newTelegramId()];
  const inv = async (t: { employee_id: string } | { user_id: string }) => (await createInvite(db, u.id, t)).token;
  expect(await redeemInvite(db, await inv({ employee_id: e1.id }), t1)).toMatchObject({ status: "bound", dual: false });
  await redeemInvite(db, await inv({ employee_id: e2.id }), t1);
  const rows = async (t: number) => (await db.select().from(kpi_tg_bindings).where(eq(kpi_tg_bindings.telegram_id, t)))
    .map((r) => [r.employee_id, r.user_id, r.active]).sort();
  expect(await rows(t1)).toEqual([[e2.id, null, true]]);
  expect(await redeemInvite(db, await inv({ user_id: u.id }), t1)).toMatchObject({ status: "bound", dual: true });
  expect(await bindingOf(db, t1)).toMatchObject({ employee: { employee_id: e2.id }, user: { user_id: u.id } });
  await redeemInvite(db, await inv({ employee_id: e2.id }), t2);           // второй телефон сотрудника
  expect(await bindingOf(db, t1)).toMatchObject({ employee: null, user: { user_id: u.id } });
});

it("вторая привязка берёт язык первой; setLang и отписка — обе", async () => {
  const e = await makeEmployee(db);
  const u = await makeUser(db);
  const b = await bindTelegram(db, { employee_id: e.id, lang: "uz" });
  await redeemInvite(db, (await createInvite(db, u.id, { user_id: u.id })).token, b.telegram_id);
  expect((await bindingOf(db, b.telegram_id)).user?.lang).toBe("uz");
  const p = await setLang(db, b.telegram_id, "ru");
  expect([p?.employee?.lang, p?.user?.lang]).toEqual(["ru", "ru"]);
  await deactivateByTelegramId(db, b.telegram_id);
  expect(await bindingOf(db, b.telegram_id)).toEqual({ employee: null, user: null });
  expect(await hasAnyActiveBinding(db, b.telegram_id)).toBe(false);
});

it("переиспользованная строка того же вида тоже берёт язык другой привязки", async () => {
  const [e1, e2] = [await makeEmployee(db), await makeEmployee(db)];
  const u = await makeUser(db);
  const old = await bindTelegram(db, { employee_id: e1.id, lang: "ru", active: false });   // прежняя строка сотрудника
  await bindTelegram(db, { user_id: u.id, telegram_id: old.telegram_id, lang: "uz" });
  await redeemInvite(db, (await createInvite(db, u.id, { employee_id: e2.id })).token, old.telegram_id);
  const rows = await db.select().from(kpi_tg_bindings).where(eq(kpi_tg_bindings.telegram_id, old.telegram_id));
  expect(rows.find((r) => r.id === old.id)).toMatchObject({ employee_id: e2.id, active: true, lang: "uz" });
});

it("индексы миграции 0040", async () => {
  const { rows } = await db.execute(sql`select indexname from pg_indexes where tablename = 'kpi_tg_bindings'`);
  const names = rows.map((x: any) => x.indexname);
  expect(names).toEqual(expect.arrayContaining(["kpi_tg_bindings_tg_employee_uq", "kpi_tg_bindings_tg_user_uq"]));
  expect(names).not.toContain("kpi_tg_bindings_telegram_uq");
});
```

  Старые ожидания в том же файле: `bindingOf(...)` `toBeNull()` → `toEqual({ employee: null, user: null })`; `toMatchObject({ employee_id })` → `toMatchObject({ employee: { employee_id } })`, для пользователя `{ user: { user_id } }`; `redeemInvite(...)` `toEqual({ status, name })` получает `dual: false`. В `http/bot.test.ts` строка `(await bindingOf(db, b.telegram_id))?.lang` → `(await bindingOf(db, b.telegram_id)).employee?.lang`, и новый тест:

```ts
it("две привязки: /start второй ссылки — «Теперь здесь и…»; /my — сначала оценщик, потом сотрудник; спор работает", async () => {
  const { reviewId, employee } = await submittedReview();          // 2025-10-25, окно спора открыто
  const u = await makeUser(db);
  const b = await bindTelegram(db, { employee_id: employee.id });
  const inv = await createInvite(db, u.id, { user_id: u.id });
  await hook(say(b.telegram_id, `/start kpi_${inv.token}`));
  expect(last().text.startsWith("Готово. Теперь здесь и ваши оценки, и напоминания оценщика.\n")).toBe(true);
  await hook(say(b.telegram_id, "/my"));
  const t = last().text;
  expect(t.indexOf("<b>Оценки за")).toBeLessThan(t.indexOf("<b>Ваши оценки</b>"));
  expect(t).toContain("\n\n<b>Ваши оценки</b>");
  await hook(press(b.telegram_id, `dispute:review:${reviewId}`));
  expect(last().text).toBe("Напишите причину спора ответом на это сообщение, не короче 5 символов. Ждём 15 минут.");
});
```

  В `http/delivery.test.ts`, тест «бот заблокирован или аккаунт удалён…»: до доставки добавить тому же `telegram_id` привязку пользователя (`bindTelegram(db, { user_id: (await makeUser(db)).id, telegram_id: b.telegram_id })`) и после доставки проверить, что у этого `telegram_id` активных строк нет. В `tg/messages.test.ts`: `botText("start_ok_dual", "uz", { name: "Тест" })` равен `ru`-варианту и не содержит ASCII-апострофа (`BOT_TEXT_KEYS` уже обходится в тесте «защита»); `joinMy(["a", "b"])` = `"a\n\nb"`.

- [ ] **Step 3: Run** `bun run test:http:kpi` и `bun test src/modules/kpi/tg` — Expected: новые тесты FAIL (нет `hasAnyActiveBinding`, `dual`, индексов).

- [ ] **Step 4: Схема и миграция.** Заменить индекс в `schema.ts`. Run: `cd backend && bunx drizzle-kit generate --name kpi_tg_dual`. Expected: файл `drizzle/migrations/0040_kpi_tg_dual.sql` ровно из трёх операторов:
  ```sql
  DROP INDEX "kpi_tg_bindings_telegram_uq";
  CREATE UNIQUE INDEX "kpi_tg_bindings_tg_employee_uq" ON "kpi_tg_bindings" USING btree ("telegram_id") WHERE "kpi_tg_bindings"."employee_id" is not null;
  CREATE UNIQUE INDEX "kpi_tg_bindings_tg_user_uq" ON "kpi_tg_bindings" USING btree ("telegram_id") WHERE "kpi_tg_bindings"."user_id" is not null;
  ```
  (разделители `--> statement-breakpoint` — как сгенерировал drizzle-kit). Поле `when` новой записи `_journal.json` больше `1792926678670` (запись `0039`). Чужая таблица в файле — остановиться и доложить. Применить: `DATABASE_URL="$TEST_DATABASE_URL" bunx drizzle-kit migrate`, затем `bunx drizzle-kit generate --name probe` → `No schema changes` (если записался `*_probe.sql` — как в шаге 1: удалить файл, снимок и запись журнала и доложить).

- [ ] **Step 5: Реализовать** `bindings.ts`, `messages.ts` (`start_ok_dual`, `joinMy`) и `bot.ts` по правилам выше.

- [ ] **Step 6: Run** юнит- и HTTP-тесты модуля — Expected: PASS всё. Типы backend и cron — пусто.

- [ ] **Step 7: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add backend/drizzle/schema.ts backend/drizzle/migrations/0040_kpi_tg_dual.sql backend/drizzle/migrations/meta/0040_snapshot.json backend/drizzle/migrations/meta/_journal.json backend/src/modules/kpi/tg/bindings.ts backend/src/modules/kpi/tg/bot.ts backend/src/modules/kpi/tg/messages.ts backend/src/modules/kpi/tg/messages.test.ts backend/src/modules/kpi/http/telegram.test.ts backend/src/modules/kpi/http/bot.test.ts backend/src/modules/kpi/http/delivery.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi): две привязки Telegram — сотрудник и оценщик на одном аккаунте"
```

---

### Task 2: Чистые правила мини-приложения и подсказка о прибавке

**Files:**
- Create: `backend/src/modules/kpi/tg-app/types.ts` (раздел «Типы ответов» дословно), `backend/src/modules/kpi/tg-app/rules.ts`, `backend/src/modules/kpi/tg-app/rules.test.ts`
- `backend/src/modules/kpi/rules.ts` не трогать: средний берётся из `quarterRow` (там `round2`), `need` считается в целых сотых, отдельный `round2` здесь не нужен.

**Interfaces:**
- Consumes: `raiseFor`, `quarterRow`, `Tier` из `../rules`; `addMonths`, `quarterStart`, `submitOpensAt`, `Period` из `../time`; типы `TgMonth`, `TgRaiseHint`, `TgNextTier`, `TgLostItem`, `TgReviewStatus`, `TgDisputeState` из `./types`.
- Produces:
  ```ts
  export function needPct(thresholdPct: number, scored: number[], remaining: number): number; // вверх до 0,1
  export function monthState(period: Period, reportPeriod: Period, at: Date, submitted: { score_pct: number | null } | null): TgMonth;
  export function quarterEnded(quarter: Period, reportPeriod: Period): boolean;   // addMonths(quarter, 2) < reportPeriod
  export function raiseHint(i: { months: TgMonth[]; tiers: Tier[]; minMonths: number; ended: boolean; decision: { amount: number } | null }): TgRaiseHint;
  export function raiseQuarter(reportPeriod: Period, has: (quarter: Period) => boolean): Period; // has: есть отправленная оценка или решение
  export function lostItems(items: { item_id: string; title_ru: string; title_uz: string; score: number | null; sort: number }[]): TgLostItem[];
  export function reviewStatusOf(f: { open: boolean; resolved: boolean; changed: boolean }): TgReviewStatus;
  export function disputeStateOf(f: { cancelled: boolean; open: boolean; periodClosed: boolean; deadline: Date; at: Date }): TgDisputeState;
  ```

Алгоритм (тела, которые сигнатуры и тесты не определяют):
```ts
// Целые сотые: никакого плавающего хвоста перед округлением вверх.
export function needPct(thresholdPct: number, scored: number[], remaining: number): number {
  const h = (x: number) => Math.round(x * 100);
  const num = h(thresholdPct) * (scored.length + remaining) - scored.reduce((a, s) => a + h(s), 0);
  return Math.ceil(num / (remaining * 10)) / 10;
}

export function raiseHint({ months, tiers, minMonths, ended, decision }): TgRaiseHint {
  if (decision) return { kind: "decided", amount: decision.amount };
  const S = months.filter((m) => m.state === "scored");
  const scores = S.map((m) => m.score_pct as number);
  const R = months.filter((m) => m.state === "pending" || m.state === "upcoming").map((m) => m.period);
  const row = quarterRow(months.map((m) => (m.state === "scored" ? m.score_pct : null)), tiers, minMonths);
  if (ended) return { kind: "waiting_hr", amount: row.suggested_amount };
  if (S.length === 0) return { kind: "none" };
  const avg = row.avg_pct as number;
  const asc = [...tiers].sort((a, b) => a.min_pct - b.min_pct);
  let cur = -1;
  asc.forEach((t, i) => { if (avg >= t.min_pct) cur = i; });
  const amount = raiseFor(avg, tiers);
  const up = asc[cur + 1];
  let next: TgNextTier | null = null;
  if (up && R.length > 0) {
    const need = needPct(up.min_pct, scores, R.length);
    next = need <= 100 ? { amount: up.amount, reachable: true, need_pct: need, periods: R } : { amount: up.amount, reachable: false };
  }
  if (S.length < minMonths) {
    return { kind: "too_few", scored: S.length, min_months: minMonths, keep_periods: S.map((m) => m.period), amount, next };
  }
  let keep: { need_pct: number; periods: string[] } | null = null;
  if (cur >= 0 && asc[cur].amount > 0 && R.length > 0) {
    const need = needPct(asc[cur].min_pct, scores, R.length);
    if (need > 0) keep = { need_pct: need, periods: R };
  }
  return { kind: "running", amount, keep, next };
}
```
`monthState`: отправленная с баллом → `scored`; отправленная без балла или `period < reportPeriod` → `not_rated`; иначе `at >= submitOpensAt(period)` → `pending`, раньше → `upcoming`. `opens_at = submitOpensAt(period).toISOString()` у всех. `raiseQuarter`: `q = quarterStart(reportPeriod)`; `!has(q) && has(addMonths(q, -3))` → прошлый, иначе `q`. `lostItems`: `score !== null && score < 100`, по возрастанию `score`, при равенстве по `sort`, первые 3, без поля `sort` в ответе.

- [ ] **Step 1: Создать `tg-app/types.ts`** из раздела «Типы ответов» дословно. Run: `grep -c '^import' backend/src/modules/kpi/tg-app/types.ts` — Expected: `0`.

- [ ] **Step 2: Написать `tg-app/rules.test.ts`**

```ts
import { describe, expect, it } from "bun:test";
import type { TgMonth } from "./types";
import { disputeStateOf, lostItems, monthState, needPct, quarterEnded, raiseHint, raiseQuarter, reviewStatusOf } from "./rules";

const T = [{ min_pct: 95, amount: 500000 }, { min_pct: 90, amount: 300000 }, { min_pct: 85, amount: 150000 }];
const m = (period: string, state: TgMonth["state"], score_pct: number | null = null): TgMonth => ({ period, state, score_pct, opens_at: "x" });
const q4 = (a: TgMonth["state"], av: number | null, b: TgMonth["state"], bv: number | null, c: TgMonth["state"], cv: number | null = null) =>
  [m("2026-10-01", a, av), m("2026-11-01", b, bv), m("2026-12-01", c, cv)];
const hint = (months: TgMonth[], o: { tiers?: typeof T; min?: number; ended?: boolean; decision?: { amount: number } | null } = {}) =>
  raiseHint({ months, tiers: o.tiers ?? T, minMonths: o.min ?? 2, ended: o.ended ?? false, decision: o.decision ?? null });

describe("needPct", () => {
  it("примеры спеки и округление вверх без плавающего хвоста", () => {
    expect(needPct(95, [90.3], 2)).toBe(97.4);
    expect(needPct(90, [90.3, 93], 1)).toBe(86.7);
    expect(needPct(95, [90.3, 93], 1)).toBe(101.7);
    expect(needPct(85, [80], 2)).toBe(87.5);
    expect(needPct(85, [80, 85.2], 1)).toBe(89.8);   // наивный Math.ceil по float даёт 89.9
    expect(needPct(95, [91.43], 2)).toBe(96.8);      // 967.85 → вверх
  });
});

describe("raiseHint", () => {
  it("макет 1: октябрь 90,3 — k=1 < min, «выйдет 300 000», для 500 000 — 97,4 за ноябрь и декабрь", () => {
    expect(hint(q4("scored", 90.3, "upcoming", null, "upcoming"))).toEqual({
      kind: "too_few", scored: 1, min_months: 2, keep_periods: ["2026-10-01"], amount: 300000,
      next: { amount: 500000, reachable: true, need_pct: 97.4, periods: ["2026-11-01", "2026-12-01"] },
    });
  });
  it("макет 2: октябрь 90,3 и ноябрь 93,0 — «сейчас 300 000», сохранится от 86,7, 500 000 недостижимо", () => {
    expect(hint(q4("scored", 90.3, "scored", 93, "upcoming"))).toEqual({
      kind: "running", amount: 300000, keep: { need_pct: 86.7, periods: ["2026-12-01"] }, next: { amount: 500000, reachable: false },
    });
  });
  it("пример спеки: 80 % — для 150 000 в среднем 87,5 за ноябрь и декабрь", () => {
    expect(hint(q4("scored", 80, "upcoming", null, "upcoming"))).toMatchObject({
      kind: "too_few", amount: 0, next: { amount: 150000, reachable: true, need_pct: 87.5, periods: ["2026-11-01", "2026-12-01"] },
    });
  });
  it("k = 0 — none", () => expect(hint(q4("pending", null, "upcoming", null, "upcoming"))).toEqual({ kind: "none" }));
  it("верхняя ступень — строки «для» нет; |R| = 0 — нет ни «для», ни «сохранится»", () => {
    expect(hint(q4("scored", 96, "scored", 97, "upcoming"))).toEqual({ kind: "running", amount: 500000, keep: { need_pct: 92, periods: ["2026-12-01"] }, next: null });
    expect(hint(q4("scored", 90.3, "scored", 93, "scored", 91))).toEqual({ kind: "running", amount: 300000, keep: null, next: null });
  });
  it("«сохранится» нет при need ≤ 0 и при нулевой ступени", () => {
    expect(hint(q4("scored", 100, "scored", 100, "upcoming"), { tiers: [{ min_pct: 50, amount: 100000 }] }))
      .toEqual({ kind: "running", amount: 100000, keep: null, next: null });                        // (150 − 200) / 1 < 0
    expect((hint(q4("scored", 80, "scored", 82, "upcoming")) as any).keep).toBeNull();              // ступени нет
  });
  it("прошлый неоценённый месяц не входит в R", () => {
    // (95 × 2 − 90,3) / 1 = 99,7; с октябрём в R было бы 97,4
    expect(hint(q4("not_rated", null, "scored", 90.3, "upcoming"))).toMatchObject({
      kind: "too_few", next: { amount: 500000, reachable: true, need_pct: 99.7, periods: ["2026-12-01"] },
    });
  });
  it("квартал кончился без решения — waiting_hr с предложением; мало месяцев — 0", () => {
    expect(hint(q4("scored", 90.3, "scored", 93, "not_rated"), { ended: true })).toEqual({ kind: "waiting_hr", amount: 300000 });
    expect(hint(q4("scored", 90.3, "not_rated", null, "not_rated"), { ended: true })).toEqual({ kind: "waiting_hr", amount: 0 });
  });
  it("решение HR важнее всего", () => {
    expect(hint(q4("scored", 90.3, "scored", 93, "upcoming"), { decision: { amount: 500000 } })).toEqual({ kind: "decided", amount: 500000 });
    expect(hint(q4("scored", 90.3, "scored", 93, "upcoming"), { ended: true, decision: { amount: 0 } })).toEqual({ kind: "decided", amount: 0 });
  });
  it("изменённые HR ступени и min = 3", () => {
    const t2 = [{ min_pct: 80, amount: 200000 }, { min_pct: 92, amount: 400000 }];
    expect(hint(q4("scored", 90.3, "upcoming", null, "upcoming"), { tiers: t2 })).toMatchObject({
      amount: 200000, next: { amount: 400000, reachable: true, need_pct: 92.9 },
    });
    expect(hint(q4("scored", 90.3, "scored", 93, "upcoming"), { min: 3 })).toMatchObject({
      kind: "too_few", scored: 2, min_months: 3, keep_periods: ["2026-10-01", "2026-11-01"],
    });
  });
});

describe("месяцы и квартал", () => {
  const at = new Date("2026-10-26T05:00:00.000Z");
  it("monthState", () => {
    expect(monthState("2026-10-01", "2026-10-01", at, { score_pct: 90.3 })).toEqual({ period: "2026-10-01", state: "scored", score_pct: 90.3, opens_at: "2026-10-19T19:00:00.000Z" });
    expect(monthState("2026-10-01", "2026-10-01", at, null).state).toBe("pending");
    expect(monthState("2026-11-01", "2026-10-01", at, null).state).toBe("upcoming");
    expect(monthState("2026-09-01", "2026-10-01", at, null).state).toBe("not_rated");
    expect(monthState("2026-10-01", "2026-10-01", at, { score_pct: null }).state).toBe("not_rated");
  });
  it("quarterEnded и raiseQuarter", () => {
    expect([quarterEnded("2026-07-01", "2026-10-01"), quarterEnded("2026-10-01", "2026-12-01")]).toEqual([true, false]);
    expect(raiseQuarter("2026-10-01", (q) => q === "2026-07-01")).toBe("2026-07-01");
    expect(raiseQuarter("2026-10-01", (q) => q === "2026-07-01" || q === "2026-10-01")).toBe("2026-10-01");
    expect(raiseQuarter("2026-10-01", () => false)).toBe("2026-10-01");
  });
});

describe("карточка месяца", () => {
  it("lostItems: ниже 100, по возрастанию, ничья по sort, до трёх", () => {
    const row = (id: string, score: number | null, sort: number) => ({ item_id: id, title_ru: id, title_uz: id, score, sort });
    expect(lostItems([row("a", 100, 10), row("b", 75, 60), row("c", null, 20), row("d", 75, 30), row("e", 90, 50), row("f", 95, 40)]).map((x) => x.item_id))
      .toEqual(["d", "b", "e"]);
    expect(lostItems([row("a", 100, 10)])).toEqual([]);
  });
  it("reviewStatusOf и disputeStateOf — порядок веток", () => {
    expect(reviewStatusOf({ open: true, resolved: true, changed: true })).toBe("dispute_open");
    expect(reviewStatusOf({ open: false, resolved: true, changed: true })).toBe("dispute_resolved");
    expect(reviewStatusOf({ open: false, resolved: false, changed: true })).toBe("changed");
    expect(reviewStatusOf({ open: false, resolved: false, changed: false })).toBe("ready");
    const d = new Date("2026-11-10T18:59:59.999Z");
    const s = (o: Partial<Parameters<typeof disputeStateOf>[0]>) =>
      disputeStateOf({ cancelled: false, open: false, periodClosed: false, deadline: d, at: new Date("2026-11-01T00:00:00Z"), ...o });
    expect([s({ cancelled: true, open: true }), s({ open: true, periodClosed: true }), s({ periodClosed: true }), s({ at: new Date("2026-11-11T00:00:00Z") }), s({})])
      .toEqual(["cancelled", "open", "period_closed", "window_closed", "can"]);
  });
});
```

  Ожидания выведены из алгоритма и примеров спеки. Расхождение в 97,4 / 86,7 / 101,7 / 87,5 — ошибка реализации, а не теста.

- [ ] **Step 3: Run** `cd backend && bun test src/modules/kpi/tg-app` — Expected: FAIL (`Cannot find module './rules'`).
- [ ] **Step 4: Реализовать** `tg-app/rules.ts`.
- [ ] **Step 5: Run** тот же тест — Expected: PASS. Типы backend — пусто.
- [ ] **Step 6: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add backend/src/modules/kpi/tg-app/types.ts backend/src/modules/kpi/tg-app/rules.ts backend/src/modules/kpi/tg-app/rules.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi): типы мини-приложения и расчёт подсказки о прибавке"
```

---

### Task 3: Вход, сессия, guard и язык

**Files:**
- Create: `backend/src/modules/kpi/tg-app/init-data.ts`, `tg-app/init-data.test.ts`, `tg-app/auth.ts`, `tg-app/ctx.ts`, `backend/src/modules/kpi/routes/tg-app.ts`, `backend/src/modules/kpi/http/tg-app-auth.test.ts`
- Modify: `backend/src/modules/kpi/controller.ts`, `backend/src/modules/kpi/http/fixtures.ts`

**Interfaces:**
- Consumes: `verifyInitData`, `INIT_DATA_MAX_AGE_SEC` из `@backend/modules/passport/tg-auth`; `bindingOf`, `hasAnyActiveBinding`, `setLang`, `langOf`, `BindingPair` (задача 1); `ctx` из `@backend/context`; `KpiError`, `run`.
- Produces:
  ```ts
  // tg-app/init-data.ts
  export function signInitData(botToken: string, o: { telegram_id: number; auth_date: number; first_name?: string }): string;
  export const TEST_BOT_TOKEN_RE = /^123456:kpi-/;          // оба тестовых токена репозитория
  export const TEST_PREFIXES = ["managers_test_", "managers_smoke_"];
  export function tokenAllowed(token: string, projectPrefix: string | undefined): boolean; // false: тестовый токен вне TEST_PREFIXES
  // tg-app/ctx.ts
  export type KpiTgSession = { telegram_id: number; employee_id: string | null; user_id: string | null; lang: "ru" | "uz" };
  export type KpiTgPrincipal = KpiTgSession;                // после перепроверки; lang — из привязки
  export const KPI_TG_SESSION_TTL_SEC = 43_200;
  export function kpiTgSessionKey(token: string): string;  // `${PROJECT_PREFIX}kpi_tg_session:${token}`
  export async function principalOf(db: DbLike, s: KpiTgSession): Promise<KpiTgPrincipal | null>;
  export function requireEmployee(p: KpiTgPrincipal): string; // employee_id или KpiError(403, "not_employee")
  export const kpiTgCtx; // Elysia, derive → { tg: KpiTgPrincipal } или 401 { error: "unauthorized" }; .as("scoped")
  // tg-app/auth.ts
  export async function authenticate(db: DbLike, redis: Redis, initData: unknown, nowSec: number): Promise<TgAuthResponse>; // ошибки — KpiError
  // routes/tg-app.ts
  export const tgAppRoutes; // new Elysia({ name: "@api/kpi/tg-app" }).use(ctx).post("/kpi/tg/auth").use(kpiTgCtx).put("/kpi/tg/lang")…
  // http/fixtures.ts
  export const TG_TEST_BOT_TOKEN = "123456:kpi-test-bot-token";
  export async function tgLogin(telegramId: number, o?: { token?: string; auth_date?: number }): Promise<{ status: number; body: any }>;
  export async function tgApi(token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  export async function tgRaw(token: string | null, path: string): Promise<Response>; // для файла фото
  ```

Правила:
- `signInitData`: поля `auth_date`, `query_id=AAAkpitest`, `user={"id":<tg>,"first_name":<имя ?? "Тест">}`; `hash` по алгоритму `verifyInitData` (секрет `HMAC_SHA256("WebAppData", token)`, строка проверки — поля по ключу через `\n`). Вывод — `URLSearchParams(...).toString()`.
- `tokenAllowed(token, prefix)`: `!TEST_BOT_TOKEN_RE.test(token) || TEST_PREFIXES.includes(prefix ?? "")`. Без импортов базы и KPI-модулей: юнит-тест импортирует `init-data.ts` без окружения.
- `authenticate`, по порядку: нет `KPI_BOT_TOKEN` → 503 `not_configured`; `!tokenAllowed(KPI_BOT_TOKEN, process.env.PROJECT_PREFIX)` → 503 `not_configured` (решение 21); `initData` не строка или `verifyInitData(..., nowSec)` не ok → 401 `bad_init_data`; `bindingOf` пуст → `hasAnyActiveBinding` ? 403 `inactive` : 403 `not_bound`; иначе сессия `{ telegram_id, employee_id: pair.employee?.employee_id ?? null, user_id: pair.user?.user_id ?? null, lang: langOf(pair) }` в Redis `SET key JSON EX 43200`; ответ `{ token, roles, lang }`, `roles` в порядке `["employee", "evaluator"]`.
- Роут `POST /kpi/tg/auth`: тело `t.Object({ init_data: t.Optional(t.Any()) })`, `nowSec = Math.floor(Date.now() / 1000)`, ответ через `run`. Ничего не логирует.
- `kpiTgCtx`: `.use(ctx).derive(...)`; токен из `authorization: Bearer <token>`; нет токена, нет ключа, мусор в Redis, сбой Redis → `status(401, { error: "unauthorized" })`. Затем `principalOf`: свежая `bindingOf`; `employee_id` остаётся, только если `pair.employee?.employee_id === s.employee_id`, `user_id` — если `pair.user?.user_id === s.user_id`; оба `null` → 401; `lang = langOf(pair)`.
- Плагин `tgAppRoutes`: `POST /kpi/tg/auth` объявлен до `.use(kpiTgCtx)`, остальные после. В `controller.ts` — `.use(tgAppRoutes)` последней строкой цепочки.
- `PUT /kpi/tg/lang` `{ lang }`: не `ru`/`uz` → 422 `bad_lang`; иначе `setLang(db, tg.telegram_id, lang)` → `{ lang }`. Кнопку меню здесь не трогать (задача 6).

- [ ] **Step 1: Написать `tg-app/init-data.test.ts`**

```ts
import { expect, it } from "bun:test";
import { verifyInitData } from "@backend/modules/passport/tg-auth";
import { signInitData, tokenAllowed } from "./init-data";

it("signInitData проходит verifyInitData тем же токеном и не проходит чужим", () => {
  const s = signInitData("123:abc", { telegram_id: 9100000001, auth_date: 1_800_000_000 });
  expect(verifyInitData(s, "123:abc", 1_800_000_100)).toEqual({ ok: true, telegramId: 9100000001, firstName: "Тест", startParam: null });
  expect(verifyInitData(s, "123:other", 1_800_000_100)).toEqual({ ok: false, error: "bad_hash" });
});

it("tokenAllowed: тестовые токены только под managers_test_ и managers_smoke_", () => {
  for (const t of ["123456:kpi-test-bot-token", "123456:kpi-smoke-dev-token"]) {
    expect([tokenAllowed(t, "managers_test_"), tokenAllowed(t, "managers_smoke_")]).toEqual([true, true]);
    expect([tokenAllowed(t, "managers_"), tokenAllowed(t, ""), tokenAllowed(t, undefined)]).toEqual([false, false, false]);
  }
  expect([tokenAllowed("7700000000:AAEexampleRealLookingToken_0123456789", "managers_"), tokenAllowed("123456:other", "managers_")])
    .toEqual([true, true]);
});
```

  Префикс в HTTP-тестах ради этой проверки не менять: все файлы `test:http:kpi` идут в одном процессе и делят одно пространство Redis.

- [ ] **Step 2: Написать `http/tg-app-auth.test.ts`** (guard и `setup` как в `bot.test.ts`; `beforeAll` — `cleanupKpi`, свой клиент `redis` (ioredis, как в `bot.test.ts`), `KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN`; `beforeEach` — `f = fakeBotApi(); setTestBotApi(f.api)`; `afterAll` — вернуть токен, `setTestBotApi(null)`, `cleanupKpi`, `sweepTestRoles`, `redis.quit()`)

```ts
const nowSec = () => Math.floor(Date.now() / 1000);

it("без KPI_BOT_TOKEN — 503 not_configured", async () => {
  delete process.env.KPI_BOT_TOKEN;
  try { expect(await tgLogin(newTelegramId())).toEqual({ status: 503, body: { error: "not_configured" } }); }
  finally { process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN; }
});

it("подпись чужим токеном, устаревшая, мусор — 401 bad_init_data", async () => {
  const tg = newTelegramId();
  expect(await tgLogin(tg, { token: "999:other" })).toEqual({ status: 401, body: { error: "bad_init_data" } });
  expect((await tgLogin(tg, { auth_date: nowSec() - 86_401 })).body).toEqual({ error: "bad_init_data" });
  for (const init_data of ["", "hash=abc", 42, null]) {
    expect((await api(null, "POST", "/api/kpi/tg/auth", { init_data })).status).toBe(401);
  }
});

it("нет привязки и снятая — 403 not_bound; уволенный и заблокированный — 403 inactive", async () => {
  expect((await tgLogin(newTelegramId())).body).toEqual({ error: "not_bound" });
  const e = await makeEmployee(db);
  const off = await bindTelegram(db, { employee_id: e.id, active: false });
  expect((await tgLogin(off.telegram_id)).body).toEqual({ error: "not_bound" });
  const fired = await makeEmployee(db, { active: false });
  expect(await tgLogin((await bindTelegram(db, { employee_id: fired.id })).telegram_id)).toEqual({ status: 403, body: { error: "inactive" } });
  const blocked = await makeUser(db, { status: "blocked" });
  expect((await tgLogin((await bindTelegram(db, { user_id: blocked.id })).telegram_id)).body).toEqual({ error: "inactive" });
});

it("сотрудник: роли, язык, сессия в Redis на 12 часов", async () => {
  const e = await makeEmployee(db);
  const b = await bindTelegram(db, { employee_id: e.id, lang: "uz" });
  const r = await tgLogin(b.telegram_id);
  expect(r.status).toBe(200);
  expect(r.body.token).toMatch(/^[0-9a-f]{64}$/);
  expect([r.body.roles, r.body.lang]).toEqual([["employee"], "uz"]);
  const key = `managers_test_kpi_tg_session:${r.body.token}`;
  expect(JSON.parse((await redis.get(key))!)).toEqual({ telegram_id: b.telegram_id, employee_id: e.id, user_id: null, lang: "uz" });
  const ttl = await redis.ttl(key);
  expect(ttl > 43_000 && ttl <= 43_200).toBe(true);
});

it("две привязки — обе роли; уволенный руководитель с живой привязкой оценщика — только evaluator", async () => {
  const e = await makeEmployee(db);
  const u = await makeUser(db);
  const b = await bindTelegram(db, { employee_id: e.id });
  await bindTelegram(db, { user_id: u.id, telegram_id: b.telegram_id });
  expect((await tgLogin(b.telegram_id)).body.roles).toEqual(["employee", "evaluator"]);
  await db.update(employees).set({ active: false }).where(eq(employees.id, e.id));
  expect((await tgLogin(b.telegram_id)).body.roles).toEqual(["evaluator"]);
});

it("guard: без токена и с чужим — 401; снятая привязка и увольнение закрывают доступ сразу", async () => {
  expect((await tgApi(null, "PUT", "/api/kpi/tg/lang", { lang: "uz" })).body).toEqual({ error: "unauthorized" });
  expect((await tgApi("f".repeat(64), "PUT", "/api/kpi/tg/lang", { lang: "uz" })).status).toBe(401);
  const e = await makeEmployee(db);
  const b = await bindTelegram(db, { employee_id: e.id });
  const token = (await tgLogin(b.telegram_id)).body.token;
  expect((await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "uz" })).status).toBe(200);
  await db.update(kpi_tg_bindings).set({ active: false }).where(eq(kpi_tg_bindings.id, b.id));
  expect((await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "ru" })).status).toBe(401);
  const e2 = await makeEmployee(db);
  const b2 = await bindTelegram(db, { employee_id: e2.id });
  const t2 = (await tgLogin(b2.telegram_id)).body.token;
  await db.update(employees).set({ active: false }).where(eq(employees.id, e2.id));
  expect((await tgApi(t2, "PUT", "/api/kpi/tg/lang", { lang: "ru" })).status).toBe(401);
});

it("язык: обе привязки, кривой — 422 bad_lang", async () => {
  const e = await makeEmployee(db);
  const u = await makeUser(db);
  const b = await bindTelegram(db, { employee_id: e.id });
  await bindTelegram(db, { user_id: u.id, telegram_id: b.telegram_id });
  const token = (await tgLogin(b.telegram_id)).body.token;
  expect(await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "uz" })).toEqual({ status: 200, body: { lang: "uz" } });
  const p = await bindingOf(db, b.telegram_id);
  expect([p.employee?.lang, p.user?.lang]).toEqual(["uz", "uz"]);
  expect((await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "en" })).body).toEqual({ error: "bad_lang" });
});

it("guard не задевает cookie-роуты и вебхук", async () => {
  const hr = await withSession({ permissions: ["kpi.manage"] });
  expect((await api(hr, "GET", `/api/kpi/tg/bindings?employee_ids=${randomUUID()}`)).status).toBe(200);
  const res = await callApi("/api/kpi/bot/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": process.env.KPI_WEBHOOK_SECRET! },
    body: JSON.stringify({ update_id: 1 }),
  });
  expect(res.status).toBe(200);
});

it("init_data и токен сессии не попадают в консоль", async () => {
  const logs: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ["log", "error", "warn"] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    const e = await makeEmployee(db);
    const b = await bindTelegram(db, { employee_id: e.id });
    const init = signInitData(TG_TEST_BOT_TOKEN, { telegram_id: b.telegram_id, auth_date: nowSec() });
    const ok = await api(null, "POST", "/api/kpi/tg/auth", { init_data: init });
    expect(ok.status).toBe(200);                                   // иначе фильтр ниже искал бы "undefined"
    await api(null, "POST", "/api/kpi/tg/auth", { init_data: init + "x" });
    const hash = new URLSearchParams(init).get("hash")!;
    expect(logs.filter((l) => l.includes(hash) || l.includes(ok.body.token))).toEqual([]);
  } finally { Object.assign(console, orig); }
});
```

- [ ] **Step 3: Run** `bun run test:http:kpi` и `bun test src/modules/kpi/tg-app` — Expected: FAIL (нет `./init-data`, 404 на `/api/kpi/tg/auth`).
- [ ] **Step 4: Реализовать** `init-data.ts`, `auth.ts`, `ctx.ts`, `routes/tg-app.ts`, фикстуры; `.use(tgAppRoutes)` последним в `controller.ts`.
- [ ] **Step 5: Run** все тесты модуля — Expected: PASS. Типы backend и админки — пусто.
- [ ] **Step 6: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add backend/src/modules/kpi/tg-app/init-data.ts backend/src/modules/kpi/tg-app/init-data.test.ts backend/src/modules/kpi/tg-app/auth.ts backend/src/modules/kpi/tg-app/ctx.ts backend/src/modules/kpi/routes/tg-app.ts backend/src/modules/kpi/controller.ts backend/src/modules/kpi/http/fixtures.ts backend/src/modules/kpi/http/tg-app-auth.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi): вход в мини-приложение по initData, сессия и смена языка"
```

---

### Task 4: Главный экран и история

**Files:**
- Create: `backend/src/modules/kpi/tg-app/load.ts`, `tg-app/home.ts`, `tg-app/dev-data.ts`, `backend/src/modules/kpi/http/tg-app-home.test.ts`
- Modify: `backend/src/modules/kpi/routes/tg-app.ts`

**Interfaces:**
- Consumes: всё из задачи 2; `kpiTgCtx`, `requireEmployee`, `KpiTgPrincipal` (задача 3); `loadSettings`, `getTiers`, `laggingEvaluators`, `loadDirectory`, `isPeriodClosed`, `currentReviewPeriod`, `reviewDeadline`, `disputeDeadline`, `submitOpensAt`, `quarterMonths`, `scorePct`, `iso`, `now`.
- Produces:
  ```ts
  // tg-app/load.ts
  export type SubmittedReview = { id: string; period: Period; score_pct: number | null; card_id: string };
  export async function submittedReviews(db: DbLike, employeeId: string, from: Period): Promise<Map<Period, SubmittedReview>>; // только status = submitted
  export async function disputeFacts(db: DbLike, type: "review" | "violation", ids: string[]):
    Promise<Map<string, { opened_at: string | null; last_resolved: TgDisputeInfo["last_resolved"] }>>;
  export async function closedPeriods(db: DbLike, periods: Period[]): Promise<Set<Period>>;
  export async function reviewDispute(db: DbLike, r: { id: string; period: Period }, at: Date, s: KpiSettings): Promise<{ dispute: TgDisputeInfo; status: TgReviewStatus }>;
  // tg-app/home.ts
  export function adminReviewsUrl(): string | null;  // KPI_ADMIN_URL (^https?://хост, хвостовой "/" срезается) + "/ru/kpi/reviews"
  export async function homeFor(db: DbLike, p: KpiTgPrincipal, at: Date): Promise<TgHome>;
  export async function historyFor(db: DbLike, employeeId: string, at: Date): Promise<TgHistory>;
  // tg-app/dev-data.ts — только тесты и smoke-seed (план 7); роуты не импортируют.
  // Каждый seed* первым делом: PROJECT_PREFIX не managers_test_ и не managers_smoke_ → throw Error("dev-data: только managers_test_ и managers_smoke_")
  export const TINY_PNG: Uint8Array;  // PNG 1×1
  export async function seedReview(db: DbLike, o: {
    employee_id: string; terminal_id: string; card_id: string; evaluator_user_id: string; period: Period;
    scores: (number | null)[];          // по активным пунктам карты в порядке sort; недостающие — null
    notes?: (string | null)[]; status?: "draft" | "submitted";
    change?: { old_score_pct: number; comment: string };   // version 2 и событие changed
  }): Promise<{ id: string; score_pct: number | null; item_ids: string[] }>;
  export async function seedViolation(db: DbLike, o: {
    employee_id: string; terminal_id: string; recorded_by: string; period: Period; occurred_at: string;
    card_item_id?: string | null; comment?: string; status?: "active" | "cancelled"; cancel_reason?: string; photo?: Uint8Array | null;
  }): Promise<{ id: string; photo_id: string | null }>;
  export async function seedDispute(db: DbLike, o: {
    subject_type: "review" | "violation"; subject_id: string; employee_id: string; period: Period;
    status?: "open" | "accepted" | "rejected"; resolution_comment?: string | null; via?: "admin" | "telegram" | "miniapp";
  }): Promise<{ id: string }>;
  export async function seedDecision(db: DbLike, o: {
    quarter_start: Period; employee_id: string; months: (number | null)[];
    status: "proposed" | "insufficient" | "approved" | "rejected"; amount?: number; comment?: string;
  }): Promise<void>;
  ```
- Роуты: `GET /kpi/tg/home` → `homeFor(drizzle, tg, now())`; `GET /kpi/tg/history` → `historyFor(drizzle, requireEmployee(tg), now())`; оба через `run`.

Сборка `homeFor` (решения 9–11, «сейчас» = `at`):
- `s = loadSettings`, `R = currentReviewPeriod(at, s.review_deadline_day)`.
- `evaluator` при `p.user_id`: `{ period: R, pending: laggingEvaluators(db, R).find(user_id)?.pending ?? 0, review_deadline: reviewDeadline(R, s.review_deadline_day).toISOString(), admin_url: adminReviewsUrl() }`.
- `employee` при `p.employee_id`: имя, `terminal_name`, должность из `staff_roles.name_ru` / `name_uz` по `staff_role_id`, `has_card` по `loadDirectory(...).card_id`. Без карты `pending`, `month`, `raise` = `null`.
- Отправленные оценки с `quarterStart(R) − 9 месяцев`; черновики не читаются вовсе.
- `pending`: у `R` нет отправленной оценки → `{ period: R, submit_opens_at, review_deadline, violations: действующие нарушения R }`. Отправленная оценка `R` с `score_pct = null` даёт не `pending`, а карточку месяца (решение 10).
- `month`: `TgMonthCard` по главному месяцу (решение 10); `lost` — `lostItems` по `kpi_review_items` с `sort` из `kpi_card_items`; `status` и `dispute` — `reviewDispute`.
- `raise`: квартал `raiseQuarter(R, q => есть отправленная оценка в q или решение approved/rejected/proposed/insufficient по q)`; `tiers` по возрастанию; `months` — `monthState` по трём месяцам; `avg_pct` — `quarterRow(...).avg_pct`; `decision` — строка `kpi_raise_decisions` со статусом `approved` (`amount = Number(approved_amount)`) или `rejected` (`amount = 0`); `ended = quarterEnded(q, R)`.
- `violations`: `{ period: month?.period ?? R, count }` — только `status = 'active'`.
- `has_history`: `historyFor(...).quarters.length > 0`.

`historyFor`: кварталы `q0 = quarterStart(R)`, `q0 − 3`, `− 6`, `− 9`; квартал есть, если в нём отправленная оценка или строка `kpi_raise_decisions` любого статуса, `q0` — ещё и при наличии карты. `result`: строка со статусом `approved` (`amount = Number(approved_amount)`) или `rejected` (`amount = 0`) → `decided`; иначе, в том числе при `proposed` и `insufficient`, `quarterEnded` → `waiting_hr`; иначе `running` (решение 22).

`dev-data.ts`: `seedReview` берёт активные пункты карты по `sort`, пишет снимки `title_ru`, `title_uz`, `weight`, `source`, `score_pct = scorePct(...)` строкой numeric, `submitted_at = now()` у отправленной; `change` ставит `version = 2` и событие `changed` (`old_score_pct`, `new_score_pct = score_pct`, `comment`, `actor_kind = "user"`, `actor_user_id = evaluator_user_id`). `seedViolation` берёт `item_title_ru` снимком из пункта `card_item_id` (без пункта — `null`), `comment` по умолчанию «Тест нарушение»; с `photo` пишет файл в `${uploadsBase()}/<violation_id>/<uuid>.png` и строку `kpi_violation_photos` (`image/png`). `seedDispute` для разобранного ставит `resolved_at = now()`. `seedDecision` заполняет `months` в том же виде, что пишет `computeQuarter`: `{ period, score_pct }[]` по `quarterMonths(quarter_start)` (`RaiseRow["months"]`, `types.ts:206`), иначе экран «Повышения» админки на стенде плана 7 ломается; `months_scored`, `avg_pct`, `suggested_amount` — через `quarterRow`; `approved_amount` и `decided_at` — для `approved` и `rejected`.

- [ ] **Step 1: Написать `http/tg-app-home.test.ts`** (обвязка как в задаче 3 и абзац под кодом; у карты `cook` 7 пунктов, `sort` 10…70; `const login = async (b: { telegram_id: number }) => (await tgLogin(b.telegram_id)).body.token`)

```ts
it("оценённый отчётный месяц: потерянные баллы, подсказка k < min, черновик не мешает", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const e = await makeEmployee(db, { role_code: "cook" });
  await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 75, 100, 90, 75, 100] });
  await seedReview(db, { ...base(e), period: "2025-11-01", scores: [100, 100, 100, 100, 100, 100, 100], status: "draft" });
  const token = await login(await bindTelegram(db, { employee_id: e.id }));
  const h = (await tgApi(token, "GET", "/api/kpi/tg/home")).body;
  expect([h.roles, h.evaluator, h.employee.has_card, h.employee.pending]).toEqual([["employee"], null, true, null]);
  expect(h.employee.month).toMatchObject({ period: "2025-10-01", score_pct: 91.43, status: "ready",
    dispute: { state: "can", deadline: "2025-11-10T18:59:59.999Z", opened_at: null, last_resolved: null } });
  expect(h.employee.month.lost.map((x: any) => [x.title_ru, x.score])).toEqual([["Гигиена сотрудника", 75], ["Соблюдение техкарты", 75], ["Время и скорость приготовления заказа", 90]]);
  expect(h.employee.raise).toMatchObject({ quarter_start: "2025-10-01", avg_pct: 91.43,
    tiers: [{ min_pct: 85, amount: 150000 }, { min_pct: 90, amount: 300000 }, { min_pct: 95, amount: 500000 }],
    hint: { kind: "too_few", scored: 1, amount: 300000, next: { amount: 500000, reachable: true, need_pct: 96.8, periods: ["2025-11-01", "2025-12-01"] } } });
  expect(h.employee.raise.months.map((m: any) => m.state)).toEqual(["scored", "upcoming", "upcoming"]);
  expect((await tgApi(token, "GET", "/api/kpi/tg/review?period=2025-11-01")).status).toBe(404);
});

it("отчётный месяц не оценён: короткая карточка и прошлый месяц, нарушения только действующие", async () => {
  setNow("2025-11-10T10:00:00+05:00");
  const e = await makeEmployee(db, { role_code: "cook" });
  await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 100, 100, 100, 100, 100] });
  for (const status of ["active", "active", "cancelled"] as const) {
    await seedViolation(db, { employee_id: e.id, terminal_id: e.terminal_id, recorded_by: ev.id, period: "2025-11-01", occurred_at: "2025-11-03T07:00:00.000Z", status });
  }
  const h = (await tgApi(await login(await bindTelegram(db, { employee_id: e.id })), "GET", "/api/kpi/tg/home")).body.employee;
  expect(h.pending).toEqual({ period: "2025-11-01", submit_opens_at: "2025-11-19T19:00:00.000Z", review_deadline: "2025-12-07T18:59:59.999Z", violations: 2 });
  expect([h.month.period, h.month.lost, h.violations]).toEqual(["2025-10-01", [], { period: "2025-10-01", count: 0 }]);
});

it("отчётный месяц отправлен без балла: карточка этого месяца с прочерком, короткой карточки нет", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const e = await makeEmployee(db, { role_code: "cook" });
  await seedReview(db, { ...base(e), period: "2025-10-01", scores: [null, null, null, null, null, null, null] });
  const h = (await tgApi(await login(await bindTelegram(db, { employee_id: e.id })), "GET", "/api/kpi/tg/home")).body.employee;
  expect([h.pending, h.month.period, h.month.score_pct, h.month.lost]).toEqual([null, "2025-10-01", null, []]);
  expect([h.raise.months[0].state, h.raise.hint]).toEqual(["not_rated", { kind: "none" }]);
});

it("новый квартал без оценок: карточка прошлого — ждём HR, потом решение; первая оценка переключает", async () => {
  setNow("2026-01-12T10:00:00+05:00");
  const e = await makeEmployee(db, { role_code: "cook" });
  await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 75, 100, 90, 75, 100] });  // 91.43
  await seedReview(db, { ...base(e), period: "2025-11-01", scores: [100, 100, 100, 100, 100, 100, 100] });
  const token = await login(await bindTelegram(db, { employee_id: e.id }));
  const raise = async () => (await tgApi(token, "GET", "/api/kpi/tg/home")).body.employee.raise;
  expect(await raise()).toMatchObject({ quarter_start: "2025-10-01", avg_pct: 95.72, hint: { kind: "waiting_hr", amount: 500000 } });
  expect((await raise()).months.map((m: any) => m.state)).toEqual(["scored", "scored", "not_rated"]);
  await seedDecision(db, { quarter_start: "2025-10-01", employee_id: e.id, months: [91.43, 100, null], status: "approved", amount: 300000, comment: "HR-секрет" });
  expect((await raise()).hint).toEqual({ kind: "decided", amount: 300000 });
  await seedReview(db, { ...base(e), period: "2026-01-01", scores: [100, 100, 100, 100, 100, 100, 100] });
  expect(await raise()).toMatchObject({ quarter_start: "2026-01-01", hint: { kind: "too_few" } });
});

it("руководитель с двумя привязками: карточка оценщика и своё; ссылка в админку из KPI_ADMIN_URL", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const e = await makeEmployee(db, { role_code: "cook" });
  await makeEmployee(db, { role_code: "cook", terminal_id: e.terminal_id });
  const u = await makeUser(db);
  await makeScope(db, u.id, { terminal_id: e.terminal_id });
  const b = await bindTelegram(db, { employee_id: e.id });
  await bindTelegram(db, { user_id: u.id, telegram_id: b.telegram_id });
  process.env.KPI_ADMIN_URL = "https://admin.example.test/";
  try {
    const h = (await tgApi(await login(b), "GET", "/api/kpi/tg/home")).body;
    expect(h.roles).toEqual(["employee", "evaluator"]);
    expect(h.evaluator).toEqual({ period: "2025-10-01", pending: 2, review_deadline: "2025-11-07T18:59:59.999Z", admin_url: "https://admin.example.test/ru/kpi/reviews" });
    expect(h.employee.pending.period).toBe("2025-10-01");
  } finally { delete process.env.KPI_ADMIN_URL; }
});

it("оценщик без привязки сотрудника: employee = null, история — 403 not_employee; без KPI_ADMIN_URL ссылки нет", async () => {
  const u = await makeUser(db);
  const token = await login(await bindTelegram(db, { user_id: u.id }));
  const h = (await tgApi(token, "GET", "/api/kpi/tg/home")).body;
  expect([h.roles, h.employee, h.evaluator.admin_url]).toEqual([["evaluator"], null, null]);
  expect((await tgApi(token, "GET", "/api/kpi/tg/history")).body).toEqual({ error: "not_employee" });
});

it("без карты: месяц и прибавка пусты, история есть", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const e = await makeEmployee(db, { role_code: "hall_worker" });
  await seedReview(db, { ...base(e), period: "2025-07-01", scores: [100, 100, 100, 100, 100, 100, 100] });
  const h = (await tgApi(await login(await bindTelegram(db, { employee_id: e.id })), "GET", "/api/kpi/tg/home")).body.employee;
  expect([h.has_card, h.pending, h.month, h.raise, h.has_history]).toEqual([false, null, null, null, true]);
});

it("история: не больше 4 кварталов, пустые пропущены, итоги и состояния месяцев; proposed — не решение", async () => {
  setNow("2026-01-12T10:00:00+05:00");
  const e = await makeEmployee(db, { role_code: "cook" });
  const all100 = [100, 100, 100, 100, 100, 100, 100];
  for (const period of ["2025-01-01", "2025-07-01", "2025-10-01", "2025-11-01"]) await seedReview(db, { ...base(e), period, scores: all100 });
  await seedDecision(db, { quarter_start: "2025-07-01", employee_id: e.id, months: [100, null, null], status: "rejected", comment: "HR-секрет" });
  await seedDecision(db, { quarter_start: "2025-10-01", employee_id: e.id, months: [100, 100, null], status: "proposed" });   // «Рассчитать» — ещё не решение
  const hist = (await tgApi(await login(await bindTelegram(db, { employee_id: e.id })), "GET", "/api/kpi/tg/history")).body;
  expect(hist.quarters.map((q: any) => [q.quarter_start, q.result, q.avg_pct])).toEqual([
    ["2026-01-01", { kind: "running" }, null],
    ["2025-10-01", { kind: "waiting_hr" }, 100],
    ["2025-07-01", { kind: "decided", amount: 0 }, 100],
  ]);
  expect(hist.quarters.map((q: any) => q.months.map((m: any) => m.state))).toEqual([
    ["upcoming", "upcoming", "upcoming"], ["scored", "scored", "not_rated"], ["scored", "not_rated", "not_rated"],
  ]);
});

it("в ответах нет id оценщика и комментария HR", async () => {
  setNow("2026-01-12T10:00:00+05:00");
  const e = await makeEmployee(db, { role_code: "cook" });
  await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 100, 100, 100, 100, 90] });
  await seedDecision(db, { quarter_start: "2025-10-01", employee_id: e.id, months: [98.57, null, null], status: "approved", amount: 150000, comment: "HR-секрет" });
  const token = await login(await bindTelegram(db, { employee_id: e.id }));
  const text = JSON.stringify([(await tgApi(token, "GET", "/api/kpi/tg/home")).body, (await tgApi(token, "GET", "/api/kpi/tg/history")).body]);
  expect(text).not.toContain(ev.id);
  expect(text).not.toContain("HR-секрет");
});
```

  Обвязка файла: `cookCardId`, `seniorCardId` и `cookItems` (id пунктов `cook` по `sort`) берутся в `beforeAll` из `GET /api/kpi/cards` сессией `kpi.manage`; `ev = await makeUser(db)` создаётся в `beforeAll`; `base(e, card = cookCardId)` = `{ employee_id: e.id, terminal_id: e.terminal_id, card_id: card, evaluator_user_id: ev.id }`. Шкала в `beforeAll` ставится явно: `PUT /api/kpi/raise-tiers` с телом `{ tiers: [{ min_pct: 95, amount: 500000 }, { min_pct: 90, amount: 300000 }, { min_pct: 85, amount: 150000 }] }` (схема роута, `routes/raises.ts:30`), чтобы чужой тест со своей шкалой не менял ожиданий. Задача 5 использует ту же обвязку.

- [ ] **Step 2: Run** `bun run test:http:kpi` — Expected: новые тесты FAIL (404 на `/api/kpi/tg/home`).
- [ ] **Step 3: Реализовать** `load.ts`, `home.ts`, `dev-data.ts` и два роута.
- [ ] **Step 4: Run** все тесты модуля — Expected: PASS. Типы — пусто.
- [ ] **Step 5: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add backend/src/modules/kpi/tg-app/load.ts backend/src/modules/kpi/tg-app/home.ts backend/src/modules/kpi/tg-app/dev-data.ts backend/src/modules/kpi/routes/tg-app.ts backend/src/modules/kpi/http/tg-app-home.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi): главный экран и история мини-приложения"
```

---

### Task 5: Разбор оценки, нарушения, фото и спор

**Files:**
- Create: `backend/src/modules/kpi/tg-app/review.ts`, `backend/src/modules/kpi/http/tg-app-review.test.ts`
- Modify: `backend/src/modules/kpi/routes/tg-app.ts`, `backend/src/modules/kpi/disputes.ts`, `backend/src/modules/kpi/types.ts`, `backend/drizzle/schema.ts` (комментарий), `backend/src/modules/kpi/http/disputes.test.ts`, `backend/src/modules/kpi/storage.ts`, `backend/src/modules/kpi/storage.test.ts`, `backend/src/modules/kpi/violations.ts` (`photoFile` через `resolveUploadFile`)

**Interfaces:**
- Consumes: `reviewDispute`, `disputeFacts`, `closedPeriods`, `seed*` (задача 4); `disputeStateOf` (задача 2); `requireEmployee`; `openDispute`; `parsePeriod`; `uploadsBase`; `UUID_RE`.
- Produces:
  ```ts
  // storage.ts — одна проверка пути фото для админки и мини-приложения
  export function resolveUploadFile(filePath: string): string | null; // абсолютный путь внутри uploadsBase() и файл есть, иначе null
  // tg-app/review.ts
  export async function reviewFor(db: DbLike, employeeId: string, period: unknown, at: Date): Promise<TgReview>;
  export async function violationsOf(db: DbLike, employeeId: string, period: unknown, at: Date): Promise<TgViolations>;
  export async function ownPhoto(db: DbLike, employeeId: string, photoId: string): Promise<{ path: string; mime: string }>;
  export async function disputeFromApp(db: DbLike, employeeId: string, body: { subject_type?: unknown; subject_id?: unknown; reason?: unknown }): Promise<TgDisputeCreated>;
  // disputes.ts
  openDispute(..., input: { ...; via?: "admin" | "telegram" | "miniapp" })
  // types.ts
  DisputeRow.opened_via: "admin" | "telegram" | "miniapp"
  ```
- Роуты (`run`, `requireEmployee`): `GET /kpi/tg/review`, `GET /kpi/tg/violations` (query `period`), `GET /kpi/tg/violation-photos/:id/file` (заголовки как у админского роута фото: `content-type`, `x-content-type-options: nosniff`, `cache-control: private, max-age=3600`; тело `Bun.file`), `POST /kpi/tg/disputes` (тело `t.Object` из трёх `t.Optional(t.Any())`).

Правила:
- `reviewFor`: `parsePeriod` → 422 `bad_period`; отправленная оценка этого сотрудника за период, иначе 404. `items` по `kpi_review_items` с `group_key` и `sort` из `kpi_card_items` (нет пункта в карте — `base`, в конец); `changes` — события `changed` и `hr_adjusted` по `created_at`; `reason_min = change_comment_min`.
- `violationsOf`: свои нарушения периода, все статусы, по `occurred_at desc, id desc`; `item_title_uz` — из `kpi_card_items` по `card_item_id`; `photo_ids` по `created_at`.
- `resolveUploadFile`: перенос проверки из `photoFile` (`violations.ts:356-360`) без изменения смысла — `path.resolve(uploadsBase())`, путь должен начинаться с `base + path.sep`, файл должен существовать. `photoFile` и `ownPhoto` зовут её и на `null` бросают 404 `not_found`; копии проверки в `review.ts` нет. В `storage.test.ts`: путь внутри каталога с файлом — абсолютный путь; `../` наружу, соседний каталог с тем же префиксом имени и отсутствующий файл — `null`.
- `ownPhoto`: не uuid, нет фото, нарушение чужое, `resolveUploadFile` дал `null` — 404 `not_found`.
- `disputeFromApp`: `subject_type` не `review`/`violation` → 422 `bad_subject_type`; `subject_id` не uuid → 404; запись не найдена, чужая или черновик → 404 `not_found`; иначе `openDispute(db, null, { subject_type, subject_id, reason, via: "miniapp", employee_actor: true })`. Ответ `{ id, subject_type, subject_id, created_at }`. `reason` не строка — передаётся как `""`, и `openDispute` отвечает 422 `comment_required`.
- `openDispute`: `via` допускает `"miniapp"`; `bad_via` на прочее остаётся. Приведение `opened_via: r.opened_via as "admin" | "telegram"` в `toRows` (`disputes.ts:95`) расширить до `DisputeRow["opened_via"]`. Комментарий у `opened_via` в `schema.ts`: `// admin | telegram | miniapp`.

- [ ] **Step 1: Написать `http/tg-app-review.test.ts`** (обвязка задачи 4; `setNow("2025-10-26T10:00:00+05:00")` в начале каждого теста; `senior_cook` — 9 пунктов, 2 из них `extra`)

```ts
it("вся оценка: группы, источник, заметки, нет данных, изменения; черновик и чужое — 404", async () => {
  const e = await makeEmployee(db, { role_code: "senior_cook" });
  const r = await seedReview(db, { ...base(e, seniorCardId), period: "2025-10-01",
    scores: [null, 100, 75, 100, 90, 100, 100, 80, 100], notes: [null, null, "Форма была грязной 14 и 18 октября"],
    change: { old_score_pct: 85, comment: "Пересчитали гигиену" } });
  const token = await login(await bindTelegram(db, { employee_id: e.id }));
  const v = (await tgApi(token, "GET", "/api/kpi/tg/review?period=2025-10-01")).body;
  expect([v.review_id, v.status, v.reason_min, v.dispute.state]).toEqual([r.id, "changed", 5, "can"]);
  expect(v.items.map((i: any) => i.group_key)).toEqual(["base", "base", "base", "base", "base", "base", "base", "extra", "extra"]);
  expect(v.items[0]).toMatchObject({ title_ru: "Приход и уход", source: "attendance", score: null });
  expect(v.items[2]).toMatchObject({ score: 75, note: "Форма была грязной 14 и 18 октября" });
  expect(v.changes).toEqual([{ at: expect.any(String), old_score_pct: 85, new_score_pct: r.score_pct, comment: "Пересчитали гигиену" }]);
  expect(JSON.stringify(v)).not.toContain(ev.id);
  expect((await tgApi(token, "GET", "/api/kpi/tg/review?period=2025-10")).body).toEqual({ error: "bad_period" });
  const other = await makeEmployee(db, { role_code: "cook" });
  const t2 = await login(await bindTelegram(db, { employee_id: other.id }));
  expect((await tgApi(t2, "GET", "/api/kpi/tg/review?period=2025-10-01")).status).toBe(404);
});

it("нарушения: только свои, новые сверху, отменённое с причиной, открытый спор, фото", async () => {
  const e = await makeEmployee(db, { role_code: "cook" });
  const v = (o: object) => seedViolation(db, { employee_id: e.id, terminal_id: e.terminal_id, recorded_by: ev.id, period: "2025-10-01", ...o } as any);
  const a = await v({ occurred_at: "2025-10-14T14:40:00.000Z", card_item_id: cookItems[2], comment: "Грязный пол у кассы", photo: TINY_PNG });
  const b = await v({ occurred_at: "2025-10-09T07:00:00.000Z", status: "cancelled", cancel_reason: "записано по ошибке" });
  const c = await v({ occurred_at: "2025-10-20T07:00:00.000Z" });
  await seedDispute(db, { subject_type: "violation", subject_id: c.id, employee_id: e.id, period: "2025-10-01" });
  const stranger = await makeEmployee(db, { role_code: "cook" });
  await seedViolation(db, { employee_id: stranger.id, terminal_id: e.terminal_id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-21T07:00:00.000Z" });
  const body = (await tgApi(await login(await bindTelegram(db, { employee_id: e.id })), "GET", "/api/kpi/tg/violations?period=2025-10-01")).body;
  expect(body.items.map((x: any) => [x.id, x.status, x.dispute.state])).toEqual([[c.id, "active", "open"], [a.id, "active", "can"], [b.id, "cancelled", "cancelled"]]);
  expect(body.items[1]).toMatchObject({ item_title_ru: "Гигиена сотрудника", item_title_uz: "Xodim gigiyenasi", photo_ids: [a.photo_id] });
  expect(body.items[2].cancel_reason).toBe("записано по ошибке");
  expect(JSON.stringify(body)).not.toContain(ev.id);
});

it("фото: своё — файл; чужое, случайное, кривое — 404; оценщику — 403", async () => {
  const e = await makeEmployee(db, { role_code: "cook" });
  const mine = await seedViolation(db, { employee_id: e.id, terminal_id: e.terminal_id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-14T07:00:00.000Z", photo: TINY_PNG });
  const s = await makeEmployee(db, { role_code: "cook" });
  const theirs = await seedViolation(db, { employee_id: s.id, terminal_id: s.terminal_id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-14T07:00:00.000Z", photo: TINY_PNG });
  const token = await login(await bindTelegram(db, { employee_id: e.id }));
  const ok = await tgRaw(token, `/api/kpi/tg/violation-photos/${mine.photo_id}/file`);
  expect([ok.status, ok.headers.get("content-type")]).toEqual([200, "image/png"]);
  expect(new Uint8Array(await ok.arrayBuffer())).toEqual(TINY_PNG);
  for (const id of [theirs.photo_id, randomUUID(), "x"]) expect((await tgRaw(token, `/api/kpi/tg/violation-photos/${id}/file`)).status).toBe(404);
  const u = await makeUser(db);
  const evToken = await login(await bindTelegram(db, { user_id: u.id }));
  expect((await tgApi(evToken, "GET", `/api/kpi/tg/violation-photos/${mine.photo_id}/file`)).body).toEqual({ error: "not_employee" });
  expect((await tgRaw(null, `/api/kpi/tg/violation-photos/${mine.photo_id}/file`)).status).toBe(401);
});

it("спор из приложения: opened_via miniapp, событие, уведомление оценщику; повтор — 409; главный экран — «на рассмотрении»", async () => {
  const e = await makeEmployee(db, { role_code: "cook" });
  const r = await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 75, 100, 100, 100, 100] });
  const token = await login(await bindTelegram(db, { employee_id: e.id }));
  const body = { subject_type: "review", subject_id: r.id, reason: "18 октября у меня был выходной" };
  const res = await tgApi(token, "POST", "/api/kpi/tg/disputes", body);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ id: expect.any(String), subject_type: "review", subject_id: r.id, created_at: expect.any(String) });
  const [d] = await db.select().from(kpi_disputes).where(eq(kpi_disputes.id, res.body.id));
  expect([d.opened_via, d.opened_by_user_id, d.employee_id, d.status]).toEqual(["miniapp", null, e.id, "open"]);
  const [evt] = await db.select().from(kpi_review_events).where(and(eq(kpi_review_events.review_id, r.id), eq(kpi_review_events.kind, "dispute_opened")));
  expect(evt.actor_kind).toBe("employee");
  const [n] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `dispute_opened:${d.id}`));
  expect([n.recipient_kind, n.user_id]).toEqual(["user", ev.id]);
  expect((await tgApi(token, "POST", "/api/kpi/tg/disputes", body)).body).toEqual({ error: "dispute_exists" });
  const home = (await tgApi(token, "GET", "/api/kpi/tg/home")).body.employee.month;
  expect([home.status, home.dispute.state, home.dispute.opened_at]).toEqual(["dispute_open", "open", iso(d.created_at)]);
});

it("спор: чужая запись и черновик — 404 без строки; коротко — 422; отменённое — 409; кривой тип — 422; после срока — 409", async () => {
  const e = await makeEmployee(db, { role_code: "cook" });
  const s = await makeEmployee(db, { role_code: "cook" });
  const theirs = await seedReview(db, { ...base(s), period: "2025-10-01", scores: [100, 100, 100, 100, 100, 100, 100] });
  const draft = await seedReview(db, { ...base(e), period: "2025-09-01", scores: [100, 100, 100, 100, 100, 100, 100], status: "draft" });
  const mine = await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 100, 100, 100, 100, 100] });
  const gone = await seedViolation(db, { employee_id: e.id, terminal_id: e.terminal_id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-14T07:00:00.000Z", status: "cancelled", cancel_reason: "ошибка" });
  const token = await login(await bindTelegram(db, { employee_id: e.id }));
  const post = (b: object) => tgApi(token, "POST", "/api/kpi/tg/disputes", { reason: "Не согласен с оценкой", ...b });
  const before = (await db.select().from(kpi_disputes)).length;
  expect((await post({ subject_type: "review", subject_id: theirs.id })).body).toEqual({ error: "not_found" });
  expect((await post({ subject_type: "review", subject_id: draft.id })).status).toBe(404);
  expect((await post({ subject_type: "review", subject_id: "x" })).status).toBe(404);
  expect((await db.select().from(kpi_disputes)).length).toBe(before);
  expect(await post({ subject_type: "review", subject_id: mine.id, reason: "ок" })).toEqual({ status: 422, body: { error: "comment_required", min: 5 } });
  expect((await post({ subject_type: "violation", subject_id: gone.id })).body).toEqual({ error: "already_cancelled" });
  expect((await post({ subject_type: "branch_result", subject_id: mine.id })).body).toEqual({ error: "bad_subject_type" });
  setNow("2025-11-11T10:00:00+05:00");
  expect((await post({ subject_type: "review", subject_id: mine.id })).body).toEqual({ error: "dispute_window_closed" });
});
```

  В `http/disputes.test.ts`, тест «от имени сотрудника (Telegram)…», добавить: `openDispute(db, null, { ..., via: "miniapp", employee_actor: true })` по второй оценке даёт `opened_via === "miniapp"`, а `via: "web"` — `KpiError` `bad_via`.

- [ ] **Step 2: Run** `bun run test:http:kpi` — Expected: новые тесты FAIL.
- [ ] **Step 3: Реализовать** `resolveUploadFile` и перевод на него `photoFile`, `review.ts`, четыре роута, `via: "miniapp"` в `disputes.ts` (с приведением в `toRows`) и `types.ts`, комментарий схемы.
- [ ] **Step 4: Run** все тесты модуля, включая `bun test src/modules/kpi/storage.test.ts` и админский тест фото в `http/violations.test.ts` — Expected: PASS. `bunx drizzle-kit generate --name probe` — `No schema changes` (если записался `*_probe.sql` — удалить файл, снимок и запись журнала, доложить). Типы backend и админки — пусто.
- [ ] **Step 5: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add backend/src/modules/kpi/tg-app/review.ts backend/src/modules/kpi/routes/tg-app.ts backend/src/modules/kpi/disputes.ts backend/src/modules/kpi/types.ts backend/src/modules/kpi/storage.ts backend/src/modules/kpi/storage.test.ts backend/src/modules/kpi/violations.ts backend/drizzle/schema.ts backend/src/modules/kpi/http/tg-app-review.test.ts backend/src/modules/kpi/http/disputes.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi): разбор оценки, нарушения, фото и спор из мини-приложения"
```

---

### Task 6: Кнопки «Открыть» в боте и кнопка меню

**Files:**
- Create: `backend/src/modules/kpi/tg/miniapp-url.ts`, `tg/menu.ts`, `tg/menu.test.ts`, `tg/set-menu.ts`
- Modify: `backend/src/modules/kpi/tg/messages.ts`, `tg/messages.test.ts`, `tg/bot-api.ts`, `tg/bot.ts`, `worker/deliver.ts`, `routes/tg-app.ts`, `http/fixtures.ts`, `http/bot.test.ts`, `http/delivery.test.ts`, `http/tg-app-auth.test.ts`

**Interfaces:**
- Consumes: `buildMessage`, `MessageCtx`, `BotApi`, `realBotApi`, `botApi` (план 4); `setLang`, `bindingOf` (задача 1).
- Produces:
  ```ts
  // tg/miniapp-url.ts
  export function miniAppUrl(): string | null;                    // KPI_MINIAPP_URL: trim, только ^https://, с хвостовым "/"
  export function appRoute(kind: string, payload: Record<string, unknown>): string | null;
  // tg/messages.ts
  export type MessageCtx = { lang: Lang; disputeUntil: string | null; appUrl?: string | null };
  export const BTN_OPEN: Record<Lang, string>;                    // { ru: "Открыть", uz: "Ochish" }
  export function openAppMarkup(lang: Lang, url: string): object;  // кнопка /my
  // tg/bot-api.ts
  interface BotApi { …; setMenuButton?(chatId: number | null, text: string, url: string): Promise<TgResult> } // необязательный: литералы BotApi в bot.test.ts:290, 331 и delivery.test.ts:180 не меняются
  // tg/menu.ts
  export const MENU_TEXT: Record<Lang, string>;                   // { ru: "Мой KPI", uz: "Mening KPI" }
  export function menuPlan(rows: { telegram_id: number; lang: "ru" | "uz" }[]): { chatId: number | null; text: string }[];
  export async function syncMenuButton(api: BotApi | null, chatId: number, lang: Lang): Promise<void>;
  // http/fixtures.ts
  fakeBotApi(): { api; sent; answered; menus: { chatId: number | null; text: string; url: string }[] }
  ```

Правила:
- `appRoute`: `review_submitted`, `review_changed` → `/review/YYYY-MM`; `violation_recorded` → `/violations/YYYY-MM`; `dispute_resolved` → по `subject_type` (`review` / `violation`); `raise_approved` → `/history`; `period` не `YYYY-MM-01` или прочий `kind` → `null`.
- `buildMessage`: при `ctx.appUrl` и `appRoute(...) !== null` добавляет последней строкой клавиатуры `[{ text: BTN_OPEN[lang], web_app: { url: appUrl + "#" + route } }]`. Кнопка «Оспорить» остаётся первой строкой, если она есть.
- `deliver.ts`: `appUrl: miniAppUrl()` в контексте `buildMessage`.
- `/my`: при `miniAppUrl()` ответ получает `openAppMarkup(langOf(pair), url)` = `{ inline_keyboard: [[{ text: ru ? "Открыть Мой KPI" : "«Mening KPI»ni ochish", web_app: { url } }]] }`.
- `realBotApi.setMenuButton`: `POST setChatMenuButton` с `{ chat_id?, menu_button: { type: "web_app", text, web_app: { url } } }`, тот же таймаут и `redact`, что у `answerCallback`; `chatId = null` — без `chat_id` (кнопка по умолчанию).
- `menuPlan`: первой — `{ chatId: null, text: "Мой KPI" }`, затем по одной на каждый `telegram_id` с `lang = "uz"` (без повторов, по возрастанию) — `"Mening KPI"`.
- `syncMenuButton`: нет `miniAppUrl()`, `api` или `api.setMenuButton` — ничего; иначе `api.setMenuButton(chatId, MENU_TEXT[lang], url)`, неуспех — `console.error` без токена.
- Только при смене языка (решение 16). Бот, кнопка языка: язык до нажатия — `langOf(await bindingOf(...))` перед `setLang`; после успешного `setLang`, если он отличается от `a.lang`, — `await syncMenuButton(api, u.chatId, a.lang)`. Мини-приложение, `PUT /kpi/tg/lang`: если `lang !== tg.lang` (язык принципала из привязки на входе запроса), — `void syncMenuButton(botApi(), tg.telegram_id, lang)` без ожидания; тот же язык — Telegram не вызывается.
- `set-menu.ts` (запускается вручную, в плане не запускать): нет `KPI_BOT_TOKEN` → `kpi menu: KPI_BOT_TOKEN не задан`, код 1; нет `miniAppUrl()` → `kpi menu: KPI_MINIAPP_URL не задан или не https`, код 1. Иначе `menuPlan` по `select distinct telegram_id, lang from kpi_tg_bindings where active`, вызовы `setMenuButton` по очереди, итог `kpi menu: default ok|fail, uz chats <ok>/<all>`; код выхода 1, если кнопка по умолчанию не встала (`default fail`), иначе 0 (неудачи отдельных чатов только в итоговой строке).

- [ ] **Step 1: Тесты.** `tg/menu.test.ts`:

```ts
import { expect, it } from "bun:test";
import { menuPlan } from "./menu";
import { appRoute, miniAppUrl } from "./miniapp-url";

it("menuPlan: по умолчанию русская, узбекским чатам своя, без повторов", () => {
  expect(menuPlan([{ telegram_id: 3, lang: "uz" }, { telegram_id: 1, lang: "ru" }, { telegram_id: 2, lang: "uz" }, { telegram_id: 2, lang: "uz" }]))
    .toEqual([{ chatId: null, text: "Мой KPI" }, { chatId: 2, text: "Mening KPI" }, { chatId: 3, text: "Mening KPI" }]);
});

it("miniAppUrl: только https, хвостовой слэш", () => {
  const cases: [string | undefined, string | null][] = [
    [undefined, null], ["", null], ["http://x.test/kpi-app/", null], ["x.test/kpi-app", null], ["javascript:alert(1)", null],
    ["https://x.test/kpi-app", "https://x.test/kpi-app/"], [" https://x.test/kpi-app/ ", "https://x.test/kpi-app/"],
  ];
  const saved = process.env.KPI_MINIAPP_URL;
  try {
    for (const [v, want] of cases) {
      if (v === undefined) delete process.env.KPI_MINIAPP_URL; else process.env.KPI_MINIAPP_URL = v;
      expect(miniAppUrl()).toBe(want);
    }
  } finally { if (saved === undefined) delete process.env.KPI_MINIAPP_URL; else process.env.KPI_MINIAPP_URL = saved; }
});

it("appRoute по видам уведомлений", () => {
  expect(appRoute("review_submitted", { period: "2026-10-01" })).toBe("/review/2026-10");
  expect(appRoute("review_changed", { period: "2026-10-01" })).toBe("/review/2026-10");
  expect(appRoute("violation_recorded", { period: "2026-10-01" })).toBe("/violations/2026-10");
  expect(appRoute("dispute_resolved", { period: "2026-10-01", subject_type: "violation" })).toBe("/violations/2026-10");
  expect(appRoute("dispute_resolved", { period: "2026-10-01", subject_type: "review" })).toBe("/review/2026-10");
  expect(appRoute("raise_approved", { quarter_start: "2026-10-01" })).toBe("/history");
  expect([appRoute("remind_evaluate", { period: "2026-10-01" }), appRoute("review_submitted", { period: "2026-10" })]).toEqual([null, null]);
});
```

  `tg/messages.test.ts`, новый `describe("кнопка «Открыть»")`:

```ts
const APP = "https://x.test/kpi-app/";
it("review_submitted: «Оспорить» первой строкой, «Открыть» второй", () => {
  expect(M.buildMessage("review_submitted", SUB, { ...ru(), appUrl: APP }).reply_markup).toEqual({ inline_keyboard: [
    [{ text: "Оспорить", callback_data: `dispute:review:${R}` }],
    [{ text: "Открыть", web_app: { url: `${APP}#/review/2025-10` } }],
  ] });
});
it("без срока спора — одна «Открыть»; uz — «Ochish»; у оценщика кнопки нет; без appUrl — как раньше", () => {
  expect(M.buildMessage("raise_approved", { raise_id: "x", quarter_start: "2025-10-01", amount: 1 }, { ...uz(null), appUrl: APP }).reply_markup)
    .toEqual({ inline_keyboard: [[{ text: "Ochish", web_app: { url: `${APP}#/history` } }]] });
  expect(M.buildMessage("remind_evaluate", { period: "2025-10-01", pending: 2, deadline: UNTIL }, { ...ru(), appUrl: APP }).reply_markup).toBeUndefined();
  expect(M.buildMessage("review_submitted", SUB, ru(null)).reply_markup).toBeUndefined();
});
```

  HTTP: в `http/bot.test.ts` — «/my при KPI_MINIAPP_URL — кнопка «Открыть Мой KPI»; lang:uz переставляет кнопку меню»: с `process.env.KPI_MINIAPP_URL = "https://x.test/kpi-app/"` (вернуть в `finally`) ответ `/my` имеет `reply_markup` `{ inline_keyboard: [[{ text: "Открыть Мой KPI", web_app: { url: "https://x.test/kpi-app/" } }]] }`, а после `press(tg, "lang:uz")` в `f.menus` есть `{ chatId: tg, text: "Mening KPI", url: "https://x.test/kpi-app/" }`; повторное `press(tg, "lang:uz")` новых записей в `f.menus` не добавляет; без переменной `f.menus` пуст и у `/my` нет `reply_markup`. В `http/delivery.test.ts`, тест «успех до срока споров…»: с той же переменной у отправленного сообщения вторая строка клавиатуры — `web_app` на `https://x.test/kpi-app/#/review/2025-10`. В `http/tg-app-auth.test.ts`, тест про язык: с переменной после `PUT /lang uz` в `f.menus` появляется `expect.objectContaining({ chatId: telegram_id, text: "Mening KPI", url: "https://x.test/kpi-app/" })` — ждать опросом не дольше 1 с с шагом 20 мс, вызов не ожидается роутом; второй `PUT /lang uz` после этого за те же 1 с новых записей не добавляет.

- [ ] **Step 2: Run** юнит- и HTTP-тесты — Expected: новые FAIL.
- [ ] **Step 3: Реализовать** `miniapp-url.ts`, `menu.ts`, `set-menu.ts`, правки `messages.ts`, `bot-api.ts`, `bot.ts`, `deliver.ts`, `routes/tg-app.ts`, `fakeBotApi().menus`.
- [ ] **Step 4: Run** все тесты модуля — Expected: PASS. Типы backend и cron — пусто (воркер импортирует `messages.ts` и `miniapp-url.ts`). Скрипт `set-menu.ts` не запускать: он ходит в настоящий Telegram.
- [ ] **Step 5: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add backend/src/modules/kpi/tg/miniapp-url.ts backend/src/modules/kpi/tg/menu.ts backend/src/modules/kpi/tg/menu.test.ts backend/src/modules/kpi/tg/set-menu.ts backend/src/modules/kpi/tg/messages.ts backend/src/modules/kpi/tg/messages.test.ts backend/src/modules/kpi/tg/bot-api.ts backend/src/modules/kpi/tg/bot.ts backend/src/modules/kpi/worker/deliver.ts backend/src/modules/kpi/routes/tg-app.ts backend/src/modules/kpi/http/fixtures.ts backend/src/modules/kpi/http/bot.test.ts backend/src/modules/kpi/http/delivery.test.ts backend/src/modules/kpi/http/tg-app-auth.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi): кнопки «Открыть» в сообщениях бота и кнопка меню «Мой KPI»"
```

---

## Покрытие спеки

| Раздел спеки мини-приложения | Задача |
|---|---|
| 3 роли: сотрудник, без карты, уволен, оценщик, обе привязки, не привязан | 3 (вход, 403), 4 (главный экран) |
| 4.1 главный экран: месяц, короткая карточка, прибавка, выбор квартала, ссылки | 4 (данные; рисует план 7) |
| 4.2 вся оценка, 4.3 нарушения, 4.4 история, 4.5 спор (`opened_via = 'miniapp'`, уведомления, условия кнопки) | 5, 4 |
| 5 подсказка о прибавке, все примеры | 2 |
| 6 что видно и чего нет | Global Constraints; тесты гигиены в 4 и 5 |
| 7 вход, сессия 12 часов, перепроверка, эндпоинты, 503 без токена, без логов | 3, 4, 5 |
| 8.1 две привязки: миграция, `redeemInvite`, `bindingOf`, `setLang`, отписка, `/my`, «Оспорить» | 1 |
| 8.2 кнопки «Открыть», `/my`, `KPI_MINIAPP_URL`, `set-menu.ts` | 6 |
| 11 миграция одна; `'miniapp'` в типе и комментарии схемы | 1, 5 (подпись в админке и заметки к деплою — план 7) |
| 12 unit и HTTP-тесты | 2–6 |
