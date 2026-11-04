# KPI: споры автора, филиалы оценщика, техничка Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Спор разбирает автор записи (или текущий оценщик, если назначение автора снято), оценщику можно дать любое число филиалов и карт одной формой, у техничек появляются роль и карта.

**Architecture:** Правило «кто разбирает» живёт в одной функции `mayResolve` в `disputes.ts` и используется и разбором, и признаком `can_resolve`. Массовое назначение выносится из роута в сервис `kpi/evaluators.ts` под тем же advisory-замком. Роль `cleaner` добавляется в каталог и в общий разбор должности, а прод получает её разовым скриптом с сухим прогоном по образцу `staff_roles/backfill.ts`.

**Tech Stack:** Bun, Elysia, Drizzle/PostgreSQL, Next.js 15 (admin), `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-04-kpi-hr-feedback-design.md` (пункты 1, 2, 3, 4).

**Worktree:** `wt switch --create kpi-admin-scopes --base feature/kpi-hr-feedback` из `/Users/macbookpro/development/managers-kpi`. Поток независим от `kpi-tg-evaluator` и `kpi-tg-attendance`; сливается первым.

## Global Constraints

- Тесты бэкенда идут только на `managers_tickets_test`: `cd backend && TEST_DATABASE_URL=<url на managers_tickets_test> bun run test:http:kpi`. Локальную базу `managers` не мигрируем и не трогаем.
- Новых прав доступа не заводим. Управляющим `kpi.manage` не выдаём; право на `/kpi/evaluators` остаётся `kpi.manage`.
- Прод и данные HR не трогаем: скрипт ролей пишет только с флагом `--apply`, по умолчанию сухой прогон.
- Ночную синхронизацию Workly не ставим на паузу; деплой днём, скрипт (сухой, потом `--apply`) до первой ночной сверки в 03:30 Asia/Tashkent.
- Узбекские тексты (uz-Latn, uz-Cyrl) пишутся черновиком; в описании PR отмечено, что носитель их не проверял.
- Коммиты: только свои файлы по явному pathspec, никогда `git add -A`. Сообщения на русском, conventional, последней строкой `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Общие файлы с другими потоками (`kpi_miniapp/src/i18n.ts`, `backend/src/modules/kpi/tg-app/types.ts`) этот поток не трогает.

## Review Focus

- Автор спора снят с назначения, а сотрудник перешёл в другой филиал: назначение нового оценщика покрывает его только по текущему филиалу. Ожидание: он разбирает (покрытие считается по текущему положению ИЛИ по снимку записи). Тест в Task 1.
- Автор потерял право `kpi.evaluate` в роли, но его назначение осталось: спор не разбирает никто. Это известный пробел (чужие права в сервисе не читаются); выход один: снять назначение автора. Фиксируется тестом, что после снятия назначения спор уходит текущему оценщику (Task 1), и строкой в описании PR.
- Одновременные одинаковые POST с массивами: дублей быть не должно. Тест на три параллельных вызова в Task 3.
- Массив с повторяющимися значениями и массив из 600 комбинаций: первое дедуплицируется, второе отвечает 422 `too_many`. Тесты в Task 3.
- Должности «Техничка зала», «техничка (мойка)», «ТЕХНИЧКА» разбираются в `cleaner`, а «Работник зала» и «Мойка» остаются прежними. Тест в Task 5.

---

### Task 1: Спор разбирает автор

**Files:**
- Modify: `backend/src/modules/kpi/access.ts` (добавить `loadScopesByUser`)
- Modify: `backend/src/modules/kpi/disputes.ts` (`mayResolve`, `authorOf`, `toRows`, `resolveDispute`, `listDisputes`)
- Modify: `backend/src/modules/kpi/http/disputes.test.ts`

**Interfaces:**
- Produces: `loadScopesByUser(db: DbLike, userIds: string[]): Promise<Map<string, Scope[]>>` в `access.ts`; в `disputes.ts` внутренние `authorOf(d: DRow, l: Loaded): string | null` и
  `mayResolve(a: { actor: Actor; actorScopes: Scope[]; authorId: string | null; authorScopes: Scope[]; emp: DirEmployee | undefined; snapshot: Subject | null }): boolean`.
- `mayHandle` остаётся как есть и обслуживает только `openDispute`.

Правило `mayResolve`: нужен `has(actor, "kpi.evaluate")`; цели покрытия это текущий `emp` и `snapshot` (непустые); `covers(scopes)` значит «`scopeCovers` хотя бы по одной цели». Если `authorId === actor.userId`, результат `covers(actorScopes)`. Иначе результат `!covers(authorScopes) && covers(actorScopes)`. `kpi.approve` права разбирать не даёт.

- [ ] **Step 1: Переписать существующие тесты, где разбирает HR**

В `disputes.test.ts` найти все места, где сессия с `permissions: ["kpi.approve"]` вызывает `resolve`/`resolveDispute` или ожидает `can_resolve: true` (около строк 276, 405, 507, 525, 575, 621 и `can_resolve` на 124, 227, 454, 495–508). Там, где HR разбирал, спор теперь разбирает автор-оценщик; там, где проверялся «HR может», ожидание меняется на `403 { error: "out_of_scope" }` и `can_resolve === false`. Содержательные проверки теста (статусы, события, уведомления) сохранить.

- [ ] **Step 2: Написать новые падающие тесты** в том же файле, внутри `describe`:

```ts
it("спор разбирает автор; другой оценщик с тем же охватом не может, пока автор покрывает", async () => {
  await resetPeriod(); setNow(NOW);
  const e = await cook();
  const author = await evaluator(e.terminal_id);
  const other = await evaluator(e.terminal_id);
  const d = (await dispute(author, "review", await submitted(author, e.id))).body as DisputeRow;
  expect((await resolve(other, d.id, { decision: "rejected", comment: "Чужой разбор" })).body).toEqual({ error: "out_of_scope" });
  expect((await resolve(author, d.id, { decision: "rejected", comment: "Оценка верна" })).status).toBe(200);
});

it("после снятия назначения автора спор уходит текущему оценщику; автор его видит, но разобрать не может", async () => {
  /* автор и второй оценщик на одном филиале; спор открыт; удалить строки kpi_evaluator_scopes автора
     через db.delete(kpi_evaluator_scopes).where(eq(kpi_evaluator_scopes.user_id, author.userId)) */
  // GET /api/kpi/disputes у автора: спор есть, can_resolve === false; resolve у автора → 403 out_of_scope
  // у второго: can_resolve === true; resolve → 200
});

it("HR с kpi.approve спор видит, can_resolve === false, разобрать не может", async () => {
  // список у HR содержит спор; resolve → 403 out_of_scope
});

it("покрытие по снимку записи: сотрудник перешёл в другой филиал, оценщик старого филиала всё ещё разбирает", async () => {
  // обновить employees.terminal_id сотрудника на другой филиал; автор со scope старого филиала → can_resolve true
});
```

- [ ] **Step 3: Запустить и убедиться, что падают**

Run: `cd backend && bun run test:http:kpi 2>&1 | grep -E "disputes|fail|pass" | tail -20` (тестовую `TEST_DATABASE_URL` задать).
Expected: новые тесты и переписанные ожидания FAIL.

- [ ] **Step 4: Реализовать**

`loadScopesByUser` в `access.ts` одним запросом `inArray(user_id, ids)`, группирует по пользователю; пустой список возвращает пустую карту без запроса. В `disputes.ts`: `authorOf` берёт `kpi_reviews.evaluator_user_id` или `kpi_violations.recorded_by` из `Loaded`; `toRows` подгружает `loadScopesByUser(db, авторы)` один раз и считает `can_resolve` через `mayResolve`; `resolveDispute` вместо `canHandle` вызывает `mayResolve` (автора и его назначения грузит из `tx`), ошибка прежняя `403 out_of_scope`; `listDisputes` в фильтре видимости добавляет `authorOf(r, l) === actor.userId ||` перед `canSeeEither`. Старую `canHandle` удалить, если больше не используется.

- [ ] **Step 5: Запустить и убедиться, что проходят**

Run: `cd backend && bun run test:http:kpi 2>&1 | tail -15`
Expected: весь набор `kpi/http` зелёный (было 271 тест; число вырастет).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/kpi/access.ts backend/src/modules/kpi/disputes.ts backend/src/modules/kpi/http/disputes.test.ts
git commit -m "feat(kpi): спор разбирает автор записи, при снятии назначения автора — текущий оценщик"
```

### Task 2: Спека KPI: разбор автором и прибавка по кварталу

**Files:**
- Modify: `docs/superpowers/specs/2026-10-25-kpi-design.md` (раздел 7.5 и место про прибавку)

- [ ] **Step 1:** В разделе 7.5 заменить формулировки «Кто разбирает: оценщик, у которого сотрудник в назначениях; HR (`kpi.approve`)» и «оценщик или HR, кто ответил первым» на правило из `2026-11-04-kpi-hr-feedback-design.md` п. 1: разбирает автор, пока он покрывает сотрудника назначением; иначе текущий оценщик сотрудника; HR спор видит, но не разбирает.
- [ ] **Step 2:** Рядом с описанием прибавки (раздел про шкалу прибавки) добавить одну фразу: «Месяцы дают балл; прибавка начисляется или не начисляется по итогу квартала».
- [ ] **Step 3:** Проверить прозу: `python3 -I "/Users/macbookpro/.claude/plugins/cache/sloptrim/sloptrim/0.9.1/scripts/detect.py" docs/superpowers/specs/2026-10-25-kpi-design.md` — `ai_tell_score` не хуже прежнего.
- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-25-kpi-design.md
git commit -m "docs(kpi): в спеке спор разбирает автор, прибавка по итогу квартала"
```

### Task 3: Массовое назначение оценщику

**Files:**
- Create: `backend/src/modules/kpi/evaluators.ts`
- Modify: `backend/src/modules/kpi/routes/evaluators.ts` (POST)
- Test: `backend/src/modules/kpi/http/cards.test.ts` (блок «назначение»), при желании новый `evaluators.test.ts` рядом по образцу его guard-шапки

**Interfaces:**
- Produces: `assignScopes(db: DbLike, input: { user_id: string; card_ids: string[]; terminal_ids: string[]; created_by: string }): Promise<{ created: number; skipped: number }>`; пустой `card_ids` или `terminal_ids` означает «все» и пишется как `null`. Для обоих пустых получается одна строка `null/null`.
- Route: `POST /kpi/evaluators` — если в теле есть `card_ids` или `terminal_ids`, идёт новый путь и ответ `{ created: number; skipped: number }`; иначе прежний путь и прежний ответ (одна строка, `409 scope_exists` на дубликат).

- [ ] **Step 1: Написать падающие тесты** (HTTP, сессия `withSession({ permissions: ["kpi.manage"] })`, оценщик `withSession({ permissions: ["kpi.evaluate"] })`):

```ts
it("массив филиалов × карт: создаёт все комбинации, повтор пропускает", async () => {
  // филиалы t1,t2 × карты c1,c2 → { created: 4, skipped: 0 }; тот же запрос → { created: 0, skipped: 4 }
  // филиалы t1,t2,t3 × карты c1,c2 → { created: 2, skipped: 4 }; GET /api/kpi/evaluators: у пользователя 6 строк
});
it("пустые массивы — «все»: одна строка null/null; повтор — skipped 1", async () => {});
it("дубликаты внутри массива схлопываются; 600 комбинаций — 422 too_many", async () => {
  // terminal_ids из 30 uuid × card_ids из 20 uuid → status 422, body { error: "too_many" }
});
it("плохой uuid — 422 bad_id; чужая карта — 422 unknown_card; без kpi.manage — 403", async () => {});
it("три параллельных одинаковых запроса не создают дублей", async () => {
  // после Promise.all в GET /api/kpi/evaluators ровно ожидаемое число строк у пользователя
});
it("прежний формат с одиночными card_id/terminal_id работает без изменений", async () => {
  // существующие проверки cards.test.ts (дубликат 409 scope_exists) остаются зелёными
});
```

- [ ] **Step 2: Запустить, убедиться, что падают**

Run: `cd backend && bun run test:http:kpi 2>&1 | grep -E "evaluators|назначени|fail" | tail`
Expected: FAIL (новый путь не существует).

- [ ] **Step 3: Реализовать `assignScopes`** в `kpi/evaluators.ts`: дедуп входа, лимит 500 комбинаций (`KpiError(422, "too_many")`), проверка uuid (`bad_id`) и существования карт (`unknown_card`), затем одна транзакция с `pg_advisory_xact_lock(hashtext('kpi_scope:' || user_id))` (тот же ключ, что в роуте), для каждой пары та же проверка дубликата, что в существующем коде, и вставка недостающих. Роут выносит общую валидацию uuid в импорт из этого же файла, чтобы не дублировать `UUID_RE`; прежний путь не менять.
- [ ] **Step 4: Запустить, убедиться, что проходят** — `cd backend && bun run test:http:kpi 2>&1 | tail -15` — всё зелёное, в том числе существующие тесты назначения.
- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/kpi/evaluators.ts backend/src/modules/kpi/routes/evaluators.ts backend/src/modules/kpi/http/cards.test.ts
git commit -m "feat(kpi): оценщику можно назначить несколько филиалов и карт одним запросом"
```

### Task 4: Админка: форма и таблица назначений

**Files:**
- Modify: `admin/lib/kpi-api.ts` (тип и метод)
- Modify: `admin/lib/kpi-api.test.ts` (строка таблицы вызовов)
- Modify: `admin/lib/kpi/settings.ts` (`groupScopes`) и `admin/lib/kpi/settings.test.ts`
- Create: `admin/app/[locale]/kpi/_components/multi-select.tsx`
- Modify: `admin/app/[locale]/kpi/settings/_components/evaluators-tab.tsx`
- Modify: `admin/messages/ru.json`, `en.json`, `uz-Latn.json`, `uz-Cyrl.json` (блок `kpi.settings.evaluators`)

**Interfaces:**
- Consumes: `POST /kpi/evaluators` с массивами из Task 3, ответ `{ created: number; skipped: number }`.
- Produces: `kpiApi.evaluators.createMany(b: { user_id: string; card_ids: string[]; terminal_ids: string[] }): Promise<{ created: number; skipped: number }>`;
  `groupScopes(rows: ScopeRow[]): ScopeGroup[]` где `ScopeGroup = { user_id: string; user_name: string; rows: ScopeRow[] }`, группы по `user_name` (ru-локаль), строки внутри группы по `created_at`;
  `MultiSelect(props: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; allLabel: string; ariaLabel: string; disabled?: boolean })` — пустой `value` отображается как `allLabel`.

- [ ] **Step 1: Падающие тесты**

В `kpi-api.test.ts` добавить строку таблицы:
`["evaluators.createMany", (a) => a.evaluators.createMany({ user_id: "u1", card_ids: ["c1"], terminal_ids: ["t1", "t2"] }), "POST", "/api/kpi/evaluators", { user_id: "u1", card_ids: ["c1"], terminal_ids: ["t1", "t2"] }]`.
В `settings.test.ts`: `groupScopes` на трёх строках двух людей возвращает две группы в алфавитном порядке, у человека с шестью филиалами `rows.length === 6`, порядок строк по `created_at`.

- [ ] **Step 2: Запустить**

Run: `cd admin && bun test ./lib/kpi/settings.test.ts ./lib/kpi-api.test.ts`
Expected: FAIL (`createMany`, `groupScopes` не определены).

- [ ] **Step 3: Реализовать** `createMany` и `groupScopes` по сигнатурам выше.
- [ ] **Step 4: Запустить** — те же команды, PASS.
- [ ] **Step 5: Реализовать интерфейс.** `MultiSelect` на `Popover` + `Command` из `admin/components/ui` (чекбоксы-галочки в списке, кнопка-триггер высотой `h-11`, как остальные селекты; текст кнопки: `allLabel` при пустом выборе, иначе названия до двух штук и «+N»). `AssignForm` заменяет два `Select` на два `MultiSelect` («Все карты», «Все филиалы»), вызывает `createMany`, по успеху показывает `toast.success` с числами создано/уже было и сбрасывает форму. Таблица группируется через `groupScopes`: одна строка на человека, в ячейке охвата список строк `scopeLabel` с кнопкой «Убрать» у каждой (удаление по-прежнему по `id` строки), Telegram-ячейка человека одна. Новые ключи в четырёх файлах сообщений: `assignedMany` («Назначений создано: {created}, уже были: {skipped}»), `allCards`, `allTerminals`; ru и en заполнить смыслом, узбекские — черновиком.
- [ ] **Step 6: Проверка**

Run: `cd admin && bun test ./lib/kpi ./lib/kpi-api.test.ts && bunx tsc --noEmit -p tsconfig.json 2>&1 | tail -5`
Expected: тесты зелёные, `tsc` без новых ошибок (сравнить с `git stash`-базой, если есть старые). Затем посмотреть экран «Настройки → Оценщики» на ширине 390 px в Chrome на стенде `managers_kpi_smoke` (как поднять стенд, см. `docs/superpowers/kpi-handoff.md`): выбрать шесть филиалов, одну карту, назначить, убедиться, что таблица показывает одну строку человека с шестью охватами.
- [ ] **Step 7: Commit**

```bash
git add admin/lib/kpi-api.ts admin/lib/kpi-api.test.ts admin/lib/kpi/settings.ts admin/lib/kpi/settings.test.ts "admin/app/[locale]/kpi/_components/multi-select.tsx" "admin/app/[locale]/kpi/settings/_components/evaluators-tab.tsx" admin/messages/ru.json admin/messages/en.json admin/messages/uz-Latn.json admin/messages/uz-Cyrl.json
git commit -m "feat(kpi-admin): назначение оценщика на несколько филиалов и карт, таблица по людям"
```

### Task 5: Роль «Техничка» в каталоге и в разборе должности

**Files:**
- Modify: `backend/src/modules/terminals/position.ts` (`roleOf`, `groupOf`)
- Modify: `backend/src/modules/staff_roles/catalog.ts` (`SEED_ROLES`, `PARSE_NAME_BY_CODE`)
- Create: `backend/src/modules/terminals/position.test.ts`

**Interfaces:**
- Produces: код роли `cleaner`; `parsePosition("Техничка").role === "Техничка"`, `ROLE_CODE_BY_PARSE_NAME["Техничка"] === "cleaner"`.

- [ ] **Step 1: Падающий тест** `position.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { ROLE_CODE_BY_PARSE_NAME, SEED_ROLES, composePosition } from "../staff_roles/catalog";
import { parsePosition } from "./position";

describe("parsePosition: техничка", () => {
  it.each(["Техничка", "ТЕХНИЧКА", "Техничка зала", "техничка (мойка)", "Техничка 2 разряд день"])("«%s» → cleaner", (p) => {
    expect(ROLE_CODE_BY_PARSE_NAME[parsePosition(p).role]).toBe("cleaner");
    expect(parsePosition(p).group).toBe("other");
  });
  it("зал и мойка остались прежними", () => {
    expect(ROLE_CODE_BY_PARSE_NAME[parsePosition("Работник зала").role]).toBe("hall_worker");
    expect(ROLE_CODE_BY_PARSE_NAME[parsePosition("Мойка").role]).toBe("kitchen_worker");
  });
  it("роль есть в каталоге и собранная строка разбирается обратно", () => {
    const r = SEED_ROLES.find((x) => x.code === "cleaner")!;
    expect(r.name_ru).toBe("Техничка");
    expect(ROLE_CODE_BY_PARSE_NAME[parsePosition(composePosition(r.name_ru, 2, "day")).role]).toBe("cleaner");
  });
});
```

- [ ] **Step 2: Запустить**

Run: `cd backend && bun test src/modules/terminals/position.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать.** `roleOf`: сразу после блока стажёров добавить `if (/техничк/.test(s)) return "Техничка";` (раньше «менеджер», «кассир», «мойк», «зал»). `groupOf`: первой строкой `if (/техничк/.test(s)) return "other";`. `PARSE_NAME_BY_CODE.cleaner = "Техничка"`. В `SEED_ROLES` добавить `{ code: "cleaner", name_ru: "Техничка", name_uz: "Farrosh", group_key: "other", is_trainee: false, trainee_of_code: null, sort: 140, synonyms: [] }` (имя `Farrosh` то же, что у карты `cleaner` в `seed-data.ts`).
- [ ] **Step 4: Запустить** — `cd backend && bun test src/modules/terminals/position.test.ts` PASS. Затем `cd backend && bun run test:http:kpi` — зелёный (разбор общий для карты сети, табло и воркера).
- [ ] **Step 5: Проверить потребителей.** Прочитать `terminals/network-map.ts` и `terminals/staff-board.ts` и убедиться, что роль `cleaner` с группой `other` у них попадает в «прочее», а не ломает счётчики; если там перечислены роли поимённо, добавить `cleaner`. Результат записать в описании PR одной строкой.
- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/terminals/position.ts backend/src/modules/terminals/position.test.ts backend/src/modules/staff_roles/catalog.ts
git commit -m "feat(staff-roles): роль «Техничка» в каталоге и в разборе должности"
```

### Task 6: Карта «Техничка» привязана к роли

**Files:**
- Modify: `backend/src/modules/kpi/seed-data.ts` (у карты `cleaner` поле `staff_role_codes`)
- Test: `backend/src/modules/kpi/http/cards.test.ts`

- [ ] **Step 1: Падающий тест** рядом с «seedCards идемпотентна»: после `seedCards` у карты `cleaner` `staff_role_codes` равен `["cleaner"]`; сотрудник, созданный через `makeEmployee(db, { role_code: "cleaner" })` (роль гарантирует `ensureStaffRole` из `fixtures.ts`; если он не знает `cleaner`, добавить роль вручную в тесте через вставку в `staff_roles`), в `GET /api/kpi/employees` под сессией `kpi.manage` имеет `card.code === "cleaner"` и `card_source === "role"`, без ручного назначения.
- [ ] **Step 2: Запустить** — FAIL (`staff_role_codes` пуст).
- [ ] **Step 3: Реализовать:** в `seed-data.ts` у карты `cleaner` заменить `staff_role_codes: []` на `["cleaner"]`. Сид только вставляет отсутствующие карты, поэтому прод получает поле скриптом из Task 7.
- [ ] **Step 4: Запустить** — `cd backend && bun run test:http:kpi` зелёный; существующий тест «ручная карта: техничка по назначению HR» остаётся зелёным (ручное назначение сильнее роли).
- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/kpi/seed-data.ts backend/src/modules/kpi/http/cards.test.ts
git commit -m "feat(kpi): карта «Техничка» подхватывается по роли cleaner"
```

### Task 7: Разовый скрипт для прода

**Files:**
- Create: `backend/src/modules/staff_roles/cleaner-plan.ts` (чистая функция)
- Create: `backend/src/modules/staff_roles/cleaner-plan.test.ts`
- Create: `backend/src/modules/staff_roles/cleaner-backfill.ts` (запуск по образцу `backfill.ts`)

**Interfaces:**
- Produces: `planCleaners(rows: { id: string; position: string | null; staff_role_id: string | null }[], cleanerRoleId: string): { assign: string[]; review: { id: string; position: string | null; staff_role_id: string }[] }` — `assign` это id сотрудников без роли с должностью, содержащей «техничк» (без учёта регистра); `review` это сотрудники, у которых роль уже стоит (не `cleanerRoleId`), а должность содержит «техничк».

- [ ] **Step 1: Падающий тест** `cleaner-plan.test.ts`: четыре строки (без роли + «Техничка»; без роли + «Повар»; с ролью hall_worker + «Техничка зала»; с ролью cleaner + «Техничка») дают `assign === [id1]`, `review === [id3]`; регистр «ТЕХНИЧКА» засчитывается.
- [ ] **Step 2: Запустить** — `cd backend && bun test src/modules/staff_roles/cleaner-plan.test.ts` FAIL.
- [ ] **Step 3: Реализовать `planCleaners`** и скрипт `cleaner-backfill.ts`. Скрипт: без `--apply` ничего не пишет и печатает отчёт (сколько `assign`, список `review` с позициями); с `--apply` в одной транзакции (1) вставляет роль `cleaner` из `SEED_ROLES`, если её нет, (2) дописывает `"cleaner"` в `kpi_cards.staff_role_codes` карты с кодом `cleaner`, если там нет, (3) проставляет `staff_role_id` из `assign`. Карты сотрудникам скрипт не назначает (они вычисляются из роли), `position` не переписывает: ночная сверка Workly делает это сама.
- [ ] **Step 4: Запустить тест** — PASS. Сам скрипт на `managers_tickets_test` не гонять без запроса: он читает `DATABASE_URL` из окружения, проверка идёт на проде владельцем (сухой прогон), здесь только компиляция: `cd backend && bun build src/modules/staff_roles/cleaner-backfill.ts --target=bun --outfile=/dev/null`.
- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/staff_roles/cleaner-plan.ts backend/src/modules/staff_roles/cleaner-plan.test.ts backend/src/modules/staff_roles/cleaner-backfill.ts
git commit -m "feat(staff-roles): разовый скрипт роли «Техничка» с сухим прогоном"
```

### Task 8: Итоговая проверка потока

- [ ] **Step 1:** `cd backend && bun run test:http:kpi && cd ../admin && bun test ./lib/kpi ./lib/kpi-api.test.ts` — зелёные.
- [ ] **Step 2:** Прогнать `bun test src/modules/staff_roles src/modules/terminals/position.test.ts` из `backend/`.
- [ ] **Step 3:** В описании PR перечислить: известный пробел про автора без `kpi.evaluate`, порядок выкладки (деплой днём → скрипт сухой → `--apply` → до 03:30), проверку потребителей роли из Task 5, узбекские тексты без проверки носителем.
