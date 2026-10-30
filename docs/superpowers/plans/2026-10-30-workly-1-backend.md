# Workly: бэкенд (сотрудники и посещаемость) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подтягивать сотрудников и посещаемость из двух компаний Workly (Les Ailes, Chopar) в `employees` и `kpi_attendance`, с предпросмотром, журналом, откатом и ночным прогоном.

**Architecture:** Новый модуль `backend/src/modules/workly/`: клиент API, чистый построитель плана сверки, применение плана с журналом, карта локаций, посещаемость. Запись посещаемости идёт через общую функцию в `modules/kpi/attendance.ts`, которую делят файловая загрузка и API. Ночной прогон ставится в существующем `office_kpi_worker`.

**Tech Stack:** Bun, Elysia, Drizzle (PostgreSQL), ioredis, BullMQ, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-29-workly-sync-design.md` (утверждена). Админка: `docs/superpowers/plans/2026-10-30-workly-2-admin.md`, она читает API этого плана.

## Global Constraints

- Переменные: `WORKLY_BASE_URL`; по четыре на компанию `WORKLY_LES_*` и `WORKLY_CHOPAR_*` (`CLIENT_ID`, `CLIENT_SECRET`, `USERNAME`, `PASSWORD`); `WORKLY_ATTENDANCE_NIGHTLY` (по умолчанию выключен). Префикс `LES` ↔ организация «Les Ailes», `CHOPAR` ↔ «ChoparPizza» (поиск организации по имени).
- Вход: `POST /v1/oauth/token`, только `grant_type=password`; ключ 30 дней, `refresh_token` 60 дней. Коды: 7002 неверный пользователь, 7003 недействительные `client_id`/`client_secret`, 7005 grant не поддерживается, 7008 недействительный ключ, HTTP 426 принудительное обновление.
- Страницы: заголовок `limit: 50`, номера с 1. `totalCount` завышен JOIN-ом по должностям, дедупликация по `id`, цикл идёт, пока `_meta.currentPage` равен запрошенной странице и она не больше `pageCount`.
- Предохранители ночного прогона: деактиваций не больше `max(10, 10% активных организации)`, созданий не больше 50, уникальных активных из Workly не меньше 90% от прошлого успешного прогона, первый прогон организации всегда ручной.
- Деактивация только при положительном признаке «уволен» (список уволенных Workly); «нет нигде» уходит в отчёт.
- Окно посещаемости: с 1-го числа месяца по вчерашний день по Asia/Tashkent; ночью текущий месяц и предыдущий, если он не закрыт. Плановый день: `is_work_day` и не `is_holiday`. Прогул: только из absence при пустом `timeoff_id`. Времена Workly местные (+05:00).
- Права всех маршрутов: `kpi.manage`. Миграция 0041; SQL проверяется глазами до применения.
- Секреты (`client_secret`, пароль, ключи доступа) не попадают в логи, ответы API и репозиторий.
- Комментарии и тексты ошибок по-русски, коды ошибок snake_case, как в `modules/kpi`. Тесты с базой идут только на `managers_tickets_test` (`TEST_DATABASE_URL`), локальную `managers` не мигрировать. Не заявлять «тесты прошли» без реального запуска. Прод не трогать.

## Review Focus

1. Workly вернул пустой или короткий список (сбой, чужая компания): никого не деактивировать и не создавать (Task 4, 5).
2. Тёзки: две записи Workly или два наших сотрудника с одним именем в организации: «неоднозначно», связь не ставится (Task 4).
3. Ключ доступа истёк посреди обхода страниц (7008 на странице 5): один повтор с новым ключом, обход продолжается без дублей (Task 3).
4. Месяц закрыт для KPI: синхронизация посещаемости отвечает 409 `period_closed` и ничего не стирает (Task 8, 9).
5. Нестандартные значения: `report: null` в T12, `late_in: null`, `work_time` `"280:00"` и `"00:00"`, `last_out` раньше `first_in` (Task 9).

## File Structure

| Файл | Ответственность |
|---|---|
| `backend/drizzle/schema.ts`, `migrations/0041_*` | колонки и таблицы |
| `modules/workly/types.ts` | формы ответов Workly |
| `modules/workly/config.ts` | подключения из env, организация по имени |
| `modules/workly/client.ts` | вход, ключ в Redis, пагинация, ошибки |
| `modules/workly/names.ts` | нормализация имён |
| `modules/workly/plan.ts` | чистый построитель плана, счётчики |
| `modules/workly/guards.ts` | предохранители |
| `modules/workly/locations.ts` | карта локаций и терминалов |
| `modules/workly/runs.ts` | журнал, `planRun`, `applyRun`, `syncAuto`, `rollbackRun` |
| `modules/workly/attendance.ts` | правила дней, `syncAttendance` |
| `modules/workly/quality.ts` | блок качества данных |
| `modules/workly/routes.ts` | Elysia-маршруты |
| `modules/workly/nightly.ts` | ночные шаги |
| `modules/workly/rollback-run.ts` | CLI отката |
| `modules/kpi/attendance.ts` | общая запись импорта по организации |

---

### Task 1: Схема и миграция 0041

**Files:**
- Modify: `backend/drizzle/schema.ts` (`employees`, `kpi_attendance_imports`; новые `workly_locations`, `workly_sync_runs`)
- Create: `backend/drizzle/migrations/0041_workly_sync.sql` и `meta/0041_snapshot.json` (генерирует drizzle-kit)

**Interfaces:**
- Produces:
  - `employees` + `workly_company_id integer`, `workly_id integer`, `workly_tab_number varchar(32)`; частичный уникальный индекс `employees_workly_uq` по `(workly_company_id, workly_id)` where `workly_id is not null`.
  - `kpi_attendance_imports` + `organization_id uuid` (nullable); у `uploaded_by` снимается `NOT NULL` (ночной прогон идёт без пользователя; тип `AttendanceImportRow.uploaded_by` становится `string | null`).
  - `workly_locations`: `id uuid pk`, `workly_company_id integer not null`, `workly_location_id integer not null`, `title varchar(120) not null`, `terminal_id uuid null`, `created_at`, `updated_at`; unique `(workly_company_id, workly_location_id)`.
  - `workly_sync_runs`: `id uuid pk`, `organization_id uuid not null`, `workly_company_id integer not null`, `trigger varchar(16)` (`manual`|`schedule`), `status varchar(16)` (`planned`|`applied`|`blocked`|`failed`|`rolled_back`), `block_reason varchar(32) null`, `counts jsonb default {}`, `active_fetched integer default 0`, `plan jsonb` (`{items, report}`), `error text null`, `created_by uuid null`, `created_at`, `applied_at null`; индекс `(organization_id, created_at)`.

- [ ] **Step 1: Добавить колонки и таблицы в `schema.ts`** в стиле соседних таблиц (`uuid().defaultRandom()`, `timestamp(..., { withTimezone: true, mode: "string" })`).
- [ ] **Step 2: Сгенерировать миграцию:** `cd backend && bunx drizzle-kit generate --name workly_sync`. Ожидается файл `0041_workly_sync.sql` и запись `idx 41` в `meta/_journal.json`.
- [ ] **Step 3: Прочитать SQL глазами:** только `ALTER TABLE ... ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`; никаких `DROP`.
- [ ] **Step 4: Применить к тестовой базе:** `DATABASE_URL=$TEST_DATABASE_URL bunx drizzle-kit migrate`. Проверка: `psql $TEST_DATABASE_URL -c '\d workly_sync_runs'` показывает все колонки, `\d employees` показывает `employees_workly_uq`.
- [ ] **Step 5: Commit** `feat(workly): схема и миграция 0041`.

---

### Task 2: Типы и конфигурация подключений

**Files:**
- Create: `backend/src/modules/workly/types.ts`, `backend/src/modules/workly/config.ts`
- Test: `backend/src/modules/workly/config.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type ConnKey = "LES" | "CHOPAR";
  export interface WorklyCreds { key: ConnKey; baseUrl: string; clientId: string; clientSecret: string; username: string; password: string }
  export interface WorklyLocationRef { id: number; title: string }
  export interface WorklyEmployee { id: number; first_name: string; last_name: string; patronymic: string; tab_number: string; start_date: string; positions: { id: number; title: string }[]; locations: WorklyLocationRef[] }
  export interface WorklyDismissed { id: number; first_name: string; last_name: string; patronymic: string; tab_number: string; start_date: string; end_date: string }
  export interface WorklyLocation { id: number; title: string }
  export interface T12Day { report_date: string; is_work_day: boolean; is_holiday: boolean; work_time: string | null }
  export interface T12Item { employee_id: number; report: { days: T12Day[] } | null }
  export interface LateInItem { employee: { id: number }; scheduled: { report_date: string }; actual: { first_in: string | null; last_out: string | null; late_in: string | null } }
  export interface AbsenceItem { employee: { id: number }; scheduled: { report_date: string; is_work_day?: boolean; timeoff_id: number | null } }
  ```
- Produces (`config.ts`):
  ```ts
  export const CONNECTIONS: readonly { key: ConnKey; organizationName: string }[]; // LES→"Les Ailes", CHOPAR→"ChoparPizza"
  export function credsFromEnv(key: ConnKey, env: Record<string, string | undefined>): WorklyCreds | null; // null, если нет хотя бы одной из пяти переменных
  export async function organizationIdOf(db: DbLike, key: ConnKey): Promise<string | null>; // DbLike из modules/kpi/access
  ```

- [ ] **Step 1: Тесты `config.test.ts`:**
  ```ts
  const full = { WORKLY_BASE_URL: "https://api.workly.uz", WORKLY_LES_CLIENT_ID: "a", WORKLY_LES_CLIENT_SECRET: "b", WORKLY_LES_USERNAME: "c", WORKLY_LES_PASSWORD: "d" };
  it("собирает креды LES", () => expect(credsFromEnv("LES", full)).toEqual({ key: "LES", baseUrl: "https://api.workly.uz", clientId: "a", clientSecret: "b", username: "c", password: "d" }));
  it("null без пароля", () => expect(credsFromEnv("LES", { ...full, WORKLY_LES_PASSWORD: "" })).toBeNull());
  it("CHOPAR не берёт ключи LES", () => expect(credsFromEnv("CHOPAR", full)).toBeNull());
  it("срезает слэш в конце baseUrl", () => expect(credsFromEnv("LES", { ...full, WORKLY_BASE_URL: "https://x.uz/" })!.baseUrl).toBe("https://x.uz"));
  ```
- [ ] **Step 2: Запустить `cd backend && bun test src/modules/workly/config.test.ts`**, ожидается FAIL (модуля нет).
- [ ] **Step 3: Реализовать `types.ts` и `config.ts`.** `organizationIdOf` ищет в `organization` по `name` и `active`.
- [ ] **Step 4: Тест проходит.**
- [ ] **Step 5: Commit** `feat(workly): типы и конфигурация подключений`.

---

### Task 3: Клиент Workly

**Files:**
- Create: `backend/src/modules/workly/client.ts`
- Test: `backend/src/modules/workly/client.test.ts`

**Interfaces:**
- Consumes: `WorklyCreds`, типы ответов (Task 2).
- Produces:
  ```ts
  export class WorklyError extends Error { constructor(public code: "not_configured" | "client_invalid" | "force_update" | "auth_failed" | "http_error", message: string) }
  export interface WorklyDeps { redis: Pick<Redis, "get" | "set" | "del">; fetch?: typeof fetch; now?: () => Date }
  export class WorklyClient {
    constructor(creds: WorklyCreds, deps: WorklyDeps);
    companyId(): Promise<number>;               // GET /v1/accounts → company_id
    employees(): Promise<WorklyEmployee[]>;     // GET /v1/employees, дедуп по id
    dismissed(): Promise<WorklyDismissed[]>;    // GET /v1/employees/dismissed, дедуп по id
    locations(): Promise<WorklyLocation[]>;     // GET /v1/locations
    t12(from: string, to: string): Promise<T12Item[]>;       // GET /v1/reports/t12?start_date&end_date, ключ employee_id
    lateIn(from: string, to: string): Promise<LateInItem[]>; // /v1/reports/late-in, ключ `${employee.id}|${report_date}`
    absence(from: string, to: string): Promise<AbsenceItem[]>; // /v1/reports/absence, тот же ключ
  }
  export function clientFor(key: ConnKey, redis: Redis): WorklyClient; // кидает WorklyError("not_configured")
  export function setClientFactory(f: typeof clientFor | null): void;   // подмена в тестах; clientFor вызывает фабрику, если она задана
  ```
- Ключ доступа хранится в Redis под `${process.env.PROJECT_PREFIX}workly_token:${key}` как JSON `{access_token, refresh_token, expires_at}`; TTL по сроку `expires_in`.

- [ ] **Step 1: Тесты `client.test.ts` на поддельном `fetch`** (ответы по таблице «путь → страницы»; Redis подменяется `Map`-обёрткой):
  - `it("дедуплицирует и останавливается, когда currentPage не равен запрошенной")`: страница 1 даёт 44 записи, страницы 2 и 3 по 50, запрос страницы 4 возвращает страницу 3 повторно с `currentPage: 3`; `await c.employees()` даёт 144 уникальных `id`, число запросов страниц равно 4.
  - `it("ходит с заголовком limit: 50 и Bearer")`: проверка заголовков первого запроса.
  - `it("берёт ключ из Redis и не логинится повторно")`: два вызова `locations()` дают один запрос `/v1/oauth/token`.
  - `it("обновляет ключ через refresh_token за сутки до срока")`: `now` ставится на `expires_at - 3600_000`, ждём запрос с `grant_type=refresh_token`.
  - `it("при 7008 на странице 5 берёт новый ключ один раз и продолжает без дублей")`: страницы 1–4 отдают данные, страница 5 первый раз `400 {code:7008}`, после повторного входа страница 5 и дальше отдают данные; итог без дублей, входов ровно два.
  - `it("7008 дважды подряд превращается в auth_failed")`.
  - `it("7003 при входе даёт WorklyError client_invalid и не повторяется")`; `it("426 даёт force_update")`.
  - `it("сообщение ошибки не содержит пароль и client_secret")`: `expect(String(err.message)).not.toContain(secret)`.
- [ ] **Step 2: Запустить, ожидается FAIL.**
- [ ] **Step 3: Реализовать `client.ts`.** Общий приватный `crawl<T>(path, params, keyOf)`; при ответе с `code: 7008` один раз сбросить ключ в Redis, войти заново и повторить тот же запрос. Вход: `application/x-www-form-urlencoded`, `grant_type=password`. Не логировать тела запросов входа.
- [ ] **Step 4: Тесты проходят.**
- [ ] **Step 5: Commit** `feat(workly): клиент API с обновлением ключа и обходом страниц`.

---

### Task 4: Имена и построитель плана

**Files:**
- Create: `backend/src/modules/workly/names.ts`, `backend/src/modules/workly/plan.ts`
- Test: `backend/src/modules/workly/names.test.ts`, `backend/src/modules/workly/plan.test.ts`

**Interfaces:**
- Consumes: `WorklyEmployee`, `WorklyDismissed`; `StructuredPosition` из `modules/staff_roles/catalog.ts`.
- Produces (`names.ts`):
  ```ts
  export function nameKey(...parts: (string | null | undefined)[]): string;
  // ВЕРХНИЙ регистр, апострофы ’ ‘ ʻ ʼ ` ´ ' удаляются, всё кроме A-Z0-9А-ЯЁ становится пробелом, токены уникальны и отсортированы, склеены пробелом
  export function worklyNameKeys(e: { first_name: string; last_name: string; patronymic?: string | null }): string[]; // [ключ имя+фамилия, ключ имя+фамилия+отчество], без повторов
  ```
- Produces (`plan.ts`):
  ```ts
  export interface OurEmployee { id: string; first_name: string; last_name: string; position: string | null; terminal_id: string; active: boolean; workly_id: number | null; workly_company_id: number | null }
  export interface EmployeeFields { first_name: string; last_name: string; workly_company_id: number | null; workly_id: number | null; workly_tab_number: string | null; position: string | null; staff_role_id: string | null; grade: number | null; shift: "day" | "night" | null; is_trainee: boolean | null; terminal_id: string; active: boolean }
  export type PlanKind = "link" | "relink" | "update" | "move" | "create" | "deactivate" | "reactivate";
  export interface PlanItem { key: string; kind: PlanKind; employee_id: string | null; workly_id: number; label: string; before: Partial<EmployeeFields> | null; after: Partial<EmployeeFields> }
  export interface PlanReport { ambiguous: { workly_id: number; label: string; employee_ids: string[] }[]; not_found: { employee_id: string; label: string }[]; no_branch: { workly_id: number; label: string }[] }
  export interface SyncPlan { items: PlanItem[]; report: PlanReport }
  export interface PlanInput { companyId: number; ours: OurEmployee[]; active: WorklyEmployee[]; dismissed: WorklyDismissed[]; terminalByLocation: ReadonlyMap<number, string | null>; structure: (title: string | null) => StructuredPosition }
  export function buildPlan(i: PlanInput): SyncPlan;
  export function countsOf(p: SyncPlan): Record<PlanKind | "ambiguous" | "not_found" | "no_branch", number>;
  ```
  `key` = `${kind}:${employee_id ?? "w" + workly_id}`. У сотрудника не больше одного основного пункта (`link`/`relink`/`update`/`reactivate`/`deactivate`); смена терминала у существующего идёт отдельным пунктом `move` (ключ `move:<employee_id>`), и в основном пункте `terminal_id` нет.

Правила `buildPlan` (из спеки 5.3–5.4):
1. Для каждой активной записи Workly `w`, на которую не указывает ничей `workly_id`: кандидаты, это сотрудники организации, у которых ключ имени совпал с одним из `worklyNameKeys(w)` (с ключом имени+фамилии нашего сотрудника) и у которых `workly_id` пуст либо указывает на запись из списка уволенных. Если активных записей Workly с тем же ключом больше одной: для всех неоднозначно. Один кандидат: `link` (`workly_id` пуст) или `relink` (указывал на уволенную запись); `after` содержит связь, `workly_tab_number`, структуру должности, `active: true`. Несколько: `report.ambiguous`. Ноль: `create`, если ровно одна локация сотрудника имеет терминал в `terminalByLocation`; иначе `report.no_branch`.
2. Записи, на которые уже указывает `workly_id`: `update`, если изменились табельный номер или должность (после `structure`), `reactivate`, если наш был неактивен; `move`, если ровно одна локация имеет терминал и он отличается от текущего (несколько локаций или ни одной сопоставленной: терминал остаётся).
3. Наш активный сотрудник, которого не затронули правила 1 и 2 (на его запись не указывает активная запись Workly): связан и его `workly_id` в списке уволенных, либо не связан, его ключ имени не совпал ни с одной активной записью Workly (неоднозначное совпадение тоже считается совпадением) и совпал ровно с одной записью списка уволенных: `deactivate` (`after: { active: false, workly_company_id, workly_id: <id уволенной записи> }`). Остальные: `report.not_found`.
4. Должность: `positions[0]?.title ?? null` через `structure`. Имена сотрудника при связывании не меняются.

- [ ] **Step 1: `names.test.ts`:** `nameKey("ozodbek", "rahimov") === nameKey("rahimov", "ozodbek")`; `nameKey("A", null, "")` игнорирует пустые; `worklyNameKeys({first_name:"A",last_name:"B",patronymic:"C"})` даёт два различных ключа, без отчества один.
- [ ] **Step 2: `plan.test.ts`** с локальными билдерами `ours(over)` и `w(over)` (минимальные валидные объекты) и `structure = (t) => ({ position: t, staff_role_id: null, grade: null, shift: null, is_trainee: null })`. Тесты:
  - `link по уникальному имени`: один наш несвязанный + одна запись Workly → `kinds(plan) = ["link"]`, `after.workly_id` и `after.active === true`.
  - `тёзки в Workly`: две активные записи с одним ключом и один наш → `items: []`, `report.ambiguous.length === 1`.
  - `два наших с одним именем`: → `report.ambiguous[0].employee_ids.length === 2`, `items: []`.
  - `create при одной сопоставленной локации`: нет кандидата, `locations: [{id:7}]`, `terminalByLocation = new Map([[7, "T1"]])` → `create` с `after.terminal_id === "T1"` и `after.first_name`.
  - `create пропускается при двух сопоставленных локациях и при несопоставленной` → `report.no_branch` длиной 1 в каждом случае.
  - `update только при изменении`: связанный с теми же табельным и должностью → `items: []` (идемпотентность); с другой должностью → `["update"]`.
  - `move`: одна сопоставленная локация другого терминала → `["move"]` с `before.terminal_id`; две локации → без `move`.
  - `reactivate`: связанный неактивный, в Workly активен → `["reactivate"]`.
  - `deactivate по списку уволенных`: связанный, `workly_id` в `dismissed` → `["deactivate"]`; несвязанный с уникальным совпадением имени в `dismissed` → `["deactivate"]` с `after.workly_id` равным id из `dismissed`.
  - `не найден`: нигде нет → `items: []`, `report.not_found.length === 1`.
  - `имя в обоих списках`: несвязанный наш, ключ имени совпал с активной записью A и с уволенной D → `["link"]` на A, `deactivate` нет.
  - `две активные и одна уволенная с тем же именем` → `report.ambiguous.length === 1`, `deactivate` нет.
  - `повторный приём`: наш связан с уволенной записью 10, в Workly активна запись 20 с тем же именем → `["relink"]`, `after.workly_id === 20`, `after.active === true`; а если связан с активной записью 10, запись 20 создаёт `create`, а не `relink`.
  - `пустой Workly (Review Focus 1)`: `active: []`, `dismissed: []`, 30 наших связанных активных → `items: []`, `report.not_found.length === 30`; ни одного `deactivate`.
  - `второй проход после применения пуст`: применить `after`/`terminal` плана к входным `ours` вручную и повторно вызвать `buildPlan` → `items: []`.
- [ ] **Step 3: Запустить `bun test src/modules/workly/names.test.ts src/modules/workly/plan.test.ts`**, ожидается FAIL.
- [ ] **Step 4: Реализовать `names.ts` и `plan.ts`.** Индексы по ключам и по `workly_id` строятся один раз; `buildPlan` не обращается к базе и сети.
- [ ] **Step 5: Тесты проходят. Commit** `feat(workly): построитель плана сверки сотрудников`.

---

### Task 5: Предохранители

**Files:**
- Create: `backend/src/modules/workly/guards.ts`
- Test: `backend/src/modules/workly/guards.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BlockReason = "first_run" | "empty_crawl" | "crawl_short" | "too_many_deactivations" | "too_many_creations";
  export function checkGuards(i: { deactivations: number; creations: number; orgActive: number; activeFetched: number; lastApplied: { activeFetched: number } | null }): { ok: true } | { ok: false; reason: BlockReason };
  ```
  Применяется только к ночному прогону (ручной «Применить» его не вызывает). Порядок проверок: `first_run` (нет `lastApplied`), `empty_crawl` (`activeFetched === 0`), `crawl_short` (`activeFetched < 0.9 * lastApplied.activeFetched`), деактиваций больше `max(10, 0.1 * orgActive)`, созданий больше 50.

- [ ] **Step 1: Тесты (таблица):**
  - без прошлого применённого: `first_run`;
  - `activeFetched: 0` при прошлом 358: `empty_crawl`;
  - `activeFetched: 300`, прошлый 358: `crawl_short`; `323`: ок (порог 322,2);
  - `deactivations: 27, orgActive: 271`: ок; `28`: `too_many_deactivations`; `deactivations: 10, orgActive: 20`: ок; `11, orgActive: 20`: `too_many_deactivations`;
  - `creations: 50`: ок; `51`: `too_many_creations`.
- [ ] **Step 2: Запустить, FAIL. Step 3: Реализовать. Step 4: PASS.**
- [ ] **Step 5: Commit** `feat(workly): предохранители ночного прогона`.

---

### Task 6: Карта локаций

**Files:**
- Create: `backend/src/modules/workly/locations.ts`
- Test: `backend/src/modules/workly/locations.test.ts` (чистые функции), `backend/src/modules/workly/http/locations.test.ts` (с базой)
- Modify: `backend/package.json` (скрипт `test:http:workly`)

**Interfaces:**
- Produces:
  ```ts
  export function locationKey(title: string): string; // верхний регистр, всё кроме A-Z0-9 удаляется: "OFIS " → "OFIS", "C-1" → "C1", "MEGA PLANET" → "MEGAPLANET", "KO'KCHA" → "KOKCHA"
  export function suggestTerminal(title: string, terminals: { id: string; name: string }[]): string | null; // terminals уже только своей организации
  export async function refreshLocations(db: DbLike, client: Pick<WorklyClient, "locations">, companyId: number, organizationId: string): Promise<void>;
  export async function setLocationTerminal(db: DbLike, locationRowId: string, terminalId: string | null, organizationId: string): Promise<void>; // KpiError(422, "terminal_other_org")
  export async function terminalMap(db: DbLike, companyId: number): Promise<Map<number, string | null>>; // workly_location_id → terminal_id
  ```
  `suggestTerminal`: у терминала отбрасывается ведущий бренд (`Les Ailes`, `Chopar Pizza`, без учёта регистра), остаток нормализуется `locationKey`; сравнение с ключом локации после таблицы псевдонимов `{ MGORKIY: "BUYUKIPAKYOLI", C5: "MARKAZ5", RIVIERA: "RIVYERA", QOYLIQ: "QOYLIQ5", SRAXIMOV: "SRAHIMOV", SOBIRRAHIMOV: "SRAHIMOV" }`. Совпали два терминала: `null`.

- [ ] **Step 1: Чистые тесты:** ключи из описания выше; `suggestTerminal("OYBEK", [{id:"t1",name:"Les Ailes Oybek"}]) === "t1"`; `suggestTerminal("M.GORKIY", [{id:"t2",name:"Les Ailes Buyuk ipak yo'li"}]) === "t2"`; `suggestTerminal("QO'YLIQ", [{id:"t3",name:"Chopar pizza Qo‘yliq-5"}]) === "t3"`; `suggestTerminal("SERGELI", [...]) === null`; два совпадения дают `null`.
- [ ] **Step 2: Тесты с базой** (по образцу guard-а в `modules/kpi/http/attendance.test.ts`; создать две организации и по терминалу): `refreshLocations` добавляет строки с подсказкой терминала; повторный вызов не затирает `terminal_id`, выставленный вручную; `setLocationTerminal` с терминалом чужой организации кидает `terminal_other_org`; `terminalMap` отдаёт `null` для несопоставленных.
- [ ] **Step 3: Добавить в `package.json` скрипт** `test:http:workly`, скопировав окружение из `test:http:kpi` и указав `bun test src/modules/workly/http/`. Все тесты с базой лежат в `backend/src/modules/workly/http/`, чистые рядом с кодом.
- [ ] **Step 4: Реализовать. Step 5: прогнать `bun test src/modules/workly/locations.test.ts` и `bun run test:http:workly`, ожидается PASS.**
- [ ] **Step 6: Commit** `feat(workly): карта локаций и терминалов`.

---

### Task 7: Журнал и применение плана

**Files:**
- Create: `backend/src/modules/workly/runs.ts`
- Test: `backend/src/modules/workly/http/runs.test.ts`
- Modify: `backend/src/modules/kpi/http/fixtures.ts` (`cleanupKpi`: удалять строки `workly_sync_runs`, `workly_locations` тестовых организаций и тестовых сотрудников с `workly_id`)

**Interfaces:**
- Consumes: `buildPlan`, `countsOf`, `checkGuards`, `terminalMap`, `refreshLocations`, `WorklyClient`, `structureFrom` и `staff_roles` для `structure`.
- Produces:
  ```ts
  export type RunClient = Pick<WorklyClient, "companyId" | "employees" | "dismissed" | "locations">;
  export interface RunSummary { run_id: string; status: "planned" | "applied" | "blocked" | "failed"; counts: ReturnType<typeof countsOf>; plan: SyncPlan; block_reason: BlockReason | null }
  export async function planRun(db: DrizzleDB, redis: Redis, client: RunClient, org: { id: string; key: ConnKey }, trigger: "manual" | "schedule", userId: string | null): Promise<RunSummary>;
  export async function applyRun(db: DrizzleDB, runId: string, exclude: string[], userId: string | null): Promise<{ applied: number; skipped: { key: string; reason: "excluded" | "stale" | "conflict" }[] }>;
  export async function syncAuto(db: DrizzleDB, redis: Redis, client: RunClient, org: { id: string; key: ConnKey }): Promise<RunSummary>; // план по расписанию, применяет сам, если checkGuards ok, иначе status "blocked"
  export async function hasAppliedRun(db: DbLike, organizationId: string): Promise<boolean>;
  export async function linkManually(db: DrizzleDB, a: { organizationId: string; companyId: number; employeeId: string; worklyId: number; tabNumber: string }, userId: string | null): Promise<void>; // 409 workly_id_taken
  ```
  `planRun`: блокировка в Redis `${PROJECT_PREFIX}workly_run_lock:${org.id}` (`SET NX EX 600`, занято: `KpiError(409, "run_in_progress")`), `refreshLocations`, загрузка наших сотрудников только этой организации (join `terminals.organization_id`), `buildPlan`, запись строки `workly_sync_runs` со статусом `planned` и `active_fetched`. `applyRun`: только для `planned` (иначе `KpiError(409, "run_not_planned")`); каждый пункт в своей транзакции, применяется, только если текущие значения полей из `before` совпадают (иначе `stale`); нарушение `employees_workly_uq` даёт `conflict`; в конце `status = "applied"`, `applied_at`. `create` вставляет `employees` с `terminal_id`, именами и структурой.

- [ ] **Step 1: Тесты с базой и подставным клиентом** (`fakeClient(active, dismissed, locations)` возвращает фиксированные списки):
  - `planRun` пишет строку `planned` с `counts` и не меняет `employees`.
  - `в план попадают только сотрудники своей организации`: сотрудник другой организации с совпавшим именем не связывается и не деактивируется.
  - `applyRun` применяет, второй `planRun` даёт пустой `plan.items`.
  - `exclude` пропускает пункт: `skipped` содержит `{ key, reason: "excluded" }`, сотрудник не изменился.
  - `stale`: после `planRun` изменить `position` сотрудника, `applyRun` пропускает его пункт с `stale`.
  - `conflict`: `workly_id` уже занят другим сотрудником → пункт в `skipped` с `conflict`, остальные применены.
  - `applyRun` второй раз по тому же `run_id` → `run_not_planned`.
  - `второй planRun при занятой блокировке` → `run_in_progress`.
  - `syncAuto` без применённого прогона → `status: "blocked"`, `block_reason: "first_run"`, в `employees` ничего не изменилось; при применённом прогоне и плане из 11 деактиваций у организации с 20 активными сотрудниками → `blocked`, `block_reason: "too_many_deactivations"`, сотрудники не изменились.
  - `linkManually` ставит связь; тот же `workly_id` у второго сотрудника → `workly_id_taken`.
  - `деактивированный сотрудник с оценкой за период остаётся в списке оценки KPI, без оценки скрыт`: после `applyRun` с `deactivate` вызвать `listEmployeeRows` из `modules/kpi/employees.ts` для периода (оценка заводится фикстурой `makeReview`/аналогом из `kpi/http/fixtures.ts`).
- [ ] **Step 2: Запустить `bun run test:http:workly`, ожидается FAIL.**
- [ ] **Step 3: Реализовать `runs.ts`.** Ошибки через `KpiError` из `../kpi/errors`.
- [ ] **Step 4: Тесты проходят. Step 5: Commit** `feat(workly): журнал прогонов, применение плана, автопрогон`.

---

### Task 8: Запись импорта посещаемости по организации (modules/kpi)

**Files:**
- Modify: `backend/src/modules/kpi/attendance.ts` (`commitImport`, `listImports`, `toImportRow`), `backend/src/modules/kpi/types.ts` (`AttendanceImportRow`), `backend/src/modules/kpi/routes/attendance.ts` (не меняется, если тело принимает `organization_id` как любое поле)
- Test: `backend/src/modules/kpi/http/attendance.test.ts` (дополнить), существующие тесты не должны меняться

**Interfaces:**
- Produces:
  ```ts
  export interface AttendanceDayRow { employee_id: string; day: string; terminal_id: string; check_in: string | null; check_out: string | null; late_minutes: number; absent: boolean }
  export async function writeAttendanceImport(tx: DbLike, a: { period: Period; organization_id: string; file_name: string; uploaded_by: string | null; mapping: object; days: AttendanceDayRow[]; rows_total: number; rows_unmatched: number; unmatched: UnmatchedRow[]; skipped?: unknown }): Promise<ImportDbRow>;
  ```
  Берёт `pg_advisory_xact_lock` по месяцу и `lockPeriodShared` (закрыт: `KpiError(409, "period_closed")`), помечает `replaced` и удаляет дни прошлых `committed`-импортов периода, у которых `organization_id` равен переданному (импорты без организации, если они есть, не трогаются), вставляет импорт и дни пачками по `INSERT_BATCH`. `commitImport` вызывает её после сопоставления; в теле обязателен `organization_id` (нет: `KpiError(422, "organization_required")`, неизвестная организация: 422 `bad_organization`), строки сопоставляются только с активными сотрудниками этой организации (join `terminals.organization_id`). Прежнего поведения «вся сеть» нет: на проде импортов ещё не было. `AttendanceImportRow` получает `organization_id: string | null` и `source: "file" | "api"` (`api`, когда `mapping.source === "api"`).

- [ ] **Step 1: Новые тесты в `attendance.test.ts`:**
  - `импорт организации A не стирает дни организации B за тот же месяц`: два commit с разными `organization_id` и своими сотрудниками, затем `GET /api/kpi/attendance/imports` показывает оба `committed`, дни обеих организаций на месте.
  - `повторный commit организации A заменяет только свой прошлый импорт`.
  - `commit без organization_id`: 422 `organization_required`. Все прежние тесты файла и хелперы `importAttendance`, `uploadAttendance` в `kpi/http/fixtures.ts` передают `organization_id` тестового филиала.
  - `со organization_id строка с табельным номером сотрудника другой организации не сопоставляется` (`unknown_external_id`).
- [ ] **Step 2: Запустить `bun run test:http:kpi`, новые тесты FAIL.**
- [ ] **Step 3: Вынести запись в `writeAttendanceImport`, подключить в `commitImport`, расширить `listImports` и `toImportRow`, обновить хелперы в `fixtures.ts`.**
- [ ] **Step 4: Весь `bun run test:http:kpi` проходит.**
- [ ] **Step 5: Commit** `feat(kpi): импорт посещаемости заменяется в пределах организации`.

---

### Task 9: Посещаемость из Workly

**Files:**
- Create: `backend/src/modules/workly/attendance.ts`
- Test: `backend/src/modules/workly/attendance.test.ts` (чистые), `backend/src/modules/workly/http/attendance.test.ts`

**Interfaces:**
- Consumes: `WorklyClient.t12/lateIn/absence/employees`, `writeAttendanceImport`, `AttendanceDayRow`, `importTotals` из `modules/kpi/attendance-parse.ts`, `isPeriodClosed`, `periodOf`, `addMonths`, `tashkentDay` из `modules/kpi/time.ts`, `now` из `modules/kpi/clock.ts`.
- Produces:
  ```ts
  export function hhmmToMinutes(s: string | null | undefined): number | null; // "01:05" → 65, "280:00" → 16800, "00:00" → 0, null/""/"x" → null
  export function tashkentTimestamp(day: string, hhmm: string, nextDay?: boolean): string; // "2026-10-20","06:05" → "2026-10-20T06:05:00+05:00"
  export function attendanceWindow(period: Period, today: string): { from: string; to: string } | null; // to = min(последний день месяца, вчера); null, если to < from
  export interface Person { employee_id: string; terminal_id: string; start_date: string | null }
  export function buildDays(i: { from: string; to: string; people: ReadonlyMap<number, Person>; t12: T12Item[]; lateIn: LateInItem[]; absence: AbsenceItem[] }): { days: AttendanceDayRow[]; unknown: number };
  export async function syncAttendance(db: DrizzleDB, client: Pick<WorklyClient, "employees" | "t12" | "lateIn" | "absence">, org: { id: string }, period: Period, userId: string | null): Promise<{ import_id: string; days: number; unknown: number; carried: number }>;
  ```
  Правила `buildDays`: прогул из absence (`timeoff_id` пуст и `scheduled.is_work_day !== false`, человек известен, день в окне и не раньше `start_date`); присутствие: `hhmmToMinutes(work_time) > 0` или есть строка `late-in` с `first_in` (плановый день по T12: `is_work_day && !is_holiday`); день и прогул, и работа: считается присутствием; плановый день без работы и без absence не пишется и увеличивает `unknown`; `late_minutes = hhmmToMinutes(late_in) ?? 0`; `check_in`/`check_out` из `late-in` (`check_out` на следующие сутки, если `last_out` раньше `first_in`); элементы T12 с `report: null` пропускаются. `syncAttendance`: окно, `people` из связанных сотрудников организации (`workly_id` не пуст) плюс `start_date` из `client.employees()`; перенос (`carried`): дни месяца сотрудников организации, чьего `workly_id` нет ни среди записей `client.employees()`, ни в элементах T12 (уволенные посреди месяца пропадают из отчётов Workly), копируются из прошлого импорта в новый; сотрудник, который в отчётах есть, не переносится, его прежние дни полностью заменяются свежими, чтобы исправления Workly доходили; запись через `writeAttendanceImport` (`file_name: "Workly API"`, `mapping: { source: "api", totals, window, unknown }`, `organization_id: org.id`); закрытый месяц: `KpiError(409, "period_closed")` до любого изменения; месяц без прошедших дней: `KpiError(422, "period_not_started")`.

- [ ] **Step 1: Чистые тесты:**
  - `hhmmToMinutes("280:00") === 16800`, `("00:00") === 0`, `(null) === null`, `("abc") === null`.
  - `tashkentTimestamp("2026-10-20","06:05") === "2026-10-20T06:05:00+05:00"`; с `nextDay` дата 21-е.
  - `attendanceWindow("2026-10-01", "2026-10-29")` даёт `{from:"2026-10-01", to:"2026-10-28"}`; `("2026-10-01","2026-10-01")` даёт `null`; `("2026-09-01","2026-10-29")` даёт `to: "2026-09-30"`.
  - `buildDays` на синтетических данных: (а) прогул только из absence; (б) плановый день без работы и без absence даёт `unknown: 1`, строки нет; (в) опоздание 01:05 даёт `late_minutes: 65`; (г) `late_in: null` даёт `0`; (д) `report: null` пропускается без ошибки; (е) праздник и день до `start_date` пропускаются; (ж) `last_out: "01:00"` при `first_in: "22:00"` даёт `check_out` на следующие сутки; (з) `timeoff_id` не пуст: не прогул; (и) день и в absence, и с `work_time "08:00"`: присутствие.
- [ ] **Step 2: Тесты с базой (подставной клиент):** запись создаёт импорт `committed` с `source: "api"` и `organization_id`; повторный вызов заменяет; закрытый месяц (`kpi_periods` со статусом закрытия, как в существующих тестах) даёт `period_closed` и старые дни целы; перенос: сотрудник с днями от прошлой синхронизации, которого нет в новых данных, остаётся с прежними строками (`carried > 0`); сотрудник, который есть в T12, а его прежний прогул в absence больше не числится, теряет эту строку (не переносится); импорт организации B не затронут.
- [ ] **Step 3: Запустить, FAIL. Step 4: Реализовать. Step 5: PASS.**
- [ ] **Step 6: Commit** `feat(workly): посещаемость из отчётов T12, late-in и absence`.

---

### Task 10: Качество данных

**Files:**
- Create: `backend/src/modules/workly/quality.ts`
- Test: `backend/src/modules/workly/quality.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BranchQuality { terminal_id: string; terminal_name: string; days: number; absent: number; share: number; flagged: boolean }
  export interface HeavyAbsentee { employee_id: string; days: number; absent: number }
  export function qualityOf(rows: { employee_id: string; terminal_id: string; absent: boolean }[], terminalNames: ReadonlyMap<string, string>): { branches: BranchQuality[]; median: number; heavy: HeavyAbsentee[] };
  export async function qualityReport(db: DbLike, organizationId: string, period: Period): Promise<ReturnType<typeof qualityOf> & { employee_names: Record<string, string> }>;
  ```
  `flagged`: доля филиала больше удвоенной медианы долей по организации; `heavy`: доля прогулов больше 0,9 при не менее 5 днях (порог 5 дней выбран при планировании, чтобы один прогул не давал «100%»); `branches` по убыванию `share`.

- [ ] **Step 1: Тесты:** четыре филиала с долями 0,1; 0,1; 0,12; 0,57 → `median` 0,11 и `flagged` только у последнего; сотрудник с 4 днями и 4 прогулами не в `heavy`, с 5 и 5 в `heavy`, с 10 и 9 прогулами (0,9) не в `heavy`, с 10 и 10 в `heavy`; пустой вход → `{ branches: [], median: 0, heavy: [] }`.
- [ ] **Step 2: FAIL. Step 3: Реализовать (`qualityReport` читает `kpi_attendance` организации за месяц с join на `terminals`). Step 4: PASS.**
- [ ] **Step 5: Commit** `feat(workly): блок качества данных посещаемости`.

---

### Task 11: Маршруты

**Files:**
- Create: `backend/src/modules/workly/routes.ts`, `backend/src/modules/workly/http/routes.test.ts`
- Modify: `backend/src/controllers.ts` или `backend/src/app.ts` (по образцу `kpiController`: `.use(worklyController)` рядом с `.use(kpiController)`)

**Interfaces:**
- Consumes: всё из Task 2–10; `ctx`, `run`, `KpiError`, `clientFor`/`setClientFactory`.
- Produces: `export const worklyController = worklyControllerImpl as unknown as Elysia;` (префикс `/api`, `permission: "kpi.manage"` на каждом маршруте). Все ответы JSON, ошибки через `run(set, ...)`.
  - `GET /workly/status`: по каждому подключению `{ key, organization_id, organization_name, configured, company_id | null, last_run: { id, status, trigger, block_reason, counts, created_at, applied_at } | null, error: string | null }`; ошибка входа Workly выдаётся строкой кода (`client_invalid`, `force_update`, `auth_failed`), не секретами.
  - `POST /workly/sync/plan` body `{ organization_id }` → `RunSummary`.
  - `GET /workly/sync/runs/:id` → строка журнала с `plan`.
  - `POST /workly/sync/apply` body `{ run_id, exclude: string[] }` → `{ applied, skipped }`.
  - `GET /workly/employees?organization_id&q` → активные сотрудники Workly (`id`, `full name`, `tab_number`, `locations`), не более 50, поиск по подстроке имени (`searchWords`/`matchesName` из `modules/kpi/name-search.ts`).
  - `POST /workly/sync/link` body `{ organization_id, employee_id, workly_id }` → `{ ok: true }`.
  - `GET /workly/locations?organization_id` → `[{ id, workly_location_id, title, terminal_id, terminal_name | null }]` (до выдачи запускается `refreshLocations`); `PUT /workly/locations/:id` body `{ terminal_id: string | null }`.
  - `POST /workly/attendance/sync` body `{ organization_id, period }` → результат `syncAttendance`.
  - `GET /workly/quality?organization_id&period` → результат `qualityReport` с названиями.
  - Организация должна быть одной из `CONNECTIONS` (иначе `KpiError(404, "organization_not_connected")`).

- [ ] **Step 1: HTTP-тесты** (`setClientFactory` с подставным клиентом; шаблон файла и охранный блок как в `modules/kpi/http/attendance.test.ts`):
  - без сессии 401, с сессией без `kpi.manage` 403 на каждом из маршрутов (цикл по списку).
  - `plan` → `apply` → `GET /workly/sync/runs/:id` показывает `applied`; сотрудники изменены как в плане.
  - `apply` с `exclude` оставляет пункт нетронутым; повторный `apply` даёт 409 `run_not_planned`.
  - `link` + `employees?q=` находят запись, `link` ставит `workly_id`; чужая организация даёт 404 `organization_not_connected`.
  - `locations`: `PUT` с терминалом другой организации даёт 422 `terminal_other_org`.
  - `status` при фабрике клиента, чьи вызовы бросают `WorklyError("not_configured")` или сетевую ошибку: в ответе обе организации, у проблемной `error` с кодом, ответ 200. Список организаций не зависит от доступности Workly: он нужен мастеру файловой загрузки как запасному пути.
  - `attendance/sync` на закрытый месяц даёт 409 `period_closed`.
  - Ответ `status` и тело ошибки не содержат значения пароля и `client_secret` из env теста.
- [ ] **Step 2: Запустить `bun run test:http:workly`, FAIL. Step 3: Реализовать маршруты и подключить контроллер. Step 4: PASS.**
- [ ] **Step 5: Commit** `feat(workly): маршруты API`.

---

### Task 12: Ночной прогон

**Files:**
- Create: `backend/src/modules/workly/nightly.ts`
- Test: `backend/src/modules/workly/nightly.test.ts`
- Modify: `cron/kpi_worker.ts` (расписание и обработчик), `cron/pm2.config.js` не меняется

**Interfaces:**
- Produces:
  ```ts
  export const WORKLY_SYNC_JOB = "workly-sync";
  export function nightlySteps(env: Record<string, string | undefined>, connections: { key: ConnKey; hasApplied: boolean; configured: boolean }[]): { key: ConnKey; employees: boolean; attendance: boolean; misconfigured: boolean }[];
  // employees: настроено и есть применённый прогон; attendance: настроено и WORKLY_ATTENDANCE_NIGHTLY === "1";
  // misconfigured: не настроено, но шаг ожидался (есть применённый прогон или WORKLY_ATTENDANCE_NIGHTLY === "1")
  export async function runNightly(db: DrizzleDB, redis: Redis): Promise<{ key: ConnKey; employees: RunSummary["status"] | "skipped" | "error"; attendance: "ok" | "skipped" | "error" }[]>;
  ```
  Окно посещаемости ночью: текущий месяц и предыдущий, если `!(await isPeriodClosed(db, prev))`. Для `misconfigured` пишутся `console.error` и строка `workly_sync_runs` со статусом `failed`, `error: "not_configured"` (не тихий пропуск). Воркер читает **`cron/.env`** (см. `docs/superpowers/kpi-deploy.md`, раздел про `cron/.env`), а не `backend/.env`: `WORKLY_BASE_URL`, оба набора `WORKLY_LES_*` и `WORKLY_CHOPAR_*`, `WORKLY_ATTENDANCE_NIGHTLY` и `PROJECT_PREFIX` должны лежать в `cron/.env`; те же ключи нужны и в `backend/.env` для маршрутов API. Ошибка одного подключения не останавливает другое; ошибка клиента (`client_invalid`, `force_update`) пишется в журнал прогона со статусом `failed` и `error`.
- В `cron/kpi_worker.ts`: `upsertJobScheduler(WORKLY_SYNC_JOB, { pattern: "30 3 * * *", tz: "Asia/Tashkent" }, ...)` в `registerSchedulers`, ветка `if (job.name === WORKLY_SYNC_JOB) return runNightly(drizzleDb, redis)` в обработчике. Время 03:30 выбрано при планировании.

- [ ] **Step 1: Тесты `nightlySteps`:** подключение не настроено и ничего не ожидалось → все три флага `false`; не настроено при применённом прогоне или `WORKLY_ATTENDANCE_NIGHTLY: "1"` → `misconfigured: true`; настроено без применённого прогона → `employees: false`; применённый прогон → `employees: true`; `attendance` только при `WORKLY_ATTENDANCE_NIGHTLY: "1"` (значения `"0"`, `""`, `undefined` дают `false`).
- [ ] **Step 2: FAIL. Step 3: Реализовать `nightly.ts` и подключить в воркере** (по образцу `KPI_DAILY_JOB`, который уже зарегистрирован там же). **Step 4: PASS; `bun build` импорта проверяется командой `cd cron && bun build kpi_worker.ts --target bun --outfile /dev/null`** (ожидается без ошибок разрешения модулей).
- [ ] **Step 5: Commit** `feat(workly): ночной прогон в office_kpi_worker`.

---

### Task 13: Откат и документ по запуску

**Files:**
- Modify: `backend/src/modules/workly/runs.ts` (`rollbackRun`)
- Create: `backend/src/modules/workly/rollback-run.ts` (CLI), `docs/superpowers/workly-deploy.md`
- Test: `backend/src/modules/workly/http/runs.test.ts` (дополнить)

**Interfaces:**
- Produces: `export async function rollbackRun(db: DrizzleDB, runId: string): Promise<{ restored: number; deleted: number; deactivated: number; skipped: { key: string; reason: "changed_since" }[] }>`: пункт возвращается, только если текущие значения его полей равны `after` (иначе `skipped` с `changed_since`, чтобы откат прогона N не затёр изменения прогона N+1); для остальных пунктов применённого прогона возвращает `before` (`link`, `relink`, `update`, `move`, `deactivate`, `reactivate`); созданных сотрудников (`create`) удаляет, если ни одна таблица с колонкой `employee_id` (проверка по `information_schema.columns`) на них не ссылается, иначе делает `active = false`; прогон не в статусе `applied` → `KpiError(409, "run_not_applied")`; после отката статус `rolled_back` (добавить значение в комментарий к колонке `status`).
- CLI: `bun run src/modules/workly/rollback-run.ts <run_id>`, печатает три числа и число пропущенных.

- [ ] **Step 1: Тесты:** после `applyRun` с `link`, `deactivate`, `move` и `create` откат возвращает прежние `terminal_id`, `active` и пустой `workly_id`; созданный сотрудник без ссылок удалён; созданный сотрудник с записью в `medical_exams` остался с `active = false`; повторный откат → `run_not_applied`; откат прогона N после применённого прогона N+1, изменившего те же поля, пропускает эти пункты с `changed_since` и не затирает новые значения.
- [ ] **Step 2: FAIL. Step 3: Реализовать `rollbackRun` и CLI. Step 4: PASS.**
- [ ] **Step 5: Написать `docs/superpowers/workly-deploy.md`:** переменные окружения (имена из Global Constraints), порядок запуска из раздела 7 спеки (резервная копия, миграция 0041, `office_api`, `office_kpi_worker`, карта локаций, «Проверить», явное «применить», блок качества, `WORKLY_ATTENDANCE_NIGHTLY=1`), откат командой CLI. Ключи `WORKLY_*` и `WORKLY_ATTENDANCE_NIGHTLY` вносятся в оба файла: `backend/.env` (маршруты `office_api`) и `cron/.env` (ночной прогон `office_kpi_worker`); после правки `cron/.env` воркер перезапускается. Команды деплоя по `managers-deploy-workflow`: `.env` не подключать в оболочку, читать отдельные переменные.
- [ ] **Step 6: Commit** `feat(workly): откат прогона и документ по запуску`.
