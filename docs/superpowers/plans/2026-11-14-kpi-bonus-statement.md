# KPI: ведомость на выдачу бонусов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR скачивает с экрана бонусов .xlsx-ведомость за квартал (лист на компанию) для подписи CEO; во всём интерфейсе «повышение/прибавка» → «бонус».

**Architecture:** Backend собирает данные тем же `listRaises`, что экран и CSV, добавляет к строке компанию, чистая функция `buildStatement` раскладывает строки по листам, `renderStatementXlsx` (exceljs) рисует книгу, маршрут `GET /api/kpi/raises/statement` отдаёт байты. Admin скачивает blob, как CSV.

**Tech Stack:** Bun, Elysia, Drizzle, exceljs ^4.4.0 (новая зависимость backend), Next.js + next-intl.

**Spec:** `docs/superpowers/specs/2026-11-14-kpi-bonus-statement-design.md`

## Global Constraints

- Права: маршрут только для `kpi.approve` (`requireAny(actor, ["kpi.approve"])`), как `/kpi/raises/export`.
- Источник строк — `listRaises(drizzle, actor, quarter)`; шкала — `getTiers`; мин. месяцев — `loadSettings(...).raise_min_months`.
- Имена в коде/БД (`kpi_raise_*`, `raises`, ключи i18n, маршруты) не переименовываем; меняются только тексты.
- Имя файла: `kpi-bonuses-YYYY-QN.xlsx`; content-type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- Документ только на русском. Сумма — число с форматом `# ##0`, процент — число с форматом `0.00`, пустой месяц — «—».
- Тексты предупреждений (точно):
  - `Предварительно: месяцы квартала ещё не закрыты, суммы могут измениться`
  - `Оценки менялись после расчёта. Нажмите «Пересчитать» и выгрузите заново`
  - `Шкала бонусов менялась после расчёта. Нажмите «Пересчитать» и выгрузите заново`
- Пустой квартал: один лист `Ведомость` со строкой `За квартал нет расчёта. Нажмите «Пересчитать».`
- Лист без компании: `Без компании`. Имя листа — до 31 символа, без `[]:*?/\`.
- HTTP-тесты KPI гоняются только на `managers_tickets_test`:
  `cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:5432/managers_tickets_test bun run test:http:kpi`
  (одиночный файл — та же строка env из `package.json`, `bun test <file>`).

## Review Focus

1. Шкалу сменили после «Пересчитать» (реальный случай на проде 14.11) — строка помечена `*`, предупреждение на листе. → тест в Task 3.
2. Сотрудник филиала одной компании не попадает на лист другой; строка без филиала — на «Без компании». → тесты Task 3 и Task 5.
3. HR перепечатывает после решений: `approved` > 0 → сумма, `approved` 0 и `rejected` → «отказ». → тест Task 3.
4. `insufficient`, отклонённый HR, в «для сведения» с причиной «мало оценок», а не «ниже порога». → тест Task 3.
5. Тестовый прогон `test:http:kpi` дважды подряд не падает на сиде шкалы (`raises.test.ts` восстанавливает шкалу, `cards.test.ts` её проверяет). → Task 1.

---

### Task 1: Шкала в тестах и сид — один набор, коммит спеки

Уже сделано на ветке `chore/kpi-raise-tiers-75` (не закоммичено): `seed-data.ts` (75→200k, 85→300k, 95→500k) и `cards.test.ts`. `raises.test.ts` в `afterAll` пишет в тестовую базу свою `DEFAULT_TIERS` (старая шкала), поэтому следующий прогон `cards.test.ts` падает.

**Files:**
- Modify: `backend/src/modules/kpi/http/raises.test.ts:25-29` (`DEFAULT_TIERS`)
- Add to commit: `backend/src/modules/kpi/seed-data.ts`, `backend/src/modules/kpi/http/cards.test.ts`, spec, этот план

- [ ] **Step 1:** `DEFAULT_TIERS = [{95,500000},{85,300000},{75,200000}]`. Проверить, что ожидания `raises.test.ts` (avg 94 → 300000 и т. п.) остались верны при новой шкале; если тест сам ставит шкалу — не трогать.
- [ ] **Step 2:** Прогнать `raises.test.ts` и `cards.test.ts` дважды подряд. Ожидается: оба раза 0 fail.
- [ ] **Step 3:** Commit `chore(kpi): шкала бонусов 75/85/95 в сиде и тестах; спека и план ведомости`.

### Task 2: Компания в строке решения

**Files:**
- Modify: `backend/src/modules/kpi/types.ts:206` (`RaiseRow`)
- Modify: `backend/src/modules/kpi/directory.ts:120` (рядом с `terminalNames`)
- Modify: `backend/src/modules/kpi/raises.ts:83` (`toRaiseRows`)
- Test: `backend/src/modules/kpi/http/raises.test.ts`

**Interfaces:**
- Produces: `RaiseRow.organization_id: string | null`, `RaiseRow.organization_name: string | null`;
  `terminalOrganizations(db: DbLike, ids: string[]): Promise<Map<string, { id: string; name: string }>>` в `directory.ts` (terminal_id → организация; один запрос `terminals ⋈ organization`, `inArray`).

- [ ] **Step 1: Failing test** в `raises.test.ts`: строка A (филиал — `randomUUID()` без строки в `terminals`) → `organization_id === null && organization_name === null`. Отдельно: сотрудник на `makeTerminal(db)` → `organization_id === KPI_TEST_ORG_ID`, `organization_name === "kpi_test_org"` (импорт из `./fixtures`). Используйте отдельного сотрудника с одной оценкой, чтобы не ломать соседние ожидания.
- [ ] **Step 2:** Прогнать — FAIL (поля undefined).
- [ ] **Step 3:** Реализовать `terminalOrganizations`, заполнить два поля в `toRaiseRows`.
- [ ] **Step 4:** Прогнать `raises.test.ts` — PASS.
- [ ] **Step 5:** Commit `feat(kpi): компания в строке квартального решения`.

### Task 3: Модель ведомости (чистая функция)

**Files:**
- Create: `backend/src/modules/kpi/bonus-statement.ts`
- Test: `backend/src/modules/kpi/bonus-statement.test.ts` (без БД, `bun test src/modules/kpi/bonus-statement.test.ts`)

**Interfaces:**
- Consumes: `RaiseRow` (Task 2), `Tier`, `raiseFor` из `./rules`.
- Produces:
  ```ts
  export type CeoCell = number | "отказ" | null;
  export interface StatementLine { no: string; employee_name: string; terminal_name: string | null; card_title: string | null;
    months: (number | null)[]; avg_pct: number | null; suggested_amount: number; ceo: CeoCell }
  export interface StatementInfoLine { employee_name: string; terminal_name: string | null; avg_pct: number | null; reason: string }
  export interface StatementSheet { sheet_name: string; company: string; lines: StatementLine[]; total_count: number;
    total_suggested: number; info: StatementInfoLine[]; warnings: string[] }
  export function buildStatement(rows: RaiseRow[], tiers: Tier[], minMonths: number): StatementSheet[];
  ```

Правила (из спеки, точно):
- Группировка по `organization_id`; `null` → лист `Без компании`, `company` = `Без компании`. Порядок листов — по `company` (`localeCompare(…, "ru")`), «Без компании» последним. `sheet_name` = company без `[]:*?/\`, обрезан до 31.
- Основной список: `suggested_amount > 0` или (`status === "approved"` и `approved_amount > 0`). Сортировка: `terminal_name` (null в конец), затем `employee_name`, `ru`. `no` = порядковый номер с 1, плюс `*`, если строка `stale` или «шкала менялась».
- «Шкала менялась»: `status ∈ {proposed, insufficient}`, `avg_pct !== null`, `months_scored >= minMonths`, `raiseFor(avg_pct, tiers) !== suggested_amount`.
- `ceo`: `approved` и `approved_amount > 0` → число; `approved` с 0 или `rejected` → `"отказ"`; иначе `null`.
- `total_count` = число строк основного списка; `total_suggested` = сумма их `suggested_amount`.
- `info`: остальные строки, сортировка как у основного. `reason`: `months_scored < minMonths` → `мало оценок: ${months_scored} из ${minMonths} нужных`, иначе `ниже порога ${min} %` (min — наименьший `min_pct` шкалы; без шкалы — `шкала не задана`). Если строка решена: + `, решение HR: отказ` (`rejected` или approved 0) или `, решение HR: ${сумма с пробелами} сум`.
- `warnings` листа в порядке: «не закрыты» (если у любой строки листа `periods_closed === false`), «оценки менялись» (любая `stale`), «шкала менялась» (любая по правилу выше). Тексты — из Global Constraints.
- Пустой `rows` → `[]` (пустую книгу рисует Task 4).

- [ ] **Step 1: Failing tests** (фабрика `row(over: Partial<RaiseRow>): RaiseRow` в тесте; шкала `[{95,500000},{85,300000},{75,200000}]`, `minMonths = 2`):
  - `две компании → два листа, порядок по имени, строка без организации на «Без компании» последним`;
  - `основной список: suggested>0 любого статуса и approved>0 при suggested 0; остальные в info`;
  - `ceo: proposed → null; approved 300000 → 300000; approved 0 → "отказ"; rejected → "отказ"`;
  - `сортировка: филиал, затем ФИО; no = "1","2",…`;
  - `итог: total_count и total_suggested по основному списку`;
  - `причина: months_scored 1 из 2 → "мало оценок: 1 из 2 нужных"` даже при `status: "rejected"` → `"мало оценок: 1 из 2 нужных, решение HR: отказ"`; `avg 71.3, 3 месяца → "ниже порога 75 %"`;
  - `шкала менялась: proposed, avg 80, suggested 150000 → no "1*" и предупреждение «Шкала бонусов…»; approved с тем же расхождением → без пометки`;
  - `stale → "*" и предупреждение «Оценки менялись…»; periods_closed false → «Предварительно…» первым`;
  - `sheet_name: "A/B:C*" → "ABC", длинное имя обрезано до 31`;
  - `пустой вход → []`.
- [ ] **Step 2:** Прогнать — FAIL (модуля нет).
- [ ] **Step 3:** Реализовать `buildStatement` в `bonus-statement.ts`.
- [ ] **Step 4:** Прогнать — PASS.
- [ ] **Step 5:** Commit `feat(kpi): модель ведомости на выдачу бонусов`.

### Task 4: Excel-книга

**Files:**
- Modify: `backend/package.json` (+ `"exceljs": "^4.4.0"`, `bun install` в `backend/`)
- Modify: `backend/src/modules/kpi/bonus-statement.ts`
- Test: `backend/src/modules/kpi/bonus-statement.test.ts`

**Interfaces:**
- Consumes: `StatementSheet`, `buildStatement` (Task 3); `quarterLabel(q, "ru")` из `./tg/messages` (даёт `III квартал 2026`); `quarterMonths` из `./time`.
- Produces: `export async function renderStatementXlsx(sheets: StatementSheet[], tiers: Tier[], quarter: Period): Promise<Buffer>`.

Раскладка листа (сверху вниз, колонки A–J = `№ | ФИО | Филиал | Карта KPI | <мес1> | <мес2> | <мес3> | Средний % | По шкале, сум | К выдаче (CEO), сум`; названия месяцев — `Июл`, `Авг`… по `quarterMonths`):
1. A1 — `company` (жирный); H1:J1 — `Утверждаю: ____________ CEO`.
2. A2 — `ВЕДОМОСТЬ НА ВЫДАЧУ БОНУСОВ KPI` (жирный, 14 пт); H2:J2 — `«___» ____________ 20__ г.`
3. A3 — `${quarterLabel} (${мес1 полностью} – ${мес3 полностью})`, например `III квартал 2026 (июль – сентябрь)`.
4. A4 — `Шкала: от 75 % — 200 000 · от 85 % — 300 000 · от 95 % — 500 000 сум` (по возрастанию `min_pct`; без шкалы — `Шкала: не задана`).
5. Далее по строке на каждое предупреждение (красный текст), затем пустая строка, затем заголовок таблицы, строки `lines`, строка итога: в B `Итого: ${total_count} чел.`, в I `total_suggested`, J пустая.
6. Если `info` не пуст: пустая строка, заголовок `Не получают бонус в этом квартале (для сведения)`, подзаголовок `ФИО | Филиал | Средний % | Причина` (B, C, H, D–G объединены под причину — на усмотрение, лишь бы читалось), строки.
7. Пустая строка, затем `Подготовил: HR ____________ / ____________ /` (A) и `Утвердил: CEO ____________ / ____________ /` (G).

Печать: `pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: узкие }`, `printTitlesRow` = строка заголовка таблицы. Шрифт таблицы 10 пт, тонкие рамки у таблиц, перенос текста в B–D. Пустой `sheets` → лист `Ведомость` с A1 = текст пустого квартала.

- [ ] **Step 1: Failing tests** (книга читается обратно `new ExcelJS.Workbook().xlsx.load(buf)`):
  - `листы и имена совпадают со sheet_name`;
  - `A2 = "ВЕДОМОСТЬ НА ВЫДАЧУ БОНУСОВ KPI", A3 = "III квартал 2026 (июль – сентябрь)" для quarter "2026-07-01"`;
  - `строка сотрудника: B = ФИО, I = 300000 (число, numFmt "# ##0"), H = 87 (число, numFmt "0.00"), пустой месяц = "—", J пустая у proposed и "отказ" у rejected`;
  - `pageSetup: orientation "landscape", fitToWidth 1, printTitlesRow указывает на строку заголовка`;
  - `пустой вход → один лист "Ведомость", A1 = "За квартал нет расчёта. Нажмите «Пересчитать»."`.
- [ ] **Step 2:** Прогнать — FAIL.
- [ ] **Step 3:** Реализовать `renderStatementXlsx`.
- [ ] **Step 4:** Прогнать — PASS.
- [ ] **Step 5:** Сборка бинаря: `cd backend && bun build --compile --minify-whitespace --minify-syntax --target bun --outfile /tmp/kpi-app-check src/index.ts && rm /tmp/kpi-app-check`. Ожидается: без ошибок.
- [ ] **Step 6:** Commit `feat(kpi): Excel-ведомость на выдачу бонусов (exceljs)`.

### Task 5: Маршрут

**Files:**
- Modify: `backend/src/modules/kpi/routes/raises.ts` (после `/kpi/raises/export`)
- Create: `backend/src/modules/kpi/http/bonus-statement.test.ts` (guard и окружение — как в `raises.test.ts`)

**Interfaces:**
- Consumes: `listRaises`, `getTiers`, `parseQuarter` (`../raises`), `loadSettings` (`../settings`), `buildStatement`, `renderStatementXlsx` (Task 3–4).
- Produces: `GET /api/kpi/raises/statement?quarter=YYYY-MM-01`.

- [ ] **Step 1: Failing HTTP test** `bonus-statement.test.ts`: две организации (`ensureKpiOrg` и `makeOrganization`), по филиалу `makeTerminal(db, { organization_id })`, по сотруднику на каждом с оценками, которые дают бонус (карта с одним ручным пунктом, как в `raises.test.ts`); `compute`; затем:
  - `kpi.view` → 403; кривой квартал → 422;
  - `kpi.approve` → 200, content-type xlsx, `content-disposition: attachment; filename="kpi-bonuses-2025-Q3.xlsx"`;
  - книга: по листу на каждую организацию, сотрудник каждой — только на своём листе.
  - `afterAll`: `cleanupKpi`, `sweepTestRoles`, удалить созданную `makeOrganization` организацию и филиалы, если `cleanupKpi` их не трогает (проверить в `fixtures.ts:539`).
- [ ] **Step 2:** Прогнать — FAIL (404).
- [ ] **Step 3:** Маршрут: `requireAny(actor, ["kpi.approve"])`, `parseQuarter`, `listRaises`, `getTiers`, `loadSettings(drizzle).raise_min_months`, `renderStatementXlsx(buildStatement(...), tiers, quarter)`, `new Response(buf, { headers })`.
- [ ] **Step 4:** Прогнать файл — PASS.
- [ ] **Step 5:** Commit `feat(kpi): GET /kpi/raises/statement`.

### Task 6: Кнопка в админке

**Files:**
- Modify: `admin/lib/kpi-api.ts:382` — общий приватный `downloadFile(url, fetcher)`; `downloadRaisesCsv` и новый `downloadBonusStatement(quarter: string, fetcher?: typeof fetch): Promise<Blob>` через него.
- Modify: `admin/lib/kpi/periods.ts:75` — `bonusStatementFilename(q: string): string` → `kpi-bonuses-YYYY-QN.xlsx`.
- Modify: `admin/app/[locale]/kpi/raises/page.tsx` — кнопка `t("exportStatement")` рядом с CSV, видна при `access.approve`; общий обработчик скачивания для CSV и ведомости (busy-флаг на кнопку).
- Modify: `admin/messages/{ru,en,uz-Latn,uz-Cyrl}.json` (`kpiScreens.raises.exportStatement`: ru `Ведомость (Excel)`, en `Payout sheet (Excel)`, uz-Latn `Qaydnoma (Excel)`, uz-Cyrl `Қайднома (Excel)`); дубль в `admin/lib/kpi/ru.ts`, если там есть `kpiScreens.raises`.
- Test: `admin/lib/kpi-api.test.ts`, `admin/lib/kpi/periods.test.ts`

- [ ] **Step 1: Failing tests:** `downloadBonusStatement` зовёт `/api/kpi/raises/statement?quarter=2026-10-01` с `credentials: "include"`, ошибки как у CSV (сеть → `network`, 403 → `forbidden`); `bonusStatementFilename` для 4 кварталов 2026 → `kpi-bonuses-2026-Q1.xlsx` … `Q4`.
- [ ] **Step 2:** `cd admin && bun run test` — FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** `cd admin && bun run test` — PASS; `bun lint` — без новых ошибок; `npx tsc --noEmit -p .` если в проекте принято (иначе пропустить и сказать).
- [ ] **Step 5:** Commit `feat(kpi): кнопка «Ведомость (Excel)» на экране бонусов`.

### Task 7: «Повышение / прибавка» → «бонус» в текстах

**Files:**
- Modify: `admin/messages/{ru,en,uz-Latn,uz-Cyrl}.json`, `admin/lib/kpi/ru.ts`, `admin/lib/kpi/access.ts:32`
- Modify: `backend/src/modules/kpi/tg/messages.ts:263-279` (`raiseApproved`), `backend/src/modules/kpi/seed-permissions.ts:11`
- Test: `backend/src/modules/kpi/tg/messages.test.ts:69-71,144`; тесты, где сверяются эти строки (`grep -rln "Прибавк\|прибавк\|Повышени\|oshir" backend/src admin/lib` по `*.test.ts`)

Охват ru: все вхождения «Повышения/повышение/повышения/прибавка/прибавки» в KPI-ключах `admin/messages/ru.json` (строки ~1044, 1135, 2548, 2802, 2823, 3126–3132, 3561–3587, 3925–3974) → «Бонусы/бонус/бонуса/бонус…», с правильным склонением. «Потолок повышения» → «Потолок бонуса». **Не трогать** «Уровень повышен» (~4379, 4495) и всё вне KPI. en: `raise` → `bonus`. uz: `oshirish`/`qoʻshimcha` в KPI-ключах → `bonus` (`bonuslar`, `bonussiz`); проверить, что `qo'shimcha` в других смыслах («дополнительно») не задет.

Telegram (точно):
- ru > 0: `<b>Бонус KPI: ${q}</b>\nРешение HR: ${sum} сум.`
- uz > 0: `<b>KPI bonusi: ${q}</b>\nHR qarori: ${sum} soʻm.`
- 0: `без бонуса.` / `bonussiz.` (заголовок «Итоги квартала» не меняется).

- [ ] **Step 1:** Поправить ожидания в `messages.test.ts` под новые тексты — FAIL.
- [ ] **Step 2:** Поправить `raiseApproved` — `bun test src/modules/kpi/tg/messages.test.ts` PASS.
- [ ] **Step 3:** Тексты admin и `access.ts`, `ru.ts`, `seed-permissions.ts`. После: `grep -n -i "повышен\|прибавк" admin/messages/ru.json admin/lib/kpi/ru.ts admin/lib/kpi/access.ts` — остаются только «Уровень повышен».
- [ ] **Step 4:** Обновить тесты, которые сверяют старые строки; `cd admin && bun run test` PASS; backend: `bun test src/modules/kpi/tg src/modules/kpi/tg-app` PASS.
- [ ] **Step 5:** Commit `chore(kpi): «повышение» → «бонус» в текстах интерфейса и Telegram`.

### Task 8: Полная проверка

- [ ] **Step 1:** `cd backend && TEST_DATABASE_URL=… bun run test:http:kpi` — 0 fail (два раза подряд, см. Review Focus 5). Юнит: `bun test src/modules/kpi --path-ignore-patterns 'src/modules/kpi/http/**'` (или перечислить файлы) — 0 fail.
- [ ] **Step 2:** `cd admin && bun run test && bun lint`.
- [ ] **Step 3:** Собрать ведомость на тестовых данных, открыть в Numbers/Excel, посмотреть предпросмотр печати: лист по ширине A4, заголовок повторяется. Скриншот в отчёт.
