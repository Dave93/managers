# KPI: оценщик в мини-приложении Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Оценщик с привязкой «оценщик» работает в «Мой KPI» без админки: список своих сотрудников по назначениям с фильтром по филиалу и карте, форма оценки (черновик и отправка), запись нарушения с фото и отмена своего, споры и «Разобрать», кнопка «Открыть» в уведомлениях `dispute_opened` и `remind_evaluate`.

**Architecture:** Роуты `/kpi/tg/ev/*` живут в отдельном плагине `routes/tg-app-ev.ts` за тем же Bearer-guard `kpiTgCtx`. Единственный новый слой логики на бэкенде — `tg-app/ev-actor.ts`: он превращает сессию с `user_id` в `Actor` админки, и дальше роуты зовут `getForm`, `saveDraft`, `submitReview`, `createViolation`, `cancelViolation`, `photoFile`, `listDisputes`, `resolveDispute` без копий проверок. Экраны клиента — vanilla TS, чистые view-модули с тестами `bun test` и тонкие DOM-экраны поверх них.

**Tech Stack:** Bun 1.4, Elysia 1.4, Drizzle ORM, PostgreSQL, ioredis, bun:test; `kpi_miniapp`: Vite 7, TypeScript 5.9 (strict, `noUncheckedIndexedAccess`), без фреймворка.

**Spec:** `docs/superpowers/specs/2026-11-04-kpi-hr-feedback-design.md` (раздел 5 и абзац про кнопку «Открыть»; правило разбора спора из раздела 1 только потребляется; «Не делаем», «Ограничения», «Решено владельцем 04.11», «Решения, принятые без владельца»). Читать вместе с `2026-10-26-kpi-employee-miniapp-design.md` (раздел 8.1, две привязки на один Telegram) и `2026-10-25-kpi-design.md` (разделы 6.2, 7.1–7.5, 8).

## Global Constraints

- Поток `tg-evaluator`: свой worktree, созданный через `wt`. `REPO` в командах ниже — корень этого worktree. Git — только `git -C "$REPO" …`, коммиты поимённо (`git add -A` и `git add .` запрещены), без `git push`, ssh, deploy.
- Права проверяются по `user_id` привязки и назначениям, как в админке; ни одного нового права не заводится. Оценщик видит только сотрудников из своих назначений.
- В Telegram добавляется только тонкий слой авторизации по сессии мини-приложения; логика и проверки — те же функции бэкенда, что использует админка.
- Спор разбирает только автор (`kpi_reviews.evaluator_user_id`, `kpi_violations.recorded_by`), любой другой получает 403 `out_of_scope`; HR (`kpi.approve`) спор видит, кнопки «Разобрать» у неё нет. Правило живёт в `disputes.ts` (поток `admin-scopes`); здесь только вызовы `listDisputes` и `resolveDispute`.
- Не добавляем кнопку «передать спор» и не меняем `evaluator_user_id` задним числом. Не выдаём управляющим `kpi.manage`. Не заводим новых прав. Не включаем `WORKLY_ATTENDANCE_NIGHTLY`.
- Уведомления `dispute_opened` и `remind_evaluate` получают кнопку «Открыть» через `appRoute` в `tg/miniapp-url.ts`; текст уведомлений не меняется.
- Тесты бэкенда идут только на `managers_tickets_test`, стенд мини-приложения — на `managers_kpi_smoke`. Локальную базу `managers` не мигрируем. Прод и данные HR не трогаем.
- Тексты на узбекском пишутся, но носитель их не проверял; это отмечается в описании PR. В мини-приложении только `ru` и `uz` (латиница): `TgLang = "ru" | "uz"`, `kpi_tg_bindings.lang` и бот знают те же два языка. Кириллического узбекского в мини-приложении нет, и этот поток его не заводит.
- Мини-приложение собирается отдельно (`kpi_miniapp`) и раздаётся тем же сервером; на деплой это не меняет ничего, кроме пересборки. Миграций и новых переменных окружения нет.
- Потоки 2 и 3 оба правят `tg-app/types.ts`, `kpi_miniapp/src/i18n.ts` и главный экран; сливать в порядке 1, 3, 2, перед слиянием подтягивать `main`. Правки общих файлов в этом плане только добавляют: `tg-app/types.ts` не меняется вовсе (новые типы в `tg-app/ev-types.ts`), в `i18n.ts` блоки ключей встают сразу после строки `eval_link` в обоих словарях; в `route.ts` варианты `Route` встают перед `{ name: "history" }`, ветка `parseHash` — в начале разбора пути, `case` в `hashOf` — перед `case "history"`; в `main.ts` импорты по алфавиту, `case` экранов оценщика в `screenOf` — перед `case "history"`; в `view/home.ts` и `screens/home.ts` меняется только блок оценщика (`evaluator`, `evaluatorBlock`); `api.ts`, `load.ts`, `photo.ts` правятся точечно, как названо в задачах. Поток `tg-attendance` ставит свои правки после `history`/`hist_upcoming`, якоря не пересекаются.
- Комментарии в коде по-русски, как в окружающем коде. Ошибки — `{ error: "<code>", ...extra }` через `KpiError` и `run()` из `kpi/errors.ts`. «Сейчас» в бизнес-логике — только `now()` из `kpi/clock.ts`.
- `backend/src/modules/kpi/tg-app/ev-types.ts` не импортирует ничего: `grep -c '^import' backend/src/modules/kpi/tg-app/ev-types.ts` печатает `0`. Мини-приложение берёт типы через `import type … from "@backend/modules/kpi/tg-app/ev-types"`, других импортов из backend в `kpi_miniapp/src` нет.
- Строки с сервера попадают в DOM только текстом через `h()`. `innerHTML`, `outerHTML`, `insertAdjacentHTML` с данными сервера запрещены. Стек клиента старый (Chrome 64): без `gap` у flex, `inset`, `aspect-ratio`, `:is()`/`:where()`; тач-цели от 44 px, основной текст от 14 px, числа с `tabular-nums`, раскладка на 375 px без горизонтальной прокрутки.
- Исполнитель каждой UI-задачи (7–11) до первой строки DOM или CSS вызывает инструментом Skill сначала `design-taste-frontend`, потом `frontend-design`. Каркас раскладки в этом плане задан, визуальное решение остаётся за исполнителем.
- Окружение backend-тестов. Блок `TESTENV` подставляется как есть перед каждой командой `bun test` в `backend/` (если `backend/.env` нет в worktree, скопировать из основной копии):
  ```bash
  cd "$REPO/backend" && export TEST_DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | sed -E 's#/managers(\?.*)?$#/managers_tickets_test#') && case "$TEST_DATABASE_URL" in *managers_tickets_test) ;; *) echo "не тестовая база"; exit 1;; esac && export PROJECT_PREFIX=managers_test_ KPI_UPLOADS_DIR=/tmp/kpi_test_uploads KPI_NOTIFY_QUEUE=kpi_notify_test KPI_BOT_USERNAME=kpi_test_bot KPI_WEBHOOK_SECRET=kpi_test_secret DATABASE_URL=$TEST_DATABASE_URL
  ```
- Проверки типов: backend — `"$REPO"/admin/node_modules/.bin/tsc --noEmit -p "$REPO"/backend --incremental false 2>&1 | grep modules/kpi` печатает пусто; мини-приложение — `cd "$REPO/kpi_miniapp" && bun --bun run build` (это `tsc --noEmit && vite build`). Юнит-тесты backend: `cd "$REPO/backend" && bun test src/modules/kpi/*.test.ts src/modules/kpi/tg src/modules/kpi/worker src/modules/kpi/tg-app`; клиента: `cd "$REPO/kpi_miniapp" && bun test` (на старте 99 тестов).
- Коммиты: сообщение по-русски в стиле `feat(kpi): …` / `test(kpi): …`, вторым `-m` — строка `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Оценщик с лишними правами расширяет себе видимость.** Управляющий, у которого роль несёт `kpi.evaluate` вместе с `kpi.approve`, `kpi.view` или `kpi.manage`, при админском `Actor` увидел бы всю сеть и отменял бы чужие нарушения. `evaluatorActor` оставляет в правах только `kpi.evaluate`. Тест: Task 1 (список этой роли — только её филиал), Task 2 (форма сотрудника чужого филиала — 403), Task 3 (отмена чужого нарушения — 403 `forbidden`), Task 4 (роль только с `kpi.approve` не разбирает — 403 `forbidden`).
2. **Доступ по идентификатору в обход проверки сотрудника.** «Никогда не оценивать вне назначения» держится на каждом id-эндпоинте, а не только на тех, где есть `employee_id`: отправка по `review_id`, отмена по `violation_id`, разбор по `dispute_id`, фото по `photo_id` проверяются с id из чужого филиала. Сессия живёт 12 часов, поэтому снятое назначение и снятая привязка должны действовать со следующего запроса. Тесты: Task 2 (форма, черновик, отправка; снятое назначение; отвязка), Task 3 (фото, отмена), Task 4 (разбор, карточка спора).
3. **Повтор запроса на плохой связи.** Филиальный wifi отдаёт «нет связи» и после того, как сервер уже записал. Запись нарушения не идемпотентна, поэтому клиент не повторяет её сам: защёлка на время отправки, при `offline` текст «результат неизвестен, проверьте «Мои нарушения»». Повторная отправка оценки и повторный разбор получают 409 `already_submitted` и `dispute_closed`, и клиент по ним перезагружает экран. Тест: Task 6 (`evOutcome`), поведение экранов — Task 8–11.
4. **Фото с телефона.** Снимок больше 10 МБ, HEIC, портретный кадр с EXIF-поворотом, четвёртое фото. Клиент жмёт до 1600 px JPEG и отклоняет нечитаемое с названием файла; сервер отвечает `photo_too_large`, `bad_photo_type`, `too_many_photos`. Тесты: Task 9 (`preparePhoto`), Task 3 (коды сервера).
5. **Состояние устарело между загрузкой и действием.** Отправка раньше 20 числа (`too_early` с `opens_at`), закрытый месяц (`period_closed`), карта сотрудника сменилась после загрузки формы (`unknown_item`, `no_card`), в уведомлении `dispute_opened` спор, который уже перешёл к другому оценщику. Тесты: Task 2 (все четыре кода), Task 4 (спор не у меня: `can_resolve: false`, после слияния потока 1 — 403), Task 6 (код → перезагрузка или текст).

## Решения плана

Это решения исполнителя плана, не владельца и не спеки; владелец может их отменить.

1. **`Actor` оценщика сужен до `kpi.evaluate`.** `perms = {"kpi.evaluate"}`, `isHq = false`, `terminals = []`. У чистого оценщика проверки те же, что в админке. У человека с ролью HR или управляющего приложение показывает только его назначения (Review Focus 1). Побочный эффект: HR-право `kpi.approve` в приложении ничего не открывает, что совпадает с пунктом 1 спеки.
2. **Отправленная оценка в приложении только читается.** `can_edit` для неё `false`; изменить её можно в админке или через спор. Правка отправленной оценки (`PUT /kpi/reviews/:id`) в объём «черновик и отправка» из спеки не входит.
3. **Экраны оценщика не кэшируются в `localStorage`.** Кэш приложения хранит ответы по пути запроса; списки чужих сотрудников и их баллы на телефоне не оседают. Без сети экран показывает «Повторить», а не старый список.
4. **Текст `dispute_opened` не меняется** (спека, пункт 1: уведомление не меняется), хотя в нём остаётся «Разберите в админке»: кнопка «Открыть» стоит под ним.
5. **Фильтры списка работают на клиенте.** Сервер отдаёт всех покрытых назначением сотрудников периода и справочники филиалов и карт, из которых строятся фильтры. Страниц нет: админка тоже грузит список целиком.
6. **Нарушение пишется текущим временем**, как в админке (`occurred_at` не отправляется), его месяц — месяц момента записи.
7. **Список «Мои нарушения»** — нарушения с `recorded_by` = я из `listViolations`; это фильтр показа. Правило отмены целиком в `cancelViolation`.
8. **Список споров** показывает то, что вернул `listDisputes`, без собственной фильтрации; «Разобрать» стоит только при `can_resolve = true`.
9. **Кнопка `remind_evaluate` с кривым периодом** не рисуется (как у остальных видов с кривым сроком); `dispute_opened` ведёт на список споров без периода.
10. **CSS в отдельном файле** `kpi_miniapp/src/style-ev.css`, подключённом из `main.ts`: поток `tg-attendance` тоже дописывает `style.css`, и конец файла не конфликтует.

---

## Структура файлов

Backend (`backend/src/modules/kpi/`): `tg-app/ev-types.ts`, `tg-app/ev-actor.ts`, `tg-app/ev-list.ts`, `tg-app/ev-review.ts`, `tg-app/ev-violations.ts`, `tg-app/ev-disputes.ts`, `routes/tg-app-ev.ts` (плагин, подключается одной строкой в `controller.ts`), тесты `http/tg-app-ev-list.test.ts`, `http/tg-app-ev-review.test.ts`, `http/tg-app-ev-violations.test.ts`, `http/tg-app-ev-disputes.test.ts`, `tg-app/ev-review.test.ts`; правки `tg/miniapp-url.ts`, `tg/messages.test.ts`, `http/delivery.test.ts`, `http/fixtures.ts`, `tg-app/smoke-seed.ts`.

Клиент (`kpi_miniapp/`): `src/view/ev-errors.ts`, `ev-list.ts`, `ev-score.ts`, `ev-review.ts`, `ev-violation.ts`, `ev-violations.ts`, `ev-disputes.ts`; `src/photo-prepare.ts`, `photo-pick.ts`, `reason-sheet.ts`; `src/screens/ev-list.ts`, `ev-items.ts`, `ev-review.ts`, `ev-violation.ts`, `ev-violations.ts`, `ev-disputes.ts`, `ev-dispute.ts`; `src/style-ev.css`; правки `route.ts`, `api.ts`, `load.ts`, `main.ts`, `i18n.ts`, `photo.ts`, `view/home.ts`, `screens/home.ts`; тесты в `test/`.

---

### Task 1: `Actor` оценщика, типы ответов, список сотрудников, плагин с guard

**Files:**
- Create: `backend/src/modules/kpi/tg-app/ev-types.ts`, `backend/src/modules/kpi/tg-app/ev-actor.ts`, `backend/src/modules/kpi/tg-app/ev-list.ts`, `backend/src/modules/kpi/routes/tg-app-ev.ts`
- Modify: `backend/src/modules/kpi/controller.ts` (импорт и `.use(tgAppEvRoutes)` сразу после `.use(tgAppRoutes)`), `backend/src/modules/kpi/http/fixtures.ts` (добавляются `makeEvaluator`, `evSession`, `tgForm`; `withSession` импортируется значением, а не `type`)
- Test: `backend/src/modules/kpi/http/tg-app-ev-list.test.ts`

**Interfaces:**
- Consumes: `kpiTgCtx`, `KpiTgPrincipal` (`tg-app/ctx.ts`); `Actor`, `DbLike`, `parsePeriod` (`access.ts`); `listEmployeeRows` (`employees.ts`); `loadSettings` (`settings.ts`); `deadlinesOf`, `isPeriodClosed` (`periods.ts`); `currentReviewPeriod` (`time.ts`); `now` (`clock.ts`); `run`, `KpiError` (`errors.ts`); `users` (схема); `ctx` (`@backend/context`, даёт `drizzle` и `cacheController`).
- Produces:
  ```ts
  // tg-app/ev-actor.ts
  export type PermLookup = { getPermissionsByRoleId(roleId: string): Promise<string[]> };
  export async function evaluatorActor(db: DbLike, perms: PermLookup, p: KpiTgPrincipal): Promise<Actor>;
  // tg-app/ev-list.ts
  export async function evEmployees(db: DbLike, actor: Actor, period: unknown, at: Date): Promise<EvEmployees>;
  // routes/tg-app-ev.ts
  export const tgAppEvRoutes: Elysia; // GET /kpi/tg/ev/employees?period=
  // http/fixtures.ts
  export async function makeEvaluator(db: DrizzleDB, o?: { perms?: string[] }): Promise<{ id: string }>;
  export async function evSession(db: DrizzleDB, userId: string): Promise<string>; // привязка user_id + tgLogin, токен сессии
  export async function tgForm(token: string | null, path: string, fd: FormData): Promise<{ status: number; body: any }>;
  ```
- Типы ответов. Файл `tg-app/ev-types.ts` создаётся ровно в этом виде, задачи 2–4 их возвращают, клиент рисует:
  ```ts
  // Ответы API оценщика в мини-приложении (/api/kpi/tg/ev/*). Файл без импортов:
  // kpi_miniapp берёт его через import type и проверяет своим tsc.
  // Периоды — "YYYY-MM-01", время — ISO 8601 UTC.
  export type EvItemSource = "manual" | "attendance" | "cooking_speed" | "sales_plan" | "food_cost";
  export type EvStatus = "none" | "draft" | "submitted" | "disputed";

  export type EvErrorCode =
    | "not_evaluator" | "forbidden" | "out_of_scope" | "not_found" | "bad_id" | "bad_period" | "bad_status" | "no_card" | "no_items"
    | "period_closed" | "already_submitted" | "too_early" | "missing_items" | "note_required" | "bad_score" | "unknown_item"
    | "comment_required" | "photo_required" | "bad_photo_type" | "photo_too_large" | "too_many_photos"
    | "open_dispute" | "already_cancelled" | "dispute_closed" | "items_required" | "no_changes" | "bad_decision";
  export interface EvError { error: EvErrorCode; min?: number; opens_at?: string; item_id?: string; items?: string[] }

  // GET /kpi/tg/ev/employees?period=YYYY-MM-01 (без period — отчётный месяц)
  export interface EvEmployee {
    id: string; first_name: string; last_name: string; terminal_id: string; terminal_name: string | null;
    position: string | null; card_id: string | null; card_title: string | null;
    review_status: "none" | "draft" | "submitted";
    score_pct: number | null;   // только у отправленной
    late: boolean; open_dispute: boolean; can_evaluate: boolean;
  }
  export interface EvEmployees {
    period: string; period_status: "open" | "closed"; submit_opens_at: string; review_deadline: string;
    terminals: { id: string; name: string }[]; cards: { id: string; title: string }[];
    items: EvEmployee[];
  }

  // GET /kpi/tg/ev/form?period&employee_id; PUT /kpi/tg/ev/draft; POST /kpi/tg/ev/reviews/:id/submit
  export interface EvFormViolation { id: string; occurred_at: string; comment: string }
  export interface EvFormItem {
    item_id: string; title_ru: string; title_uz: string; hint_ru: string | null; weight: number; source: EvItemSource;
    group_key: "base" | "extra"; score: number | null; note: string | null;
    suggestion: { score: number; basis: string } | null;
    violations: EvFormViolation[]; violation_hint: number | null;
  }
  export interface EvReviewForm {
    period: string; period_status: "open" | "closed";
    employee: { id: string; first_name: string; last_name: string; terminal_name: string | null };
    card_title: string;
    review: { id: string; status: "draft" | "submitted"; score_pct: number | null; version: number; submitted_at: string | null; late: boolean } | null;
    items: EvFormItem[];
    other_violations: EvFormViolation[];
    can_edit: boolean;          // false у отправленной оценки: в приложении она только читается
    open_dispute: boolean; dispute_rejected: boolean;
    submit_opens_at: string; review_deadline: string;
  }

  // GET /kpi/tg/ev/violation-form?employee_id
  export interface EvViolationForm {
    employee: { id: string; first_name: string; last_name: string; terminal_name: string | null };
    card_title: string | null;
    items: { id: string; title_ru: string; title_uz: string }[];   // активные пункты карты по sort
    photo_required: boolean; max_photos: number; max_photo_bytes: number; comment_min: number;
  }
  // POST /kpi/tg/ev/violations (multipart), GET /kpi/tg/ev/violations?period=, POST /kpi/tg/ev/violations/:id/cancel
  export interface EvViolation {
    id: string; employee_id: string; employee_name: string; terminal_name: string | null;
    card_item_id: string | null; item_title_ru: string | null; period: string; occurred_at: string; comment: string;
    status: "active" | "cancelled"; cancel_reason: string | null; photo_ids: string[]; open_dispute: boolean;
    can_cancel: boolean;
  }
  export interface EvViolations { period: string; period_status: "open" | "closed"; items: EvViolation[] }

  // GET /kpi/tg/ev/disputes?status=, GET /kpi/tg/ev/disputes/:id, POST /kpi/tg/ev/disputes/:id/resolve
  export type EvDisputeSubject =
    | { kind: "review"; score_pct: number | null }
    | { kind: "violation"; item_title_ru: string | null; comment: string; photo_ids: string[] };
  export interface EvDispute {
    id: string; subject_type: "review" | "violation"; subject_id: string;
    employee_id: string | null; employee_name: string | null; terminal_name: string | null; period: string;
    reason: string; status: "open" | "accepted" | "rejected"; resolution_comment: string | null;
    resolved_at: string | null; created_at: string; can_resolve: boolean;
    subject: EvDisputeSubject | null;
  }
  export interface EvDisputes { items: EvDispute[] }
  export interface EvDisputeDetail { dispute: EvDispute; comment_min: number; form: EvReviewForm | null } // form — только у спора по оценке
  ```

Правила:
- `evaluatorActor`: `p.user_id === null` — 403 `not_evaluator`; строка `users` по `user_id` (поля `role_id`, `status`) не найдена или `status` не `active` — 403 `not_evaluator`; права берутся как у админки, `perms.getPermissionsByRoleId(role_id)` (у `role_id = null` — пустой список); без `kpi.evaluate` — 403 `forbidden`; результат `{ userId, perms: new Set(["kpi.evaluate"]), isHq: false, terminals: [] }`. Права читаются на каждом запросе, в сессии их нет.
- `evEmployees`: `period` не задан — `currentReviewPeriod(now(), review_deadline_day)`, иначе `parsePeriod`; строки — `listEmployeeRows(db, actor, { period })` целиком (без фильтров); `terminals` и `cards` — уникальные значения из этих строк (филиалы по имени, карты по названию `title_ru`); `score_pct` только у `review.status === "submitted"`; `position` — `staff_role_name`; `card_title` — `card.title_ru`; сроки из `deadlinesOf`, `period_status` из `isPeriodClosed`.
- Плагин: `new Elysia({ name: "@api/kpi/tg-app-ev" }).use(ctx).use(kpiTgCtx)` и дальше роуты; каждый обработчик: `run(set, async () => … await evaluatorActor(drizzle, cacheController, tg) …)`. `query.period` — `t.Optional(t.Any())`: значение проверяет сервис.
- `makeEvaluator`: `makeUser(db, { perms })` (роль `test_kpi_*` в базе), затем `role_id` пользователя читается из базы и `withSession({ permissions: perms, userId, roleId })` кладёт ту же роль в Redis-кэш ролей, откуда `getPermissionsByRoleId` берёт права. `perms` по умолчанию `["kpi.evaluate"]`; права `kpi.*` должны лежать в таблице `permissions` тестовой базы (`makeUser` иначе бросает ошибку с подсказкой про `seed-permissions`).

- [ ] **Step 1: Написать `http/tg-app-ev-list.test.ts`.** Обвязка — как в `http/tg-app-review.test.ts` (guard `dbLooksLikeTest`/`prefixLooksLikeTest`, динамические импорты, `beforeAll` с `setup()`, `cleanupKpi`, подменой `KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN` и чтением карт HR-сессией `withSession({ permissions: ["kpi.manage"] })` → `cookCardId`, `cookItems`; `beforeEach` с `setTestBotApi(fakeBotApi().api)`; `afterAll` возвращает токен, `setNow(null)`, `cleanupKpi`, `sweepTestRoles`). Дополнительно импортируются `evSession`, `makeEvaluator`, `makeScope`, `makeTerminal`, `seedReview`, `kpi_evaluator_scopes`, `kpi_tg_bindings`; `randomUUID` берётся из `node:crypto` статическим импортом в начале файла. Эта же обвязка и те же импорты нужны файлам задач 2–4.

```ts
const base = (ev: { id: string }, e: { id: string; terminal_id: string }) =>
  ({ employee_id: e.id, terminal_id: e.terminal_id, card_id: cookCardId, evaluator_user_id: ev.id, period: "2025-10-01" as const });

it("список: только покрытые назначением, статусы, справочники фильтров", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
  const ev = await makeEvaluator(db);
  await makeScope(db, ev.id, { terminal_id: t1.id });
  const a = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });          // черновик
  const b = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });          // без оценки
  const c = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });          // отправлена
  const out = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });        // чужой филиал
  const nocard = await makeEmployee(db, { role_code: "hall_worker", terminal_id: t1.id }); // без карты
  const all100 = cookItems.map(() => 100);
  await seedReview(db, { ...base(ev, a), scores: all100, status: "draft" });
  await seedReview(db, { ...base(ev, c), scores: all100 });
  const token = await evSession(db, ev.id);
  const r = await tgApi(token, "GET", "/api/kpi/tg/ev/employees");
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({
    period: "2025-10-01", period_status: "open",
    submit_opens_at: "2025-10-19T19:00:00.000Z", review_deadline: "2025-11-07T18:59:59.999Z",
    terminals: [{ id: t1.id, name: t1.name }],
    cards: [{ id: cookCardId, title: "Повар (Chopar и Les Ailes)" }],
  });
  const byId = new Map<string, any>(r.body.items.map((i: any) => [i.id, i]));
  expect([...byId.keys()].sort()).toEqual([a.id, b.id, c.id].sort());
  expect(byId.get(a.id)).toMatchObject({ review_status: "draft", score_pct: null, can_evaluate: true, late: false, open_dispute: false, terminal_id: t1.id });
  expect(byId.get(b.id)).toMatchObject({ review_status: "none", score_pct: null });
  expect(byId.get(c.id)).toMatchObject({ review_status: "submitted", score_pct: 100 });
  expect(byId.has(out.id) || byId.has(nocard.id)).toBe(false);
  expect((await tgApi(token, "GET", "/api/kpi/tg/ev/employees?period=2025-09-01")).body.period).toBe("2025-09-01");
  expect(await tgApi(token, "GET", "/api/kpi/tg/ev/employees?period=2025-9")).toEqual({ status: 422, body: { error: "bad_period" } });
});

it("роль с kpi.approve, kpi.view и kpi.manage видит в приложении только своё назначение", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
  const mine = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const other = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
  const hr = await makeEvaluator(db, { perms: ["kpi.evaluate", "kpi.approve", "kpi.view", "kpi.manage"] });
  await makeScope(db, hr.id, { terminal_id: t1.id });
  const r = await tgApi(await evSession(db, hr.id), "GET", "/api/kpi/tg/ev/employees");
  const ids = r.body.items.map((i: any) => i.id);
  expect(ids).toContain(mine.id);
  expect(ids).not.toContain(other.id);
});

it("сессия: без токена 401; только сотрудник — 403 not_evaluator; без права — 403 forbidden; после отвязки 401", async () => {
  expect(await tgApi(null, "GET", "/api/kpi/tg/ev/employees")).toEqual({ status: 401, body: { error: "unauthorized" } });
  const emp = await makeEmployee(db, { role_code: "cook" });
  const empToken = (await tgLogin((await bindTelegram(db, { employee_id: emp.id })).telegram_id)).body.token;
  expect(await tgApi(empToken, "GET", "/api/kpi/tg/ev/employees")).toEqual({ status: 403, body: { error: "not_evaluator" } });
  const viewer = await makeEvaluator(db, { perms: ["kpi.view"] });
  expect(await tgApi(await evSession(db, viewer.id), "GET", "/api/kpi/tg/ev/employees")).toEqual({ status: 403, body: { error: "forbidden" } });
  const ev = await makeEvaluator(db);
  const b = await bindTelegram(db, { user_id: ev.id });
  const token = (await tgLogin(b.telegram_id)).body.token;
  expect((await tgApi(token, "GET", "/api/kpi/tg/ev/employees")).status).toBe(200);
  await db.update(kpi_tg_bindings).set({ active: false }).where(eq(kpi_tg_bindings.id, b.id));
  expect((await tgApi(token, "GET", "/api/kpi/tg/ev/employees")).status).toBe(401);
});

it("guard нового плагина не расползается: публичный вход и cookie-роуты админки работают", async () => {
  const hr = await withSession({ permissions: ["kpi.manage"] });
  expect((await api(hr, "GET", "/api/kpi/me")).status).toBe(200);
  const emp = await makeEmployee(db, { role_code: "cook" });
  expect((await tgLogin((await bindTelegram(db, { employee_id: emp.id })).telegram_id)).status).toBe(200);
});

it("снятое назначение действует со следующего запроса", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const t1 = await makeTerminal(db);
  const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const ev = await makeEvaluator(db);
  await makeScope(db, ev.id, { terminal_id: t1.id });
  const token = await evSession(db, ev.id);
  expect((await tgApi(token, "GET", "/api/kpi/tg/ev/employees")).body.items.map((i: any) => i.id)).toContain(e.id);
  await db.delete(kpi_evaluator_scopes).where(eq(kpi_evaluator_scopes.user_id, ev.id));
  expect((await tgApi(token, "GET", "/api/kpi/tg/ev/employees")).body).toMatchObject({ items: [], terminals: [], cards: [] });
});
```

- [ ] **Step 2: Run** `TESTENV && bun test --timeout 30000 src/modules/kpi/http/tg-app-ev-list.test.ts` — Expected: FAIL (импорт `makeEvaluator` не найден, роута нет).
- [ ] **Step 3: Реализовать** `ev-types.ts` (ровно по блоку выше), `ev-actor.ts`, `ev-list.ts`, плагин `routes/tg-app-ev.ts` с роутом `GET /kpi/tg/ev/employees`, две строки в `controller.ts`, три хелпера в `fixtures.ts`.
- [ ] **Step 4: Run** тот же файл — Expected: PASS. Если тест «guard нового плагина» падает 500 или `tg` приходит `undefined`: два плагина с одним именем guard конфликтуют; перенести определения роутов из `tg-app-ev.ts` в цепочку `routes/tg-app.ts` после последнего `.post("/kpi/tg/disputes", …)`, где `tg` уже есть, убрать плагин и две строки из `controller.ts` и доложить (эксперимент на голом Elysia с двумя плагинами и общим `.as("scoped")` guard прошёл, на реальном `kpiTgCtx` не проверялся). Затем `TESTENV && bun test --timeout 30000 src/modules/kpi/http/tg-app-auth.test.ts` — PASS; `grep -c '^import' backend/src/modules/kpi/tg-app/ev-types.ts` — `0`; проверка типов backend — пусто.
- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add backend/src/modules/kpi/tg-app/ev-types.ts backend/src/modules/kpi/tg-app/ev-actor.ts backend/src/modules/kpi/tg-app/ev-list.ts backend/src/modules/kpi/routes/tg-app-ev.ts backend/src/modules/kpi/controller.ts backend/src/modules/kpi/http/fixtures.ts backend/src/modules/kpi/http/tg-app-ev-list.test.ts
git -C "$REPO" commit -m "feat(kpi): список сотрудников оценщика в мини-приложении, Actor по сессии привязки" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Форма оценки, черновик, отправка

**Files:**
- Create: `backend/src/modules/kpi/tg-app/ev-review.ts`, `backend/src/modules/kpi/tg-app/ev-review.test.ts`, `backend/src/modules/kpi/http/tg-app-ev-review.test.ts`
- Modify: `backend/src/modules/kpi/routes/tg-app-ev.ts`

**Interfaces:**
- Consumes: `evaluatorActor` (задача 1); `getForm`, `saveDraft`, `submitReview`, `ItemInput`, `ReviewForm` (`reviews.ts`, `types.ts`); `itemsSchema` (`routes/reviews.ts`); `parsePeriod`; `KpiError`.
- Produces:
  ```ts
  // tg-app/ev-review.ts
  export function evFormOf(f: ReviewForm): EvReviewForm; // can_edit = f.can_edit && f.review?.status !== "submitted"; evaluator_user_id и recorded_by наружу не идут
  export async function evForm(db: DbLike, actor: Actor, period: unknown, employeeId: unknown): Promise<EvReviewForm>;
  export async function evSaveDraft(db: DbLike, actor: Actor, body: { period?: unknown; employee_id?: unknown; items?: unknown }): Promise<EvReviewForm>;
  export async function evSubmit(db: DbLike, actor: Actor, reviewId: string, items: ItemInput[] | undefined): Promise<EvReviewForm>;
  ```
- Роуты: `GET /kpi/tg/ev/form` (query `period`, `employee_id`, оба `t.Optional(t.Any())`), `PUT /kpi/tg/ev/draft` (body `{ period?, employee_id?, items?: itemsSchema }`), `POST /kpi/tg/ev/reviews/:id/submit` (body `t.Optional(t.Object({ items: t.Optional(itemsSchema) }))`).

Правила: `evForm`: `parsePeriod(period)` (422 `bad_period`), пустой или не строка `employeeId` — 422 `bad_id`, дальше `getForm`. `evSaveDraft`: то же, затем `saveDraft(db, actor, period, employee_id, items ?? [])`. `evSubmit` зовёт `submitReview`. Все три возвращают `evFormOf(...)`. Проверки (`out_of_scope`, `no_card`, `too_early`, `missing_items`, `note_required`, `bad_score`, `unknown_item`, `already_submitted`, `period_closed`) приходят из сервисов, дополнительных нет.

- [ ] **Step 1: Написать `tg-app/ev-review.test.ts`** (чистый, без БД): фикстура `ReviewForm` с одним пунктом, `review.status: "submitted"`, `review.evaluator_user_id: "U1"`, нарушением с `recorded_by: "U1"`, `can_edit: true`, `deadlines: { period: "2025-10-01", submit_opens_at: "2025-10-19T19:00:00.000Z", review_deadline: "2025-11-07T18:59:59.999Z", dispute_deadline: "2025-11-10T18:59:59.999Z" }`.

```ts
it("evFormOf: отправленная только читается, ids оценщика не уходят, сроки плоскими полями", () => {
  const out = evFormOf(SUBMITTED);
  expect(out.can_edit).toBe(false);
  expect(out.submit_opens_at).toBe("2025-10-19T19:00:00.000Z");
  expect(out.review_deadline).toBe("2025-11-07T18:59:59.999Z");
  expect(out.card_title).toBe("Повар (Chopar и Les Ailes)");
  expect(JSON.stringify(out)).not.toContain("U1");
  expect(evFormOf({ ...SUBMITTED, review: { ...SUBMITTED.review!, status: "draft" } }).can_edit).toBe(true);
  expect(evFormOf({ ...SUBMITTED, review: null }).can_edit).toBe(true);
  expect(evFormOf({ ...SUBMITTED, can_edit: false, review: null }).can_edit).toBe(false);
});
```

- [ ] **Step 2: Написать `http/tg-app-ev-review.test.ts`** (обвязка как в задаче 1 плюс `kpi_reviews`, `kpi_notifications`, `kpi_periods`, `kpi_employee_cards`; `formOf`, `put`, `submit` — обёртки над `tgApi`).

```ts
const base = (ev: { id: string }, e: { id: string; terminal_id: string }) =>
  ({ employee_id: e.id, terminal_id: e.terminal_id, card_id: cookCardId, evaluator_user_id: ev.id, period: "2025-10-01" as const });
const formOf = (token: string, e: { id: string }, period = "2025-10-01") =>
  tgApi(token, "GET", `/api/kpi/tg/ev/form?period=${period}&employee_id=${e.id}`);
const fill = (form: any, v = 100) => form.items.map((i: any) => ({ item_id: i.item_id, score: i.source === "manual" ? v : null }));
const put = (token: string, body: object) => tgApi(token, "PUT", "/api/kpi/tg/ev/draft", { period: "2025-10-01", ...body });
const submit = (token: string, id: string) => tgApi(token, "POST", `/api/kpi/tg/ev/reviews/${id}/submit`, {});

it("форма, черновик и отправка: те же проверки и результат, что в админке; уведомление сотруднику", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const t1 = await makeTerminal(db);
  const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
  const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const token = await evSession(db, ev.id);
  const f0 = await formOf(token, e);
  expect(f0.status).toBe(200);
  expect(f0.body).toMatchObject({ period: "2025-10-01", period_status: "open", review: null, can_edit: true, open_dispute: false, dispute_rejected: false, submit_opens_at: "2025-10-19T19:00:00.000Z" });
  expect(f0.body.items).toHaveLength(cookItems.length);
  expect(JSON.stringify(f0.body)).not.toContain(ev.id);
  const d = await put(token, { employee_id: e.id, items: fill(f0.body) });
  expect(d.status).toBe(200);
  expect(d.body.review).toMatchObject({ status: "draft" });
  const [row] = await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, d.body.review.id));
  expect(row.evaluator_user_id).toBe(ev.id);
  const s = await submit(token, d.body.review.id);
  expect(s.status).toBe(200);
  expect(s.body.review).toMatchObject({ status: "submitted" });
  expect(s.body.can_edit).toBe(false);
  const [n] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `review_submitted:${d.body.review.id}`));
  expect([n.recipient_kind, n.employee_id]).toEqual(["employee", e.id]);
  expect(await submit(token, d.body.review.id)).toEqual({ status: 409, body: { error: "already_submitted" } });
  expect(await put(token, { employee_id: e.id, items: [] })).toEqual({ status: 409, body: { error: "already_submitted" } });
  const admin = await withSession({ permissions: ["kpi.evaluate"], userId: ev.id });
  const af = await api(admin, "GET", `/api/kpi/reviews/form?period=2025-10-01&employee_id=${e.id}`);
  expect(af.body.review.score_pct).toBe(s.body.review.score_pct);
});

it("ошибки сервисов доходят как есть: too_early, missing_items, bad_score, unknown_item, period_closed, no_card", async () => {
  const t1 = await makeTerminal(db);
  const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
  const token = await evSession(db, ev.id);
  setNow("2025-10-19T10:00:00+05:00");
  const e1 = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const d1 = await put(token, { employee_id: e1.id, items: fill((await formOf(token, e1)).body) });
  expect(await submit(token, d1.body.review.id)).toEqual({ status: 409, body: { error: "too_early", opens_at: "2025-10-19T19:00:00.000Z" } });
  setNow("2025-10-26T10:00:00+05:00");
  const e2 = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const f2 = (await formOf(token, e2)).body;
  const d2 = await put(token, { employee_id: e2.id, items: [] });
  const miss = await submit(token, d2.body.review.id);
  expect([miss.status, miss.body.error]).toEqual([422, "missing_items"]);
  expect(miss.body.items.slice().sort()).toEqual(f2.items.filter((i: any) => i.source === "manual").map((i: any) => i.item_id).sort());
  expect(await put(token, { employee_id: e2.id, items: [{ item_id: cookItems[1], score: 101 }] })).toEqual({ status: 422, body: { error: "bad_score", item_id: cookItems[1] } });
  const ghost = randomUUID();
  expect(await put(token, { employee_id: e2.id, items: [{ item_id: ghost, score: 50 }] })).toEqual({ status: 422, body: { error: "unknown_item", item_id: ghost } });
  await db.insert(kpi_periods).values({ period: "2025-08-01", status: "closed" });
  expect(await put(token, { period: "2025-08-01", employee_id: e2.id, items: [] })).toEqual({ status: 409, body: { error: "period_closed" } });
  expect((await formOf(token, e2, "2025-08-01")).body).toMatchObject({ period_status: "closed", can_edit: false });
  await db.insert(kpi_employee_cards).values({ employee_id: e2.id, card_id: null });
  // Сотрудника сняли с оценки (карта null) после загрузки формы: назначение «все карты» его ещё покрывает, но оценивать нечем.
  expect(await formOf(token, e2, "2025-09-01")).toEqual({ status: 422, body: { error: "no_card" } });
  expect(await put(token, { period: "2025-09-01", employee_id: e2.id, items: [] })).toEqual({ status: 422, body: { error: "no_card" } });
});

it("вне назначения: форма, черновик и отправка по id чужой оценки — 403; несуществующее и кривое — 404; мусор — 422", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
  const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
  const ev2 = await makeEvaluator(db); await makeScope(db, ev2.id, { terminal_id: t2.id });
  const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
  const fr = await seedReview(db, { ...base(ev2, foreign), scores: cookItems.map(() => 100), status: "draft" });
  const token = await evSession(db, ev.id);
  const OUT = { status: 403, body: { error: "out_of_scope" } };
  expect(await formOf(token, foreign)).toEqual(OUT);
  expect(await put(token, { employee_id: foreign.id, items: [] })).toEqual(OUT);
  expect(await submit(token, fr.id)).toEqual(OUT);
  expect((await formOf(token, { id: randomUUID() })).status).toBe(404);
  expect((await formOf(token, { id: "x" })).status).toBe(404);
  expect((await submit(token, randomUUID())).status).toBe(404);
  expect(await tgApi(token, "GET", "/api/kpi/tg/ev/form?period=2025-10-01")).toEqual({ status: 422, body: { error: "bad_id" } });
  expect(await tgApi(token, "GET", `/api/kpi/tg/ev/form?period=oct&employee_id=${foreign.id}`)).toEqual({ status: 422, body: { error: "bad_period" } });
  const [still] = await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, fr.id));
  expect(still.status).toBe("draft");
});

it("роль с kpi.approve не открывает форму чужого филиала; снятое назначение и отвязка действуют сразу", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
  const mine = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
  const hr = await makeEvaluator(db, { perms: ["kpi.evaluate", "kpi.approve", "kpi.view"] });
  await makeScope(db, hr.id, { terminal_id: t1.id });
  const b = await bindTelegram(db, { user_id: hr.id });
  const token = (await tgLogin(b.telegram_id)).body.token;
  expect((await formOf(token, mine)).status).toBe(200);
  expect(await formOf(token, foreign)).toEqual({ status: 403, body: { error: "out_of_scope" } });
  await db.delete(kpi_evaluator_scopes).where(eq(kpi_evaluator_scopes.user_id, hr.id));
  expect(await formOf(token, mine)).toEqual({ status: 403, body: { error: "out_of_scope" } });
  await db.update(kpi_tg_bindings).set({ active: false }).where(eq(kpi_tg_bindings.id, b.id));
  expect((await formOf(token, mine)).status).toBe(401);
});
```

- [ ] **Step 3: Run** `TESTENV && bun test src/modules/kpi/tg-app/ev-review.test.ts` и `TESTENV && bun test --timeout 30000 src/modules/kpi/http/tg-app-ev-review.test.ts` — Expected: FAIL (нет `ev-review.ts`, роутов).
- [ ] **Step 4: Реализовать** `ev-review.ts` и три роута в `tg-app-ev.ts`.
- [ ] **Step 5: Run** оба файла — Expected: PASS; затем `TESTENV && bun test --timeout 30000 src/modules/kpi/http/reviews.test.ts` — PASS (админка не затронута); типы backend — пусто.
- [ ] **Step 6: Commit**

```bash
git -C "$REPO" add backend/src/modules/kpi/tg-app/ev-review.ts backend/src/modules/kpi/tg-app/ev-review.test.ts backend/src/modules/kpi/routes/tg-app-ev.ts backend/src/modules/kpi/http/tg-app-ev-review.test.ts
git -C "$REPO" commit -m "feat(kpi): форма оценки, черновик и отправка для оценщика в мини-приложении" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Нарушения: запись с фото, отмена своего, фото

**Files:**
- Create: `backend/src/modules/kpi/tg-app/ev-violations.ts`, `backend/src/modules/kpi/http/tg-app-ev-violations.test.ts`
- Modify: `backend/src/modules/kpi/routes/tg-app-ev.ts`

**Interfaces:**
- Consumes: `evaluatorActor`; `createViolation`, `cancelViolation`, `listViolations`, `photoFile`, `normalizePhotos` (`violations.ts`); `ViolationRow` (`types.ts`); `loadDirectory`, `canEvaluate` (`directory.ts`); `loadScopes` (`access.ts`); `loadSettings`; `isPeriodClosed`; `periodOf` (`time.ts`); `MAX_PHOTOS`, `MAX_PHOTO_BYTES` (`storage.ts`); `kpi_card_items` (схема).
- Produces:
  ```ts
  export function evViolationOf(v: ViolationRow, canCancel: boolean): EvViolation; // recorded_by и имена авторов наружу не идут
  export async function evViolationForm(db: DbLike, actor: Actor, employeeId: unknown): Promise<EvViolationForm>;
  export async function evCreateViolation(db: DbLike, actor: Actor, input: { employee_id?: unknown; card_item_id?: string; comment?: string; photos: File[] }): Promise<EvViolation>;
  export async function evViolations(db: DbLike, actor: Actor, period: unknown, at: Date): Promise<EvViolations>;
  export async function evCancelViolation(db: DbLike, actor: Actor, id: string, reason: unknown): Promise<EvViolation>;
  ```
- Роуты: `GET /kpi/tg/ev/violation-form?employee_id`, `POST /kpi/tg/ev/violations` (`type: "multipart/form-data"`, схема тела как у `POST /kpi/violations`), `GET /kpi/tg/ev/violations?period`, `POST /kpi/tg/ev/violations/:id/cancel` (body `{ reason: t.Optional(t.Any()) }`), `GET /kpi/tg/ev/violation-photos/:id/file` (заголовки как у админского роута: `content-type`, `x-content-type-options: nosniff`, `cache-control: private, max-age=3600`, тело `Bun.file`).

Правила:
- `evViolationForm`: сотрудник через `loadDirectory({ employeeIds: [id], includeInactive: true })`; не uuid или не найден — 404 `not_found`; без `canEvaluate` по текущим филиалу и карте — 403 `out_of_scope`; `items` — активные пункты текущей карты по `sort` (нет карты — пусто); `photo_required` из `loadSettings`; `max_photos = MAX_PHOTOS`, `max_photo_bytes = MAX_PHOTO_BYTES`, `comment_min = 3`.
- `evCreateViolation`: `createViolation(db, actor, { employee_id, card_item_id, comment, photos })` без `occurred_at` (решение 6) и без собственных проверок; ответ `evViolationOf(row, true)`.
- `evViolations`: `period` не задан — `periodOf(at)`, иначе `parsePeriod`; `listViolations(db, actor, { period })`, оставить `recorded_by === actor.userId`; `can_cancel = status === "active" && !open_dispute && период не закрыт` (`isPeriodClosed` один раз на запрос).
- `evCancelViolation`: `cancelViolation(db, actor, id, reason as string)`; ответ `evViolationOf(row, false)`.
- Роут фото зовёт `photoFile(db, actor, id)` из `violations.ts` без обёртки внутри `run`; ошибка (`not_found` у чужого и несуществующего) уходит ответом, как у админского роута.

- [ ] **Step 1: Написать `http/tg-app-ev-violations.test.ts`** (обвязка как в задаче 1 плюс `tgForm`, `tgRaw`, `seedViolation`, `seedDispute`, `TINY_PNG`, `kpi_violations`).

```ts
const png = (name = "p.png") => new File([TINY_PNG], name, { type: "image/png" });
const mp = (fields: Record<string, string>, files: File[] = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append("photos", f);
  return fd;
};
const OUT = { status: 403, body: { error: "out_of_scope" } };

it("форма нарушения и запись с фото: ответ, запись, уведомление; фото отдаётся в пределах назначения", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
  const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
  const ev2 = await makeEvaluator(db); await makeScope(db, ev2.id, { terminal_id: t2.id });
  const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
  const token = await evSession(db, ev.id);
  const vf = await tgApi(token, "GET", `/api/kpi/tg/ev/violation-form?employee_id=${e.id}`);
  expect(vf.body).toMatchObject({ employee: { id: e.id }, card_title: "Повар (Chopar и Les Ailes)", photo_required: false, max_photos: 3, max_photo_bytes: 10485760, comment_min: 3 });
  expect(vf.body.items).toHaveLength(cookItems.length);
  expect(vf.body.items[0].id).toBe(cookItems[0]);
  expect(await tgApi(token, "GET", `/api/kpi/tg/ev/violation-form?employee_id=${foreign.id}`)).toEqual(OUT);
  const ok = await tgForm(token, "/api/kpi/tg/ev/violations", mp({ employee_id: e.id, card_item_id: cookItems[1], comment: "Грязный пол у кассы" }, [png()]));
  expect(ok.status).toBe(200);
  expect(ok.body).toMatchObject({ employee_id: e.id, card_item_id: cookItems[1], comment: "Грязный пол у кассы", status: "active", period: "2025-10-01", open_dispute: false, can_cancel: true });
  expect(ok.body.photo_ids).toHaveLength(1);
  expect(JSON.stringify(ok.body)).not.toContain(ev.id);
  const [n] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `violation_recorded:${ok.body.id}`));
  expect([n.recipient_kind, n.employee_id]).toEqual(["employee", e.id]);
  const file = await tgRaw(token, `/api/kpi/tg/ev/violation-photos/${ok.body.photo_ids[0]}/file`);
  expect([file.status, file.headers.get("content-type")]).toEqual([200, "image/png"]);
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(TINY_PNG);
  const theirs = await seedViolation(db, { employee_id: foreign.id, terminal_id: t2.id, recorded_by: ev2.id, period: "2025-10-01", occurred_at: "2025-10-14T07:00:00.000Z", photo: TINY_PNG });
  expect((await tgRaw(token, `/api/kpi/tg/ev/violation-photos/${theirs.photo_id}/file`)).status).toBe(404);
  expect((await tgRaw(token, `/api/kpi/tg/ev/violation-photos/${randomUUID()}/file`)).status).toBe(404);
  expect((await tgRaw(null, `/api/kpi/tg/ev/violation-photos/${ok.body.photo_ids[0]}/file`)).status).toBe(401);
});

it("ошибки записи: комментарий, тип и число фото, чужой сотрудник, нет сотрудника, фото обязательно", async () => {
  const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
  const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
  const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
  const token = await evSession(db, ev.id);
  const post = (fields: Record<string, string>, files: File[] = []) => tgForm(token, "/api/kpi/tg/ev/violations", mp(fields, files));
  expect((await post({ employee_id: e.id, comment: "ab" })).body).toEqual({ error: "comment_required" });
  expect((await post({ employee_id: e.id, comment: "Нет формы" }, [new File(["x"], "a.txt", { type: "text/plain" })])).body).toEqual({ error: "bad_photo_type" });
  expect((await post({ employee_id: e.id, comment: "Нет формы" }, [png(), png(), png(), png()])).body).toEqual({ error: "too_many_photos" });
  expect(await post({ employee_id: foreign.id, comment: "Нет формы" })).toEqual(OUT);
  expect((await post({ comment: "Нет формы" })).body).toEqual({ error: "bad_id" });
  const hr = await withSession({ permissions: ["kpi.manage"] });
  expect((await api(hr, "PUT", "/api/kpi/settings", { violation_photo_required: true })).status).toBe(200);
  expect((await post({ employee_id: e.id, comment: "Нет формы" })).body).toEqual({ error: "photo_required" });
  expect((await api(hr, "PUT", "/api/kpi/settings", { violation_photo_required: false })).status).toBe(200);
  const emp = await makeEmployee(db, { role_code: "cook" });
  const empToken = (await tgLogin((await bindTelegram(db, { employee_id: emp.id })).telegram_id)).body.token;
  expect(await tgForm(empToken, "/api/kpi/tg/ev/violations", mp({ employee_id: e.id, comment: "Нет формы" }))).toEqual({ status: 403, body: { error: "not_evaluator" } });
});

it("мои нарушения и отмена: только мои, can_cancel, чужое и спор не отменяются, роль с approve тоже", async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const t1 = await makeTerminal(db);
  const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
  const other = await makeEvaluator(db); await makeScope(db, other.id, { terminal_id: t1.id });
  const hr = await makeEvaluator(db, { perms: ["kpi.evaluate", "kpi.approve"] }); await makeScope(db, hr.id, { terminal_id: t1.id });
  const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const v = (o: object) => seedViolation(db, { employee_id: e.id, terminal_id: t1.id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-20T07:00:00.000Z", ...o } as any);
  const mine = await v({ comment: "Мой", photo: TINY_PNG });
  const gone = await v({ status: "cancelled", cancel_reason: "ошибка" });
  const disputed = await v({});
  await seedDispute(db, { subject_type: "violation", subject_id: disputed.id, employee_id: e.id, period: "2025-10-01" });
  const others = await v({ recorded_by: other.id });
  const token = await evSession(db, ev.id);
  const list = await tgApi(token, "GET", "/api/kpi/tg/ev/violations?period=2025-10-01");
  expect(list.body).toMatchObject({ period: "2025-10-01", period_status: "open" });
  const byId = new Map<string, any>(list.body.items.map((x: any) => [x.id, x]));
  expect([...byId.keys()].sort()).toEqual([mine.id, gone.id, disputed.id].sort());
  expect([byId.get(mine.id).can_cancel, byId.get(gone.id).can_cancel, byId.get(disputed.id).can_cancel]).toEqual([true, false, false]);
  expect(byId.get(mine.id).photo_ids).toEqual([mine.photo_id]);
  expect((await tgApi(token, "GET", "/api/kpi/tg/ev/violations")).body.period).toBe("2025-10-01");
  const cancel = (id: string, reason: unknown, tk = token) => tgApi(tk, "POST", `/api/kpi/tg/ev/violations/${id}/cancel`, { reason });
  expect(await cancel(mine.id, "ab")).toEqual({ status: 422, body: { error: "comment_required" } });
  const c = await cancel(mine.id, "Записано по ошибке");
  expect(c.status).toBe(200);
  expect(c.body).toMatchObject({ id: mine.id, status: "cancelled", cancel_reason: "Записано по ошибке", can_cancel: false });
  expect((await cancel(mine.id, "Записано по ошибке")).body).toEqual({ error: "already_cancelled" });
  expect(await cancel(disputed.id, "Записано по ошибке")).toEqual({ status: 409, body: { error: "open_dispute" } });
  expect(await cancel(others.id, "Записано по ошибке")).toEqual({ status: 403, body: { error: "forbidden" } });
  expect(await cancel(others.id, "Записано по ошибке", await evSession(db, hr.id))).toEqual({ status: 403, body: { error: "forbidden" } });
  const [row] = await db.select().from(kpi_violations).where(eq(kpi_violations.id, others.id));
  expect(row.status).toBe("active");
  expect((await cancel(randomUUID(), "Записано по ошибке")).status).toBe(404);
});
```

- [ ] **Step 2: Run** `TESTENV && bun test --timeout 30000 src/modules/kpi/http/tg-app-ev-violations.test.ts` — Expected: FAIL (роутов нет).
- [ ] **Step 3: Реализовать** `ev-violations.ts` и пять роутов в `tg-app-ev.ts`.
- [ ] **Step 4: Run** тот же файл — Expected: PASS; затем `TESTENV && bun test --timeout 30000 src/modules/kpi/http/violations.test.ts` — PASS; типы backend — пусто.
- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add backend/src/modules/kpi/tg-app/ev-violations.ts backend/src/modules/kpi/routes/tg-app-ev.ts backend/src/modules/kpi/http/tg-app-ev-violations.test.ts
git -C "$REPO" commit -m "feat(kpi): нарушения оценщика в мини-приложении: запись с фото, отмена своего" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Споры: список, карточка, разбор

**Files:**
- Create: `backend/src/modules/kpi/tg-app/ev-disputes.ts`, `backend/src/modules/kpi/http/tg-app-ev-disputes.test.ts`
- Modify: `backend/src/modules/kpi/routes/tg-app-ev.ts`

**Interfaces:**
- Consumes: `evaluatorActor`; `evForm` (задача 2); `listDisputes`, `resolveDispute` (`disputes.ts`, не менять); `DisputeRow` (`types.ts`); `ItemInput`; `itemsSchema`; `loadSettings` (`change_comment_min`); `kpi_reviews`, `kpi_violations`, `kpi_card_items`, `kpi_violation_photos` (схема).
- Produces:
  ```ts
  export async function evDisputes(db: DbLike, actor: Actor, status: unknown): Promise<EvDisputes>;
  export async function evDisputeDetail(db: DbLike, actor: Actor, id: string): Promise<EvDisputeDetail>;
  export async function evResolve(db: DbLike, actor: Actor, id: string, body: { decision?: unknown; comment?: unknown; items?: ItemInput[] }): Promise<EvDispute>;
  ```
- Роуты: `GET /kpi/tg/ev/disputes` (query `status` `t.Optional(t.Any())`), `GET /kpi/tg/ev/disputes/:id`, `POST /kpi/tg/ev/disputes/:id/resolve` (body как у `POST /kpi/disputes/:id/resolve`: `decision`, `comment` — `t.Optional(t.Any())`, `items` — `t.Optional(itemsSchema)`).

Правила:
- `evDisputes`: `listDisputes(db, actor, { status: status as string | undefined })`; каждая строка → `EvDispute` (без `opened_via`, `resolved_by_name`); `subject` собирается пакетом: для оценок `score_pct` из `kpi_reviews`, для нарушений `item_title_ru`, `comment` и `photo_ids` (`kpi_violation_photos` по `created_at`). Порядок строк не меняется, `can_resolve` не пересчитывается.
- `evDisputeDetail`: id не uuid или спора нет среди результата `listDisputes(db, actor, {})` — 404 `not_found` (чужой спор и несуществующий неотличимы); `comment_min` из `loadSettings(db).change_comment_min`; `form` — `evForm(db, actor, dispute.period, dispute.employee_id)` для спора по оценке, иначе `null`.
- `evResolve`: `resolveDispute(db, actor, id, { decision, comment, items })`, результат `EvDispute` с `subject: null`. Авторизации в приложении нет: её делает `resolveDispute`.

- [ ] **Step 1: Написать `http/tg-app-ev-disputes.test.ts`** (обвязка как в задаче 1, включая `randomUUID`, плюс `seedReview`, `seedViolation`, `seedDispute`, `kpi_disputes`, `kpi_review_events`, `kpi_violations`, `kpi_periods`, `kpi_notifications`).

```ts
const setupDispute = async () => {
  setNow("2025-10-26T10:00:00+05:00");
  const t1 = await makeTerminal(db);
  const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
  const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const rv = await seedReview(db, { employee_id: e.id, terminal_id: t1.id, card_id: cookCardId, evaluator_user_id: ev.id, period: "2025-10-01",
    scores: cookItems.map((_, i) => (i === 1 ? 50 : 100)) });
  const d = await seedDispute(db, { subject_type: "review", subject_id: rv.id, employee_id: e.id, period: "2025-10-01" });
  return { t1, ev, e, rv, d, token: await evSession(db, ev.id) };
};
const resolve = (token: string, id: string, body: object) => tgApi(token, "POST", `/api/kpi/tg/ev/disputes/${id}/resolve`, body);

it("список и карточка: мой спор с разбором; спор вне назначения не виден; HR-роль без kpi.evaluate — 403", async () => {
  const { e, rv, d, token } = await setupDispute();
  const list = await tgApi(token, "GET", "/api/kpi/tg/ev/disputes");
  const mine = list.body.items.find((x: any) => x.id === d.id);
  expect(mine).toMatchObject({ status: "open", can_resolve: true, employee_id: e.id, period: "2025-10-01", subject_type: "review", reason: "Тест спор: не согласен", subject: { kind: "review", score_pct: rv.score_pct } });
  expect((await tgApi(token, "GET", "/api/kpi/tg/ev/disputes?status=rejected")).body.items.map((x: any) => x.id)).not.toContain(d.id);
  expect(await tgApi(token, "GET", "/api/kpi/tg/ev/disputes?status=bad")).toEqual({ status: 422, body: { error: "bad_status" } });
  const detail = await tgApi(token, "GET", `/api/kpi/tg/ev/disputes/${d.id}`);
  expect(detail.body).toMatchObject({ comment_min: 5, dispute: { id: d.id, can_resolve: true }, form: { review: { status: "submitted" }, can_edit: false } });
  expect(detail.body.form.items).toHaveLength(cookItems.length);
  const t2 = await makeTerminal(db);
  const ev3 = await makeEvaluator(db); await makeScope(db, ev3.id, { terminal_id: t2.id });
  const token3 = await evSession(db, ev3.id);
  expect((await tgApi(token3, "GET", "/api/kpi/tg/ev/disputes")).body.items.map((x: any) => x.id)).not.toContain(d.id);
  expect(await tgApi(token3, "GET", `/api/kpi/tg/ev/disputes/${d.id}`)).toEqual({ status: 404, body: { error: "not_found" } });
  expect((await tgApi(token, "GET", `/api/kpi/tg/ev/disputes/${randomUUID()}`)).status).toBe(404);
  expect((await tgApi(token, "GET", "/api/kpi/tg/ev/disputes/x")).status).toBe(404);
  const hr = await makeEvaluator(db, { perms: ["kpi.approve"] });
  expect(await tgApi(await evSession(db, hr.id), "GET", "/api/kpi/tg/ev/disputes")).toEqual({ status: 403, body: { error: "forbidden" } });
});

it("разбор: принять оценку с новыми баллами; отклонить; принять спор по нарушению отменяет его", async () => {
  const { t1, ev, e, rv, d, token } = await setupDispute();
  const detail = (await tgApi(token, "GET", `/api/kpi/tg/ev/disputes/${d.id}`)).body;
  const items = detail.form.items.map((i: any) => ({ item_id: i.item_id, score: i.item_id === cookItems[1] ? 100 : i.score, note: i.note }));
  const ok = await resolve(token, d.id, { decision: "accepted", comment: "Согласен, пересчитал", items });
  expect(ok.status).toBe(200);
  expect(ok.body).toMatchObject({ id: d.id, status: "accepted", resolution_comment: "Согласен, пересчитал", can_resolve: false });
  const [row] = await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, rv.id));
  expect(Number(row.score_pct)).toBe(100);
  const kinds = (await db.select().from(kpi_review_events).where(eq(kpi_review_events.review_id, rv.id))).map((x) => x.kind);
  expect(kinds).toEqual(expect.arrayContaining(["changed", "dispute_resolved"]));
  const [n] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `dispute_resolved:${d.id}`));
  expect([n.recipient_kind, n.employee_id]).toEqual(["employee", e.id]);
  expect((await resolve(token, d.id, { decision: "rejected", comment: "Оценка верна" })).body).toEqual({ error: "dispute_closed" });

  const e2 = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const rv2 = await seedReview(db, { employee_id: e2.id, terminal_id: t1.id, card_id: cookCardId, evaluator_user_id: ev.id, period: "2025-10-01", scores: cookItems.map(() => 90) });
  const d2 = await seedDispute(db, { subject_type: "review", subject_id: rv2.id, employee_id: e2.id, period: "2025-10-01" });
  const rej = await resolve(token, d2.id, { decision: "rejected", comment: "Оценка верна" });
  expect([rej.status, rej.body.status]).toEqual([200, "rejected"]);
  expect(Number((await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, rv2.id)))[0].score_pct)).toBe(90);

  const e3 = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const vio = await seedViolation(db, { employee_id: e3.id, terminal_id: t1.id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-20T07:00:00.000Z" });
  const d3 = await seedDispute(db, { subject_type: "violation", subject_id: vio.id, employee_id: e3.id, period: "2025-10-01" });
  const listed = (await tgApi(token, "GET", "/api/kpi/tg/ev/disputes")).body.items.find((x: any) => x.id === d3.id);
  expect(listed.subject).toMatchObject({ kind: "violation", comment: "Тест нарушение", photo_ids: [] });
  expect((await resolve(token, d3.id, { decision: "accepted", comment: "Нарушение снято" })).body.status).toBe("accepted");
  expect((await db.select().from(kpi_violations).where(eq(kpi_violations.id, vio.id)))[0].status).toBe("cancelled");
});

it("ошибки разбора: нет баллов, коротко, неверное решение, чужой спор, закрытый месяц", async () => {
  const { t1, ev, d, token } = await setupDispute();
  expect(await resolve(token, d.id, { decision: "accepted", comment: "Согласен, пересчитал" })).toEqual({ status: 422, body: { error: "items_required" } });
  expect(await resolve(token, d.id, { decision: "rejected", comment: "ab" })).toEqual({ status: 422, body: { error: "comment_required", min: 5 } });
  expect(await resolve(token, d.id, { decision: "maybe", comment: "Оценка верна" })).toEqual({ status: 422, body: { error: "bad_decision" } });
  const t2 = await makeTerminal(db);
  const ev3 = await makeEvaluator(db); await makeScope(db, ev3.id, { terminal_id: t2.id });
  expect(await resolve(await evSession(db, ev3.id), d.id, { decision: "rejected", comment: "Оценка верна" })).toEqual({ status: 403, body: { error: "out_of_scope" } });
  const hr = await makeEvaluator(db, { perms: ["kpi.approve"] });
  expect(await resolve(await evSession(db, hr.id), d.id, { decision: "rejected", comment: "Оценка верна" })).toEqual({ status: 403, body: { error: "forbidden" } });
  expect((await db.select().from(kpi_disputes).where(eq(kpi_disputes.id, d.id)))[0].status).toBe("open");
  const e4 = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
  const old = await seedReview(db, { employee_id: e4.id, terminal_id: t1.id, card_id: cookCardId, evaluator_user_id: ev.id, period: "2025-09-01", scores: cookItems.map(() => 80) });
  const d4 = await seedDispute(db, { subject_type: "review", subject_id: old.id, employee_id: e4.id, period: "2025-09-01" });
  await db.insert(kpi_periods).values({ period: "2025-09-01", status: "closed" });
  const form = (await tgApi(token, "GET", `/api/kpi/tg/ev/disputes/${d4.id}`)).body.form;
  const items = form.items.map((i: any) => ({ item_id: i.item_id, score: 100, note: i.note }));
  expect(await resolve(token, d4.id, { decision: "accepted", comment: "Согласен, пересчитал", items })).toEqual({ status: 409, body: { error: "period_closed" } });
});
```

- [ ] **Step 2: Run** `TESTENV && bun test --timeout 30000 src/modules/kpi/http/tg-app-ev-disputes.test.ts` — Expected: FAIL (роутов нет).
- [ ] **Step 3: Реализовать** `ev-disputes.ts` и три роута.
- [ ] **Step 4: Run** тот же файл — Expected: PASS; затем `TESTENV && bun test --timeout 30000 src/modules/kpi/http/disputes.test.ts` — PASS; типы backend — пусто.
- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add backend/src/modules/kpi/tg-app/ev-disputes.ts backend/src/modules/kpi/routes/tg-app-ev.ts backend/src/modules/kpi/http/tg-app-ev-disputes.test.ts
git -C "$REPO" commit -m "feat(kpi): споры оценщика в мини-приложении: список, карточка, разбор" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6 (выполняется, когда поток `admin-scopes` влит в ветку).** Признак слияния: `grep -n "mayResolve" "$REPO/backend/src/modules/kpi/disputes.ts"` находит совпадение; пока не находит, шаг пропустить и записать в описание PR, что он ждёт слияния. Порядок слияния по спеке 1, 3, 2, поэтому этот поток обычно идёт последним: `git -C "$REPO" fetch origin && git -C "$REPO" merge origin/main`, затем добавить в `tg-app-ev-disputes.test.ts`:

```ts
it("после слияния admin-scopes: не автор с тем же назначением не разбирает; назначение автора снято — разбирает новый оценщик", async () => {
  const { t1, ev, d, token } = await setupDispute();
  const next = await makeEvaluator(db); await makeScope(db, next.id, { terminal_id: t1.id });
  const nextToken = await evSession(db, next.id);
  const canOf = async (tk: string) => (await tgApi(tk, "GET", "/api/kpi/tg/ev/disputes")).body.items.find((x: any) => x.id === d.id)?.can_resolve ?? false;
  expect([await canOf(token), await canOf(nextToken)]).toEqual([true, false]);
  expect(await resolve(nextToken, d.id, { decision: "rejected", comment: "Оценка верна" })).toEqual({ status: 403, body: { error: "out_of_scope" } });
  await db.delete(kpi_evaluator_scopes).where(eq(kpi_evaluator_scopes.user_id, ev.id));
  expect([await canOf(token), await canOf(nextToken)]).toEqual([false, true]);
  const ok = await resolve(nextToken, d.id, { decision: "rejected", comment: "Оценка верна" });
  expect([ok.status, ok.body.status]).toEqual([200, "rejected"]);
});
```
  Run `TESTENV && bun test --timeout 30000 src/modules/kpi/http/tg-app-ev-disputes.test.ts` — PASS; commit `git -C "$REPO" add backend/src/modules/kpi/http/tg-app-ev-disputes.test.ts` с сообщением `test(kpi): разбор спора автором и новым оценщиком в мини-приложении` и той же строкой `Co-Authored-By`.

---

### Task 5: Кнопка «Открыть» в уведомлениях оценщику

**Files:**
- Modify: `backend/src/modules/kpi/tg/miniapp-url.ts`, `backend/src/modules/kpi/tg/messages.test.ts`, `backend/src/modules/kpi/http/delivery.test.ts`

**Interfaces:**
- Consumes: `appRoute`, `buildMessage`, `deliverOne`.
- Produces: `appRoute("dispute_opened", p)` → `"/ev/disputes"`; `appRoute("remind_evaluate", p)` → `` `/ev/${YYYY-MM}` `` при валидном `p.period`, иначе `null`; `overdue_summary` остаётся `null`. Комментарий над `appRoute` («оценщику… кнопки нет») переписывается. `notify.ts` и `worker/deliver.ts` не меняются: доставка уже передаёт `appUrl` для любого вида (`worker/deliver.ts:120`), спека зовёт эту правку «в `tg/` и `notify`», но в `notify` она не нужна.

- [ ] **Step 1: Тесты.** В `tg/messages.test.ts`, блок `describe("кнопка «Открыть»")`: в тесте «без срока спора — одна «Открыть»…» удалить проверку `remind_evaluate … toBeUndefined()` и добавить:

```ts
it("оценщик: dispute_opened ведёт на споры, remind_evaluate — на список месяца; кривой срок и сводка HR — без кнопки", () => {
  const DISP = { dispute_id: R, subject_type: "review", subject_id: R, employee_id: R, period: "2025-10-01", employee_name: "Тест Повар", reason: "причина" };
  expect(M.buildMessage("dispute_opened", DISP, { ...ru(), appUrl: APP }).reply_markup)
    .toEqual({ inline_keyboard: [[{ text: "Открыть", web_app: { url: `${APP}#/ev/disputes` } }]] });
  expect(M.buildMessage("remind_evaluate", { period: "2025-10-01", pending: 2, deadline: UNTIL }, { ...uz(null), appUrl: APP }).reply_markup)
    .toEqual({ inline_keyboard: [[{ text: "Ochish", web_app: { url: `${APP}#/ev/2025-10` } }]] });
  expect(M.buildMessage("remind_evaluate", { period: "2025-13-01", pending: 2, deadline: UNTIL }, { ...ru(), appUrl: APP }).reply_markup).toBeUndefined();
  expect(M.buildMessage("overdue_summary", { period: "2025-10-01", lagging: [], lagging_total: 0 }, { ...ru(), appUrl: APP }).reply_markup).toBeUndefined();
  expect(M.buildMessage("dispute_opened", DISP, ru()).reply_markup).toBeUndefined();
});
```
  В `http/delivery.test.ts` после теста «успех до срока споров с KPI_MINIAPP_URL…» добавить:

```ts
it("dispute_opened и remind_evaluate оценщику с KPI_MINIAPP_URL: одна кнопка «Открыть» на экран оценщика", async () => {
  setNow("2025-11-05T10:00:00+05:00");
  const saved = process.env.KPI_MINIAPP_URL;
  process.env.KPI_MINIAPP_URL = "https://x.test/kpi-app/";
  try {
    const u = await makeUser(db); await bindTelegram(db, { user_id: u.id });
    const open = async (kind: string, payload: Record<string, unknown>) => {
      const f = fakeBotApi();
      expect(await go(await note({ user_id: u.id, kind, payload }), f.api)).toEqual({ result: "sent" });
      return (f.sent[0].msg.reply_markup as any).inline_keyboard;
    };
    expect(await open("dispute_opened", { dispute_id: RID, subject_type: "review", subject_id: RID, employee_id: RID, period: P10, employee_name: "Тест", reason: "причина" }))
      .toEqual([[{ text: "Открыть", web_app: { url: "https://x.test/kpi-app/#/ev/disputes" } }]]);
    expect(await open("remind_evaluate", { period: P10, pending: 2, deadline: "2025-11-07T18:59:59.999Z" }))
      .toEqual([[{ text: "Открыть", web_app: { url: "https://x.test/kpi-app/#/ev/2025-10" } }]]);
  } finally {
    if (saved === undefined) delete process.env.KPI_MINIAPP_URL; else process.env.KPI_MINIAPP_URL = saved;
  }
});
```
- [ ] **Step 2: Run** `TESTENV && bun test src/modules/kpi/tg/messages.test.ts` и `TESTENV && bun test --timeout 30000 src/modules/kpi/http/delivery.test.ts` — Expected: FAIL (кнопки у оценщика нет).
- [ ] **Step 3: Реализовать** два `case` в `appRoute`; переписать комментарий над функцией.
- [ ] **Step 4: Run** те же два файла — Expected: PASS; затем `TESTENV && bun test src/modules/kpi/tg` и `TESTENV && bun test --timeout 30000 src/modules/kpi/http/notify.test.ts` — PASS (код `tg/*` исполняет воркер на ES2021: новых методов нет).
- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add backend/src/modules/kpi/tg/miniapp-url.ts backend/src/modules/kpi/tg/messages.test.ts backend/src/modules/kpi/http/delivery.test.ts
git -C "$REPO" commit -m "feat(kpi): кнопка «Открыть» в уведомлениях оценщику о споре и напоминании" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Ядро клиента: маршруты, роли, загрузка без кэша, multipart, исходы действий

**Files:**
- Create: `kpi_miniapp/src/view/ev-errors.ts`, `kpi_miniapp/test/view-ev-errors.test.ts`
- Modify: `kpi_miniapp/src/route.ts`, `kpi_miniapp/src/api.ts`, `kpi_miniapp/src/load.ts`, `kpi_miniapp/src/main.ts`, `kpi_miniapp/src/i18n.ts`, `kpi_miniapp/test/route.test.ts`, `kpi_miniapp/test/api.test.ts`, `kpi_miniapp/test/load.test.ts`, `kpi_miniapp/test/i18n.test.ts`

**Interfaces:**
- Consumes: типы `ev-types.ts`; `ApiResult` (`api.ts`); `dayMonth` (`format.ts`); `Key`, `Lang` (`i18n.ts`).
- Produces:
  ```ts
  // route.ts
  export type Route = … | { name: "ev"; period: string | null } | { name: "ev_review"; period: string; employee_id: string }
    | { name: "ev_violation"; employee_id: string } | { name: "ev_violations"; period: string | null }
    | { name: "ev_disputes" } | { name: "ev_dispute"; id: string };
  export function isEvRoute(r: Route): boolean;
  export function routeAllowed(r: Route, roles: readonly string[]): boolean; // home всем; ev_* — roles содержит "evaluator"; остальные — "employee"
  // api.ts
  sendForm<T>(path: string, body: FormData): Promise<ApiResult<T>>;   // POST, срок blobTimeoutMs, без ручного Content-Type
  // load.ts
  export function loadVia<T>(d: LoadDeps<T>, path: string, onSlow: () => void, noCache?: boolean): Promise<Loaded<T>>;
  export function loadScreen<T>(path: string, onSlow: () => void, noCache?: boolean): Promise<Loaded<T>>;
  // view/ev-errors.ts
  export type EvOutcome = { kind: "done" } | { kind: "unknown" } | { kind: "session" } | { kind: "reload"; key: Key }
    | { kind: "error"; key: Key; vars?: Record<string, string | number> };
  export function evOutcome(r: ApiResult<unknown>, l: Lang): EvOutcome;
  export function evNoticeKey(code: string): Key | null; // forbidden, out_of_scope, no_card → ev_err_*; иначе null
  ```
- Форматы хеша: `#/ev`, `#/ev/2026-10`, `#/ev/review/2026-10/<uuid>`, `#/ev/violation/<uuid>`, `#/ev/violations`, `#/ev/violations/2026-10`, `#/ev/disputes`, `#/ev/dispute/<uuid>`. Кривой месяц или id — главный экран.

Правила `evOutcome`: `ok` → `done`; `fail` со статусом `offline` → `unknown` (запрос мог дойти до сервера); `fail` с другим статусом и `http` с `not_evaluator`, `not_employee` → `session` (разбирает роутер); `http` с кодами `already_submitted`, `dispute_closed`, `already_cancelled`, `unknown_item`, `period_closed`, `not_found` → `reload` с ключом текста; прочие `http` → `error` с ключом из таблицы и параметрами (`too_early` → `{ date: dayMonth(body.opens_at, l) }`, `comment_required` → `{ min: body.min }`); неизвестный код → `err_generic`. Ключи: `ev_err_<код>` из списка ниже, а `comment_required` → `err_comment_required`, `period_closed` → `err_period_closed`, `already_cancelled` → `err_already_cancelled`, `not_found` → `err_not_found`.

Правки `main.ts` (все точечные; импорт `./style-ev.css` добавляет задача 7):
1. `guard(r)` возвращает `r`, если `routeAllowed(r, roles)`, иначе сбрасывает хеш в `#/` и отдаёт главный (комментарий «Решение 18» обновить: роль нужна и сотруднику, и оценщику).
2. `Screen` получает `noCache?: boolean`; `showAsync` передаёт его третьим аргументом в `loadScreen`.
3. В `screenOf` для всех шести новых маршрутов пока `default: return screenOf(HOME);` с комментарием «экраны оценщика подключают задачи 7–11»; задача 11 удаляет `default`, и компилятор снова проверяет полноту.
4. В `present()` `res.error === "not_employee" || res.error === "not_evaluator"` → `goHome()`; для остальных `http`: если `evNoticeKey(res.error)` вернул ключ — показать `notice(sc, key)` вместо `statusScreen`. `notFound(sc)` переименовать в `notice(sc, key)` с тем же видом (карточка `.notfound`, заголовок экрана над ней), `404` зовёт `notice(sc, "err_not_found")`.

- [ ] **Step 1: Тесты.** `test/route.test.ts`:

```ts
const ID = "3f2b8c1e-5a4d-4e7f-9b21-0c6d8e9a1b23";
it("parseHash и hashOf: экраны оценщика, параметры Telegram, мусор", () => {
  expect(parseHash("#/ev")).toEqual({ name: "ev", period: null });
  expect(parseHash("#/ev/2026-10")).toEqual({ name: "ev", period: "2026-10-01" });
  expect(parseHash(`#/ev/review/2026-10/${ID}?tgWebAppData=abc&tgWebAppVersion=7.10`)).toEqual({ name: "ev_review", period: "2026-10-01", employee_id: ID });
  expect(parseHash(`#/ev/violation/${ID}`)).toEqual({ name: "ev_violation", employee_id: ID });
  expect(parseHash("#/ev/violations")).toEqual({ name: "ev_violations", period: null });
  expect(parseHash("#/ev/violations/2026-09")).toEqual({ name: "ev_violations", period: "2026-09-01" });
  expect(parseHash("#/ev/disputes")).toEqual({ name: "ev_disputes" });
  expect(parseHash(`#/ev/dispute/${ID}`)).toEqual({ name: "ev_dispute", id: ID });
  for (const bad of ["#/ev/2026-13", "#/ev/review/2026-10/x", "#/ev/review/2026-13/" + ID, "#/ev/violation/", "#/ev/dispute/zzz", "#/ev/other"]) expect(parseHash(bad)).toEqual({ name: "home" });
  const routes = [{ name: "ev", period: null }, { name: "ev", period: "2026-10-01" }, { name: "ev_review", period: "2026-10-01", employee_id: ID },
    { name: "ev_violation", employee_id: ID }, { name: "ev_violations", period: null }, { name: "ev_violations", period: "2026-09-01" }, { name: "ev_disputes" }, { name: "ev_dispute", id: ID }] as const;
  for (const r of routes) expect(parseHash(hashOf(r))).toEqual(r);
  expect(hashOf({ name: "ev_review", period: "2026-10-01", employee_id: ID })).toBe(`#/ev/review/2026-10/${ID}`);
});
it("routeAllowed: сотрудник не заходит на экраны оценщика и наоборот; главный всем", () => {
  expect(routeAllowed({ name: "home" }, [])).toBe(true);
  expect(routeAllowed({ name: "ev", period: null }, ["employee"])).toBe(false);
  expect(routeAllowed({ name: "ev_disputes" }, ["evaluator"])).toBe(true);
  expect(routeAllowed({ name: "review", period: "2026-10-01" }, ["evaluator"])).toBe(false);
  expect(routeAllowed({ name: "history" }, ["employee", "evaluator"])).toBe(true);
  expect([isEvRoute({ name: "ev_dispute", id: ID }), isEvRoute({ name: "history" })]).toEqual([true, false]);
});
```
  `test/api.test.ts`:
```ts
it("sendForm: multipart без ручного Content-Type, Bearer, один повторный вход на 401, то же тело", async () => {
  const seen: { url: string; ct: string | null; auth: string | null; body: unknown }[] = [];
  const r = [ok({ token: "t1", roles: ["evaluator"], lang: "ru" }), ok({ error: "unauthorized" }, 401), ok({ token: "t2", roles: ["evaluator"], lang: "ru" }), ok({ id: "v1" })];
  const f = (async (url: string, init: RequestInit = {}) => { const h = new Headers(init.headers); seen.push({ url, ct: h.get("Content-Type"), auth: h.get("Authorization"), body: init.body }); return r.shift()!; }) as any;
  const fd = new FormData(); fd.append("comment", "Грязный пол");
  expect(await createApi({ fetch: f, sdk: () => "ok", initData: () => "q" }).sendForm("/ev/violations", fd)).toEqual({ kind: "ok", data: { id: "v1" } });
  expect(seen.map((s) => [s.url, s.ct, s.auth])).toEqual([["/api/kpi/tg/auth", "application/json", null], ["/api/kpi/tg/ev/violations", null, "Bearer t1"], ["/api/kpi/tg/auth", "application/json", null], ["/api/kpi/tg/ev/violations", null, "Bearer t2"]]);
  expect([seen[1]!.body, seen[3]!.body]).toEqual([fd, fd]);
});
it("sendForm: сеть упала — offline; 409 с телом — http", async () => {
  const down = (async () => { throw new TypeError("Failed to fetch"); }) as any;
  expect(await createApi({ fetch: down, sdk: () => "ok", initData: () => "q" }).sendForm("/ev/violations", new FormData())).toEqual({ kind: "fail", status: "offline" });
  const r = [ok({ token: "t", roles: ["evaluator"], lang: "ru" }), ok({ error: "period_closed" }, 409)];
  const f = (async () => r.shift()!) as any;
  expect(await createApi({ fetch: f, sdk: () => "ok", initData: () => "q" }).sendForm("/ev/violations", new FormData()))
    .toEqual({ kind: "http", code: 409, error: "period_closed", body: { error: "period_closed" } });
});
```
  `test/load.test.ts`:
```ts
it("loadVia noCache: ответ не сохраняется, offline без stale, not_bound всё равно стирает кэш", async () => {
  const cache = createCache(memKV(), 7, "w7");
  cache.save("/ev/employees", { old: 1 }, 1);
  const fresh = await loadVia({ get: answer({ kind: "ok", data: { n: 2 } }), cache: () => cache, now: () => 9 }, "/ev/employees", () => {}, true);
  expect(fresh).toEqual({ kind: "fresh", data: { n: 2 } });
  expect(cache.load("/ev/employees")).toEqual({ data: { old: 1 }, at: 1 });
  const off = await loadVia({ get: answer<{ n: number }>({ kind: "fail", status: "offline" }), cache: () => cache, now: () => 9 }, "/ev/employees", () => {}, true);
  expect(off).toEqual({ kind: "fail", status: "offline" });
  await loadVia({ get: answer({ kind: "fail", status: "not_bound" }), cache: () => cache, now: () => 9 }, "/ev/employees", () => {}, true);
  expect(cache.load("/ev/employees")).toBeNull();
});
```
  `test/view-ev-errors.test.ts`:
```ts
import { expect, it } from "bun:test";
import type { ApiResult } from "../src/api";
import { evNoticeKey, evOutcome } from "../src/view/ev-errors";

const http = (code: number, error: string | null, body: unknown = { error }): ApiResult<unknown> => ({ kind: "http", code, error, body });

it("evOutcome: успех, неизвестный исход, сессия, перезагрузка, ошибка с параметрами", () => {
  expect(evOutcome({ kind: "ok", data: {} }, "ru")).toEqual({ kind: "done" });
  expect(evOutcome({ kind: "fail", status: "offline" }, "ru")).toEqual({ kind: "unknown" });
  expect(evOutcome({ kind: "fail", status: "expired" }, "ru")).toEqual({ kind: "session" });
  expect(evOutcome(http(403, "not_evaluator"), "ru")).toEqual({ kind: "session" });
  expect(evOutcome(http(409, "already_submitted"), "ru")).toEqual({ kind: "reload", key: "ev_err_already_submitted" });
  expect(evOutcome(http(409, "dispute_closed"), "ru")).toEqual({ kind: "reload", key: "ev_err_dispute_closed" });
  expect(evOutcome(http(409, "already_cancelled"), "ru")).toEqual({ kind: "reload", key: "err_already_cancelled" });
  expect(evOutcome(http(422, "unknown_item"), "ru")).toEqual({ kind: "reload", key: "ev_err_unknown_item" });
  expect(evOutcome(http(409, "period_closed"), "ru")).toEqual({ kind: "reload", key: "err_period_closed" });
  expect(evOutcome(http(409, "too_early", { error: "too_early", opens_at: "2025-10-19T19:00:00.000Z" }), "ru"))
    .toEqual({ kind: "error", key: "ev_err_too_early", vars: { date: "20 октября" } });
  expect(evOutcome(http(422, "comment_required", { error: "comment_required", min: 5 }), "ru")).toEqual({ kind: "error", key: "err_comment_required", vars: { min: 5 } });
  expect(evOutcome(http(422, "missing_items"), "ru")).toEqual({ kind: "error", key: "ev_err_missing_items" });
  expect(evOutcome(http(418, "weird"), "ru")).toEqual({ kind: "error", key: "err_generic" });
  expect(evOutcome(http(418, null, null), "ru")).toEqual({ kind: "error", key: "err_generic" });
});
it("evNoticeKey: только экраны-заглушки", () => {
  expect([evNoticeKey("forbidden"), evNoticeKey("out_of_scope"), evNoticeKey("no_card"), evNoticeKey("weird")]).toEqual(["ev_err_forbidden", "ev_err_out_of_scope", "ev_err_no_card", null]);
});
```
  `test/i18n.test.ts`:
```ts
it("ключи ev_*: плейсхолдеры {…} в ru и uz совпадают", () => {
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  const keys = (Object.keys(DICT.ru) as (keyof typeof DICT.ru)[]).filter((k) => k.startsWith("ev_"));
  expect(keys.length).toBeGreaterThan(0);
  for (const k of keys) expect([k, ph(DICT.uz[k])]).toEqual([k, ph(DICT.ru[k])]);
});
```
- [ ] **Step 2: Run** `cd "$REPO/kpi_miniapp" && bun test test/route.test.ts test/api.test.ts test/load.test.ts test/view-ev-errors.test.ts test/i18n.test.ts` — Expected: FAIL (нет `routeAllowed`, `sendForm`, `ev-errors.ts`; у `i18n` нет ключей `ev_`).
- [ ] **Step 3: Реализовать** `route.ts` (разбор по порядку: `/ev/disputes`, `/ev/dispute/<uuid>`, `/ev/violations[/YYYY-MM]`, `/ev/violation/<uuid>`, `/ev/review/YYYY-MM/<uuid>`, `/ev/YYYY-MM`, `/ev`; uuid — `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`), `api.ts` (`call` получает необязательный `ms` и передаёт его в `authed`; `sendForm` зовёт `call` с `{ method: "POST", body }` и `blobTimeoutMs`), `load.ts`, `view/ev-errors.ts`, правки `main.ts` по списку, ключи `i18n.ts`. Ключи (RU точно; UZ латиницей пишет исполнитель по правилам файла: `oʻ`/`gʻ` через U+02BB, `eʼ`/`maʼ` через U+02BC, без ASCII-апострофа; вставить сразу после строки `eval_link` в обоих словарях):

  | Ключ | RU |
  |---|---|
  | `ev_err_forbidden` | У вас нет права оценивать. Обратитесь к HR. |
  | `ev_err_out_of_scope` | Сотрудник не входит в ваши назначения. |
  | `ev_err_no_card` | Для должности сотрудника KPI не настроен. |
  | `ev_err_too_early` | Оценки можно отправлять с {date}. |
  | `ev_err_missing_items` | Не у всех пунктов есть балл. |
  | `ev_err_note_required` | Нужна заметка: балл отличается от предложения или не поставлен. |
  | `ev_err_bad_score` | Балл — целое число от 0 до 100. |
  | `ev_err_unknown_item` | Карта изменилась, форма обновлена. |
  | `ev_err_no_items` | В карте нет пунктов для оценки. |
  | `ev_err_already_submitted` | Оценка уже отправлена. |
  | `ev_err_photo_required` | Добавьте фото. |
  | `ev_err_bad_photo_type` | Фото должно быть JPEG или PNG. |
  | `ev_err_photo_too_large` | Фото больше 10 МБ. |
  | `ev_err_too_many_photos` | Не больше 3 фото. |
  | `ev_err_open_dispute` | По записи открыт спор: сначала разберите его. |
  | `ev_err_dispute_closed` | Спор уже разобран. |
  | `ev_err_items_required` | Укажите новые баллы по пунктам. |
  | `ev_err_no_changes` | Баллы не изменились. |
  | `ev_err_unknown_outcome` | Нет связи, результат неизвестен. Проверьте «Мои нарушения», прежде чем записывать снова. |

- [ ] **Step 4: Run** те же пять файлов, затем `cd "$REPO/kpi_miniapp" && bun test` — Expected: PASS; `bun --bun run build` — PASS (в `dist/assets/` один `.js` и один `.css`).
- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add kpi_miniapp/src/route.ts kpi_miniapp/src/api.ts kpi_miniapp/src/load.ts kpi_miniapp/src/main.ts kpi_miniapp/src/i18n.ts kpi_miniapp/src/view/ev-errors.ts kpi_miniapp/test/route.test.ts kpi_miniapp/test/api.test.ts kpi_miniapp/test/load.test.ts kpi_miniapp/test/i18n.test.ts kpi_miniapp/test/view-ev-errors.test.ts
git -C "$REPO" commit -m "feat(kpi): ядро клиента оценщика: маршруты, роли, загрузка без кэша, multipart, исходы действий" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Экран «Мои сотрудники» и ссылка с главного экрана

**Files:**
- Create: `kpi_miniapp/src/view/ev-list.ts`, `kpi_miniapp/src/screens/ev-list.ts`, `kpi_miniapp/src/style-ev.css`, `kpi_miniapp/test/view-ev-list.test.ts`
- Modify: `kpi_miniapp/src/main.ts` (импорт стилей и экрана, `case "ev"` в `screenOf`), `kpi_miniapp/src/i18n.ts`, `kpi_miniapp/src/view/home.ts`, `kpi_miniapp/src/screens/home.ts`, `kpi_miniapp/test/view-home.test.ts`

**Interfaces:**
- Consumes: `EvEmployees`, `EvEmployee`, `EvStatus` (`ev-types.ts`); `hashOf`; `dayMonth`, `pct1` (`format.ts`); `monthName`, `tIn`; `loadScreen` с `noCache`.
- Produces:
  ```ts
  // view/ev-list.ts
  export interface EvFilter { terminal_id: string | null; card_id: string | null; status: "all" | EvStatus; search: string }
  export interface EvRowVM { id: string; name: string; sub: string; chip: { text: string; tone: "ok" | "wait" | "warn" }; late: string | null; score: string | null; hash: string }
  export interface EvListVM {
    title: string; info: string; closed: boolean;
    branches: { id: string | null; label: string }[]; showBranch: boolean;
    cards: { id: string | null; label: string }[]; showCard: boolean;
    statuses: { value: "all" | EvStatus; label: string; count: number }[];
    rows: EvRowVM[]; counter: string; empty: "ev_empty" | "ev_empty_filter" | null;
  }
  export function evListView(d: EvEmployees, f: EvFilter, l: Lang, nowMs: number): EvListVM;
  // view/home.ts
  HomeVM.evaluator: { text: string; link: string | null; links: { text: string; hash: string }[] } | null
  ```
- Экран: путь `/ev/employees` (+ `?period=…`, когда в маршруте есть период), `kind: "list"`, `noCache: true`, заголовок `ev_list_title`. Фильтр хранится в переменной модуля `screens/ev-list.ts` (память до закрытия приложения: возврат с формы оценки не сбрасывает фильтр) и меняет список без запроса.

Правила `evListView`:
- Сортировка: сначала `none` и `draft`, затем `submitted`; внутри групп порядок сервера.
- Фильтры филиала и карты применяются к строкам; `statuses[].count` считаются после филиала, карты и поиска, до статуса (`disputed` — `open_dispute`, `submitted` — `review_status === "submitted"`, `all` — все); поиск — все слова из `search` (по пробелам, без регистра) входят подстрокой в `"${last_name} ${first_name}"`.
- `showBranch`/`showCard` — когда вариантов больше одного. Подписи вариантов: `ev_f_all_branches`, `ev_f_all_cards`, дальше названия из справочников.
- Чип: `open_dispute` → «Спор» (`warn`); иначе `none` → «Не оценён» (`wait`), `draft` → «Черновик» (`wait`), `submitted` → «Отправлена» (`ok`). `score` — `${pct1(score_pct)} %` с U+00A0 перед `%`, только у отправленной. `late` — `ev_late`, когда `late`. `sub` — «должность · филиал», пустые части выпадают.
- `info`: месяц закрыт → `ev_closed`; до `submit_opens_at` → `ev_opens` с датой; иначе `ev_deadline` с датой `review_deadline`.
- `empty`: нет строк вообще → `ev_empty`; строки есть, фильтр их скрыл → `ev_empty_filter`.

Раскладка (375 px): заголовок `h1.title`; под ним строка `info`; фильтры в карточке: два `<select>` на всю ширину (филиал, карта; высота 44 px, показываются при `showBranch`/`showCard`), поле поиска, ряд кнопок статуса с числами (переносятся на вторую строку, не прокручиваются вбок); дальше `ul.card` строк `.row`: имя, под ним `sub`, справа чип; строка целиком ссылка на `ev_review`, шеврон справа; внизу строка-ссылка «Мои нарушения» на `ev_violations`. Главный экран: у блока оценщика под текстом строки-ссылки `links` (`ev_home_staff` → `#/ev`), ссылка в админку остаётся тихой кнопкой.

- [ ] **Step 1: Тесты.** `test/view-ev-list.test.ts`:

```ts
import { expect, it } from "bun:test";
import type { EvEmployee, EvEmployees } from "@backend/modules/kpi/tg-app/ev-types";
import { type EvFilter, evListView } from "../src/view/ev-list";

const uid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const row = (n: number, last: string, first: string, t: string, tn: string, c: string, ct: string, st: EvEmployee["review_status"], o: Partial<EvEmployee> = {}): EvEmployee =>
  ({ id: uid(n), first_name: first, last_name: last, terminal_id: t, terminal_name: tn, position: "Повар", card_id: c, card_title: ct, review_status: st, score_pct: null, late: false, open_dispute: false, can_evaluate: true, ...o });
const D: EvEmployees = {
  period: "2026-10-01", period_status: "open", submit_opens_at: "2026-10-19T19:00:00.000Z", review_deadline: "2026-11-07T18:59:59.999Z",
  terminals: [{ id: "t1", name: "Филиал А" }, { id: "t2", name: "Филиал Б" }], cards: [{ id: "c1", title: "Повар" }, { id: "c2", title: "Кассир" }],
  items: [
    row(1, "Алиев", "Ботир", "t1", "Филиал А", "c1", "Повар", "submitted", { score_pct: 91.4 }),
    row(2, "Каримов", "Али", "t1", "Филиал А", "c1", "Повар", "none"),
    row(3, "Умаров", "Санжар", "t2", "Филиал Б", "c2", "Кассир", "draft"),
    row(4, "Абдуллаев", "Тимур", "t2", "Филиал Б", "c1", "Повар", "submitted", { open_dispute: true, score_pct: 80, late: true }),
  ],
};
const ALL: EvFilter = { terminal_id: null, card_id: null, status: "all", search: "" };
const NOW = Date.parse("2026-10-26T10:00:00+05:00");
const ids = (f: EvFilter) => evListView(D, f, "ru", NOW).rows.map((r) => r.id);

it("порядок: не оценённые и черновики первыми, отправленные потом, внутри — как прислал сервер", () => {
  expect(ids(ALL)).toEqual([uid(2), uid(3), uid(1), uid(4)]);
});
it("фильтры: филиал, карта, статус, поиск по словам без учёта регистра и порядка", () => {
  expect(ids({ ...ALL, terminal_id: "t2" })).toEqual([uid(3), uid(4)]);
  expect(ids({ ...ALL, card_id: "c2" })).toEqual([uid(3)]);
  expect(ids({ ...ALL, status: "none" })).toEqual([uid(2)]);
  expect(ids({ ...ALL, status: "submitted" })).toEqual([uid(1), uid(4)]);
  expect(ids({ ...ALL, status: "disputed" })).toEqual([uid(4)]);
  expect(ids({ ...ALL, search: "ботир алиев" })).toEqual([uid(1)]);
  expect(ids({ ...ALL, search: "ЛИЕВ" })).toEqual([uid(1)]);
  expect(ids({ ...ALL, search: "x" })).toEqual([]);
});
it("счётчики статусов — после филиала и поиска, до статуса; пустые состояния", () => {
  expect(evListView(D, { ...ALL, terminal_id: "t2" }, "ru", NOW).statuses.map((s) => [s.value, s.count]))
    .toEqual([["all", 2], ["none", 0], ["draft", 1], ["submitted", 1], ["disputed", 1]]);
  expect(evListView(D, { ...ALL, search: "x" }, "ru", NOW).empty).toBe("ev_empty_filter");
  expect(evListView({ ...D, items: [] }, ALL, "ru", NOW).empty).toBe("ev_empty");
  expect(evListView(D, ALL, "ru", NOW).empty).toBeNull();
});
it("строка: чип, балл, опоздание, ссылка; справочники и подписи", () => {
  const vm = evListView(D, ALL, "ru", NOW);
  const byId = new Map(vm.rows.map((r) => [r.id, r]));
  expect(byId.get(uid(1))).toMatchObject({ name: "Алиев Ботир", sub: "Повар · Филиал А", chip: { text: "Отправлена", tone: "ok" }, score: "91,4 %", late: null, hash: `#/ev/review/2026-10/${uid(1)}` });
  expect(byId.get(uid(2))!.chip).toEqual({ text: "Не оценён", tone: "wait" });
  expect(byId.get(uid(3))!.chip).toEqual({ text: "Черновик", tone: "wait" });
  expect(byId.get(uid(4))).toMatchObject({ chip: { text: "Спор", tone: "warn" }, late: "с опозданием" });
  expect([vm.showBranch, vm.showCard, vm.branches[0], vm.cards[0]]).toEqual([true, true, { id: null, label: "Все филиалы" }, { id: null, label: "Все карты" }]);
  expect(evListView({ ...D, terminals: [D.terminals[0]!] }, ALL, "ru", NOW).showBranch).toBe(false);
  expect(vm.counter).toBe("4 из 4");
});
it("info: срок оценок, начало отправки, закрытый месяц; заголовок на двух языках", () => {
  expect(evListView(D, ALL, "ru", NOW).info).toBe("Оценки до 7 ноября");
  expect(evListView(D, ALL, "ru", Date.parse("2026-10-10T10:00:00+05:00")).info).toBe("Отправка оценок с 20 октября");
  expect(evListView({ ...D, period_status: "closed" }, ALL, "ru", NOW)).toMatchObject({ info: "Месяц закрыт, оценки не меняются.", closed: true });
  expect(evListView(D, ALL, "ru", NOW).title).toBe("Мои сотрудники · октябрь");
  expect(evListView(D, ALL, "uz", NOW).title).toContain("oktabr");
});
```
  В `test/view-home.test.ts` строку про `evaluator` (около 168) заменить на `toEqual({ text: "Нужно оценить 1 сотрудника до 7 ноября", link: "http://localhost:6762/ru/kpi/reviews", links: [{ text: "Мои сотрудники", hash: "#/ev" }] })`.
- [ ] **Step 2: Run** `cd "$REPO/kpi_miniapp" && bun test test/view-ev-list.test.ts test/view-home.test.ts` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `view/ev-list.ts`, правку `homeView` (поле `links`) и `evaluatorBlock` в `screens/home.ts`, `screens/ev-list.ts`, `style-ev.css` (классы с префиксом `ev-`, существующие `.screen`, `.card`, `.row`, `.btn`, `.chip chip-*`, `.title`), `case "ev"` и импорты в `main.ts`. Ключи RU (UZ пишет исполнитель):

  | Ключ | RU |
  |---|---|
  | `ev_home_staff` | Мои сотрудники |
  | `ev_list_title` | Мои сотрудники · {month} |
  | `ev_f_branch` | Филиал |
  | `ev_f_card` | Карта |
  | `ev_f_all_branches` | Все филиалы |
  | `ev_f_all_cards` | Все карты |
  | `ev_st_all` | Все |
  | `ev_st_none` | Не оценены |
  | `ev_st_draft` | Черновик |
  | `ev_st_submitted` | Отправлены |
  | `ev_st_disputed` | Спор |
  | `ev_chip_none` | Не оценён |
  | `ev_chip_draft` | Черновик |
  | `ev_chip_submitted` | Отправлена |
  | `ev_chip_disputed` | Спор |
  | `ev_search_ph` | Поиск по имени |
  | `ev_empty` | Сотрудников по вашим назначениям нет |
  | `ev_empty_filter` | По фильтру никого нет |
  | `ev_late` | с опозданием |
  | `ev_deadline` | Оценки до {date} |
  | `ev_opens` | Отправка оценок с {date} |
  | `ev_closed` | Месяц закрыт, оценки не меняются. |
  | `ev_counter` | {shown} из {total} |
  | `ev_my_violations` | Мои нарушения |

- [ ] **Step 4: Run** те же файлы, затем `bun test` и `bun --bun run build` в `kpi_miniapp/` — Expected: PASS; `grep -rn 'innerHTML\|outerHTML\|insertAdjacentHTML' kpi_miniapp/src` не находит подстановок данных сервера. Внешний вид экрана смотрится в задаче 12.
- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add kpi_miniapp/src/view/ev-list.ts kpi_miniapp/src/screens/ev-list.ts kpi_miniapp/src/style-ev.css kpi_miniapp/src/main.ts kpi_miniapp/src/i18n.ts kpi_miniapp/src/view/home.ts kpi_miniapp/src/screens/home.ts kpi_miniapp/test/view-ev-list.test.ts kpi_miniapp/test/view-home.test.ts
git -C "$REPO" commit -m "feat(kpi): экран «Мои сотрудники» оценщика в мини-приложении" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Форма оценки сотрудника

**Files:**
- Create: `kpi_miniapp/src/view/ev-score.ts`, `kpi_miniapp/src/view/ev-review.ts`, `kpi_miniapp/src/screens/ev-items.ts`, `kpi_miniapp/src/screens/ev-review.ts`, `kpi_miniapp/test/view-ev-score.test.ts`, `kpi_miniapp/test/view-ev-review.test.ts`
- Modify: `kpi_miniapp/src/main.ts` (`case "ev_review"`), `kpi_miniapp/src/i18n.ts`, `kpi_miniapp/src/style-ev.css`

**Interfaces:**
- Consumes: `EvReviewForm`, `EvFormItem` (`ev-types.ts`); `evOutcome` (задача 6); `appApi().send`; `haptic`; `latch`, `reasonCount`; `navigate`, `rerender`, `back`; `dayMonth`, `pct1`.
- Produces: порт `admin/lib/kpi/review-form.ts` без изменения правил, плюс разметочный вид формы:
  ```ts
  // view/ev-score.ts
  export const SCORE_BUTTONS: readonly [0, 25, 50, 75, 100];
  export type FormItemLite = Pick<EvFormItem, "item_id" | "source" | "weight" | "score" | "note" | "suggestion">;
  export type DraftItem = { score: number | null; note: string; invalid?: boolean; text?: string };
  export type Draft = Record<string, DraftItem>;
  export function draftFromItems(items: readonly FormItemLite[], prefill: boolean): Draft; // prefill: новая форма и черновик подставляют предложение в пустой автопункт
  export function parseScoreInput(text: string): number | null | "invalid";
  export function scoreTextChange(value: DraftItem, text: string): DraftItem | null;
  export function pickScore(value: DraftItem, score: number | null): DraftItem;
  export function staleNoteHint(prevScore: number | null, nextScore: number | null, prevNote: string, currentNote: string): boolean;
  export function toItemInputs(items: readonly FormItemLite[], draft: Draft): { item_id: string; score: number | null; note: string | null }[];
  export function previewPct(items: readonly FormItemLite[], draft: Draft): number | null;
  export function changedItemIds(items: readonly FormItemLite[], draft: Draft): string[];
  export type IssueCode = "bad_score_text" | "score_required" | "note_required" | "comment_required" | "no_changes";
  export type FormIssue = { code: IssueCode; item_id?: string };
  export function reviewIssues(items: readonly FormItemLite[], draft: Draft, action: "draft" | "submit" | "change", comment: string, commentMin: number): FormIssue[];
  export function evIssueText(i: FormIssue, commentMin: number, l: Lang): string;
  // view/ev-review.ts
  export interface EvItemVM { id: string; title: string; hint: string | null; sourceLabel: string | null; suggestionText: string | null; violationLine: string | null; violationComments: string[] }
  export interface EvReviewVM {
    title: string; sub: string; mode: "edit" | "readonly";
    banner: { key: Key; vars?: Record<string, string | number> } | null;
    submitAllowed: boolean;
    groups: { key: "base" | "extra"; title: string; items: EvItemVM[] }[];
    otherViolations: string[];
  }
  export function evReviewView(f: EvReviewForm, l: Lang, nowMs: number): EvReviewVM;
  // screens/ev-items.ts (DOM; его же использует задача 11)
  export function renderItemEditors(o: { groups: EvReviewVM["groups"]; items: readonly EvFormItem[]; draft: Draft; issues: Map<string, FormIssue>; disabled: boolean; onChange(itemId: string, v: DraftItem): void }): HTMLElement;
  ```
- Экран: путь `/ev/form?period=…&employee_id=…`, `kind: "list"`, `noCache: true`, заголовок — имя сотрудника, на 403/422 `no_card` показывается заглушка из задачи 6.

Правила `evReviewView`:
- `title` — «Фамилия Имя»; `sub` — «филиал · карта · Месяц» (пустые части выпадают, месяц с заглавной буквы); `mode` — `edit` при `f.can_edit`, иначе `readonly`.
- `banner` по порядку: месяц закрыт → `ev_closed`; оценка отправлена → `ev_readonly_submitted` с `date` = `dayMonth(submitted_at)`; открыт спор → `ev_readonly_dispute`; `!can_edit` → `ev_readonly_scope`; `nowMs` до `submit_opens_at` → `ev_form_opens` с `date` (форма остаётся `edit`); иначе `null`.
- `submitAllowed` — `mode === "edit"` и `nowMs >= Date.parse(submit_opens_at)`.
- Группы: `base`, затем `extra` (пустые не показываются), заголовки `grp_base`, `grp_extra`. Пункт: название по языку (узбекского нет — русское), `hint` только русский, `sourceLabel` для автопунктов (`src_attendance` у посещаемости, `src_branch` у остальных), `suggestionText` по `ev_suggest`, `violationLine` по `ev_viol_line` только при нарушениях, `violationComments` — «дата: комментарий».

Поведение экрана (не покрыто юнит-тестом, проверяется в задаче 12):
- Черновик правки живёт в переменной модуля по ключу `период:employee_id` до успешного сохранения или отправки, возврат на экран его восстанавливает.
- Пункт: пять кнопок 0, 25, 50, 75, 100 в один ряд (каждая от 44 px, `aria-pressed`), ниже поле «Свой балл» (`inputMode="numeric"`, неверный текст помечается), у автопункта ещё «Нет данных» и, при предложении, «Принять»; заметка (`textarea`, подпись «Заметку увидит сотрудник»), подсказка о нарушениях месяца; живой итог `ev_form_total` над кнопками.
- Две кнопки внизу: «Сохранить черновик» (тихая) и «Отправить оценку» (главная, неактивна при `!submitAllowed`). Нажатие берёт защёлку `latch()`, до запроса прогоняется `reviewIssues`; пункт с проблемой подсвечивается, текст `evIssueText` под ним, экран прокручивается к первому. Результат — `evOutcome`: `done` → вибро успеха, сброс черновика, `rerender()`; `reload` → текст и `rerender()`; `unknown` → `STATUS_TEXT.offline[lang()]` под кнопками, защёлка снята; `session` → `rerender()`; `error` → текст под кнопками, `note_required` и `bad_score` с `item_id` из тела подсвечивают пункт.
- Кнопка «Записать нарушение» (тихая) ведёт на `ev_violation` этого сотрудника.
- Режим `readonly`: пункты как список «название — балл» с заметками, баннер сверху, кнопок сохранения нет.

- [ ] **Step 1: Тесты.** `test/view-ev-score.test.ts` повторяет значения `admin/lib/kpi/review-form.test.ts` (фикстура `items`: `m1` ручной балл 100, `m2` ручной 50, `a1` посещаемость без балла с предложением `{ score: 80, basis: "Workly: 20 из 25 дней вовремя" }`; `sent` — те же с `a1.score = 80`):

```ts
it("кнопки и разбор поля балла", () => {
  expect([...SCORE_BUTTONS]).toEqual([0, 25, 50, 75, 100]);
  expect([parseScoreInput(""), parseScoreInput("   "), parseScoreInput("0"), parseScoreInput(" 75 ")]).toEqual([null, null, 0, 75]);
  for (const bad of ["50.5", "50,5", "101", "-1", "abc", "1e2"]) expect(parseScoreInput(bad)).toBe("invalid");
  const v: DraftItem = { score: 50, note: "" };
  expect(scoreTextChange(v, "150")).toEqual({ score: 50, note: "", invalid: true, text: "150" });
  expect(scoreTextChange({ ...v, invalid: true, text: "150" }, "150")).toBeNull();
  expect(scoreTextChange({ ...v, invalid: true, text: "150" }, "75")).toEqual({ score: 75, note: "", invalid: false });
});
it("черновик из формы: предложение подставляется в пустой автопункт только при prefill", () => {
  expect(draftFromItems(items, false)).toEqual({ m1: { score: 100, note: "" }, m2: { score: 50, note: "" }, a1: { score: null, note: "" } });
  expect(draftFromItems(items, true).a1).toEqual({ score: 80, note: "" });
  const noted: FormItemLite[] = [{ ...items[2]!, note: "терминал сломан" }];
  expect(draftFromItems(noted, true).a1).toEqual({ score: null, note: "терминал сломан" });
});
it("toItemInputs и previewPct", () => {
  const d = draftFromItems(items, true);
  d.a1 = { score: 60, note: "  болел  " }; d.m2 = { score: 50, note: "   " };
  expect(toItemInputs(items, d)).toEqual([{ item_id: "m1", score: 100, note: null }, { item_id: "m2", score: 50, note: null }, { item_id: "a1", score: 60, note: "болел" }]);
  expect(previewPct(items, draftFromItems(items, false))).toBe(75);
  expect(previewPct(items, { m1: { score: null, note: "" }, m2: { score: null, note: "" }, a1: { score: null, note: "" } })).toBeNull();
  expect(previewPct([items[0]!, { ...items[1]!, weight: 2 }], { m1: { score: 100, note: "" }, m2: { score: 0, note: "" } })).toBe(33.33);
});
it("reviewIssues: черновик неполным, отправка требует баллы и заметки, изменение — комментарий и разницу", () => {
  const d0 = draftFromItems(items, true);
  expect(reviewIssues(items, { ...d0, m2: { score: null, note: "" } }, "draft", "", 5)).toEqual([]);
  expect(reviewIssues(items, { ...d0, m2: { score: null, note: "" } }, "submit", "", 5)).toEqual([{ code: "score_required", item_id: "m2" }]);
  expect(reviewIssues(items, draftFromItems(items, false), "submit", "", 5)).toEqual([{ code: "note_required", item_id: "a1" }]);
  expect(reviewIssues(items, { ...d0, a1: { score: 60, note: "" } }, "submit", "", 5)).toEqual([{ code: "note_required", item_id: "a1" }]);
  expect(reviewIssues(items, { ...d0, a1: { score: 60, note: "болел" } }, "submit", "", 5)).toEqual([]);
  expect(reviewIssues(items, { ...d0, m1: { score: 100, note: "", invalid: true, text: "150" } }, "draft", "", 5)).toEqual([{ code: "bad_score_text", item_id: "m1" }]);
  const base = draftFromItems(sent, false);
  expect(reviewIssues(sent, { ...base, m2: { score: 75, note: "" } }, "change", "  ок  ", 5)).toEqual([{ code: "comment_required" }]);
  expect(reviewIssues(sent, base, "change", "опоздал 3 раза", 5)).toEqual([{ code: "no_changes" }]);
  expect(changedItemIds(items, { ...draftFromItems(items, false), m2: { score: 75, note: "" }, m1: { score: 100, note: "новая заметка" } })).toEqual(["m2"]);
});
it("evIssueText на двух языках", () => {
  expect(evIssueText({ code: "comment_required" }, 5, "ru")).toBe("Комментарий — не меньше 5 букв или цифр");
  expect(evIssueText({ code: "note_required", item_id: "a1" }, 5, "ru")).toBe("Балл отличается от предложения или не поставлен: напишите заметку");
  expect(evIssueText({ code: "no_changes" }, 5, "uz").length).toBeGreaterThan(0);
});
```
  `test/view-ev-review.test.ts` (фикстура `F: EvReviewForm`: сотрудник «Алиев Ботир», филиал «Филиал А», `card_title: "Повар (Chopar и Les Ailes)"`, период `2026-10-01`, `can_edit: true`, `review: null`, `submit_opens_at: "2026-10-19T19:00:00.000Z"`, два пункта `base` и один `extra`; у первого `suggestion: { score: 80, basis: "Workly: 20 из 25 дней вовремя" }`, `source: "attendance"`, `violations: [{ id: "v1", occurred_at: "2026-10-14T14:40:00.000Z", comment: "Грязный пол" }]`, `violation_hint: 90`):
```ts
const OPEN = Date.parse("2026-10-26T10:00:00+05:00");
it("шапка, группы, пункты", () => {
  const vm = evReviewView(F, "ru", OPEN);
  expect([vm.title, vm.sub, vm.mode, vm.banner, vm.submitAllowed]).toEqual(["Алиев Ботир", "Филиал А · Повар (Chopar и Les Ailes) · Октябрь", "edit", null, true]);
  expect(vm.groups.map((g) => [g.key, g.title, g.items.length])).toEqual([["base", "Основные пункты", 2], ["extra", "Дополнительные пункты", 1]]);
  expect(vm.groups[0]!.items[0]).toMatchObject({ sourceLabel: "по данным Workly", suggestionText: "Предложение: 80 · Workly: 20 из 25 дней вовремя", violationLine: "Нарушений за месяц: 1. Подсказка: 90", violationComments: ["14 октября: Грязный пол"] });
  expect(vm.groups[0]!.items[1]).toMatchObject({ sourceLabel: null, suggestionText: null, violationLine: null });
});
it("баннеры: закрыт, отправлена, спор, вне назначения, отправка ещё не открыта", () => {
  const sub = { ...F, review: { id: "r", status: "submitted" as const, score_pct: 90, version: 1, submitted_at: "2026-10-25T07:00:00.000Z", late: false }, can_edit: false };
  expect(evReviewView({ ...F, period_status: "closed", can_edit: false }, "ru", OPEN).banner).toEqual({ key: "ev_closed" });
  expect(evReviewView(sub, "ru", OPEN)).toMatchObject({ mode: "readonly", submitAllowed: false, banner: { key: "ev_readonly_submitted", vars: { date: "25 октября" } } });
  expect(evReviewView({ ...sub, open_dispute: true }, "ru", OPEN).banner).toEqual({ key: "ev_readonly_submitted", vars: { date: "25 октября" } });
  expect(evReviewView({ ...F, open_dispute: true, can_edit: false }, "ru", OPEN).banner).toEqual({ key: "ev_readonly_dispute" });
  expect(evReviewView({ ...F, can_edit: false }, "ru", OPEN).banner).toEqual({ key: "ev_readonly_scope" });
  const early = evReviewView(F, "ru", Date.parse("2026-10-10T10:00:00+05:00"));
  expect([early.mode, early.submitAllowed, early.banner]).toEqual(["edit", false, { key: "ev_form_opens", vars: { date: "20 октября" } }]);
});
it("узбекское название пункта, русского нет — русское", () => {
  const vm = evReviewView({ ...F, items: [{ ...F.items[0]!, title_uz: "" }, ...F.items.slice(1)] }, "uz", OPEN);
  expect(vm.groups[0]!.items[0]!.title).toBe(F.items[0]!.title_ru);
});
```
- [ ] **Step 2: Run** `cd "$REPO/kpi_miniapp" && bun test test/view-ev-score.test.ts test/view-ev-review.test.ts` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `view/ev-score.ts` (порт без изменения правил; `commentOk` из админки заменяется `reasonCount(c) >= min` из `util.ts`; `roundTo` копируется как есть из `admin/lib/kpi/format.ts`), `view/ev-review.ts`, `screens/ev-items.ts` (`renderItemEditors(items, vm, draft, issues, onChange)`, его же использует задача 11), `screens/ev-review.ts`, `case "ev_review"` в `main.ts`, CSS. Ключи RU:

  | Ключ | RU |
  |---|---|
  | `ev_form_total` | Итог: {pct} |
  | `ev_form_total_none` | Итог: пока нет баллов |
  | `ev_score_none` | Нет данных |
  | `ev_score_own` | Свой балл |
  | `ev_suggest` | Предложение: {score} · {basis} |
  | `ev_suggest_accept` | Принять |
  | `ev_note_label` | Заметка |
  | `ev_note_hint` | Заметку увидит сотрудник |
  | `ev_note_ph` | Например: форма была грязной 14 октября |
  | `ev_note_stale` | Заметка написана к прежнему баллу. Проверьте текст. |
  | `ev_viol_line` | Нарушений за месяц: {n}. Подсказка: {hint} |
  | `ev_viol_other` | Нарушения без пункта карты |
  | `ev_btn_draft` | Сохранить черновик |
  | `ev_btn_submit` | Отправить оценку |
  | `ev_btn_violation` | Записать нарушение |
  | `ev_saved` | Черновик сохранён |
  | `ev_sent` | Оценка отправлена |
  | `ev_readonly_submitted` | Оценка отправлена {date}. Изменить её можно в админке или через спор. |
  | `ev_readonly_dispute` | По оценке открыт спор. Оценку меняет только разбор спора. |
  | `ev_readonly_scope` | Эту оценку вы не меняете: сотрудник вне ваших назначений. |
  | `ev_form_opens` | Отправка оценок с {date}. Черновик можно сохранять сейчас. |
  | `ev_issue_bad_score_text` | Балл — целое число от 0 до 100 |
  | `ev_issue_score_required` | Поставьте балл |
  | `ev_issue_note_required` | Балл отличается от предложения или не поставлен: напишите заметку |
  | `ev_issue_comment_required` | Комментарий — не меньше {min} букв или цифр |
  | `ev_issue_no_changes` | Измените хотя бы один балл |

- [ ] **Step 4: Run** оба файла, затем `bun test` и `bun --bun run build` в `kpi_miniapp/` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add kpi_miniapp/src/view/ev-score.ts kpi_miniapp/src/view/ev-review.ts kpi_miniapp/src/screens/ev-items.ts kpi_miniapp/src/screens/ev-review.ts kpi_miniapp/src/main.ts kpi_miniapp/src/i18n.ts kpi_miniapp/src/style-ev.css kpi_miniapp/test/view-ev-score.test.ts kpi_miniapp/test/view-ev-review.test.ts
git -C "$REPO" commit -m "feat(kpi): форма оценки сотрудника для оценщика в мини-приложении" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Запись нарушения с фото

**Files:**
- Create: `kpi_miniapp/src/photo-prepare.ts`, `kpi_miniapp/src/photo-pick.ts`, `kpi_miniapp/src/view/ev-violation.ts`, `kpi_miniapp/src/screens/ev-violation.ts`, `kpi_miniapp/test/photo-prepare.test.ts`, `kpi_miniapp/test/view-ev-violation.test.ts`
- Modify: `kpi_miniapp/src/main.ts` (`case "ev_violation"`), `kpi_miniapp/src/i18n.ts`, `kpi_miniapp/src/style-ev.css`

**Interfaces:**
- Consumes: `EvViolationForm`, `EvViolation` (`ev-types.ts`); `appApi().sendForm`; `evOutcome`; `reasonCount`, `latch`; `navigate`, `back`; `haptic`.
- Produces:
  ```ts
  // photo-prepare.ts (чистый; порт preparePhoto из admin/lib/tickets-create.ts)
  export const MAX_PHOTO_SIDE = 1600; export const JPEG_QUALITY = 0.85;
  export interface PhotoIO<I> { decode(file: File): Promise<{ image: I; width: number; height: number }>; encode(image: I, width: number, height: number): Promise<Blob | null>; release(image: I): void }
  export type PhotoOutcome = { ok: true; file: File; recompressed: boolean } | { ok: false; reason: "empty" | "decode" | "no_size" | "prepare" | "too_big" };
  export function fitWithin(width: number, height: number, max?: number): { width: number; height: number };
  export function preparePhoto<I>(file: File, io: PhotoIO<I>, maxBytes: number): Promise<PhotoOutcome>;
  // view/ev-violation.ts
  export interface ViolationDraft { item_id: string | null; comment: string; photos: File[] }
  export type ViolationIssue = "comment" | "photo_required" | "too_many_photos";
  export function violationIssues(d: ViolationDraft, f: EvViolationForm): ViolationIssue[];
  export function buildViolationForm(employeeId: string, d: ViolationDraft): FormData;
  ```
- Экран: путь `/ev/violation-form?employee_id=…`, `kind: "list"`, `noCache: true`.

Правила:
- `preparePhoto`: пустой файл — `empty`; файл не декодируется — `decode`; нулевой размер — `no_size`; оригинал годится (`image/jpeg` или `image/png` и не больше `maxBytes`) и длинная сторона не больше 1600 — оригинал как есть; иначе перекодирование в JPEG 0,85 с длинной стороной 1600 (`fitWithin`); `encode` вернул `null` или не `image/jpeg` — оригинал, если годится, иначе `prepare`; результат не меньше оригинала и оригинал годится — оригинал; результат больше `maxBytes` — `too_big`; новое имя — `jpegName` (расширение `.jpg`). `io.release` вызывается всегда.
- `violationIssues`: `comment` — букв и цифр меньше `comment_min`; `photo_required` — фото обязательно и их нет; `too_many_photos` — больше `max_photos`.
- `buildViolationForm`: поля `employee_id`, `card_item_id` (только если пункт выбран), `comment` (trim), `photos` (каждый файл отдельным полем).
- `photo-pick.ts` — браузерная часть `PhotoIO<HTMLImageElement>`: перенос `browserIO` из `admin/app/[locale]/kpi/_components/photo-input.tsx` (декодирование через `<img>` ради EXIF-ориентации, холст с белой подложкой, `canvas.toBlob`, срок 30 с на шаг, обнуление холста, `revokeObjectURL` в `release`) без изменения поведения.

Поведение экрана: шапка с именем сотрудника и подписью `ev_viol_comment_note`; `<select>` «Пункт карты» (первый вариант «Без пункта карты», названия по языку); `textarea` комментария со счётчиком (`reasonCounter` из `counter.ts` с `comment_min`); блок фото: кнопки «Снять» (`capture="environment"`) и «Выбрать» (`multiple`) — два скрытых `input[type=file][accept="image/jpeg,image/png"]`, превью с кнопкой «Убрать» (44 px), счётчик «N из max», отметка «обязательно» при `photo_required`, «Готовим фото…» пока идёт `preparePhoto`; нечитаемые файлы — строка с названием файла. Главная кнопка «Записать нарушение» неактивна, пока есть `violationIssues`, пока готовятся фото или идёт отправка. Отправка: `latch()`, `appApi().sendForm("/ev/violations", fd)`, затем `evOutcome`: `done` → вибро успеха, `back()` и `navigate({ name: "ev_violations", period: null })`; `unknown` → текст `ev_err_unknown_outcome` со ссылкой «Мои нарушения», кнопка отправки остаётся доступной только после нажатия на эту ссылку (повторной автоматической отправки нет); `error` → текст под кнопкой.

- [ ] **Step 1: Тесты.** `test/photo-prepare.test.ts` с поддельным `PhotoIO` (`decode` возвращает заданные размеры или бросает, `encode` возвращает заданный `Blob` или `null`, счётчик `release`), `MAX = 10 * 1024 * 1024`:

```ts
const file = (size: number, type: string, name = "p.jpg") => new File([new Uint8Array(size)], name, { type });
const io = (o: { w?: number; h?: number; fail?: boolean; out?: Blob | null }) => {
  const calls = { encode: [] as [number, number][], release: 0 };
  return { calls, io: {
    decode: async () => { if (o.fail) throw new Error("decode"); return { image: "img", width: o.w ?? 800, height: o.h ?? 600 }; },
    encode: async (_i: string, w: number, h: number) => { calls.encode.push([w, h]); return o.out === undefined ? new Blob([new Uint8Array(1000)], { type: "image/jpeg" }) : o.out; },
    release: () => { calls.release++; },
  } };
};
it("fitWithin: длинная сторона не больше 1600, пропорции сохраняются", () => {
  expect(fitWithin(3000, 2000)).toEqual({ width: 1600, height: 1067 });
  expect(fitWithin(1200, 900)).toEqual({ width: 1200, height: 900 });
});
it("небольшой JPEG уходит как есть", async () => {
  const f = file(500_000, "image/jpeg"); const t = io({});
  expect(await preparePhoto(f, t.io, MAX)).toEqual({ ok: true, file: f, recompressed: false });
  expect([t.calls.encode.length, t.calls.release]).toEqual([0, 1]);
});
it("кадр 4000×3000 жмётся до 1600×1200 в JPEG, имя получает .jpg", async () => {
  const t = io({ w: 4000, h: 3000 });
  const r = await preparePhoto(file(6_000_000, "image/png", "IMG_1.png"), t.io, MAX);
  expect(r).toMatchObject({ ok: true, recompressed: true });
  if (r.ok) expect([r.file.type, r.file.name]).toEqual(["image/jpeg", "IMG_1.jpg"]);
  expect(t.calls.encode).toEqual([[1600, 1200]]);
});
it("PNG больше 10 МБ при малых сторонах перекодируется; результат всё ещё больше предела — too_big", async () => {
  expect((await preparePhoto(file(12 * 1024 * 1024, "image/png"), io({}).io, MAX)).ok).toBe(true);
  const big = io({ out: new Blob([new Uint8Array(11 * 1024 * 1024)], { type: "image/jpeg" }) });
  expect(await preparePhoto(file(12 * 1024 * 1024, "image/png"), big.io, MAX)).toEqual({ ok: false, reason: "too_big" });
});
it("HEIC и нечитаемое — decode; пустой файл — empty; encode null: годный оригинал уходит, негодный — prepare", async () => {
  expect(await preparePhoto(file(900_000, "image/heic", "a.heic"), io({ fail: true }).io, MAX)).toEqual({ ok: false, reason: "decode" });
  expect(await preparePhoto(file(0, "image/jpeg"), io({}).io, MAX)).toEqual({ ok: false, reason: "empty" });
  const f = file(2_000_000, "image/jpeg");
  expect(await preparePhoto(f, io({ w: 4000, h: 3000, out: null }).io, MAX)).toEqual({ ok: true, file: f, recompressed: false });
  expect(await preparePhoto(file(900_000, "image/heic"), io({ w: 4000, h: 3000, out: null }).io, MAX)).toEqual({ ok: false, reason: "prepare" });
});
it("результат не меньше оригинала — уходит оригинал", async () => {
  const f = file(900, "image/jpeg");
  expect(await preparePhoto(f, io({ w: 2000, h: 1000 }).io, MAX)).toEqual({ ok: true, file: f, recompressed: false });
});
```
  `test/view-ev-violation.test.ts` (фикстура `F: EvViolationForm`: `items: [{ id: "i1", title_ru: "Чистота кухни", title_uz: "Oshxona tozaligi" }]`, `photo_required: false`, `max_photos: 3`, `max_photo_bytes: 10485760`, `comment_min: 3`):
```ts
const ph = (n: number) => Array.from({ length: n }, (_, i) => new File(["x"], `p${i}.png`, { type: "image/png" }));
it("violationIssues: комментарий, обязательное фото, лимит", () => {
  expect(violationIssues({ item_id: null, comment: "аб", photos: [] }, F)).toEqual(["comment"]);
  expect(violationIssues({ item_id: null, comment: "...", photos: [] }, F)).toEqual(["comment"]);
  expect(violationIssues({ item_id: null, comment: "Грязь", photos: [] }, F)).toEqual([]);
  expect(violationIssues({ item_id: null, comment: "Грязь", photos: [] }, { ...F, photo_required: true })).toEqual(["photo_required"]);
  expect(violationIssues({ item_id: null, comment: "Грязь", photos: ph(4) }, F)).toEqual(["too_many_photos"]);
});
it("buildViolationForm: поля, trim, пункт только если выбран, фото по одному полю", () => {
  const fd = buildViolationForm("emp-1", { item_id: "i1", comment: "  Грязный пол ", photos: ph(2) });
  expect([fd.get("employee_id"), fd.get("card_item_id"), fd.get("comment"), fd.getAll("photos").length]).toEqual(["emp-1", "i1", "Грязный пол", 2]);
  expect(buildViolationForm("emp-1", { item_id: null, comment: "Грязь", photos: [] }).has("card_item_id")).toBe(false);
});
```
- [ ] **Step 2: Run** `cd "$REPO/kpi_miniapp" && bun test test/photo-prepare.test.ts test/view-ev-violation.test.ts` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `photo-prepare.ts`, `view/ev-violation.ts`, `photo-pick.ts`, `screens/ev-violation.ts`, `case "ev_violation"` в `main.ts`, CSS. Ключи RU:

  | Ключ | RU |
  |---|---|
  | `ev_viol_title` | Нарушение · {name} |
  | `ev_viol_item` | Пункт карты |
  | `ev_viol_item_none` | Без пункта карты |
  | `ev_viol_comment` | Что произошло |
  | `ev_viol_comment_ph` | Например: грязный пол у кассы |
  | `ev_viol_comment_min` | Не меньше {min} букв или цифр |
  | `ev_viol_comment_note` | Комментарий увидит сотрудник |
  | `ev_photo_title` | Фото |
  | `ev_photo_required` | Фото обязательно |
  | `ev_photo_count` | {n} из {max} |
  | `ev_photo_take` | Снять |
  | `ev_photo_pick` | Выбрать |
  | `ev_photo_remove` | Убрать фото |
  | `ev_photo_busy` | Готовим фото… |
  | `ev_photo_err_decode` | Не удалось прочитать «{label}». Нужен JPEG или PNG. |
  | `ev_photo_err_empty` | Файл «{label}» пустой. |
  | `ev_photo_err_prepare` | Не удалось подготовить «{label}». |
  | `ev_photo_err_big` | «{label}» больше {mb} МБ даже после сжатия. |
  | `ev_photo_err_limit` | Можно не больше {max} фото. |
  | `ev_btn_viol_send` | Записать нарушение |

- [ ] **Step 4: Run** оба файла, затем `bun test` и `bun --bun run build` в `kpi_miniapp/` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add kpi_miniapp/src/photo-prepare.ts kpi_miniapp/src/photo-pick.ts kpi_miniapp/src/view/ev-violation.ts kpi_miniapp/src/screens/ev-violation.ts kpi_miniapp/src/main.ts kpi_miniapp/src/i18n.ts kpi_miniapp/src/style-ev.css kpi_miniapp/test/photo-prepare.test.ts kpi_miniapp/test/view-ev-violation.test.ts
git -C "$REPO" commit -m "feat(kpi): запись нарушения с фото для оценщика в мини-приложении" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: «Мои нарушения» и отмена своего

**Files:**
- Create: `kpi_miniapp/src/view/ev-violations.ts`, `kpi_miniapp/src/reason-sheet.ts`, `kpi_miniapp/src/screens/ev-violations.ts`, `kpi_miniapp/test/view-ev-violations.test.ts`
- Modify: `kpi_miniapp/src/photo.ts` (`photoThumb(id, base = "/violation-photos")`: путь файла берётся из второго аргумента, остальное без изменений), `kpi_miniapp/src/main.ts` (`case "ev_violations"`), `kpi_miniapp/src/i18n.ts`, `kpi_miniapp/src/style-ev.css`

**Interfaces:**
- Consumes: `EvViolations`, `EvViolation`; `evOutcome`; `photoThumb`; `reasonCounter`; `dayMonth`, `hhmm`; `monthName`.
- Produces:
  ```ts
  // view/ev-violations.ts
  export interface EvViolationVM {
    id: string; who: string; item: string; when: string; comment: string;
    status: { text: string; tone: "active" | "muted" | "warn" }; cancelReason: string | null;
    photoIds: string[]; canCancel: boolean; line: string | null;
  }
  export function evViolationsView(d: EvViolations, l: Lang): { title: string; items: EvViolationVM[]; empty: boolean };
  // reason-sheet.ts (по образцу sheet.ts, sheet.ts не менять)
  export interface ReasonSheetOptions { title: string; hint: string; placeholder: string; min: number; submitLabel: string; send(reason: string): Promise<ApiResult<unknown>>; onDone(): void }
  export function openReasonSheet(o: ReasonSheetOptions): void;
  ```
- Экран: путь `/ev/violations?period=…` (без периода — без параметра), `kind: "list"`, `noCache: true`, заголовок `ev_myviol_title`.

Правила `evViolationsView`: `who` — «Имя Фамилия · филиал» (`employee_name` как есть, пустые части выпадают); `item` — `item_title_ru` или `ev_viol_item_none` (узбекского названия сервер не отдаёт); `when` — `${dayMonth(occurred_at, l)}, ${hhmm(Date.parse(occurred_at))}`; статус: отменено → `viol_cancelled` (`muted`), открытый спор → `viol_dispute` (`warn`), иначе `viol_active` (`active`); `cancelReason` — только у отменённого; `canCancel` — `can_cancel`; `line` — у действующего без права отмены: открыт спор → `ev_viol_open_dispute`, иначе месяц закрыт (`period_status` ответа) → `ev_viol_closed`.

Поведение: строка нарушения как на экране сотрудника (превью фото 80 px, открываются на весь экран, файлы через `/ev/violation-photos/:id/file`); у `canCancel` тихая кнопка «Отменить» открывает `openReasonSheet` с причиной (минимум 3 буквы или цифры, как `commentOk(reason, 3)` на сервере; кнопка отправки MainButton, как в `sheet.ts`, а без MainButton обычная); отправка — `appApi().send("POST", "/ev/violations/<id>/cancel", { reason })`, исход через `evOutcome`: `done` и `reload` закрывают шторку и `rerender()`. Внизу ссылка «Записать нарушение» не нужна: запись начинается с карточки сотрудника.

- [ ] **Step 1: Тест `test/view-ev-violations.test.ts`:**

```ts
const V = (o: Partial<EvViolation>): EvViolation => ({ id: "v1", employee_id: "e1", employee_name: "Алиев Ботир", terminal_name: "Филиал А", card_item_id: null, item_title_ru: "Чистота кухни",
  period: "2026-10-01", occurred_at: "2026-10-14T14:40:00.000Z", comment: "Грязный пол у кассы", status: "active", cancel_reason: null, photo_ids: ["p1"], open_dispute: false, can_cancel: true, ...o });
const D = (items: EvViolation[], closed = false): EvViolations => ({ period: "2026-10-01", period_status: closed ? "closed" : "open", items });
it("строка: пункт, время по Ташкенту, статус, право отмены", () => {
  const vm = evViolationsView(D([V({})]), "ru");
  expect(vm.title).toBe("Мои нарушения · октябрь");
  expect(vm.items[0]).toEqual({ id: "v1", who: "Алиев Ботир · Филиал А", item: "Чистота кухни", when: "14 октября, 19:40", comment: "Грязный пол у кассы",
    status: { text: "действует", tone: "active" }, cancelReason: null, photoIds: ["p1"], canCancel: true, line: null });
});
it("отменённое, спор, закрытый месяц, без пункта", () => {
  const vm = evViolationsView(D([
    V({ id: "a", status: "cancelled", cancel_reason: "записано по ошибке", can_cancel: false }),
    V({ id: "b", open_dispute: true, can_cancel: false }),
    V({ id: "c", can_cancel: false, item_title_ru: null }),
  ], true), "ru");
  const by = new Map(vm.items.map((x) => [x.id, x]));
  expect(by.get("a")).toMatchObject({ status: { text: "отменено", tone: "muted" }, cancelReason: "записано по ошибке", line: null });
  expect(by.get("b")).toMatchObject({ status: { text: "спор открыт", tone: "warn" }, line: "По нарушению открыт спор. Отменить его можно только разбором спора." });
  expect(by.get("c")).toMatchObject({ item: "Без пункта карты", line: "Месяц закрыт, отменить нельзя." });
  expect(evViolationsView(D([]), "ru").empty).toBe(true);
});
```
- [ ] **Step 2: Run** `cd "$REPO/kpi_miniapp" && bun test test/view-ev-violations.test.ts` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `view/ev-violations.ts`, `reason-sheet.ts`, `screens/ev-violations.ts`, правку `photo.ts`, `case "ev_violations"` в `main.ts`, CSS. Ключи RU:

  | Ключ | RU |
  |---|---|
  | `ev_myviol_title` | Мои нарушения · {month} |
  | `ev_myviol_empty` | Вы не записывали нарушений в этом месяце |
  | `ev_viol_cancel` | Отменить |
  | `ev_viol_open_dispute` | По нарушению открыт спор. Отменить его можно только разбором спора. |
  | `ev_viol_closed` | Месяц закрыт, отменить нельзя. |
  | `ev_cancel_title` | Отменить нарушение |
  | `ev_cancel_hint` | Причину увидит сотрудник. |
  | `ev_cancel_ph` | Например: записано по ошибке |
  | `ev_cancel_send` | Отменить нарушение |

- [ ] **Step 4: Run** `bun test` и `bun --bun run build` в `kpi_miniapp/` — Expected: PASS; существующий тест фото сотрудника (`view-violations`, `api` blob) не меняется.
- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add kpi_miniapp/src/view/ev-violations.ts kpi_miniapp/src/reason-sheet.ts kpi_miniapp/src/screens/ev-violations.ts kpi_miniapp/src/photo.ts kpi_miniapp/src/main.ts kpi_miniapp/src/i18n.ts kpi_miniapp/src/style-ev.css kpi_miniapp/test/view-ev-violations.test.ts
git -C "$REPO" commit -m "feat(kpi): «Мои нарушения» и отмена своего нарушения в мини-приложении оценщика" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Споры: список и «Разобрать»

**Files:**
- Create: `kpi_miniapp/src/view/ev-disputes.ts`, `kpi_miniapp/src/screens/ev-disputes.ts`, `kpi_miniapp/src/screens/ev-dispute.ts`, `kpi_miniapp/test/view-ev-disputes.test.ts`
- Modify: `kpi_miniapp/src/main.ts` (`case "ev_disputes"`, `case "ev_dispute"`, удалить `default` из `screenOf`), `kpi_miniapp/src/view/home.ts` (вторая ссылка `ev_home_disputes` → `#/ev/disputes` в `evaluator.links`), `kpi_miniapp/test/view-home.test.ts`, `kpi_miniapp/src/i18n.ts`, `kpi_miniapp/src/style-ev.css`

**Interfaces:**
- Consumes: `EvDisputes`, `EvDispute`, `EvDisputeDetail`, `EvReviewForm`; `evOutcome`; `renderItemEditors`, `draftFromItems`, `toItemInputs`, `reviewIssues`, `evIssueText`, `changedItemIds` (задача 8); `photoThumb(id, "/ev/violation-photos")` (задача 10); `appApi().send`.
- Produces:
  ```ts
  // view/ev-disputes.ts
  export interface EvDisputeRowVM { id: string; who: string; kind: string; when: string; reason: string; chip: { text: string; tone: "ok" | "wait" | "warn" | "muted" }; canResolve: boolean; hash: string }
  export function evDisputesView(d: EvDisputes, l: Lang): { rows: EvDisputeRowVM[]; empty: boolean };
  export type ResolveDecision = "accepted" | "rejected";
  export function resolveIssues(a: { decision: ResolveDecision; comment: string; draft: Draft }, d: EvDisputeDetail): FormIssue[];
  export function resolveBody(a: { decision: ResolveDecision; comment: string; draft: Draft }, d: EvDisputeDetail): { decision: ResolveDecision; comment: string; items?: { item_id: string; score: number | null; note: string | null }[] };
  ```
- Экраны: список `/ev/disputes` (`kind: "list"`, `noCache: true`, заголовок `ev_dsp_title`); карточка `/ev/disputes/<id>` (`noCache: true`, заголовок — вид и месяц).

Правила:
- Порядок строк: сначала открытые с `can_resolve` (свежие выше), затем открытые без него, затем разобранные по `resolved_at` убыванию. Чип: открытый с правом → «Ждёт разбора» (`wait`), открытый без права → «Открыт» (`muted`), принятый → «Принят» (`ok`), отклонённый → «Отклонён» (`muted`). `kind` — `ev_dsp_review`/`ev_dsp_violation` с месяцем; `reason` как есть; `canResolve` — `can_resolve`; `hash` — `#/ev/dispute/<id>`.
- `resolveIssues`: принять спор по оценке — результат `reviewIssues(form.items, draft, "change", comment, comment_min)` (баллы, заметки, комментарий, `no_changes`); отклонить и принять спор по нарушению — только `comment_required`, когда букв и цифр в комментарии (`reasonCount`) меньше `comment_min`.
- `resolveBody`: `accepted` по оценке → `items: toItemInputs(...)`; в остальных случаях без `items`; `comment` с trim.

Поведение карточки: группы и подписи пунктов берутся из `evReviewView(detail.form, lang(), Date.now())`; шапка (имя, вид и месяц), причина сотрудника, блок «о чём спор» (для оценки — «Сейчас: балл», для нарушения — пункт, комментарий и фото 80 px), при `can_resolve = false` вместо управления — текст статуса (у разобранного — «Решение: …» и комментарий). Управление: переключатель «Принять / Отклонить»; при «Принять» по оценке под ним редакторы пунктов (те же, что в форме оценки, с исходными баллами; живой итог), для нарушения ничего; поле комментария сотруднику со счётчиком; главная кнопка «Принять спор»/«Отклонить спор». Нажатие: `latch()`, `resolveIssues` (подсветка и тексты), `appApi().send("POST", "/ev/disputes/<id>/resolve", resolveBody(...))`, `evOutcome`: `done` → вибро успеха, `back()`; `reload` (`dispute_closed`, `period_closed`, `unknown_item`) → текст и `rerender()`; `unknown` → `STATUS_TEXT.offline[lang()]`, повтор безопасен (второй разбор получит 409 `dispute_closed`). Пустое состояние списка — «Споров нет» (для спора, который перешёл к другому оценщику, строки в списке нет или она без кнопки).

- [ ] **Step 1: Тесты.** `test/view-ev-disputes.test.ts` (фикстуры в начале файла):

```ts
const DR = (o: Partial<EvDispute> = {}): EvDispute => ({ id: "d1", subject_type: "review", subject_id: "r1", employee_id: "e1", employee_name: "Алиев Ботир", terminal_name: "Филиал А",
  period: "2026-10-01", reason: "Не согласен", status: "open", resolution_comment: null, resolved_at: null, created_at: "2026-10-01T07:00:00.000Z", can_resolve: true,
  subject: { kind: "review", score_pct: 91.4 }, ...o });
const item = (id: string, score: number): EvFormItem => ({ item_id: id, title_ru: id, title_uz: id, hint_ru: null, weight: 1, source: "manual", group_key: "base", score, note: null, suggestion: null, violations: [], violation_hint: null });
const FORM: EvReviewForm = { period: "2026-10-01", period_status: "open", employee: { id: "e1", first_name: "Ботир", last_name: "Алиев", terminal_name: "Филиал А" }, card_title: "Повар",
  review: { id: "r1", status: "submitted", score_pct: 75, version: 1, submitted_at: "2026-10-25T07:00:00.000Z", late: false }, items: [item("m1", 100), item("m2", 50)], other_violations: [],
  can_edit: false, open_dispute: true, dispute_rejected: false, submit_opens_at: "2026-10-19T19:00:00.000Z", review_deadline: "2026-11-07T18:59:59.999Z" };
const DET: EvDisputeDetail = { dispute: DR(), comment_min: 5, form: FORM };
```

Тесты:

```ts
it("порядок и чипы: ждут моего разбора, открытые чужие, разобранные по давности", () => {
  const vm = evDisputesView({ items: [
    DR({ id: "acc", status: "accepted", can_resolve: false, resolved_at: "2026-10-12T07:00:00.000Z", created_at: "2026-10-09T07:00:00.000Z" }),
    DR({ id: "other", can_resolve: false, created_at: "2026-10-15T07:00:00.000Z" }),
    DR({ id: "old", created_at: "2026-10-10T07:00:00.000Z" }),
    DR({ id: "new", created_at: "2026-10-14T07:00:00.000Z", subject_type: "violation", subject: { kind: "violation", item_title_ru: null, comment: "Грязь", photo_ids: [] } }),
    DR({ id: "rej", status: "rejected", can_resolve: false, resolved_at: "2026-10-13T07:00:00.000Z" }),
  ] }, "ru");
  expect(vm.rows.map((r) => r.id)).toEqual(["new", "old", "other", "rej", "acc"]);
  const by = new Map(vm.rows.map((r) => [r.id, r]));
  expect([by.get("new")!.chip, by.get("other")!.chip, by.get("acc")!.chip, by.get("rej")!.chip]).toEqual([
    { text: "Ждёт разбора", tone: "wait" }, { text: "Открыт", tone: "muted" }, { text: "Принят", tone: "ok" }, { text: "Отклонён", tone: "muted" }]);
  expect(by.get("new")).toMatchObject({ who: "Алиев Ботир · Филиал А", kind: "Нарушение, октябрь", canResolve: true, hash: "#/ev/dispute/new" });
  expect(by.get("old")!.kind).toBe("Оценка за октябрь");
  expect(evDisputesView({ items: [] }, "ru").empty).toBe(true);
});
it("resolveIssues: отклонить — только комментарий; принять оценку — баллы и комментарий; нарушение — только комментарий", () => {
  const same = draftFromItems(DET.form!.items, false);
  expect(resolveIssues({ decision: "rejected", comment: "ок", draft: same }, DET)).toEqual([{ code: "comment_required" }]);
  expect(resolveIssues({ decision: "rejected", comment: "Оценка верна", draft: same }, DET)).toEqual([]);
  expect(resolveIssues({ decision: "accepted", comment: "Пересчитал по табелю", draft: same }, DET)).toEqual([{ code: "no_changes" }]);
  const changed = { ...same, m2: { score: 100, note: "" } };
  expect(resolveIssues({ decision: "accepted", comment: "Пересчитал по табелю", draft: changed }, DET)).toEqual([]);
  expect(resolveIssues({ decision: "accepted", comment: "", draft: changed }, DET)).toEqual([{ code: "comment_required" }]);
  const vio: EvDisputeDetail = { ...DET, form: null, dispute: DR({ subject_type: "violation", subject: { kind: "violation", item_title_ru: null, comment: "Грязь", photo_ids: [] } }) };
  expect(resolveIssues({ decision: "accepted", comment: "Нарушение снято", draft: {} }, vio)).toEqual([]);
});
it("resolveBody: баллы только при принятии оценки, комментарий обрезан", () => {
  const changed = { ...draftFromItems(DET.form!.items, false), m2: { score: 100, note: "" } };
  expect(resolveBody({ decision: "accepted", comment: "  Пересчитал по табелю ", draft: changed }, DET)).toEqual({
    decision: "accepted", comment: "Пересчитал по табелю", items: [{ item_id: "m1", score: 100, note: null }, { item_id: "m2", score: 100, note: null }] });
  expect(resolveBody({ decision: "rejected", comment: "Оценка верна", draft: changed }, DET)).toEqual({ decision: "rejected", comment: "Оценка верна" });
});
```
  В `test/view-home.test.ts`: ожидание `links` блока оценщика становится `[{ text: "Мои сотрудники", hash: "#/ev" }, { text: "Споры", hash: "#/ev/disputes" }]`.
- [ ] **Step 2: Run** `cd "$REPO/kpi_miniapp" && bun test test/view-ev-disputes.test.ts test/view-home.test.ts` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `view/ev-disputes.ts`, оба экрана, ссылку на главном экране, `case` в `main.ts` и удаление `default` в `screenOf` (теперь `tsc` проверяет полноту по всем маршрутам), CSS. Ключи RU:

  | Ключ | RU |
  |---|---|
  | `ev_home_disputes` | Споры |
  | `ev_dsp_title` | Споры |
  | `ev_dsp_empty` | Споров нет |
  | `ev_dsp_review` | Оценка за {month} |
  | `ev_dsp_violation` | Нарушение, {month} |
  | `ev_dsp_chip_wait` | Ждёт разбора |
  | `ev_dsp_chip_other` | Открыт |
  | `ev_dsp_chip_accepted` | Принят |
  | `ev_dsp_chip_rejected` | Отклонён |
  | `ev_dsp_resolve` | Разобрать |
  | `ev_dsp_reason` | Причина сотрудника |
  | `ev_dsp_decision` | Решение |
  | `ev_dsp_accept` | Принять |
  | `ev_dsp_reject` | Отклонить |
  | `ev_dsp_comment` | Комментарий сотруднику |
  | `ev_dsp_comment_ph` | Объясните решение |
  | `ev_dsp_scores` | Новые баллы |
  | `ev_dsp_score_now` | Сейчас: {pct} |
  | `ev_dsp_violation_item` | Пункт: {title} |
  | `ev_dsp_send_accept` | Принять спор |
  | `ev_dsp_send_reject` | Отклонить спор |
  | `ev_dsp_resolution` | Решение: {text} |
  | `ev_dsp_not_mine` | Этот спор разбирает другой оценщик. |

- [ ] **Step 4: Run** `bun test` и `bun --bun run build` в `kpi_miniapp/` — Expected: PASS (без `default` в `screenOf` сборка проверяет, что каждый маршрут имеет экран).
- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add kpi_miniapp/src/view/ev-disputes.ts kpi_miniapp/src/screens/ev-disputes.ts kpi_miniapp/src/screens/ev-dispute.ts kpi_miniapp/src/main.ts kpi_miniapp/src/view/home.ts kpi_miniapp/src/i18n.ts kpi_miniapp/src/style-ev.css kpi_miniapp/test/view-ev-disputes.test.ts kpi_miniapp/test/view-home.test.ts
git -C "$REPO" commit -m "feat(kpi): споры оценщика в мини-приложении: список и разбор" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Стенд, проверка в Chrome, итоговые прогоны

**Files:**
- Modify: `backend/src/modules/kpi/tg-app/smoke-seed.ts` (только добавления: роль для оценщиков стенда)

**Interfaces:**
- Consumes: всё из задач 1–11; `roles`, `roles_permissions`, `permissions`, `users` (схема); персоны стенда 9100000004 (спор), 9100000011 (оценщик), 9100000012 (руководитель: сотрудник и оценщик).
- Produces: на стенде оба пользователя `test_kpi_smoke_eval` и `test_kpi_smoke_lead` имеют `role_id` роли `test_kpi_smoke_evaluator` с одним правом `kpi.evaluate`. Без неё все `/kpi/tg/ev/*` отвечают 403 `forbidden`: `smoke-seed` создаёт пользователей без роли.

Правила правки `smoke-seed.ts`: в начале `seed()` до `makeUser` — найти право `kpi.evaluate` в `permissions` (нет — бросить ошибку «нет права kpi.evaluate: примените seed-permissions на стенде»), вставить роль `test_kpi_smoke_evaluator` (поля `name`, `code` те же) и связь в `roles_permissions`; `makeUser` пишет `role_id`. Очистка перед записью удаляет эту роль и её связи после удаления пользователей. Правка не трогает другие блоки файла (поток `tg-attendance` может добавлять в тот же файл свои строки).

- [ ] **Step 1: Правка `smoke-seed.ts`** и проверка скриптом: стенд поднимается блоком «Стенд» из задачи 3 плана `docs/superpowers/plans/2026-10-26-kpi-7-miniapp-front.md` (команды повторяются как есть; `SMOKE_URL` проверяется на окончание `managers_kpi_smoke`; нет базы — остановиться и доложить, остальные базы не трогать). После `smoke-seed` выполнить `/opt/homebrew/opt/postgresql@17/bin/psql "$SMOKE_URL" -Atc "select login, role_id is not null from users where login like 'test_kpi_smoke%' order by login"` — Expected: обе строки `t`. Backend стенда запускать после сида (роли кэшируются при старте `CacheControlService`; запущенный раньше процесс перезапустить).
- [ ] **Step 2: Обход в Chrome** через chrome-attach на окне 375×812, светлая и тёмная тема, русский и узбекский. Ссылки: `cd "$REPO/kpi_miniapp" && KPI_BOT_TOKEN=123456:kpi-smoke-dev-token bun scripts/dev-url.ts --tg <id> --route <маршрут> --theme <light|dark>`. Проверить и снять скриншоты (в каталог сессии, не в репозиторий):
  - Персона 9100000011 (только оценщик): главный экран с блоком оценщика и ссылками; `#/ev` (фильтры филиала и карты, поиск, чипы статуса, список); открыть сотрудника без оценки, поставить баллы, «Сохранить черновик», «Отправить оценку»; отправленная оценка читается без кнопок; «Записать нарушение» с фото из файла (`upload_file` на скрытое поле выбора), экран «Мои нарушения», отмена с причиной; `#/ev/disputes`, карточка спора персоны 04, принять с новыми баллами, отклонить; `#/ev/2026-10` и `#/ev/disputes` как переходы из уведомлений.
  - Персона 9100000012 (сотрудник и оценщик): на главном экране сверху блок оценщика, под ним всё приложение сотрудника; экраны оценщика открываются, экраны сотрудника тоже.
  - Персона 9100000001 (только сотрудник) на `#/ev/disputes` и `#/ev`: открывается главный экран, хеш `#/`.
  - На каждом экране скриптом через `evaluate_script`: `document.documentElement.scrollWidth <= 375`; все `button`, `a`, `select`, `input` не ниже 44 px; кегль основного текста не ниже 14 px; у чисел `font-variant-numeric: tabular-nums`; обрезанного текста нет (самое длинное имя и русское название карты). Консоль без ошибок, `list_network_requests` без 5xx.
  - Нет сети (`emulate` с `networkConditions: "Offline"`) на списке и форме: экран «Нет связи» с «Повторить», старых списков нет; при записи нарушения без сети — текст про неизвестный исход и ссылка «Мои нарушения».
- [ ] **Step 3: Итоговые прогоны.**
  - `cd "$REPO/kpi_miniapp" && bun test && bun --bun run build`; в `dist/assets/` ровно один `.js` и один `.css`; `grep -rl __KPI_DEV_FAKE_TELEGRAM__ dist` пусто; `grep -rn '@backend' src | grep -v '^[^:]*:[0-9]*:import type .* from "@backend/'` пусто; `grep -rn 'innerHTML\|outerHTML\|insertAdjacentHTML' src` не находит подстановок данных сервера.
  - `TESTENV && bun run test:http:kpi` из `backend/` (на чистом `TEST_DATABASE_URL`): все файлы PASS.
  - Юнит-тесты backend из Global Constraints и проверка типов backend — пусто; `cd "$REPO/admin" && ./node_modules/.bin/tsc --noEmit -p . --incremental false 2>&1 | grep "error TS"` — пусто (админка импортирует тип `App` бэкенда, новые роуты его меняют).
  - `git -C "$REPO" fetch origin && git -C "$REPO" merge origin/main`, затем повторить три предыдущих пункта; шаг 6 задачи 4 выполнить, если поток `admin-scopes` уже в ветке.
- [ ] **Step 4: Остановить стенд** (оба фоновых процесса: backend на 6799 и vite на 5174).
- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add backend/src/modules/kpi/tg-app/smoke-seed.ts
git -C "$REPO" commit -m "test(kpi): роль kpi.evaluate оценщикам стенда мини-приложения" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Заметки для описания PR** (текст в PR, не файл): тексты `uz` для новых ключей `ev_*` пишет разработка и носитель их не проверял; мини-приложение знает только `ru` и `uz` (латиница), кириллического узбекского нет; в спеке `2026-10-26-kpi-employee-miniapp-design.md` не-цель «Оценщик не ставит оценки в приложении» теперь устарела (правит поток `admin-scopes` вместе со спекой KPI); миграций и переменных окружения нет, деплой — пересборка `kpi_miniapp` и перезапуск backend; роль оценщика обязана нести `kpi.evaluate`, иначе приложение отвечает «нет права оценивать».

---

## Самопроверка

**Покрытие спеки (раздел 5).** Список сотрудников по назначениям с фильтром по филиалу и карте и статусом периода: задачи 1 и 7. Оценка тем же кодом, черновик и отправка: задачи 2 и 8. Запись нарушения с фото и отмена своего: задачи 3, 9, 10. Споры по моим оценкам, принять с баллами и отклонить с комментарием: задачи 4 и 11. Кнопка «Открыть» у `dispute_opened` и `remind_evaluate`: задача 5. Права по `user_id` и назначениям, без новых прав, оценщик только в своих назначениях: `evaluatorActor` и тесты 403 по каждому id-эндпоинту (задачи 1–4). Правило разбора спора потребляется через `resolveDispute`/`listDisputes`, своей авторизации нет; зависимость от потока 1 закрыта шагом 6 задачи 4. «Не делаем»: новых прав, «передать спор», `kpi.manage` управляющим, ночной синхронизации посещаемости в плане нет. Блок оценщика на главном экране, который вёл только в админку, заменён ссылками на экраны (задача 7), ссылка в админку осталась тихой.

**Согласованность типов.** Все ответы описаны один раз в `ev-types.ts` (задача 1) и использованы без переименований: `EvReviewForm` (задачи 2, 4, 8, 11), `EvViolation` (3, 10), `EvDispute`, `EvDisputeDetail` (4, 11), `EvEmployees` (1, 7), `EvViolationForm` (3, 9). Имена функций клиента (`evOutcome`, `evNoticeKey`, `renderItemEditors`, `draftFromItems`, `reviewIssues`, `photoThumb(id, base)`) определены в задаче-источнике до использования. Маршруты клиента заданы целиком в задаче 6, экраны подключаются по одному, `default` в `screenOf` снимается в задаче 11.

**Проверено по коду.** Пути, имена и сигнатуры из задач сверены с `access.ts`, `directory.ts`, `employees.ts`, `reviews.ts`, `violations.ts`, `disputes.ts`, `tg-app/ctx.ts`, `routes/*.ts`, `tg/miniapp-url.ts`, `tg/messages.ts`, `kpi_miniapp/src/*`, `admin/lib/kpi/review-form.ts`, `admin/lib/tickets-create.ts`. Команды `bun test` в `kpi_miniapp` (99 тестов) и `src/modules/kpi/tg-app src/modules/kpi/tg` (63 теста) выполнены на старте. Не проверено запуском: HTTP-тесты `test:http:kpi` против базы, поведение двух плагинов с общим guard на реальном `kpiTgCtx` (на голом Elysia проверено), отсутствие в базе стенда `managers_kpi_smoke`, поведение `vite build` при втором CSS-файле (покрывается проверкой «ровно один `.css`»).

**Пропорции.** Блоки кода — только тесты и точные тексты ключей; реализации даны сигнатурами и правилами. Таблицы ключей содержат русский текст дословно; узбекский пишет исполнитель.
