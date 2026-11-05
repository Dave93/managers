# Выходные дни в KPI: план реализации

> **Для исполнителя:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans. Шаги отмечены `- [ ]`.

**Цель:** управляющий выдаёт сотруднику выходной из мини-приложения; выходной не считается прогулом в баллах, списках и табеле.

**Архитектура:** отдельная таблица `kpi_days_off` (по строке на день, мягкая отмена). Синхронизация Workly не меняется: `kpi_attendance.absent` остаётся как есть, выходные накладываются при чтении одним читателем (`activeDaysOff` для JS, `absentDayOff` для SQL-агрегатов) в шести местах.

**Стек:** Bun, Elysia, Drizzle/Postgres, kpi_miniapp (Vite, чистые `view/` + DOM `screens/`), admin (Next 15, next-intl).

**Спека:** `docs/superpowers/specs/2026-11-05-kpi-days-off-design.md` (читать целиком до начала).

## Global Constraints

- Ветка `feature/kpi-days-off`, worktree `/Users/macbookpro/development/managers-days-off`. Деплой на прод и cherry-pick не входят в план.
- Причины (коды): `sick`, `family`, `time_off`, `vacation`, `schedule`, `other`; для `other` текст ≥3 символов после trim, иначе `reason_text = null`.
- Окно: не больше 31 дня в запросе; вперёд не дальше `сегодня (Ташкент) + 31`; назад не раньше `сегодня − 366` дней; дни закрытого месяца KPI — 409 `period_closed`.
- Лимита выходных в месяц и согласования HR нет. Сотруднику причина не отдаётся никогда. Синхронизацию `workly/attendance.ts` и `workly/quality.ts` не менять.
- Права: только `kpi.evaluate` через `evaluatorActor` и `canEvaluate(actor, scopes, {terminal_id, card_id})` по текущим филиалу и карте.
- Код ошибок ответа: `{ error: code }`; новые коды `bad_dates`, `bad_reason`, `reason_text_required`; остальные из существующих (`not_found`, `bad_id`, `forbidden`, `out_of_scope`, `period_closed`, `already_cancelled`, `bad_period`).
- Тексты: мини-приложение `ru`/`uz`; админка `en`, `ru`, `uz-Latn`, `uz-Cyrl`. Узбекские варианты помечать в PR как требующие носителя.
- Комментарии в коде и коммиты на русском, как в репозитории. Коммит оканчивать `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Миграция только добавляет таблицу. Номер 0042 сверить с `prod/main` до генерации (на момент плана на проде и в origin последняя 0041).

**Команды** (из worktree; `node_modules` backend и admin уже слинкованы на основной чекаут):

```bash
# чистые тесты backend (без БД)
cd backend && bun test src/modules/kpi/days-off-rules.test.ts
# HTTP-тесты KPI (локальные Postgres managers_tickets_test и Redis подняты)
cd backend && PROJECT_PREFIX=managers_test_ KPI_UPLOADS_DIR=/tmp/kpi_test_uploads KPI_NOTIFY_QUEUE=kpi_notify_test \
  KPI_BOT_USERNAME=kpi_test_bot KPI_WEBHOOK_SECRET=kpi_test_secret \
  DATABASE_URL=postgres://$(whoami)@localhost:5432/managers_tickets_test bun test src/modules/kpi/http/<файл>
# мини-приложение
cd kpi_miniapp && bun test
# админка
cd admin && bun test lib/kpi/<файл>
```

`T` ниже в командах — сокращение для строки HTTP-тестов выше.

## Review Focus

Входы, которых спека прямо не называет, а человек на них споткнётся (у каждого есть тест в задаче-владельце):

1. Диапазон пересекает границу месяца, следующий месяц закрыт: ни одной строки не пишется (всё или ничего). Тест в Task 3.
2. Повтор того же запроса и повторная выдача после отмены: повтор не падает и перечисляет `skipped`; после отмены день выдаётся снова. Task 3.
3. На день с выходным у Workly есть присутствие: считается присутствие, выходной в балле и табеле не участвует. Task 4, Task 5.
4. Все прогульные дни месяца закрыты выходными: балла нет (`null`), а не 0 % и не NaN. Task 4.
5. Причина не уходит сотруднику: ответ «Моей посещаемости» содержит только `day_off`. Task 5.

---

### Task 1: Таблица `kpi_days_off`, миграция 0042, чистка в фикстурах

**Files:**
- Modify: `backend/drizzle/schema.ts` (рядом с `kpi_attendance`, после ~3145)
- Create: `backend/drizzle/migrations/0042_kpi_days_off.sql`, обновить `meta/_journal.json` и `meta/0042_snapshot.json` (генерирует `drizzle-kit`)
- Modify: `backend/src/modules/kpi/http/fixtures.ts` (`cleanupKpi` и импорт схемы)
- Commit также спеку (правка про два файла).

**Interfaces:**
- Produces: `kpi_days_off` из `backend/drizzle/schema`: `id uuid pk`, `employee_id uuid not null`, `day date (mode string) not null`, `terminal_id uuid not null`, `reason_code varchar(16) not null`, `reason_text text`, `given_by uuid not null`, `created_at timestamptz default now() not null`, `cancelled_at timestamptz`, `cancelled_by uuid`. Индексы: `uniqueIndex("kpi_days_off_employee_day_uq").on(employee_id, day).where(sql\`cancelled_at is null\`)`, `index("kpi_days_off_terminal_day_idx").on(terminal_id, day)`, `index("kpi_days_off_given_by_idx").on(given_by, day)`.

- [ ] **Step 1:** сверить номер: `git ls-tree --name-only prod/main backend/drizzle/migrations/ | tail -2` (после `git fetch` прода по `managers-deploy-workflow`); ожидается 0041. Если на проде есть 0042, взять следующий свободный и поправить имя файла в плане.
- [ ] **Step 2:** добавить таблицу в `schema.ts` с русским комментарием в стиле соседних таблиц.
- [ ] **Step 3:** `cd backend && ./node_modules/.bin/drizzle-kit generate --name kpi_days_off`. Открыть SQL: должен содержать только `CREATE TABLE "kpi_days_off"` и три `CREATE ... INDEX` (уникальный с `WHERE cancelled_at IS NULL`). Если генератор принёс чужой дрейф, написать SQL и снимок вручную по образцу 0041, не применяя лишнего.
- [ ] **Step 4:** применить к тестовой БД: `psql managers_tickets_test -f backend/drizzle/migrations/0042_kpi_days_off.sql`; проверка: `psql managers_tickets_test -Atc "select to_regclass('kpi_days_off')"` печатает `kpi_days_off`.
- [ ] **Step 5:** в `cleanupKpi` добавить `await db.delete(kpi_days_off)` рядом с `kpi_attendance`; импортировать таблицу. Проверка: `T attendance-board.test.ts` — 3 pass.
- [ ] **Step 6:** `git add backend/drizzle docs backend/src/modules/kpi/http/fixtures.ts && git commit -m "feat(kpi): таблица kpi_days_off (миграция 0042)"`.

---

### Task 2: Чистые правила выходных `days-off-rules.ts`

**Files:**
- Create: `backend/src/modules/kpi/days-off-rules.ts`, `backend/src/modules/kpi/days-off-rules.test.ts`
- Modify: `backend/src/modules/kpi/tg-app/ev-types.ts` (тип `DayOffReason`, три кода в `EvErrorCode`)

**Interfaces:**
- Produces (в `ev-types.ts`): `export type DayOffReason = "sick" | "family" | "time_off" | "vacation" | "schedule" | "other"`; `EvErrorCode` дополнен `"bad_dates" | "bad_reason" | "reason_text_required"`.
- Produces (в `days-off-rules.ts`, без БД, бросает `KpiError`):
  - `DAY_OFF_REASONS: readonly DayOffReason[]` (порядок как в Global Constraints), `MAX_RANGE_DAYS = 31`, `MAX_AHEAD_DAYS = 31`, `MAX_BACK_DAYS = 366`
  - `addDays(day: string, n: number): string` (UTC-арифметика над `YYYY-MM-DD`)
  - `expandRange(from: unknown, to: unknown, today: string): string[]` — дни от `from` до `to` включительно по возрастанию; 422 `bad_dates` для не-даты (включая `2026-02-30`), `from > to`, длины > 31, `to > addDays(today, 31)`, `from < addDays(today, -366)`
  - `checkReason(code: unknown, text: unknown): { reason_code: DayOffReason; reason_text: string | null }` — 422 `bad_reason` для неизвестного кода или не строки; 422 `reason_text_required` при `other` без ≥3 символов после trim (использовать `commentOk` из `rules.ts`); для не-`other` текст игнорируется (`null`)
  - `periodOfDay(day: string): string` → `YYYY-MM-01`

- [ ] **Step 1: падающие тесты** в `days-off-rules.test.ts` (`today = "2026-11-05"`):
  - `expandRange("2026-11-03","2026-11-05",today)` → `["2026-11-03","2026-11-04","2026-11-05"]`; `("2026-11-05","2026-11-05")` → один день
  - `expandRange("2026-11-06","2026-11-05",today)` → бросает `bad_dates`; `("2026-02-30","2026-03-01")` → `bad_dates`; `(undefined, "2026-11-05")` → `bad_dates`
  - 31 день ровно проходит, 32 дня → `bad_dates`; `to = "2026-12-06"` проходит (today+31), `"2026-12-07"` → `bad_dates`; `from = "2025-11-04"` (today−366) проходит, `"2025-11-03"` → `bad_dates`
  - `checkReason("sick", "что угодно")` → `{reason_code:"sick", reason_text:null}`; `checkReason("other", "  по семейным  ")` → текст `"по семейным"`; `checkReason("other","ab")` и `("other", undefined)` → `reason_text_required`; `checkReason("holiday","x")` и `(5, null)` → `bad_reason`
  - `addDays("2026-12-31", 1)` → `"2027-01-01"`; `periodOfDay("2026-11-17")` → `"2026-11-01"`
- [ ] **Step 2:** `cd backend && bun test src/modules/kpi/days-off-rules.test.ts` → FAIL (модуля нет).
- [ ] **Step 3:** реализовать по сигнатурам выше; даты проверять строгим regexp и обратной сборкой через `Date.UTC`, как `isDay` в `workly/attendance.ts` (не импортировать из него: там он приватный).
- [ ] **Step 4:** тесты → PASS. `cd backend && ./node_modules/.bin/tsc --noEmit -p .` без новых ошибок.
- [ ] **Step 5:** `git commit -m "feat(kpi): правила выходных дней (даты, причины, окно)"`.

---

### Task 3: Сервис `days-off.ts`, роуты `/kpi/tg/ev/*`, типы ответов

**Files:**
- Create: `backend/src/modules/kpi/days-off.ts`, `backend/src/modules/kpi/tg-app/ev-days-off.ts` (тонкий слой ответов), `backend/src/modules/kpi/http/tg-app-ev-days-off.test.ts`
- Modify: `backend/src/modules/kpi/tg-app/ev-types.ts`, `backend/src/modules/kpi/routes/tg-app-ev.ts`

**Interfaces:**
- Consumes: Task 1 таблица; Task 2 `expandRange`, `checkReason`, `periodOfDay`, `MAX_*`; `evaluatorActor`; `loadDirectory`/`canEvaluate`/`loadScopes`; `lockPeriodShared`/`isPeriodClosed`; `userNames` не нужен.
- Produces (в `ev-types.ts`, без импортов):
  - `EvDayOff { id; employee_id; employee_name: string; terminal_name: string | null; day: string; reason_code: DayOffReason; reason_text: string | null; status: "active" | "cancelled"; can_cancel: boolean }`
  - `EvDayOffForm { employee: { id; first_name; last_name; terminal_name: string | null }; reasons: DayOffReason[]; window: { min: string; max: string }; max_range_days: number; existing: string[] }` (`existing` — дни сотрудника с активным выходным внутри окна)
  - `EvDaysOffCreated { created: EvDayOff[]; skipped: string[] }`
  - `EvDaysOff { period: string; period_status: "open" | "closed"; items: EvDayOff[] }`
- Produces (в `days-off.ts`, все принимают `db: DbLike`):
  - `giveDaysOff(db, actor: Actor, input: { employee_id?: unknown; from?: unknown; to?: unknown; reason_code?: unknown; reason_text?: unknown }, at: Date): Promise<{ created: DayOffRow[]; skipped: string[] }>`
  - `cancelDayOff(db, actor, id: string): Promise<DayOffRow>`
  - `listGivenDaysOff(db, actor, period: Period): Promise<DayOffRow[]>` — мои (`given_by = actor.userId`) за месяц, включая отменённые, дни по убыванию
  - `dayOffForm(db, actor, employeeId: unknown, at: Date): Promise<EvDayOffForm>`
  - `activeDaysOff(db, q: { employeeIds: string[]; from: string; to: string /* исключая */ }): Promise<Map<string, Map<string, { reason_code: DayOffReason; reason_text: string | null; given_by: string }>>>` (employee_id → day → данные; для Task 4–5)
  - `absentDayOff(a: { employee_id: AnyPgColumn; day: AnyPgColumn; absent: AnyPgColumn }): SQL` — `(absent and exists (select 1 from kpi_days_off d where d.employee_id = a.employee_id and d.day = a.day and d.cancelled_at is null))` (для Task 4)
  - `DayOffRow` — строка таблицы + `employee_name`, `terminal_name`
- Produces (роуты, тот же `kpiTgCtx`, `run(set, …)`, поля `t.Any()` как у соседних): `GET /kpi/tg/ev/day-off-form?employee_id`; `POST /kpi/tg/ev/days-off` (тело `employee_id, from, to, reason_code, reason_text`); `GET /kpi/tg/ev/days-off?period=`; `POST /kpi/tg/ev/days-off/:id/cancel`.

Правила `giveDaysOff`: неверный `employee_id` (не строка/пусто) — 422 `bad_id`, не uuid — 404 `not_found`; сотрудник ищется среди активных (`loadDirectory` без `includeInactive`): нет — 404 `not_found`; `canEvaluate` ложно — 403 `out_of_scope`; затем даты и причина (Task 2). В транзакции: `lockPeriodShared` по каждому месяцу диапазона, любой закрытый — 409 `period_closed` до единой записи; вставка по дню с `onConflictDoNothing` на частичный уникальный индекс (`target: [employee_id, day]`, `targetWhere: sql\`cancelled_at is null\``), `terminal_id` — текущий филиал сотрудника, `given_by` — `actor.userId`; не вставленные дни — в `skipped`. `cancelDayOff`: строка под `for("update")`; нет/не uuid — 404 `not_found`; `given_by ≠ actor.userId` — 403 `forbidden`; уже отменена — 409 `already_cancelled`; месяц закрыт (`lockPeriodShared`) — 409 `period_closed`; иначе `cancelled_at = now()`, `cancelled_by`. `can_cancel` в списке — активный и месяц открыт. Форма: `window.min` — позже из (первый день месяца после последнего закрытого периода `kpi_periods`, `today − 366`), `window.max = today + 31`; 404/403 как у выдачи.

- [ ] **Step 1: падающие HTTP-тесты** (образец сессии и подписи initData — `http/tg-app-ev-violations.test.ts`; фикстуры `setup`, `makeEmployee`, `makeTerminal`, `cleanupKpi` из `fixtures.ts`). Тесты и ожидания:
  - выдача диапазона 3 дня: 200, `created.length = 3`, `skipped = []`, в БД три строки с `terminal_id` филиала сотрудника и `given_by` оценщика
  - тот же запрос повторно: `created = []`, `skipped` = те же 3 дня (Review Focus 2); после отмены одного дня выдача снова создаёт его
  - диапазон `2026-10-30..2026-11-02`, ноябрь закрыт (строка `kpi_periods` `closed`): 409 `period_closed`, строк в `kpi_days_off` ноль (Review Focus 1)
  - `reason_code: "other"` без текста — 422 `reason_text_required`; `reason_code: "x"` — 422 `bad_reason`; `to < from` — 422 `bad_dates`
  - сотрудник чужого филиала — 403 `out_of_scope`; неактивный — 404 `not_found`; не uuid — 404; пустой `employee_id` — 422 `bad_id`
  - оценщик с назначением, ограниченным картой: выдача сотруднику другой карты — 403 `out_of_scope`
  - отмена автором — 200, `status: "cancelled"`; отмена чужого выходного другим оценщиком — 403 `forbidden`; повторная отмена — 409 `already_cancelled`; отмена в закрытом месяце — 409 `period_closed`
  - список `?period=2026-11-01`: только мои, отменённые есть со `status: "cancelled"`, `can_cancel` у активного в открытом месяце `true`, в закрытом `false`; `?period=bad` — 422 `bad_period`
  - форма: `reasons` — шесть кодов, `window.max = today+31`, `existing` содержит уже выданный день; без роли `kpi.evaluate` — 403
- [ ] **Step 2:** `T tg-app-ev-days-off.test.ts` → FAIL.
- [ ] **Step 3:** реализовать `days-off.ts`, `ev-days-off.ts` (приведение `DayOffRow` к `EvDayOff`: `employee_name = \`${last_name} ${first_name}\`.trim()`), типы, роуты; роуты зарегистрированы в цепочке `tgAppEvRoutes`.
- [ ] **Step 4:** `T tg-app-ev-days-off.test.ts` → все PASS; затем весь набор `T` без имени файла (`src/modules/kpi/http/`) — без регрессий; `tsc --noEmit` backend.
- [ ] **Step 5:** `git commit -m "feat(kpi): выдача и отмена выходных оценщиком (API мини-приложения)"`.

---

### Task 4: Наложение выходных на баллы: подсказка «Приход и уход», «Сотрудники KPI», балл филиала

**Files:**
- Modify: `backend/src/modules/kpi/attendance-parse.ts` (`AttendanceStats`, `attendanceSuggestion`), `backend/src/modules/kpi/attendance.ts` (`attendanceStats`), `backend/src/modules/kpi/people.ts` (`loadPeople`), `backend/src/modules/kpi/branch-facts.ts` (`attendanceByTerminal`)
- Test: `backend/src/modules/kpi/attendance-parse.test.ts` (чистые), `backend/src/modules/kpi/http/days-off-overlay.test.ts` (новый HTTP)

**Interfaces:**
- Consumes: `activeDaysOff`, `absentDayOff` (Task 3).
- Produces: `attendanceSuggestion(rows: { absent: boolean; late_minutes: number }[], off = 0): AttendanceStats | null`; `AttendanceStats` получает необязательное `off?: number` (поле добавляется только при `off > 0`, остальные результаты не меняются); основание получает хвост `, выходных ${off}`.

Правила: в `attendanceStats` строки с `absent` и активным выходным на этот `day` отбрасываются, их число — `off`; `days`/`ontime`/`late`/`absent` считаются по оставшимся. В `loadPeople` счётчик `absent` исключает такие строки (ontime/late не меняются, они и так требуют `not absent`). В `attendanceByTerminal`: `days` = `count(*) filter (where not <absentDayOff>)`, `absent` = `count(*) filter (where absent and not exists-выходной)`; пользоваться `absentDayOff(a)` (`absent and not absentDayOff(a)` даёт «прогул без выходного»).

- [ ] **Step 1: падающие чистые тесты** (`attendance-parse.test.ts`):
  - 3 вовремя + 1 опоздание, `off = 2` → `{ days: 4, ontime: 3, late: 1, absent: 0, off: 2, score: 75, basis: "Workly: 4 дня, вовремя 3, опозданий 1, прогулов 0, выходных 2" }`
  - пустой список и `off = 2` → `null` (Review Focus 4); пустой и `off = 0` → `null`
  - без второго аргумента результат без ключа `off` (существующие тесты не меняются)
- [ ] **Step 2: падающие HTTP-тесты** (`days-off-overlay.test.ts`; образцы: `attendance-review.test.ts` для подсказки в форме оценки, `branch.test.ts` и хелпер посещаемости `fixtures.ts:480` для балла филиала; выходные вставлять в `kpi_days_off` напрямую через drizzle):
  - сотрудник с 2 вовремя, 1 прогул 05.11 и активным выходным на 05.11: подсказка формы — `score 100`, основание содержит «выходных 1», «прогулов 0»; после `cancelled_at = now()` подсказка возвращается к «прогулов 1» и баллу 67
  - выходной на день, где у Workly присутствие (`absent=false`): подсказка не меняется, «выходных» в основании нет (Review Focus 3)
  - все прогульные дни закрыты выходными и других строк нет: подсказки нет (как «нет данных», требует заметку при отправке)
  - `GET` списка «Сотрудники KPI» (`loadPeople`; найти маршрут в `routes/employees.ts`): `attendance.absent` без дня с выходным
  - балл филиала: `days` и `absent` в деталях пункта дисциплины не включают такой день
- [ ] **Step 3:** тесты → FAIL. **Step 4:** реализовать (SQL через `absentDayOff`). **Step 5:** чистые тесты PASS, `T days-off-overlay.test.ts attendance-review.test.ts branch.test.ts` PASS, затем весь `src/modules/kpi/`. `tsc` backend.
- [ ] **Step 6:** `git commit -m "feat(kpi): выходные не считаются прогулом в баллах, списке и балле филиала"`.

---

### Task 5: Наложение на показ: табель и «Моя посещаемость»

**Files:**
- Modify: `backend/src/modules/kpi/types.ts` (`BoardDay[0]`: `0|1|2|3`; `BoardEmployee.off?`), `backend/src/modules/kpi/attendance-board.ts`, `backend/src/modules/kpi/tg-app/types.ts` (`TgAttendanceDay.day_off: boolean`), `backend/src/modules/kpi/tg-app/attendance.ts`
- Test: `backend/src/modules/kpi/http/attendance-board.test.ts` (дополнить), HTTP-тест «Моей посещаемости» (найти по `grep -rn "tg/attendance" backend/src/modules/kpi/http`, дополнить там или в `days-off-overlay.test.ts`)

**Interfaces:**
- Consumes: `activeDaysOff` (Task 3); `userNames` из `directory.ts`.
- Produces: `BoardEmployee.off?: Record<string, { reason_code: string; reason_text: string | null; by: string | null }>` — ключ «день месяца» (`"5"`), только для дней со статусом 3; `by` — имя выдавшего. `BoardDay` статус 3 = `[3, 0, null, null]`. `TgAttendanceDay.day_off` в каждой строке `attendanceFor`.

Правила: табель: день пуст или Workly пишет прогул, и есть активный выходной → `[3,0,null,null]` + запись в `off`; день с присутствием не меняется и в `off` не попадает. «Моя посещаемость»: строка прогула с выходным отдаётся как `{ absent: false, day_off: true, late_minutes: 0, check_in: null, check_out: null }`; день выходного без строки Workly добавляется такой же строкой; присутствие главнее (`day_off: false`); список остаётся отсортирован по дню по убыванию. Причина и автор в ответе сотрудника не появляются. Добавление `day_off` ломает компиляцию существующих литералов `TgAttendanceDay`/`BoardDay` в тестах бэкенда, мини-приложения и админки: поправить по `tsc` (в мини-приложении и админке — только литералы; их логика в Task 6–8).

- [ ] **Step 1: падающие тесты:**
  - табель: выходной на прогуле → `days[idx]` равен `[3,0,null,null]`, `off["5"]` содержит код, текст и имя автора; выходной на пустом дне → тоже статус 3; на дне с присутствием → день прежний, `off` без этого дня; отменённый выходной → ничего; сотрудник чужого филиала не виден (существующее правило зоны)
  - «Моя посещаемость»: строка с `day_off: true` для прогула и для дня без строки; для присутствия `day_off: false`; в ответе нет ключей `reason_code`, `reason_text`, `given_by` (Review Focus 5)
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `T attendance-board.test.ts` + тест «Моей посещаемости» PASS; весь `src/modules/kpi/` PASS; `tsc` backend.
- [ ] **Step 5:** `git commit -m "feat(kpi): выходные в табеле и «Моей посещаемости»"`.

---

### Task 6: Мини-приложение: маршруты, чистые модели, тексты

**Files:**
- Modify: `kpi_miniapp/src/route.ts`, `kpi_miniapp/src/i18n.ts`, `kpi_miniapp/src/view/ev-errors.ts`, `kpi_miniapp/src/view/attendance.ts`
- Create: `kpi_miniapp/src/view/ev-dayoff.ts`, `kpi_miniapp/src/view/ev-daysoff.ts`
- Test: `kpi_miniapp/test/route.test.ts`, `view-attendance.test.ts` (дополнить), новые `view-ev-dayoff.test.ts`, `view-ev-daysoff.test.ts`, `i18n.test.ts` (проверка парности ключей ru/uz уже есть, держать зелёной)

**Interfaces:**
- Consumes: типы `EvDayOffForm`, `EvDayOff`, `EvDaysOff`, `DayOffReason`, `TgAttendanceDay.day_off` из бэкенда.
- Produces:
  - `Route` дополняется `{ name: "ev_dayoff"; employee_id: string }` (хеш `#/ev/dayoff/<uuid>`) и `{ name: "ev_daysoff"; period: string | null }` (`#/ev/daysoff`, `#/ev/daysoff/YYYY-MM`); порядок разбора в `parseEv` — до общего правила «один сегмент = месяц»; `hashOf` и `routeAllowed` (`isEvRoute` покрывает префикс `ev`)
  - `view/ev-dayoff.ts`: `interface DayOffDraft { from: string; to: string; reason: DayOffReason | null; text: string }`; `dayOffFormView(f: EvDayOffForm, l: Lang): { title: string; name: string; reasons: { code: DayOffReason; label: string }[]; min: string; max: string; existing: string }`; `dayOffIssues(d: DayOffDraft, f: EvDayOffForm, l: Lang): string[]` (пусто — можно отправлять); `dayOffCount(d: DayOffDraft): number` (число дней диапазона, 0 если даты неверны); `dayOffBody(employeeId: string, d: DayOffDraft): { employee_id: string; from: string; to: string; reason_code: DayOffReason; reason_text?: string }`
  - `view/ev-daysoff.ts`: `evDaysOffView(d: EvDaysOff, l: Lang): { title: string; empty: boolean; closed: boolean; items: { id: string; who: string; day: string; reason: string; status: { text: string; tone: "active" | "muted" }; canCancel: boolean }[] }`
  - `AttendanceRowVM.dayOff: string | null` (подпись «Выходной», у такой строки `absent`, `times`, `late` равны `null`)
  - ключи i18n (ru и uz): `ev_btn_dayoff`, `ev_my_daysoff`, `ev_dayoff_title`, `ev_dayoff_from`, `ev_dayoff_to`, `ev_dayoff_reason`, `ev_dayoff_other_ph`, `ev_dayoff_send`, `ev_dayoff_count`, `ev_dayoff_existing`, `ev_dayoff_done`, `ev_dayoff_skipped`, `ev_daysoff_empty`, `ev_daysoff_cancel`, `ev_daysoff_closed`, `ev_reason_sick`, `ev_reason_family`, `ev_reason_time_off`, `ev_reason_vacation`, `ev_reason_schedule`, `ev_reason_other`, `att_day_off`, `ev_err_bad_dates`, `ev_err_bad_reason`, `ev_err_reason_text`; ru: «Болезнь», «Семейные обстоятельства», «Отгул», «Отпуск», «По графику», «Другая причина»; uz: «Kasallik», «Oilaviy sharoit», «Otgul», «Ta'til», «Jadval bo'yicha», «Boshqa sabab» (апостроф как в существующих uz-строках: `ʼ`/`ʻ`, посмотреть соседние)

- [ ] **Step 1: падающие тесты:**
  - `route.test.ts`: `parseHash("#/ev/dayoff/<uuid>")` → `{ name: "ev_dayoff", employee_id }`; не uuid → home; `#/ev/daysoff` → `period: null`; `#/ev/daysoff/2026-11` → `period: "2026-11-01"`; `#/ev/daysoff/2026-13` → home; `hashOf` обратим; `routeAllowed` для обоих — только роли с `evaluator`
  - `view-ev-dayoff.test.ts`: `dayOffCount({from:"2026-11-03",to:"2026-11-05",…})` = 3, при `to < from` = 0; `dayOffIssues` пуст при причине `sick`, возвращает сообщение при `reason: null`, при `other` с текстом короче 3, при диапазоне вне `min..max`; `dayOffBody` не кладёт `reason_text` для не-`other` и обрезает пробелы у `other`; метки причин ru и uz
  - `view-ev-daysoff.test.ts`: строка активного (`tone: "active"`, `canCancel` из ответа), отменённого (`"muted"`, `canCancel: false`), для `other` в `reason` подставлен текст, пустой список → `empty: true`, закрытый месяц → `closed: true`
  - `view-attendance.test.ts`: строка с `day_off: true` → `dayOff: "Выходной"` (uz: свой перевод), `absent`, `times`, `late` равны `null`
  - `view-ev-errors` (существующий тест-файл): коды `bad_dates`, `bad_reason`, `reason_text_required` → `{ kind: "error", key: "ev_err_bad_dates" | … }`, `period_closed` по-прежнему `reload`
- [ ] **Step 2:** `cd kpi_miniapp && bun test` → FAIL. **Step 3:** реализовать; пустые/неверные даты `dayOffCount` не бросают. **Step 4:** `bun test` PASS (весь набор). `tsc` мини-приложения: `cd kpi_miniapp && ../backend/node_modules/.bin/tsc --noEmit -p .`.
- [ ] **Step 5:** `git commit -m "feat(kpi-miniapp): маршруты, модели и тексты выходных"`.

---

### Task 7: Мини-приложение: экраны, кнопки, «Моя посещаемость»

**Files:**
- Create: `kpi_miniapp/src/screens/ev-dayoff.ts`, `kpi_miniapp/src/screens/ev-daysoff.ts`
- Modify: `kpi_miniapp/src/main.ts` (два `case`), `kpi_miniapp/src/screens/ev-review.ts` (кнопка), `kpi_miniapp/src/screens/ev-list.ts` (строка), `kpi_miniapp/src/screens/attendance.ts` (подпись «Выходной»), `kpi_miniapp/src/style-ev.css` / `style.css` по необходимости

**Interfaces:**
- Consumes: Task 6 модели и маршруты; `appApi()` и `evOutcome` по образцу `screens/ev-violation.ts` (отправка, `latch`, `haptic`, исход `unknown`/`session`/`reload`/`error`).
- Produces: `renderEvDayOff(f: EvDayOffForm): HTMLElement`, `renderEvDaysOff(d: EvDaysOff): HTMLElement`; `main.ts`: `ev_dayoff` → `GET /ev/day-off-form?employee_id=…`, `ev_daysoff` → `GET /ev/days-off[?period=…]`, оба `kind: "list"`, `noCache: true`.

Поведение: на экране оценки (не в режимах `ev_readonly_scope`/`ev_closed`) рядом с «Нарушение» кнопка «Выходной» ведёт на `ev_dayoff`; в списке сотрудников под «Мои нарушения» строка «Выданные выходные» (`ev_my_daysoff`) ведёт на `ev_daysoff`. Форма: два `<input type="date">` с `min`/`max` из формы, `select` причины, `textarea` при `other`, строка «N дн.» (`dayOffCount`), подсказка уже выданных дней, кнопка отправки неактивна пока `dayOffIssues` не пуст. Запись не идемпотентна на сети: при исходе `unknown` повтор сам не уходит, человек открывает «Выданные выходные» (как у нарушения; повтор безопасен благодаря `skipped`, но следовать образцу). После успеха переход на `ev_daysoff`. Список: кнопка «Отменить» у строк с `canCancel`, отправка `POST /ev/days-off/:id/cancel`, перерисовка. «Моя посещаемость»: строка с `dayOff` рисуется спокойной подписью вместо «не вышел». Все строки с сервера в DOM только через `h()` (текст).

- [ ] **Step 1:** реализовать экраны и проводку (DOM-слой юнит-тестами не покрыт, как остальные `screens/`).
- [ ] **Step 2:** `cd kpi_miniapp && bun test` PASS; `tsc --noEmit` без ошибок; `bun run build` (нужен `vite`: если пакета нет, `cd kpi_miniapp && bun install`, `node_modules` в мини-приложении не коммитить).
- [ ] **Step 3: проверка в браузере** на локальном стенде (БД `managers_kpi_smoke`, запуск по образцу сессии с мини-приложением в `scratchpad`: поднять backend, `bun run dev` в `kpi_miniapp`, fake-telegram из `src/dev`): под оценщиком выдать выходной на 3 дня, увидеть его в «Выданные выходные», отменить один день; под сотрудником открыть «Моя посещаемость» — подпись «Выходной», причины нет. Снять один скриншот 390 px каждой формы. Если стенд не поднимается за разумное время, зафиксировать это в отчёте, а не пропускать молча.
- [ ] **Step 4:** `git commit -m "feat(kpi-miniapp): экраны выдачи и списка выходных"`.

---

### Task 8: Админка: статус «Выходной» в табеле и карточке сотрудника

**Files:**
- Modify: `admin/lib/kpi/timesheet.ts`, `admin/lib/kpi/employee-card.ts`, `admin/app/[locale]/kpi/_components/day-style.ts`, `admin/app/[locale]/kpi/timesheet/_components/month-matrix.tsx`, `employee-list.tsx`, `employee-sheet.tsx`, `admin/app/[locale]/kpi/_components/attendance-month.tsx` (карточка), `admin/messages/{en,ru,uz-Latn,uz-Cyrl}.json`
- Test: `admin/lib/kpi/timesheet.test.ts`, `admin/lib/kpi/employee-card.test.ts`; проверки локалей, которые уже есть (`attendance-i18n.test.ts` и соседи), держать зелёными

**Interfaces:**
- Produces: `DayStatus = "ontime" | "late" | "absent" | "dayoff"`; `STATUS` с ключом `3: "dayoff"`; `Totals` получает `off: number` (день `dayoff` увеличивает `off`, но **не** `recorded`); `sumTotals` суммирует `off`; `absentShare` и фильтры вкладок не меняются; `attendanceDays` (карточка): `d.day_off` → `[3, 0, null, null]` раньше проверки `d.absent`; `CELL.dayoff` — спокойный синий (`bg-sky-300 dark:bg-sky-700`, не конкурирует с красным и жёлтым); причина и автор в `employee-sheet.tsx` из `BoardEmployee.off`, подпись причины по коду (`reason_text` для `other`).
- Ключи админских текстов (в тех же пространствах, где лежат `tip.absent` и подписи статусов табеля; структуру найти по `useTranslations` в `timesheet/page.tsx` и компонентах): `dayoff` для подсказки, легенды и итогов; `reason.sick|family|time_off|vacation|schedule|other`; «выдал» для боковой панели. Все 4 локали, ключи идентичны.

- [ ] **Step 1: падающие тесты:**
  - `timesheet.test.ts`: `statusOf([3,0,null,null])` = `"dayoff"`; `totalsOf` по дням `[ontime, dayoff, absent, null]` → `{ ontime: 1, late: 0, absent: 1, off: 1, recorded: 2 }`; `absentShare` для этих итогов = 50 (выходной в знаменатель не входит); `sumTotals` суммирует `off`
  - `employee-card.test.ts`: `attendanceDays` по дню `{ day_off: true, absent: false, … }` даёт `[3,0,null,null]`; день `absent: true` без выходного по-прежнему `[2,0,null,null]`
- [ ] **Step 2:** `cd admin && bun test lib/kpi/timesheet.test.ts lib/kpi/employee-card.test.ts` → FAIL. **Step 3:** реализовать логику, затем компоненты и тексты. **Step 4:** тесты PASS, весь `bun test lib/kpi`, `cd admin && ./node_modules/.bin/tsc --noEmit` без ошибок, `bun lint`.
- [ ] **Step 5: проверка в браузере:** `next dev --webpack` (Turbopack не работает с симлинком `node_modules`, см. заметку про worktree табеля), `/ru/kpi/timesheet` на стенде с выходным: ячейка синяя, подсказка и легенда на месте, боковая панель показывает причину и автора, шапка «Прогулы» не включает этот день; светлая и тёмная темы, ширины 1440 и 390. Карточка сотрудника рисует тот же статус.
- [ ] **Step 6:** `git commit -m "feat(kpi): статус «Выходной» в табеле и карточке сотрудника"`.

---

### Task 9: Общая проверка и подготовка PR (без выкладки)

**Files:** изменений кода нет, кроме найденных ошибок; PR-описание готовится в чате.

- [ ] **Step 1:** весь HTTP-набор KPI: `T` на `src/modules/kpi/http/` — без новых падений относительно `origin/main` (если падают тесты, которые падали и до работы, сравнить прогоном на чистом `origin/main` и сообщить отдельно).
- [ ] **Step 2:** `bun test` в `backend` (чистые), `kpi_miniapp`, `admin/lib/kpi`; `tsc --noEmit` во всех трёх; `admin: bun lint`; `kpi_miniapp: bun run build`.
- [ ] **Step 3:** прочитать `git diff origin/main --stat` и убедиться: нет правок `workly/attendance.ts`, `workly/quality.ts`; в миграции только `kpi_days_off`; нет секретов и `node_modules` в индексе.
- [ ] **Step 4:** подготовить текст PR (что сделано, решения исполнителя из спеки, известные ограничения: отмена по одному дню, `отмена HR` не сделана, uz-тексты ждут носителя, уведомления сотруднику нет, лимита нет) и показать владельцу. Пуш и PR только после его «да»; выкладка на прод только по прямой просьбе.
