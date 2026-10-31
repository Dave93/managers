# Workly: админка Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Экран HR «Workly» в разделе KPI: состояние подключений, проверка и применение сверки сотрудников, ручная связь, карта локаций, синхронизация посещаемости с блоком качества данных; выбор организации в мастере файловой загрузки.

**Architecture:** Экран `/kpi/workly` в `admin/app/[locale]/kpi/workly/`, по образцу `kpi/attendance` (`ScreenGate`, TanStack Query, `kpiApi`-стиль обёртка над Eden). Чистая логика группировки плана вынесена в `admin/lib/kpi/workly.ts` и покрыта `bun test`.

**Tech Stack:** Next.js 15, React 19, next-intl, TanStack Query, shadcn-компоненты (`@admin/components/ui/*`), Eden (`apiClient.api.workly`).

**Spec:** `docs/superpowers/specs/2026-10-29-workly-sync-design.md`, раздел 5.7. API берётся из `docs/superpowers/plans/2026-10-30-workly-1-backend.md` (Task 11): маршруты `/api/workly/*`, права `kpi.manage`. Этот план выполняется после плана бэкенда.

## Global Constraints

- Права экрана: только `kpi.manage` (как у «Загрузки Workly»). Пункт меню в группе KPI (`nav-config.tsx`), перед «Приход и уход».
- Тексты через `next-intl` во всех четырёх локалях: `ru`, `en`, `uz-Latn`, `uz-Cyrl` (`admin/messages/<locale>.json`). Русские ключи добавляет каждая задача вместе со своим экраном (иначе экран не запустится), в `ru.json` под `kpiScreens.workly.*`; английский и два узбекских файла заполняет задача 6 и проверяет скриптом паритета ключей. Пункт меню `nav.kpi.workly` добавляет задача 1 сразу во все четыре локали. Русский основной; узбекские тексты нужно показать носителю до выката (как отмечено в `kpi-handoff.md`).
- Пароли, `client_secret`, ключи доступа в интерфейсе не показываются; ошибки подключения выводятся по коду (`client_invalid`, `force_update`, `auth_failed`, `not_configured`).
- Кнопка «Применить» запрашивает подтверждение с числами плана (связать, создать, деактивировать, перенести). Первый прогон организации всегда ручной (бэкенд не даст применить иначе).
- Типы ответов берутся из бэкенда через алиас `@backend/*`, как в `admin/lib/kpi-api.ts`.
- Выкат: админка выходит вместе с бэкендом одним релизом (одна ветка `feature/workly-sync`, один PR): задача 5 нужна, чтобы файловая загрузка продолжила работать после того, как бэкенд сделал `organization_id` обязательным.
- «Проверить» и «Синхронизировать» работают в фоне 70–100 секунд (бэкенд отдаёт `202 { run_id, status: "running" }`); экран опрашивает `GET /api/workly/sync/runs/:id` каждые 2 секунды, пока статус `running`, и возобновляет опрос после перезагрузки страницы, если последний прогон в `status` ещё `running`.
- Проверки: `cd admin && bun test ./lib/kpi`, `bun lint`, `admin/node_modules/.bin/tsc --noEmit` (в базе три известные ошибки, новых быть не должно).

## Факты бэкенда и рулинги (бэкенд готов, коммит fceb1fe9; админка читает его код, а не план)

- Маршруты `/api/workly/*` (файл `backend/src/modules/workly/routes.ts`), права `kpi.manage`. Eden: `(apiClient.api as any).workly`, как `(apiClient.api as any).kpi` в `admin/lib/kpi-api.ts`.
- `GET /workly/status` → массив по подключению `{ key, organization_id | null, organization_name, configured, last_run | null, error | null }`; `last_run` без плана: `{ id, kind: "employees"|"attendance", status, trigger, block_reason, counts, period, error, created_at, applied_at }`. Статусы прогона: `running`, `planned`, `applied`, `blocked`, `failed`, `rolled_back`. Ночной прогон мог оставить `blocked` (причины `crawl_short`, `too_many_deactivations`, `too_many_creations`, `empty_crawl`): карточка показывает причину текстом.
- `POST /workly/sync/plan` и `POST /workly/attendance/sync` отвечают HTTP 202 `{ run_id, status: "running" }`. `GET /workly/sync/runs/:id` отдаёт `RunRow` с `plan` (у `kind: attendance` плана нет, итог в `counts`: `days`, `unknown`, `carried`, `import_id`).
- `POST /workly/sync/apply` body `{ run_id, exclude: string[] }`: `exclude` обязателен, админка ВСЕГДА шлёт массив (пустой `[]`, если исключений нет). Ответ `{ applied, skipped: { key, reason: "excluded"|"stale"|"conflict" }[] }`; тот же `skipped` потом хранится в `plan.skipped`, применённые ключи в `plan.applied`.
- `SyncPlan = { items: PlanItem[], report: { ambiguous: { workly_id, label, employee_ids }[], not_found: { employee_id, label }[], no_branch: { workly_id, label }[] }, applied?, skipped?, rolled_back? }`; `PlanItem = { key, kind, employee_id | null, workly_id, label, before, after }`; виды пунктов `link`, `relink`, `update`, `move`, `create`, `deactivate`, `reactivate`. Пункт `move` может идти парой к `link`/`relink`/`reactivate` у того же сотрудника: в списке пропущенных они показываются рядом.
- `GET /workly/employees?organization_id&q` отдаёт не более 50 записей `{ id, full_name, tab_number, locations }`; первый запрос на холодном кэше идёт до ~26 секунд (индикатор загрузки обязателен). `POST /workly/sync/link` body `{ organization_id, employee_id, workly_id }`.
- Расхождения с первоначальным текстом плана (рулинги): R19 прогон может завершиться кодами ошибок `empty_crawl`, `crawl_failed`, `crawl_short`, `apply_failed`, `client_invalid`, `force_update`, `auth_failed`, `http_error`, `not_configured`, `period_closed`, `period_not_started`, `enqueue_failed`, а маршруты отвечают `run_in_progress`, `run_not_planned`, `run_superseded`, `run_not_found`, `queue_unavailable`, `organization_not_connected`, `employee_not_found`, `workly_employee_not_found`, `workly_id_taken`, `terminal_other_org`, `location_not_found`, `organization_required`, `bad_organization`: у каждого русский текст в `kpiScreens.workly.errors.<код>` (для `run_superseded`: «План устарел, соберите заново»; для `apply_failed`: «Не удалось применить план, изменений нет, соберите заново»). Ночной прогон `blocked first_run` НЕ пишется (шаг сотрудников пропускается без применённого прогона): вытеснить ручной план может только ночной прогон организации, у которой уже есть применённый прогон. R20 у импортов посещаемости `source: "api"` поля `sheet`, `header_row`, `mapping` равны `null`: везде, где экран читает их (`imports-table.tsx`), для `null` выводится прочерк «—». R23 первая синхронизация API организации ЗАМЕНЯЕТ её файловый импорт за месяц: перед нажатием «Синхронизировать» экран показывает предупреждение, если за выбранный месяц у организации уже есть импорт с `source: "file"` (список импортов уже загружается `kpiApi.attendance.imports(period)`; в нём есть `organization_id` и `source`). R24 ночная синхронизация посещаемости выключена на бэкенде; на экране об этом не пишем, только про ручную.

## Review Focus

1. Тысячи записей в плане (Les Ailes: сотни деактиваций и созданий): таблица не должна зависать, группы свёрнуты и показывают первые 50 строк с «показать все» (Task 3).
2. Подключение не настроено или Workly недоступен: экран показывает понятное состояние, а не пустую страницу и не 500 (Task 3).
3. Применённый или устаревший прогон: кнопка «Применить» недоступна, показан итог с `skipped` (Task 2, 3).
   Перезагрузка страницы посреди обхода: опрос возобновляется, а не показывается пустой экран (Task 3). Прогон упал: показан код ошибки по-русски, кнопку можно нажать снова (Task 3).
4. Организация в мастере файловой загрузки не выбрана: «Загрузить» недоступна, сервер не получает запрос без `organization_id` (Task 5).
5. У человека нет `kpi.manage`: экран показывает `NoAccessNotice`, меню пункт скрыт (Task 1).

---

### Task 1: Права, пункт меню, названия

**Files:**
- Modify: `admin/lib/kpi/access.ts` (`KpiScreen` + `"workly"`, `KPI_SCREEN_PERMS.workly = ["kpi.manage"]`, `KPI_SCREEN_TITLE.workly = "Workly"`), `admin/components/layout/nav-config.tsx` (пункт `t("kpi.workly")`, `href: p("/kpi/workly")`), `admin/messages/*.json` (`nav.kpi.workly`)
- Test: `admin/lib/kpi/access.test.ts` (дополнить)

**Interfaces:**
- Produces: экран `"workly"` в `KpiScreen`; `canOpen(perms, "workly")`.

- [ ] **Step 1: Тесты:** `canOpen(["kpi.manage"], "workly") === true`; `canOpen(["kpi.view","kpi.approve","kpi.evaluate"], "workly") === false`; `canOpen([], "workly") === false`.
- [ ] **Step 2: `cd admin && bun test ./lib/kpi/access.test.ts`, FAIL. Step 3: реализовать. Step 4: PASS.**
- [ ] **Step 5: Commit** `feat(admin): экран Workly — права и пункт меню`.

---

### Task 2: Чистая логика плана и API-обёртка

**Files:**
- Create: `admin/lib/kpi/workly.ts`, `admin/lib/kpi/workly.test.ts`
- Modify: `admin/lib/kpi-api.ts` (группа `workly`), `admin/app/[locale]/kpi/_components/use-kpi.ts` (ключи `qk.workly*`)

**Interfaces:**
- Consumes: `PlanItem`, `PlanKind`, `SyncPlan`, `RunSummary` из `@backend/modules/workly/*`.
- Produces (`workly.ts`):
  ```ts
  export const PLAN_GROUP_ORDER: readonly PlanKind[] = ["deactivate", "link", "relink", "update", "move", "reactivate", "create"];
  export function groupPlan(items: PlanItem[]): { kind: PlanKind; items: PlanItem[] }[]; // только непустые, в порядке PLAN_GROUP_ORDER
  export function toggleExclusion(excluded: ReadonlySet<string>, key: string): Set<string>;
  export function effectiveCounts(items: PlanItem[], excluded: ReadonlySet<string>): Record<PlanKind, number>; // без исключённых
  export function canApply(run: { status: string } | null): boolean; // только "planned"
  export function connectionErrorKey(code: string | null): string | null; // "client_invalid", "force_update", "auth_failed", "not_configured", "crawl_failed", "stale" → "workly.errors.<код>"; неизвестный код → "workly.errors.unknown"; null → null
  export function isRunning(run: { status: string } | null | undefined): boolean; // status === "running"
  export function pollInterval(run: { status: string } | null | undefined): number | false; // 2000, пока isRunning, иначе false (для refetchInterval)
  ```
- Produces (`kpi-api.ts`): `kpiApi.workly = { status(), plan(organization_id) → { run_id, status }, run(id), apply(run_id, exclude), employees(organization_id, q), link(b), locations(organization_id), setLocation(id, terminal_id), attendanceSync(organization_id, period), quality(organization_id, period) }` поверх `(apiClient.api as any).workly` в стиле соседних групп; `qk.worklyStatus`, `qk.worklyRun(id)`, `qk.worklyLocations(orgId)`, `qk.worklyQuality(orgId, period)`.

- [ ] **Step 1: Тесты `workly.test.ts`:**
  - `groupPlan` на пунктах `create`, `deactivate`, `link` возвращает порядок `deactivate, link, create` и пропускает пустые группы.
  - `toggleExclusion` добавляет и снимает ключ, не мутируя исходное множество.
  - `effectiveCounts` не считает исключённые.
  - `canApply({status:"planned"}) === true`; для `applied`, `blocked`, `failed`, `null` `false`.
  - `connectionErrorKey("force_update") === "workly.errors.force_update"`, `("stale") === "workly.errors.stale"`, `("xyz") === "workly.errors.unknown"`, `(null) === null`.
  - `isRunning({status:"running"}) === true`; для `planned`, `null`, `undefined` `false`; `pollInterval({status:"running"}) === 2000`, `pollInterval({status:"planned"}) === false`, `pollInterval(undefined) === false`.
- [ ] **Step 2: FAIL. Step 3: реализовать `workly.ts`, группу `workly` в `kpi-api.ts` и ключи `qk`. Step 4: `bun test ./lib/kpi` PASS.**
- [ ] **Step 5: Commit** `feat(admin): логика плана Workly и API-обёртка`.

---

### Task 3: Экран «Workly»: сверка сотрудников

**Files:**
- Create: `admin/app/[locale]/kpi/workly/page.tsx`, `_components/connection-card.tsx`, `_components/plan-review.tsx`, `_components/manual-link-dialog.tsx`

**Interfaces:**
- Consumes: `kpiApi.workly.*`, `groupPlan`, `toggleExclusion`, `effectiveCounts`, `canApply`, `connectionErrorKey`, `ScreenGate screen="workly"`.
- Produces: страница `WorklyPage` (по образцу `kpi/attendance/page.tsx`), секции в таком порядке: «Подключения» (по одной карточке на организацию), «Сверка сотрудников», «Локации» (Task 4), «Посещаемость» (Task 4).

Поведение:
- Карточка подключения: название организации, `configured`, последний прогон (статус, источник, время), ошибка по `connectionErrorKey`; кнопка «Проверить» (`plan` → `run_id`) затем `useQuery(qk.worklyRun(run_id))` с `refetchInterval: (q) => pollInterval(q.state.data)` и надписью «Идёт обход Workly, около двух минут»; кнопка недоступна, пока идёт обход. Если `last_run.status === "running"` при загрузке, опрос запускается сам. `planned` открывает `PlanReview`; `failed` показывает текст ошибки по `connectionErrorKey(run.error)`, кнопку можно нажать снова.
- `PlanReview`: счётчики плана, группы по `groupPlan` (заголовок группы, число, свёрнуто; первые 50 строк и «Показать все»), у каждой строки флажок «исключить» (`toggleExclusion`), блоки отчёта «Неоднозначно», «Не найден», «Не привязан к филиалу»; кнопка «Применить» активна при `canApply`, открывает подтверждение с `effectiveCounts`; после применения показывает `applied` и список `skipped` (причины `excluded`, `stale`, `conflict`) и обновляет статус.
- `ManualLinkDialog`: открывается из строк «Неоднозначно» и «Не найден»; поле поиска (`workly.employees?q`, не более 50 результатов, с задержкой ввода), выбор записи, `link`; ошибка `workly_id_taken` показывается текстом.

- [ ] **Step 1: Реализовать компоненты и страницу.** Тексты из `useTranslations("kpiScreens.workly")`; русские ключи этой задачи (подключения, план, отчёт, пропущенные, ручная связь, тексты ошибок по кодам из раздела «Факты бэкенда») добавляются в `ru.json` здесь же.
- [ ] **Step 2: Проверка типов и линтера:** `admin/node_modules/.bin/tsc --noEmit` без новых ошибок, `bun lint` чисто.
- [ ] **Step 3: Ручная проверка** на smoke-стенде (база `managers_kpi_smoke`, `PROJECT_PREFIX=managers_smoke_`, миграция 0041 применена именно к ней; локальную `managers` не мигрировать, `managers_tickets_test` не использовать: её чистят тесты; ключи `WORKLY_*` в `backend/.env`, admin `bun dev`): открыть `/ru/kpi/workly`, нажать «Проверить» для каждой организации (только чтение Workly, пишется лишь строка журнала), убедиться, что группы и отчёт отображаются, «Применить» не нажимать. Скриншот экрана приложить к описанию PR.
- [ ] **Step 4: Commit** `feat(admin): экран Workly — подключения и сверка сотрудников`.

---

### Task 4: Локации и посещаемость на экране

**Files:**
- Create: `admin/app/[locale]/kpi/workly/_components/locations-table.tsx`, `_components/attendance-sync.tsx`
- Modify: `admin/app/[locale]/kpi/workly/page.tsx`

**Interfaces:**
- Consumes: `kpiApi.workly.locations/setLocation/attendanceSync/quality`, `PeriodSelect` и `periodOptions` из `kpi/_components` и `@admin/lib/kpi/periods`, терминалы из `qk.terminals` (запрос терминалов KPI уже есть в `use-kpi`).

Поведение:
- `LocationsTable`: для выбранной организации строки «локация Workly → терминал» с выбором терминала (`Select`, только терминалы своей организации, опция «не привязан»), изменение сразу вызывает `setLocation`; несопоставленные подсвечены.
- `AttendanceSync`: выбор месяца и организации, кнопка «Синхронизировать» (`attendanceSync` → `run_id`, опрос как в «Проверить»), итог из `run.counts` (`days`, `unknown`, `carried`), ошибки `period_closed` и `period_not_started` текстом сразу после нажатия (они приходят до постановки задачи), `failed` по `connectionErrorKey(run.error)`; ниже блок качества (`quality`): таблица филиалов (доля прогулов, пометка `flagged`) и список «прогулы более чем в 90% дней» с именами из `employee_names`.

- [ ] **Step 1: Реализовать** (русские ключи этой задачи в `ru.json`). Перед кнопкой «Синхронизировать» показывается предупреждение (R23), если у выбранной организации за выбранный месяц уже есть импорт `source: "file"` (данные из `kpiApi.attendance.imports(period)`): «Синхронизация заменит загруженный файл за этот месяц». **Step 2: `tsc` и `bun lint` без новых замечаний.**
- [ ] **Step 3: Ручная проверка** на том же smoke-стенде: карта локаций сохраняется и переживает перезагрузку страницы; блок качества отображается для месяца с данными (после ручной синхронизации на стенде).
- [ ] **Step 4: Commit** `feat(admin): карта локаций и синхронизация посещаемости`.

---

### Task 5: Выбор организации в мастере файловой загрузки

**Files:**
- Modify: `admin/lib/kpi-api.ts` (`AttendanceCommitBody` + `organization_id: string`), `admin/app/[locale]/kpi/attendance/_components/import-wizard.tsx`, `admin/app/[locale]/kpi/attendance/_components/imports-table.tsx` (колонка «Источник»: файл или API, организация)
- Test: `admin/lib/kpi/attendance.test.ts` (дополнить, если логика в `lib/kpi/attendance.ts`)

**Interfaces:**
- Consumes: список организаций из `kpiApi.workly.status()` (`organization_id`, `organization_name`); `AttendanceImportRow.organization_id` и `source` (план 1, Task 8).

Поведение: `AttendanceImportRow.sheet`, `header_row` и `mapping` теперь `string | null` / `number | null` / `AttendanceMapping | null` (R20, у импортов из API их нет): `imports-table.tsx` и диалог с описанием импорта выводят «—» для `null`, типы остальных читателей поправлены так, чтобы `tsc` проходил. В шаге сопоставления колонок добавляется обязательный `Select` организации (список из `kpiApi.workly.status()`; организации с `organization_id: null` в нём нет); пока не выбрана, «Загрузить» недоступна и в `commit` не уходит запрос; `replaceNotice` говорит, что заменяется импорт выбранной организации за месяц.

- [ ] **Step 1: Тест** на чистой функции в `lib/kpi/attendance.ts`: `commitBodyIssue(draft)` возвращает код `organization_required`, пока `organization_id` пуст, и `null`, когда заполнен (`toMapping` и существующие проверки не меняются).
- [ ] **Step 2: FAIL. Step 3: Реализовать функцию, `Select` в мастере и колонку «Источник». Step 4: `bun test ./lib/kpi` PASS.**
- [ ] **Step 5: Русские ключи** (`kpiScreens.attendance.wizard.organization`, колонка «Источник», прочерк) в `ru.json`. **Step 6: Commit** `feat(admin): организация в мастере загрузки Workly`.

---

### Task 6: Переводы

**Files:**
- Modify: `admin/messages/ru.json`, `en.json`, `uz-Latn.json`, `uz-Cyrl.json`

**Interfaces:**
- Consumes: русские ключи задач 1, 3, 4, 5 (`ru.json` уже заполнен); задача 6 переводит их в `en`, `uz-Latn`, `uz-Cyrl` и сверяет паритет.
- Produces: те же ключи `nav.kpi.workly` (уже во всех локалях с задачи 1), `kpiScreens.workly.*` (заголовки секций, кнопки, надпись «идёт обход», подписи групп плана по `PlanKind`, причины `skipped`, отчёт, подтверждение, ошибки `workly.errors.{client_invalid,force_update,auth_failed,not_configured,crawl_failed,stale,unknown}`, локации, качество данных), `kpiScreens.attendance.wizard.organization`, колонка «Источник». Набор ключей одинаков во всех четырёх файлах.

- [ ] **Step 1: Проверочный скрипт** (одноразовый, не коммитится): собрать плоские ключи `nav.kpi.workly`, `kpiScreens.workly.*`, `kpiScreens.attendance.wizard.organization` из `ru.json` и убедиться, что каждый присутствует в трёх остальных файлах. Запуск до перевода показывает недостающие ключи.
- [ ] **Step 2: Перевести ключи из `ru.json` в `en`, `uz-Latn`, `uz-Cyrl`** (русский текст не менять, кроме явных опечаток).
- [ ] **Step 3: Повторить проверочный скрипт:** недостающих ключей нет. `bun lint` и `tsc --noEmit` без новых замечаний.
- [ ] **Step 4: Commit** `feat(admin): переводы экрана Workly`. В описании PR указать, что узбекские тексты ждут проверки носителем.
