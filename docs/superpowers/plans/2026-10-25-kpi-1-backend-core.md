# KPI — План 1: ядро backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Модуль `backend/src/modules/kpi`: карты оценки, назначения оценщиков, месячные оценки с историей, нарушения с фото, споры, закрытие месяца, квартальные повышения и исходящие уведомления (только запись).

**Architecture:** Как inventory: `controller.ts` монтирует плагины роутов из `routes/*.ts`, бизнес-логика в сервисах, чистые правила в `time.ts` и `rules.ts` с юнит-тестами. Ошибки — `KpiError(status, code)` и `run(set, fn)`. Контроллер регистрируется в `backend/src/app.ts` как `as unknown as Elysia`. Тесты уровня HTTP идут через `backend/tests/helpers/http.ts` на базе `managers_tickets_test`.

**Tech Stack:** Bun 1.4, Elysia 1.4, Drizzle ORM 0.44 / drizzle-kit 0.31, PostgreSQL, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-25-kpi-design.md` (разделы 5–9, 13, 14)

## Global Constraints

- Рабочая копия `/Users/macbookpro/development/managers-kpi`, ветка `feature/kpi`. Все команды отсюда. Каталог `/Users/macbookpro/development/managers` не трогать.
- Коммитить только свои файлы поимённо. `git add -A` и `git add .` запрещены. Никаких `git push`, ssh, pm2, деплоя.
- Локальную базу `managers` не мигрировать и не писать в неё: она устарела. Миграции и тесты — только `managers_tickets_test`. Строка подключения собирается так (не печатать её, в ней пароль):
  ```bash
  cd backend && export TEST_DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | sed -E 's#/managers(\?.*)?$#/managers_tickets_test#')
  case "$TEST_DATABASE_URL" in *managers_tickets_test) ;; *) echo "не тестовая база"; exit 1;; esac
  ```
- Модуль регистрируется в `backend/src/app.ts` перед `.use(apiController)`, экспорт `export const kpiController = kpiControllerImpl as unknown as Elysia;`. В `controllers.ts` не регистрировать.
- Статусы — `varchar`, не `pgEnum`. `id: uuid("id").defaultRandom().primaryKey().notNull()`, время `timestamp(..., { withTimezone: true, mode: "string" })`, даты `date(..., { mode: "string" })`, деньги `numeric(18,2)`, проценты `numeric(5,2)`. Ответы API отдают числа, не строки numeric.
- Время: Asia/Tashkent = UTC+5 без перехода на летнее время. Период — строка `YYYY-MM-01`.
- Ошибки API: `{ error: "<code>", ...extra }` с HTTP-статусом. Неверный ввод — 422, нет прав — 403, нет объекта — 404, конфликт состояния — 409.
- Никаких реальных имён и зарплат в коде и фикстурах. Фикстуры: «Тест Повар», «Тест Кассир».
- Комментарии в коде — по-русски, коротко, как в соседних модулях.
- Описание права не длиннее 60 символов.
- Проверка типов: `admin/node_modules/.bin/tsc --noEmit -p backend --incremental false 2>&1 | grep modules/kpi` не печатает ничего.
- Юнит-тесты: `cd backend && bun test src/modules/kpi/*.test.ts`. HTTP-тесты: `cd backend && bun run test:http:kpi` (скрипт появляется в задаче 4).

## Review Focus

1. Кривой период (`2026-13-01`, `2026-10-15`, пустая строка) в любом query или body → 422 `bad_period`, не 500. Тест в задаче 4 (`/kpi/periods/2026-10-15` → 422) и в задаче 6 (`/kpi/reviews?period=x` → 422).
2. Двойная отправка формы или два оценщика сразу → upsert по `(period, employee_id)`, второй запрос не падает в 500. Тест в задаче 6: два параллельных `PUT /kpi/reviews/draft` — оба 200, строка одна.
3. Пункт карты отключили после отправки оценки → форма отправленной оценки показывает снимок, процент не меняется. Тест в задаче 6.
4. Комментарий из одних пробелов при изменении или споре → 422 `comment_required`. Тест в задачах 6 и 8.
5. Фото: не JPEG/PNG, больше 10 МБ, больше 3 штук, чужой или кривой id → 422/404, файл чужого филиала не отдаётся. Тесты в задаче 7.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `backend/drizzle/schema.ts` (правка, в конец) | Таблицы `kpi_*` фазы 1 |
| `backend/drizzle/migrations/0035_kpi_core.sql` + `meta/` | Миграция |
| `backend/src/modules/kpi/time.ts` + `.test.ts` | Периоды, сроки, кварталы по Ташкенту |
| `backend/src/modules/kpi/rules.ts` + `.test.ts` | Процент оценки, карта сотрудника, назначения, шкала повышения, настройки |
| `backend/src/modules/kpi/clock.ts` | `now()` с подменой только в тестовом окружении |
| `backend/src/modules/kpi/errors.ts` | `KpiError`, `run` |
| `backend/src/modules/kpi/access.ts` | `Actor`, `actorFrom`, проверки прав и видимости |
| `backend/src/modules/kpi/settings.ts` | Чтение и запись `kpi_settings` |
| `backend/src/modules/kpi/notify.ts` | Запись `kpi_notifications` в транзакции |
| `backend/src/modules/kpi/types.ts` | Типы ответов для админки |
| `backend/src/modules/kpi/seed-data.ts` | Стартовые карты и шкала (точный текст) |
| `backend/src/modules/kpi/seed-cards.ts` | Идемпотентная загрузка `seed-data` |
| `backend/src/modules/kpi/seed-permissions.ts` | Права |
| `backend/src/modules/kpi/directory.ts` | Сотрудники с действующей картой, имена филиалов и пользователей |
| `backend/src/modules/kpi/reviews.ts` | Форма, черновик, отправка, изменение, история |
| `backend/src/modules/kpi/storage.ts` | Фото нарушений на диске |
| `backend/src/modules/kpi/violations.ts` | Журнал нарушений |
| `backend/src/modules/kpi/disputes.ts` | Споры |
| `backend/src/modules/kpi/periods.ts` | Сводка месяца, закрытие, открытие |
| `backend/src/modules/kpi/raises.ts` | Шкала, расчёт квартала, решения, CSV |
| `backend/src/modules/kpi/routes/*.ts` | Плагины роутов по разделам |
| `backend/src/modules/kpi/controller.ts` | Сборка плагинов, префикс `/api` |
| `backend/src/modules/kpi/http/fixtures.ts` | Общие фикстуры HTTP-тестов |
| `backend/src/modules/kpi/http/*.test.ts` | HTTP-тесты по разделам |
| `backend/src/app.ts` (правка) | Регистрация |
| `backend/package.json` (правка) | Скрипт `test:http:kpi` |

---

### Task 1: Таблицы и миграция 0035

**Files:**
- Modify: `backend/drizzle/schema.ts` (дописать в конец файла)
- Create: `backend/drizzle/migrations/0035_kpi_core.sql`, `backend/drizzle/migrations/meta/0035_snapshot.json`, правка `meta/_journal.json` (всё генерирует drizzle-kit)

**Interfaces:**
- Produces: экспорты `kpi_cards`, `kpi_card_items`, `kpi_employee_cards`, `kpi_evaluator_scopes`, `kpi_periods`, `kpi_settings`, `kpi_reviews`, `kpi_review_items`, `kpi_review_events`, `kpi_violations`, `kpi_violation_photos`, `kpi_disputes`, `kpi_raise_tiers`, `kpi_raise_decisions`, `kpi_notifications` из `backend/drizzle/schema`.

Колонки — строго по разделам 6.1–6.8 спеки. Уточнения:

| Таблица | Ключи и индексы |
|---|---|
| `kpi_cards` | `uniqueIndex("kpi_cards_code_uq").on(code)`; `staff_role_codes text[] default '{}' not null` |
| `kpi_card_items` | `card_id uuid not null references kpi_cards.id`; `index("kpi_card_items_card_idx").on(card_id)`; `source varchar(20) default 'manual'`, `group_key varchar(20) default 'base'`, `weight integer default 1` |
| `kpi_employee_cards` | `employee_id uuid primaryKey`; `card_id uuid` nullable (null = «не оценивается») |
| `kpi_evaluator_scopes` | `index("kpi_evaluator_scopes_user_idx").on(user_id)`. Уникальность `(user_id, card_id, terminal_id)` проверяет код (NULLS NOT DISTINCT не используем: версия Postgres на проде неизвестна) |
| `kpi_periods` | `period date primaryKey`; `status varchar(16) default 'open'` |
| `kpi_settings` | `key varchar(64) primaryKey`; `value jsonb not null` |
| `kpi_reviews` | `uniqueIndex("kpi_reviews_period_employee_uq").on(period, employee_id)`; `index("kpi_reviews_period_terminal_idx").on(period, terminal_id)`; `version integer default 1` |
| `kpi_review_items` | `review_id references kpi_reviews.id onDelete cascade`; `uniqueIndex("kpi_review_items_review_item_uq").on(review_id, item_id)`; `score smallint` |
| `kpi_review_events` | `index("kpi_review_events_review_idx").on(review_id)`; `changes jsonb default '[]'` |
| `kpi_violations` | `index("kpi_violations_period_terminal_idx").on(period, terminal_id)`; `index("kpi_violations_employee_period_idx").on(employee_id, period)` |
| `kpi_violation_photos` | `violation_id references kpi_violations.id`; индекс по `violation_id` |
| `kpi_disputes` | `uniqueIndex("kpi_disputes_open_uq").on(subject_type, subject_id).where(sql\`status = 'open'\`)`; `index("kpi_disputes_period_idx").on(period)` |
| `kpi_raise_tiers` | `uniqueIndex("kpi_raise_tiers_min_pct_uq").on(min_pct)` |
| `kpi_raise_decisions` | `uniqueIndex("kpi_raise_decisions_quarter_employee_uq").on(quarter_start, employee_id)`; `history jsonb default '[]'` |
| `kpi_notifications` | `uniqueIndex("kpi_notifications_dedupe_uq").on(dedupe_key)`; `index("kpi_notifications_status_idx").on(status, created_at)`; `status default 'pending'`, `attempts integer default 0` |

Индексы пишутся в новом стиле: `(t) => [uniqueIndex(...).on(...), index(...).on(...)]`.

- [ ] **Step 1: Проверить, что схема и снимок в согласии до правки**

Run: `cd backend && bunx drizzle-kit generate --name probe`
Expected: `No schema changes, nothing to migrate`. Если генератор что-то нашёл — остановиться и доложить, чужой дрейф не чинить.

- [ ] **Step 2: Дописать 15 таблиц в конец `backend/drizzle/schema.ts`**

Нужные импорты (`smallint`, `jsonb`, `date`, `index`, `primaryKey` и т.п.) добавить в верхний `import` только если их там нет.

- [ ] **Step 3: Сгенерировать миграцию**

Run: `cd backend && bunx drizzle-kit generate --name kpi_core`
Expected: создан `drizzle/migrations/0035_kpi_core.sql`. Открыть его: внутри только `CREATE TABLE "kpi_..."`, `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` между `kpi_*` и `CREATE [UNIQUE] INDEX` по `kpi_*`. Любая строка про другие таблицы — остановиться и доложить.

- [ ] **Step 4: Применить к тестовой базе и проверить**

```bash
cd backend && export TEST_DATABASE_URL=...   # см. Global Constraints
DATABASE_URL="$TEST_DATABASE_URL" bunx drizzle-kit migrate
psql "$TEST_DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_name like 'kpi\_%'"
bunx drizzle-kit generate --name probe
```
Expected: `15`, затем `No schema changes, nothing to migrate`.

- [ ] **Step 5: Commit**

```bash
git add backend/drizzle/schema.ts backend/drizzle/migrations/0035_kpi_core.sql backend/drizzle/migrations/meta/0035_snapshot.json backend/drizzle/migrations/meta/_journal.json
git commit -m "feat(kpi): таблицы карт, оценок, нарушений, споров и повышений"
```

---

### Task 2: Периоды и сроки (`time.ts`)

**Files:**
- Create: `backend/src/modules/kpi/time.ts`
- Test: `backend/src/modules/kpi/time.test.ts`

**Interfaces:**
- Consumes: тип `KpiSettings` — объявить здесь же как `Pick` нужных полей не надо: `time.ts` принимает числа, а не объект настроек.
- Produces:
  ```ts
  export type Period = string; // "YYYY-MM-01"
  export function isPeriod(s: unknown): s is Period;            // строго YYYY-MM-01, месяц 01..12
  export function periodOf(d: Date): Period;                     // месяц, в который попадает d по Ташкенту
  export function addMonths(p: Period, n: number): Period;
  export function tashkentDay(d: Date): string;                  // "YYYY-MM-DD" по Ташкенту
  export function dayStart(p: Period, day: number): Date;        // 00:00 по Ташкенту, day обрезается до длины месяца
  export function dayEnd(p: Period, day: number): Date;          // 23:59:59.999 по Ташкенту
  export function submitOpensAt(p: Period): Date;                // dayStart(p, 20)
  export function reviewDeadline(p: Period, reviewDay: number): Date;   // dayEnd(addMonths(p,1), reviewDay)
  export function disputeDeadline(p: Period, disputeDay: number): Date; // dayEnd(addMonths(p,1), disputeDay)
  export function reminderFrom(p: Period, reviewDay: number, daysBefore: number): Date; // 00:00 дня (reviewDeadline − daysBefore дней)
  export function currentReviewPeriod(now: Date, reviewDay: number): Period; // прошлый месяц, пока не прошёл его срок, иначе текущий
  export function quarterStart(p: Period): Period;
  export function quarterMonths(q: Period): [Period, Period, Period];
  export function isQuarterStart(s: unknown): s is Period;
  ```

- [ ] **Step 1: Написать тесты**

```ts
import { describe, expect, it } from "bun:test";
import * as T from "./time";

describe("kpi time", () => {
  it("isPeriod", () => {
    expect(T.isPeriod("2026-10-01")).toBe(true);
    for (const bad of ["2026-10-15", "2026-13-01", "2026-1-01", "", null, 5]) expect(T.isPeriod(bad)).toBe(false);
  });
  it("periodOf по Ташкенту", () => {
    expect(T.periodOf(new Date("2026-10-31T19:30:00Z"))).toBe("2026-11-01"); // 00:30 1 ноября в Ташкенте
    expect(T.periodOf(new Date("2026-10-31T18:59:59Z"))).toBe("2026-10-01");
  });
  it("addMonths через год", () => {
    expect(T.addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(T.addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });
  it("сроки октября", () => {
    expect(T.submitOpensAt("2026-10-01").toISOString()).toBe("2026-10-19T19:00:00.000Z");
    expect(T.reviewDeadline("2026-10-01", 7).toISOString()).toBe("2026-11-07T18:59:59.999Z");
    expect(T.disputeDeadline("2026-10-01", 10).toISOString()).toBe("2026-11-10T18:59:59.999Z");
    expect(T.reminderFrom("2026-10-01", 7, 7).toISOString()).toBe("2026-10-30T19:00:00.000Z"); // 31 октября 00:00
  });
  it("день обрезается до длины месяца", () => {
    expect(T.dayEnd("2026-02-01", 31).toISOString()).toBe("2026-02-28T18:59:59.999Z");
  });
  it("currentReviewPeriod", () => {
    expect(T.currentReviewPeriod(new Date("2026-11-05T10:00:00Z"), 7)).toBe("2026-10-01");
    expect(T.currentReviewPeriod(new Date("2026-11-08T10:00:00Z"), 7)).toBe("2026-11-01");
  });
  it("кварталы", () => {
    expect(T.quarterStart("2026-11-01")).toBe("2026-10-01");
    expect(T.quarterStart("2026-03-01")).toBe("2026-01-01");
    expect(T.quarterMonths("2026-10-01")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(T.isQuarterStart("2026-07-01")).toBe(true);
    expect(T.isQuarterStart("2026-08-01")).toBe(false);
  });
  it("tashkentDay", () => {
    expect(T.tashkentDay(new Date("2026-10-31T19:30:00Z"))).toBe("2026-11-01");
  });
});
```

- [ ] **Step 2: Run** `cd backend && bun test src/modules/kpi/time.test.ts` — Expected: FAIL (`Cannot find module './time'`).

- [ ] **Step 3: Реализовать `time.ts`** — арифметика со сдвигом `+5 ч` через `Date.UTC`, без библиотек часовых поясов.

- [ ] **Step 4: Run** тот же тест — Expected: PASS.

- [ ] **Step 5: Commit** `git add backend/src/modules/kpi/time.ts backend/src/modules/kpi/time.test.ts && git commit -m "feat(kpi): периоды и сроки по Ташкенту"`

---

### Task 3: Правила (`rules.ts`)

**Files:**
- Create: `backend/src/modules/kpi/rules.ts`
- Test: `backend/src/modules/kpi/rules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ItemSource = "manual" | "attendance" | "cooking_speed" | "sales_plan" | "food_cost";
  export const ITEM_SOURCES: ItemSource[];
  export type ScoredItem = { item_id: string; weight: number; source: ItemSource; score: number | null };
  export function scorePct(items: ScoredItem[]): number | null;   // Σ(score×weight)/Σweight по не-null, округление до 0.01
  export function missingManual(items: ScoredItem[]): string[];   // item_id ручных пунктов с score === null
  export function isScore(v: unknown): v is number;               // целое 0..100
  export function commentOk(c: unknown, min: number): boolean;    // строка, не-пробельных символов >= min
  export function violationHint(count: number, penalty: number): number; // max(0, 100 − penalty×count)
  export type CardLite = { id: string; staff_role_codes: string[]; active: boolean; sort: number };
  export function effectiveCardId(
    emp: { staff_role_code: string | null; is_trainee: boolean | null },
    override: { card_id: string | null } | undefined,
    cards: CardLite[],
  ): { card_id: string | null; source: "override" | "role" | null };
  export type Scope = { card_id: string | null; terminal_id: string | null };
  export function scopeCovers(scopes: Scope[], target: { card_id: string | null; terminal_id: string }): boolean;
  export type Tier = { min_pct: number; amount: number };
  export function validateTiers(tiers: Tier[], cap: number): string | null;
  export function raiseFor(avg: number, tiers: Tier[]): number;
  export function quarterRow(months: (number | null)[], tiers: Tier[], minMonths: number):
    { months_scored: number; avg_pct: number | null; status: "proposed" | "insufficient"; suggested_amount: number };
  export function diffScores(before: Record<string, number | null>, after: Record<string, number | null>):
    { item_id: string; old: number | null; new: number | null }[];
  export interface KpiSettings {
    review_deadline_day: number; dispute_deadline_day: number; reminder_days_before: number;
    raise_cap: number; raise_min_months: number; violation_photo_required: boolean;
    violation_penalty_hint: number; change_comment_min: number;
  }
  export const DEFAULT_SETTINGS: KpiSettings; // 7, 10, 7, 500000, 2, false, 10, 5
  export function validateSettingsPatch(patch: Record<string, unknown>): string | null;
  ```

Правила, которые тесты не определяют однозначно:
- `effectiveCardId`: ручное назначение побеждает всегда, даже с `card_id: null` (тогда `{card_id: null, source: "override"}`). Без назначения стажёр (`is_trainee === true`) карты не получает. Иначе первая активная карта по `sort`, где `staff_role_codes` содержит код роли.
- `scopeCovers`: назначение подходит, если `(s.card_id === null || s.card_id === target.card_id) && (s.terminal_id === null || s.terminal_id === target.terminal_id)`. При `target.card_id === null` подходят только назначения с `card_id === null`.
- `validateTiers` возвращает первый найденный код: `tier_pct_range` (min_pct вне 0..100), `tier_amount_range` (amount < 0), `tier_amount_over_cap`, `tier_pct_duplicate`, иначе `null`. Пустой список допустим.
- `validateSettingsPatch`: неизвестный ключ → `unknown_setting`. Дни дедлайнов — целые 1..28 (`bad_day`). `reminder_days_before` — 0..27, `raise_cap` — 0..10 000 000, `raise_min_months` — 1..3, `violation_penalty_hint` — 0..100, `change_comment_min` — 1..200 (`bad_value`). Булево поле — только boolean (`bad_value`). `dispute_deadline_day < review_deadline_day` → `dispute_before_review`; проверяется, если в патче есть хотя бы одно из двух полей, против второго из патча или дефолта, — вызывающий передаёт объединённые настройки.

- [ ] **Step 1: Написать тесты**

```ts
import { describe, expect, it } from "bun:test";
import * as R from "./rules";

const tiers = [{ min_pct: 95, amount: 500000 }, { min_pct: 90, amount: 300000 }, { min_pct: 85, amount: 150000 }];
const it_ = (id: string, score: number | null, weight = 1, source: R.ItemSource = "manual") => ({ item_id: id, score, weight, source });

describe("scorePct", () => {
  it("пустые пункты выпадают, веса пересчитываются", () => {
    expect(R.scorePct([it_("a", 90), it_("b", 80), it_("c", null, 1, "attendance")])).toBe(85);
    expect(R.scorePct([it_("a", 100, 2), it_("b", 70, 1)])).toBe(90);
    expect(R.scorePct([it_("a", 100, 1), it_("b", 0, 2)])).toBe(33.33);
    expect(R.scorePct([it_("a", null)])).toBeNull();
  });
  it("missingManual видит только ручные", () => {
    expect(R.missingManual([it_("a", null), it_("b", null, 1, "attendance"), it_("c", 50)])).toEqual(["a"]);
  });
});

describe("ввод", () => {
  it("isScore", () => {
    for (const ok of [0, 50, 100]) expect(R.isScore(ok)).toBe(true);
    for (const bad of [-1, 101, 50.5, "50", null]) expect(R.isScore(bad)).toBe(false);
  });
  it("commentOk", () => {
    expect(R.commentOk("   \n  ", 5)).toBe(false);
    expect(R.commentOk("ок да", 5)).toBe(false);
    expect(R.commentOk("опоздал 3 раза", 5)).toBe(true);
    expect(R.commentOk(undefined, 1)).toBe(false);
  });
  it("violationHint", () => {
    expect(R.violationHint(0, 10)).toBe(100);
    expect(R.violationHint(3, 10)).toBe(70);
    expect(R.violationHint(12, 10)).toBe(0);
  });
});

describe("effectiveCardId", () => {
  const cards: R.CardLite[] = [
    { id: "cook", staff_role_codes: ["cook", "universal_cook"], active: true, sort: 10 },
    { id: "old", staff_role_codes: ["cook"], active: false, sort: 1 },
    { id: "cleaner", staff_role_codes: [], active: true, sort: 60 },
  ];
  it("по роли, неактивная пропускается", () => {
    expect(R.effectiveCardId({ staff_role_code: "universal_cook", is_trainee: false }, undefined, cards)).toEqual({ card_id: "cook", source: "role" });
    expect(R.effectiveCardId({ staff_role_code: "cook", is_trainee: false }, undefined, cards)).toEqual({ card_id: "cook", source: "role" });
  });
  it("ручное назначение побеждает, null = не оценивается", () => {
    expect(R.effectiveCardId({ staff_role_code: "hall_worker", is_trainee: false }, { card_id: "cleaner" }, cards)).toEqual({ card_id: "cleaner", source: "override" });
    expect(R.effectiveCardId({ staff_role_code: "cook", is_trainee: false }, { card_id: null }, cards)).toEqual({ card_id: null, source: "override" });
  });
  it("стажёр и роль без карты", () => {
    expect(R.effectiveCardId({ staff_role_code: "cook", is_trainee: true }, undefined, cards)).toEqual({ card_id: null, source: null });
    expect(R.effectiveCardId({ staff_role_code: null, is_trainee: null }, undefined, cards)).toEqual({ card_id: null, source: null });
  });
});

describe("scopeCovers", () => {
  it("null — любой", () => {
    expect(R.scopeCovers([{ card_id: null, terminal_id: "t1" }], { card_id: "cook", terminal_id: "t1" })).toBe(true);
    expect(R.scopeCovers([{ card_id: "cook", terminal_id: null }], { card_id: "cook", terminal_id: "t9" })).toBe(true);
    expect(R.scopeCovers([{ card_id: "cook", terminal_id: null }], { card_id: "cashier", terminal_id: "t9" })).toBe(false);
    expect(R.scopeCovers([{ card_id: "cook", terminal_id: null }], { card_id: null, terminal_id: "t9" })).toBe(false);
    expect(R.scopeCovers([{ card_id: null, terminal_id: null }], { card_id: null, terminal_id: "t9" })).toBe(true);
    expect(R.scopeCovers([], { card_id: "cook", terminal_id: "t1" })).toBe(false);
  });
});

describe("повышение", () => {
  it("ступени", () => {
    expect(R.raiseFor(84.99, tiers)).toBe(0);
    expect(R.raiseFor(85, tiers)).toBe(150000);
    expect(R.raiseFor(94.99, tiers)).toBe(300000);
    expect(R.raiseFor(100, tiers)).toBe(500000);
  });
  it("пример из плана: 92, 96, 94 → 94% и 300 000", () => {
    expect(R.quarterRow([92, 96, 94], tiers, 2)).toEqual({ months_scored: 3, avg_pct: 94, status: "proposed", suggested_amount: 300000 });
  });
  it("мало месяцев", () => {
    expect(R.quarterRow([95, null, null], tiers, 2)).toEqual({ months_scored: 1, avg_pct: 95, status: "insufficient", suggested_amount: 0 });
    expect(R.quarterRow([95, 95, null], tiers, 2)).toEqual({ months_scored: 2, avg_pct: 95, status: "proposed", suggested_amount: 500000 });
    expect(R.quarterRow([null, null, null], tiers, 2)).toEqual({ months_scored: 0, avg_pct: null, status: "insufficient", suggested_amount: 0 });
  });
  it("validateTiers", () => {
    expect(R.validateTiers(tiers, 500000)).toBeNull();
    expect(R.validateTiers([{ min_pct: 95, amount: 600000 }], 500000)).toBe("tier_amount_over_cap");
    expect(R.validateTiers([{ min_pct: 101, amount: 1 }], 500000)).toBe("tier_pct_range");
    expect(R.validateTiers([{ min_pct: 90, amount: 1 }, { min_pct: 90, amount: 2 }], 500000)).toBe("tier_pct_duplicate");
    expect(R.validateTiers([], 500000)).toBeNull();
  });
});

describe("diffScores", () => {
  it("только изменённые", () => {
    expect(R.diffScores({ a: 50, b: 80, c: null }, { a: 50, b: 90, c: 10 })).toEqual([
      { item_id: "b", old: 80, new: 90 },
      { item_id: "c", old: null, new: 10 },
    ]);
  });
});

describe("настройки", () => {
  it("дефолты", () => {
    expect(R.DEFAULT_SETTINGS).toEqual({ review_deadline_day: 7, dispute_deadline_day: 10, reminder_days_before: 7, raise_cap: 500000, raise_min_months: 2, violation_photo_required: false, violation_penalty_hint: 10, change_comment_min: 5 });
  });
  it("validateSettingsPatch", () => {
    expect(R.validateSettingsPatch({ review_deadline_day: 5 })).toBeNull();
    expect(R.validateSettingsPatch({ foo: 1 })).toBe("unknown_setting");
    expect(R.validateSettingsPatch({ review_deadline_day: 29 })).toBe("bad_day");
    expect(R.validateSettingsPatch({ raise_min_months: 4 })).toBe("bad_value");
    expect(R.validateSettingsPatch({ violation_photo_required: "yes" })).toBe("bad_value");
    expect(R.validateSettingsPatch({ review_deadline_day: 12, dispute_deadline_day: 10 })).toBe("dispute_before_review");
  });
});
```

- [ ] **Step 2: Run** `cd backend && bun test src/modules/kpi/rules.test.ts` — Expected: FAIL.
- [ ] **Step 3: Реализовать `rules.ts`.** Округление процентов — `Math.round(x * 100) / 100`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git add backend/src/modules/kpi/rules.ts backend/src/modules/kpi/rules.test.ts && git commit -m "feat(kpi): правила оценки, карты, назначений и повышения"`

---

### Task 4: Каркас модуля, права, настройки, первый HTTP-тест

**Files:**
- Create: `backend/src/modules/kpi/clock.ts`, `errors.ts`, `access.ts`, `settings.ts`, `notify.ts`, `periods.ts` (пока только `isPeriodClosed`), `types.ts`, `controller.ts`, `routes/me.ts`, `routes/settings.ts`, `routes/periods.ts` (пока только валидация пути, см. Step 1), `seed-permissions.ts`, `http/fixtures.ts`, `http/me.test.ts`
- Modify: `backend/src/app.ts` (импорт и `.use(kpiController)` перед `.use(apiController)`), `backend/package.json` (скрипт)

**Interfaces:**
- Consumes: `time.ts`, `rules.ts` (задачи 2–3); `ctx` из `@backend/context`; `resolveIsHq` из `@backend/lib/resolve-is-hq`.
- Produces:
  ```ts
  // clock.ts — подмена времени только при PROJECT_PREFIX === "managers_test_"
  export function now(): Date; // process.env.KPI_FAKE_NOW, если задан и окружение тестовое, иначе new Date()

  // errors.ts — копия паттерна inventory/errors.ts
  export class KpiError extends Error { constructor(status: number, code: string, extra?: Record<string, unknown>) }
  export function run<T>(set: { status?: number | string }, fn: () => Promise<T>): Promise<T | { error: string; [k: string]: unknown }>;

  // access.ts
  export type DbLike = /* как в inventory/access.ts */;
  export type Actor = { userId: string; perms: Set<string>; isHq: boolean; terminals: string[] };
  export async function actorFrom(a: { user: any; role: any; terminals: string[]; cacheController: any }): Promise<Actor>;
  export function has(actor: Actor, perm: string): boolean;
  export function requireAny(actor: Actor, perms: string[]): void;            // иначе KpiError(403, "forbidden")
  export function seesNetwork(actor: Actor): boolean;                          // kpi.manage || kpi.approve || isHq
  export function viewsTerminal(actor: Actor, terminalId: string): boolean;    // seesNetwork || (kpi.view && terminals.includes)
  export async function loadScopes(db: DbLike, userId: string): Promise<Scope[]>;
  export function parsePeriod(v: unknown): Period;                             // иначе KpiError(422, "bad_period")

  // settings.ts
  export async function loadSettings(db: DbLike): Promise<KpiSettings>;        // DEFAULT_SETTINGS + строки kpi_settings
  export async function saveSettings(db: DbLike, patch: Partial<KpiSettings>, userId: string): Promise<KpiSettings>; // validateSettingsPatch по объединению, иначе KpiError(422, code)

  // periods.ts — дополняется в задаче 8
  export async function isPeriodClosed(db: DbLike, period: Period): Promise<boolean>; // строка kpi_periods со status 'closed'

  // notify.ts — только запись, доставка в плане 4
  export type NotifyInput = { recipient_kind: "employee" | "user"; employee_id?: string; user_id?: string; kind: string; payload: Record<string, unknown>; dedupe_key: string };
  export async function enqueue(tx: DbLike, n: NotifyInput): Promise<void>;   // insert ... on conflict (dedupe_key) do nothing

  // types.ts — расширяется в следующих задачах
  export type KpiPerm = "kpi_layout" | "kpi.evaluate" | "kpi.view" | "kpi.manage" | "kpi.approve";
  export interface Deadlines { period: string; submit_opens_at: string; review_deadline: string; dispute_deadline: string }
  export interface MeResponse { user_id: string; perms: KpiPerm[]; is_hq: boolean; scopes: ScopeRow[]; settings: KpiSettings; current_period: string; deadlines: Deadlines }
  export interface ScopeRow { id: string; user_id: string; user_name: string; card_id: string | null; card_title: string | null; terminal_id: string | null; terminal_name: string | null; created_at: string }
  ```
- Роуты задачи: `GET /api/kpi/me` (userAuth; 403 `forbidden`, если нет ни одного `kpi.*`, кроме `kpi_layout`), `GET /api/kpi/settings` (любое из view/manage/approve/evaluate), `PUT /api/kpi/settings` (`permission: "kpi.manage"`, тело — частичные настройки), `GET /api/kpi/periods/:period` (в этой задаче — только `parsePeriod`; сводку дописывает задача 8, до неё ответ `{ period }`).
- Права в `seed-permissions.ts` — таблица из раздела 8 спеки. Описания — ровно оттуда.
- Скрипт в `backend/package.json`:
  `"test:http:kpi": "PROJECT_PREFIX=managers_test_ KPI_UPLOADS_DIR=/tmp/kpi_test_uploads DATABASE_URL=$TEST_DATABASE_URL bun test src/modules/kpi/http/"`
- `http/fixtures.ts` (используют задачи 5–9):
  ```ts
  export async function setup(): Promise<{ db: DrizzleDB }>;            // ensureApp + seedCards(db) (seedCards появится в задаче 5; до неё setup его не зовёт)
  export function setNow(iso: string | null): void;                     // process.env.KPI_FAKE_NOW
  export async function api(s: Session | null, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  export async function makeEmployee(db, o?: { terminal_id?: string; role_code?: string; is_trainee?: boolean; first_name?: string }): Promise<{ id: string; terminal_id: string }>;
  export async function ensureStaffRole(db, code: string): Promise<string>; // id роли; вставка, если нет
  export async function makeScope(db, userId: string, o?: { card_id?: string | null; terminal_id?: string | null }): Promise<void>;
  export async function cleanupKpi(db): Promise<void>;                  // удаляет kpi_* строки и employees, созданные фикстурами (по меткам first_name "Тест …")
  ```
  `terminal_id` по умолчанию — `randomUUID()`: у `employees.terminal_id` нет внешнего ключа. Каждый тестовый файл начинается с того же guard, что `inventory/routes.test.ts` (пропуск без тестового окружения).

- [ ] **Step 1: Написать `http/me.test.ts`**

```ts
// guard как в inventory/routes.test.ts, затем:
it("без сессии — 401", async () => expect((await api(null, "GET", "/api/kpi/me")).status).toBe(401));
it("без kpi-прав — 403", async () => {
  const s = await withSession({ permissions: ["medical.list"] });
  expect((await api(s, "GET", "/api/kpi/me")).status).toBe(403);
});
it("оценщик видит свои права, настройки и сроки", async () => {
  setNow("2026-11-05T10:00:00+05:00");
  const s = await withSession({ permissions: ["kpi_layout", "kpi.evaluate"] });
  const r = await api(s, "GET", "/api/kpi/me");
  expect(r.status).toBe(200);
  expect(r.body.perms.sort()).toEqual(["kpi.evaluate", "kpi_layout"]);
  expect(r.body.current_period).toBe("2026-10-01");
  expect(r.body.settings.raise_cap).toBe(500000);
  expect(r.body.deadlines.review_deadline).toBe("2026-11-07T18:59:59.999Z");
});
it("настройки: оценщику PUT нельзя, HR можно, кривое значение — 422", async () => {
  const ev = await withSession({ permissions: ["kpi.evaluate"] });
  expect((await api(ev, "PUT", "/api/kpi/settings", { review_deadline_day: 5 })).status).toBe(403);
  const hr = await withSession({ permissions: ["kpi.manage"] });
  expect((await api(hr, "PUT", "/api/kpi/settings", { review_deadline_day: 29 })).body).toEqual({ error: "bad_day" });
  const ok = await api(hr, "PUT", "/api/kpi/settings", { review_deadline_day: 6 });
  expect(ok.status).toBe(200);
  expect(ok.body.review_deadline_day).toBe(6);
  await api(hr, "PUT", "/api/kpi/settings", { review_deadline_day: 7 }); // вернуть
});
it("кривой период — 422 bad_period", async () => {
  const hr = await withSession({ permissions: ["kpi.view"] });
  expect((await api(hr, "GET", "/api/kpi/periods/2026-10-15")).body).toEqual({ error: "bad_period" });
});
```

- [ ] **Step 2: Run** `cd backend && TEST_DATABASE_URL=... bun run test:http:kpi` — Expected: FAIL (404 на `/api/kpi/me`).
- [ ] **Step 3: Реализовать файлы задачи и зарегистрировать контроллер в `app.ts`.**
- [ ] **Step 4: Run** тот же тест и `bun test src/modules/kpi/*.test.ts` — Expected: PASS. Проверка типов из Global Constraints — пусто.
- [ ] **Step 5: Применить права к тестовой базе** `DATABASE_URL="$TEST_DATABASE_URL" bun run src/modules/kpi/seed-permissions.ts` — Expected: 5 строк `inserted kpi…`, повторный запуск — 5 `skip`.
- [ ] **Step 6: Commit** — все файлы задачи поимённо, сообщение `feat(kpi): каркас модуля, права, настройки`.

---

### Task 5: Карты, назначения оценщиков, список сотрудников

**Files:**
- Create: `backend/src/modules/kpi/seed-data.ts`, `seed-cards.ts`, `directory.ts`, `routes/cards.ts`, `routes/evaluators.ts`, `routes/employees.ts`, `http/cards.test.ts`
- Modify: `controller.ts` (`.use()` новых роутов), `types.ts`, `http/fixtures.ts` (`setup` зовёт `seedCards`)

**Interfaces:**
- Consumes: `effectiveCardId`, `scopeCovers` (задача 3); `Actor`, `loadScopes`, `viewsTerminal`, `seesNetwork` (задача 4).
- Produces:
  ```ts
  // seed-cards.ts
  export async function seedCards(db: DbLike): Promise<{ cards: number; tiers: number }>; // вставляет недостающие карты по code (с пунктами) и шкалу, если kpi_raise_tiers пуста; существующее не трогает
  // directory.ts
  export type DirEmployee = { id: string; first_name: string; last_name: string; terminal_id: string; terminal_name: string | null; staff_role_code: string | null; staff_role_name: string | null; is_trainee: boolean | null; active: boolean; external_id: string | null; card_id: string | null; card_source: "override" | "role" | null };
  export async function loadDirectory(db: DbLike, o?: { employeeIds?: string[]; includeInactive?: boolean }): Promise<DirEmployee[]>;
  export function canEvaluate(actor: Actor, scopes: Scope[], e: { terminal_id: string; card_id: string | null }): boolean; // kpi.evaluate && scopeCovers
  export function canSeeEmployee(actor: Actor, scopes: Scope[], e: { terminal_id: string; card_id: string | null }): boolean; // viewsTerminal || canEvaluate
  export async function userNames(db: DbLike, ids: string[]): Promise<Map<string, string>>;   // "Имя Фамилия" или login
  export async function terminalNames(db: DbLike, ids: string[]): Promise<Map<string, string>>;
  // types.ts
  export interface CardItem { id: string; card_id: string; sort: number; title_ru: string; title_uz: string; hint_ru: string | null; hint_uz: string | null; source: ItemSource; weight: number; group_key: "base" | "extra"; active: boolean }
  export interface Card { id: string; code: string; title_ru: string; title_uz: string; staff_role_codes: string[]; active: boolean; sort: number; items: CardItem[] }
  export interface EmployeeRow { id: string; first_name: string; last_name: string; terminal_id: string; terminal_name: string | null; staff_role_code: string | null; staff_role_name: string | null; active: boolean; external_id: string | null; card: { id: string; code: string; title_ru: string } | null; card_source: "override" | "role" | null; review: { id: string; status: "draft" | "submitted"; score_pct: number | null; submitted_at: string | null; late: boolean } | null; open_dispute: boolean; can_evaluate: boolean }
  ```
- Роуты:
  - `GET /kpi/cards?include_inactive=1` — любое `kpi.*`;
  - `POST /kpi/cards` `{code, title_ru, title_uz, staff_role_codes, sort?}` (manage; 409 `code_taken`);
  - `PUT /kpi/cards/:id` `{title_ru?, title_uz?, staff_role_codes?, active?, sort?}`;
  - `POST /kpi/cards/:id/items` `{title_ru, title_uz, hint_ru?, hint_uz?, source, weight, group_key, sort?}`;
  - `PUT /kpi/items/:id` (те же поля + `active`);
  - `weight` 1..100, иначе 422 `bad_weight`; `source` из `ITEM_SOURCES`, иначе 422 `bad_source`.
  - `GET /kpi/evaluators`, `POST /kpi/evaluators` `{user_id, card_id: string|null, terminal_id: string|null}` (409 `scope_exists`), `DELETE /kpi/evaluators/:id`, `GET /kpi/users?search=` (до 20 активных, по login/имени/фамилии) — всё manage.
  - `GET /kpi/employees?period&terminal_id&card_id&status&search` — `status` ∈ `none|draft|submitted|disputed`. Сотрудники с картой, видимые актору (`canSeeEmployee`), активные плюс неактивные, у которых есть оценка за период. Оценщику без `kpi.view` — только из назначений. Сортировка: филиал, фамилия.
  - `PUT /kpi/employees/:id/card` `{card_id: string|null, comment?}` — manage; повторный вызов заменяет; `{card_id: "auto"}` удаляет ручное назначение (вернуть к карте по роли).
- `late` у оценки: `submitted_at > reviewDeadline` или (не отправлена и `now() > reviewDeadline`).

`seed-data.ts` — точный текст карт из раздела 6.1 спеки (русские названия). Узбекские названия:

| code | title_uz |
|---|---|
| cook | Oshpaz (Chopar va Les Ailes) |
| senior_cook | Katta oshpaz |
| cashier | Kassir |
| cashier_plus | Kassir, maosh 4 000 000 soʻm |
| manager | Filial menejeri |
| cleaner | Farrosh |

| Пункт | title_uz |
|---|---|
| Приход и уход | Kelish va ketish |
| Чистота кухни | Oshxona tozaligi |
| Гигиена сотрудника | Xodim gigiyenasi |
| Порядок в остатках продуктов | Mahsulot qoldiqlarida tartib |
| Время и скорость приготовления заказа | Buyurtmani tayyorlash vaqti va tezligi |
| Соблюдение техкарты | Texnologik kartaga rioya qilish |
| Правильная приёмка продукции со склада | Ombordan mahsulotni toʻgʻri qabul qilish |
| Удерживает поваров в команде | Oshpazlarni jamoada ushlab qolish |
| Отчёты вовремя: заказы на склад, дневные и месячные остатки, дневное списание, перемещения | Hisobotlarni oʻz vaqtida yuritish: omborga buyurtmalar, kunlik va oylik qoldiqlar, kunlik hisobdan chiqarish, koʻchirishlar |
| Своя гигиена и форма | Shaxsiy gigiyena va forma |
| Чистота кассы | Kassa tozaligi |
| Открывает и закрывает кассовые смены, работает с кассовыми терминалами, следит за стоп-листом | Kassa smenalarini ochadi va yopadi, kassa terminallari bilan ishlaydi, stop-listni kuzatadi |
| Знает меню витрины по техкарте | Vitrina menyusini texnologik karta boʻyicha biladi |
| Хорошие доп. продажи | Yaxshi qoʻshimcha savdo |
| Продаёт по скриптам продаж | Savdo skriptlari boʻyicha sotadi |
| Умеет работать поваром | Oshpaz boʻlib ishlay oladi |
| Форма и гигиена | Forma va gigiyena |
| Чистота филиала | Filial tozaligi |
| Качество сервиса: как сотрудники обслуживают гостей, скорость приёма и выдачи заказа | Xizmat sifati: xodimlar mehmonlarga qanday xizmat koʻrsatadi, buyurtmani qabul qilish va berish tezligi |
| Качество приготовления и хранение продуктов по стандартам сроков хранения | Taom tayyorlash sifati va mahsulotlarni saqlash muddati standartlari boʻyicha saqlash |
| Правильно составляет заказ на склад и проверяет поставку | Omborga buyurtmani toʻgʻri tuzadi va kelgan mahsulotni tekshiradi |
| Работа над планом продаж | Savdo rejasi ustida ishlash |
| Фудкост и остатки | Fudkost va qoldiqlar |
| Кассовый отчёт | Kassa hisoboti |
| Своя гигиена | Shaxsiy gigiyena |
| Чистота зала и уборной | Zal va hojatxona tozaligi |

Апостроф в узбекском — `ʻ` (U+02BB). Порядок карт (`sort`): cook 10, senior_cook 20, cashier 30, cashier_plus 40, manager 50, cleaner 60. Пункты `extra` — по спеке. Шкала: 95 → 500000, 90 → 300000, 85 → 150000.

- [ ] **Step 1: Написать `http/cards.test.ts`**

```ts
it("seedCards идемпотентна: 6 карт, у старшего повара 9 пунктов, у технички 3", async () => {
  await seedCards(db); await seedCards(db);
  const hr = await withSession({ permissions: ["kpi.manage"] });
  const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
  expect(cards.map((c) => c.code)).toEqual(["cook", "senior_cook", "cashier", "cashier_plus", "manager", "cleaner"]);
  expect(cards.find((c) => c.code === "senior_cook")!.items).toHaveLength(9);
  expect(cards.find((c) => c.code === "cleaner")!.items.map((i) => i.title_ru)).toEqual(["Приход и уход", "Своя гигиена", "Чистота зала и уборной"]);
  expect(cards.find((c) => c.code === "cook")!.items[0].source).toBe("attendance");
});
it("пункт: вес вне 1..100 — 422 bad_weight", ...);
it("назначение: дубликат — 409 scope_exists; оценщик видит только своих", async () => {
  const cook = await makeEmployee(db, { role_code: "cook" });
  const cashier = await makeEmployee(db, { role_code: "cashier", terminal_id: cook.terminal_id });
  const ev = await withSession({ permissions: ["kpi.evaluate"] });
  const hr = await withSession({ permissions: ["kpi.manage"] });
  const cookCard = /* id карты cook */;
  expect((await api(hr, "POST", "/api/kpi/evaluators", { user_id: ev.userId, card_id: cookCard, terminal_id: null })).status).toBe(200);
  expect((await api(hr, "POST", "/api/kpi/evaluators", { user_id: ev.userId, card_id: cookCard, terminal_id: null })).body).toEqual({ error: "scope_exists" });
  const list = (await api(ev, "GET", `/api/kpi/employees?period=2026-10-01&terminal_id=${cook.terminal_id}`)).body as EmployeeRow[];
  expect(list.map((e) => e.id)).toEqual([cook.id]);
  expect(list[0].can_evaluate).toBe(true);
});
it("ручная карта: техничка по назначению HR, стажёр без карты не виден, auto возвращает к роли", ...);
it("kpi.view видит только свои филиалы", async () => {
  const a = await makeEmployee(db, { role_code: "cook" });
  const b = await makeEmployee(db, { role_code: "cook" });
  const v = await withSession({ permissions: ["kpi.view"], terminals: [a.terminal_id] });
  const ids = ((await api(v, "GET", "/api/kpi/employees?period=2026-10-01")).body as EmployeeRow[]).map((e) => e.id);
  expect(ids).toContain(a.id);
  expect(ids).not.toContain(b.id);
});
```

- [ ] **Step 2: Run** `bun run test:http:kpi` — Expected: новые тесты FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Run** — Expected: PASS; типы чисты.
- [ ] **Step 5: Commit** `feat(kpi): карты, оценщики, список сотрудников`.

---

### Task 6: Оценки

**Files:**
- Create: `backend/src/modules/kpi/reviews.ts`, `routes/reviews.ts`, `http/reviews.test.ts`
- Modify: `controller.ts`, `types.ts`

**Interfaces:**
- Consumes: `scorePct`, `missingManual`, `isScore`, `commentOk`, `diffScores`, `violationHint` (задача 3); `submitOpensAt`, `reviewDeadline`, `disputeDeadline` (задача 2); `loadDirectory`, `canEvaluate`, `canSeeEmployee` (задача 5); `enqueue` (задача 4); `loadSettings`.
- Produces:
  ```ts
  export type ItemInput = { item_id: string; score: number | null; note?: string | null };
  export async function getForm(db, actor, period: Period, employeeId: string): Promise<ReviewForm>;
  export async function saveDraft(db, actor, period: Period, employeeId: string, items: ItemInput[]): Promise<ReviewForm>;
  export async function submitReview(db, actor, reviewId: string, items?: ItemInput[]): Promise<ReviewForm>;
  export async function changeReview(db, actor, reviewId: string, items: ItemInput[], comment: string, kind?: "changed" | "hr_adjusted"): Promise<ReviewForm>;
  export async function reviewEvents(db, actor, reviewId: string): Promise<ReviewEvent[]>;
  export async function listReviews(db, actor, q: { period: Period; terminal_id?: string; card_id?: string; status?: string }): Promise<EmployeeRow[]>; // = список сотрудников задачи 5 с фильтром «есть оценка»
  // types.ts
  export interface ReviewFormItem { item_id: string; title_ru: string; title_uz: string; hint_ru: string | null; weight: number; source: ItemSource; group_key: "base" | "extra"; score: number | null; note: string | null; suggestion: { score: number; basis: string } | null; violations: ViolationRow[] }
  export interface ReviewForm { period: string; period_status: "open" | "closed"; employee: { id: string; first_name: string; last_name: string; terminal_id: string; terminal_name: string | null }; card: { id: string; code: string; title_ru: string }; review: { id: string; status: "draft" | "submitted"; score_pct: number | null; version: number; submitted_at: string | null; evaluator_user_id: string; late: boolean } | null; items: ReviewFormItem[]; other_violations: ViolationRow[]; can_edit: boolean; needs_comment: boolean; deadlines: Deadlines }
  export interface ReviewEvent { id: string; kind: string; actor_kind: string; actor_name: string | null; changes: { item_id: string; title_ru: string; old: number | null; new: number | null }[]; old_score_pct: number | null; new_score_pct: number | null; comment: string | null; created_at: string }
  ```
  `ViolationRow` объявить в `types.ts` уже здесь (поля — в задаче 7). Пока задача 7 не сделана, `violations: []`.
- Роуты:
  - `GET /kpi/reviews?period&terminal_id&card_id&status` (evaluate/view);
  - `GET /kpi/reviews/form?period&employee_id` (evaluate/view);
  - `PUT /kpi/reviews/draft` `{period, employee_id, items}` (evaluate);
  - `POST /kpi/reviews/:id/submit` `{items?}` (evaluate);
  - `PUT /kpi/reviews/:id` `{items, comment}` (evaluate/approve);
  - `GET /kpi/reviews/:id/events`.

Правила (раздел 7.2 спеки), которые тесты закрепляют:
- **Черновик.** Сохранять и отправлять может только `kpi.evaluate` с покрывающим назначением, иначе 403 `out_of_scope`. Без карты — 422 `no_card`. Месяц закрыт — 409 `period_closed`. Отправленную оценку через draft менять нельзя — 409 `already_submitted`. Черновик хранит пункты текущей карты: при сохранении строки `kpi_review_items` пересобираются по активным пунктам, баллы совпавших `item_id` сохраняются.
- **Отправка.** Раньше `submitOpensAt` — 409 `too_early`. Пустые ручные пункты — 422 `missing_items` с `{ items: [...] }`. Пишет `submitted`, `score_pct`, событие `submitted`, уведомление `review_submitted` сотруднику с `dedupe_key = review_submitted:<review_id>`.
- **Изменение отправленной.**
  - Право: оценщик с назначением в открытом месяце, `kpi.approve` в любом.
  - Пустой или короткий комментарий — 422 `comment_required`. Нет изменений — 422 `no_changes`.
  - В закрытом месяце без `kpi.approve` — 409 `period_closed`, событие `hr_adjusted`. Иначе событие `changed`.
  - `version + 1`, уведомление `review_changed` с `dedupe_key = review_changed:<review_id>:<version>`.
- **Автопункт.** Если оценщик ставит балл, отличный от `suggestion.score`, без `note` — 422 `note_required`. В этом плане предложений нет (появятся в планах 3 и 5), но проверка пишется сейчас.
- **Балл.** Неверный `score` — 422 `bad_score`. Чужой `item_id` (не из карты) — 422 `unknown_item`.
- **Форма отправленной оценки** строится из снимка `kpi_review_items`, черновика или новой — из текущей карты.

- [ ] **Step 1: Написать `http/reviews.test.ts`** — тесты (каждый со своим сотрудником из `makeEmployee`, назначением и `setNow`):
  - `черновик → отправка → процент и уведомление`: 7 пунктов повара, `attendance` = null, остальные 100, 100, 50, 50, 100, 100 → `score_pct` 83.33. В `kpi_notifications` одна строка `review_submitted`.
  - `отправка до 20 числа — 409 too_early` (`setNow("2026-10-10T10:00:00+05:00")`, период `2026-10-01`).
  - `пустой ручной пункт — 422 missing_items`, в ответе его `item_id`.
  - `изменение без комментария — 422 comment_required; из пробелов — 422; с комментарием — 200, version 2, событие changed со списком изменений`.
  - `изменение без изменений — 422 no_changes`.
  - `чужой оценщик — 403 out_of_scope`, `kpi.view без evaluate — форма 200, сохранение 403`.
  - `два параллельных draft — оба 200, одна строка kpi_reviews` (`Promise.all`).
  - `пункт отключили после отправки — форма показывает снимок, процент тот же; у нового черновика другого сотрудника пункта нет`.
  - `кривой период — 422 bad_period` на `GET /api/kpi/reviews?period=x`.
  - `late: отправка 2026-11-09 за октябрь — late=true`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Реализовать.** Все записи одной операции — в `db.transaction`. Гонку двух черновиков снимает `insert ... on conflict (period, employee_id) do nothing` с последующим `select`.
- [ ] **Step 4: Run** — PASS; типы чисты.
- [ ] **Step 5: Commit** `feat(kpi): месячные оценки с историей и обязательным комментарием`.

---

### Task 7: Нарушения с фото

**Files:**
- Create: `backend/src/modules/kpi/storage.ts`, `violations.ts`, `routes/violations.ts`, `http/violations.test.ts`
- Modify: `controller.ts`, `types.ts`, `reviews.ts` (форма: нарушения под пунктами, `suggestion` для ручных пунктов не трогать — подсказка нарушений отдельным полем, см. ниже)

**Interfaces:**
- Consumes: `canEvaluate`, `canSeeEmployee`, `loadDirectory` (задача 5); `enqueue`; `periodOf`, `tashkentDay`.
- Produces:
  ```ts
  // storage.ts — по образцу tickets/storage.ts
  export const MAX_PHOTOS = 3;
  export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
  export function uploadsBase(): string; // process.env.KPI_UPLOADS_DIR ?? "/home/davr/managers/uploads/kpi"
  export function checkPhoto(f: { type: string; size: number }, index: number): string | null; // "bad_photo_type" | "photo_too_large" | "too_many_photos" | null
  export async function savePhoto(file: File, violationId: string, onPath?: (p: string) => void): Promise<{ file_path: string; mime: string; size_bytes: number }>;
  // violations.ts
  export async function createViolation(db, actor, input: { employee_id: string; card_item_id?: string | null; occurred_at?: string | null; comment: string; photos: File[] }): Promise<ViolationRow>;
  export async function cancelViolation(db, actor, id: string, reason: string): Promise<ViolationRow>;
  export async function listViolations(db, actor, q: { period?: Period; terminal_id?: string; employee_id?: string; status?: "active" | "cancelled" }): Promise<ViolationRow[]>;
  export async function photoFile(db, actor, photoId: string): Promise<{ path: string; mime: string }>; // 404 not_found при чужом/кривом id
  export async function violationsFor(db, employeeId: string, period: Period): Promise<ViolationRow[]>; // активные, для формы оценки
  // types.ts
  export interface ViolationRow { id: string; terminal_id: string; terminal_name: string | null; employee_id: string; employee_name: string; card_item_id: string | null; item_title_ru: string | null; period: string; occurred_at: string; comment: string; recorded_by: string; recorded_by_name: string | null; status: "active" | "cancelled"; cancel_reason: string | null; photos: { id: string }[]; open_dispute: boolean; created_at: string }
  ```
  В `ReviewFormItem` добавить поле `violation_hint: number | null` (= `violationHint(n, settings.violation_penalty_hint)` при n > 0, иначе null). `other_violations` — нарушения без пункта.
- Роуты:
  - `GET /kpi/violations?period&terminal_id&employee_id&status` (view/evaluate);
  - `POST /kpi/violations` — `type: "multipart/form-data"`, поля `employee_id`, `card_item_id?`, `occurred_at?` (ISO; по умолчанию `now()`), `comment`, `photos: t.Optional(t.Files())` (evaluate с назначением; scope проверяется по действующей карте сотрудника);
  - `POST /kpi/violations/:id/cancel` `{reason}`: автор в открытом месяце или `kpi.approve`, иначе 403;
  - `GET /kpi/violation-photos/:id/file` — `Bun.file(path)` с типом.

Правила:
- `comment` — `commentOk(comment, 3)`, иначе 422 `comment_required`.
- Фото обязательно, если `violation_photo_required` — 422 `photo_required`.
- `card_item_id` должен быть активным пунктом действующей карты сотрудника — 422 `unknown_item`.
- `occurred_at` в будущем больше чем на 5 минут — 422 `bad_occurred_at`.
- Месяц нарушения (`periodOf(occurred_at)`) закрыт — 409 `period_closed`.
- Файлы ложатся на диск до вставки строк. Если транзакция упала, файлы удаляются (как в tickets).
- Создание пишет уведомление `violation_recorded` сотруднику, `dedupe_key = violation_recorded:<id>`.

- [ ] **Step 1: Написать `http/violations.test.ts`:**
  - `запись с двумя PNG — 200, photos.length 2, файл отдаётся оценщику и kpi.view своего филиала, kpi.view чужого филиала — 404`;
  - `GIF — 422 bad_photo_type; 4 фото — 422 too_many_photos; 11 МБ — 422 photo_too_large`;
  - `кривой id фото — 404`;
  - `пункт не из карты — 422 unknown_item`;
  - `без фото при violation_photo_required=true — 422 photo_required` (настройку вернуть);
  - `в форме оценки нарушение под пунктом, violation_hint 90; после cancel — пропало`;
  - `отмена: чужой оценщик — 403, автор — 200, повторная — 409 already_cancelled`.

  Файлы для теста: `new File([Uint8Array.from([0x89,0x50,0x4e,0x47])], "a.png", { type: "image/png" })`, `FormData` через `callApi`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Run** — PASS; типы чисты; `ls /tmp/kpi_test_uploads` — файлы есть только у удачных записей.
- [ ] **Step 5: Commit** `feat(kpi): журнал нарушений с фото`.

---

### Task 8: Споры и закрытие месяца

**Files:**
- Create: `backend/src/modules/kpi/disputes.ts`, `routes/disputes.ts`, `http/disputes.test.ts`
- Modify: `periods.ts` (сводка, закрытие), `routes/periods.ts` (полная сводка), `controller.ts`, `types.ts`, `reviews.ts` (флаг `open_dispute` в списке)

**Interfaces:**
- Consumes: `changeReview` (задача 6); `cancelViolation` (задача 7); `disputeDeadline`, `reviewDeadline` (задача 2); `commentOk`; `enqueue`.
- Produces:
  ```ts
  export async function openDispute(db, actor, input: { subject_type: "review" | "violation"; subject_id: string; reason: string; via?: "admin" | "telegram"; employee_actor?: boolean }): Promise<DisputeRow>;
  export async function resolveDispute(db, actor, id: string, input: { decision: "accepted" | "rejected"; comment: string; items?: ItemInput[] }): Promise<DisputeRow>;
  export async function listDisputes(db, actor, q: { status?: "open" | "accepted" | "rejected"; period?: Period }): Promise<DisputeRow[]>;
  export async function periodSummary(db, actor, period: Period): Promise<PeriodSummary>;
  export async function closePeriod(db, actor, period: Period): Promise<PeriodSummary>;
  export async function reopenPeriod(db, actor, period: Period, comment: string): Promise<PeriodSummary>;
  // types.ts
  export interface DisputeRow { id: string; subject_type: "review" | "violation"; subject_id: string; employee_id: string | null; employee_name: string | null; terminal_name: string | null; period: string; opened_via: "admin" | "telegram"; reason: string; status: "open" | "accepted" | "rejected"; resolution_comment: string | null; resolved_by_name: string | null; resolved_at: string | null; created_at: string; can_resolve: boolean }
  export interface PeriodSummary { period: string; status: "open" | "closed"; closed_at: string | null; closed_by_name: string | null; deadlines: Deadlines; counts: { employees: number; submitted: number; drafts: number; none: number; late: number; open_disputes: number }; lagging: { user_id: string; user_name: string; pending: number }[]; can_close: boolean; close_blockers: string[] }
  ```
  `openDispute` с `employee_actor: true` вызывается планом 4 из Telegram: проверка прав пропускается, `opened_by_user_id = null`.
- Роуты:
  - `GET /kpi/disputes?status&period` (view/evaluate/approve);
  - `POST /kpi/disputes` `{subject_type, subject_id, reason}` (evaluate с назначением или approve);
  - `POST /kpi/disputes/:id/resolve` `{decision, comment, items?}`;
  - `GET /kpi/periods/:period` (view/approve/manage);
  - `POST /kpi/periods/:period/close` (approve);
  - `POST /kpi/periods/:period/reopen` `{comment}` (approve).

Правила (разделы 7.1 и 7.5 спеки):
- **Открытие спора.**
  - `reason` — `commentOk(reason, settings.change_comment_min)`, иначе 422 `comment_required`.
  - Оценка должна быть `submitted`, иначе 409 `not_submitted`. Нарушение — `active`, иначе 409 `already_cancelled`.
  - После `disputeDeadline` — 409 `dispute_window_closed`. Месяц закрыт — 409 `period_closed`. Уже есть открытый — 409 `dispute_exists`.
  - По оценке пишется событие `dispute_opened`. Уведомление `dispute_opened` уходит пользователю: `evaluator_user_id` для оценки, `recorded_by` для нарушения.
- **Разбор.**
  - Право: оценщик с назначением на сотрудника или `kpi.approve`.
  - `comment` обязателен (422 `comment_required`). Уже разобран — 409 `dispute_closed`.
  - Оценка, принято: `items` обязательны и должны что-то менять. Вызывается `changeReview(..., comment)`, затем событие `dispute_resolved`.
  - Нарушение, принято: `cancelViolation(..., comment)`.
  - Уведомление `dispute_resolved` сотруднику, `dedupe_key = dispute_resolved:<id>`.
- **Закрытие месяца.**
  - Раньше `disputeDeadline` — 409 `dispute_window_open`. Есть открытые споры по месяцу — 409 `open_disputes` с `{ ids }`. Уже закрыт — 409 `already_closed`.
  - Не оценённые сотрудники закрытию не мешают, но видны в `counts.none`. `can_close` и `close_blockers` считаются по тем же правилам.
  - `lagging` — пользователи с назначениями и числом покрытых ими сотрудников без отправленной оценки, по убыванию.
- **Открыть заново** можно с комментарием (422 `comment_required`). Комментарий пишется в `reopen_comment`, статус меняется на `open`.

- [ ] **Step 1: Написать `http/disputes.test.ts`:**
  - `спор по оценке до 10 ноября — 200, событие dispute_opened, уведомление оценщику; второй — 409 dispute_exists`;
  - `спор 11 ноября по октябрю — 409 dispute_window_closed`;
  - `спор по черновику — 409 not_submitted`;
  - `разбор accepted без items — 422; с items — оценка изменена, события changed и dispute_resolved, уведомление сотруднику`;
  - `разбор rejected без комментария — 422 comment_required`;
  - `спор по нарушению accepted — нарушение cancelled`;
  - `закрытие 9 ноября — 409 dispute_window_open; 11 ноября при открытом споре — 409 open_disputes; после разбора — 200; изменение оценки оценщиком — 409 period_closed; HR — 200 и событие hr_adjusted`;
  - `reopen без комментария — 422; с комментарием — 200, status open`;
  - `сводка: counts и lagging на 3 сотрудниках (1 отправлена, 1 черновик, 1 без оценки)`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Run** — PASS; типы чисты.
- [ ] **Step 5: Commit** `feat(kpi): споры и закрытие месяца`.

---

### Task 9: Квартальные повышения и шкала

**Files:**
- Create: `backend/src/modules/kpi/raises.ts`, `routes/raises.ts`, `http/raises.test.ts`
- Modify: `controller.ts`, `types.ts`

**Interfaces:**
- Consumes: `quarterRow`, `validateTiers`, `raiseFor` (задача 3); `quarterMonths`, `isQuarterStart` (задача 2); `isPeriodClosed` (задача 8); `enqueue`; `loadDirectory`, `userNames`, `terminalNames`.
- Produces:
  ```ts
  export async function getTiers(db): Promise<Tier[]>;                         // по убыванию min_pct
  export async function saveTiers(db, actor, tiers: Tier[]): Promise<Tier[]>;   // замена целиком в транзакции; validateTiers против raise_cap
  export async function computeQuarter(db, actor, quarter: Period): Promise<RaiseRow[]>;
  export async function listRaises(db, actor, quarter: Period): Promise<RaiseRow[]>;
  export async function decideRaise(db, actor, id: string, input: { status: "approved" | "rejected"; amount?: number; comment?: string }): Promise<RaiseRow>;
  export function raisesCsv(rows: RaiseRow[]): string;                          // BOM + ";"-разделитель + CRLF
  // types.ts
  export interface Tier { min_pct: number; amount: number }
  export interface RaiseRow { id: string; quarter_start: string; employee_id: string; employee_name: string; terminal_name: string | null; card_title: string | null; months: { period: string; score_pct: number | null }[]; months_scored: number; avg_pct: number | null; suggested_amount: number; status: "proposed" | "insufficient" | "approved" | "rejected"; approved_amount: number | null; decided_by_name: string | null; decided_at: string | null; comment: string | null; periods_closed: boolean }
  ```
- Роуты:
  - `GET /kpi/raise-tiers` (любое `kpi.*`);
  - `PUT /kpi/raise-tiers` `{tiers}` (manage; 422 с кодом `validateTiers`);
  - `GET /kpi/raises?quarter` (view/approve; view — только свои филиалы);
  - `POST /kpi/raises/compute` `{quarter}` (approve);
  - `POST /kpi/raises/:id/decide` (approve);
  - `GET /kpi/raises/export?quarter` (approve). Ответ: `content-type: text/csv; charset=utf-8`, `content-disposition: attachment; filename="kpi-raises-2026-Q4.csv"`.
- Квартал не первый месяц квартала — 422 `bad_quarter`.

Правила (раздел 7.6 спеки):
- **Пересчёт.** Берутся сотрудники, у которых в квартале есть хотя бы одна отправленная оценка. Строки `approved` и `rejected` не трогаются. Остальные upsert-ом получают свежие `months`, `avg_pct`, `suggested_amount`, `status` и `computed_at`.
- **Решение.**
  - Хотя бы один месяц квартала открыт — 409 `periods_open`.
  - `amount` — от 0 до `raise_cap`, иначе 422 `bad_amount`. По умолчанию `suggested_amount`; при `rejected` сумма 0.
  - Комментарий обязателен, если строка `insufficient`, если `amount ≠ suggested_amount` или если решение уже было (422 `comment_required`).
  - Прошлое решение (`status`, `approved_amount`, `decided_by`, `decided_at`, `comment`) дописывается в `history`.
  - При `approved` уведомление `raise_approved` сотруднику с `dedupe_key = raise_approved:<id>:<decided_at>`.
- **CSV.** Колонки: `ФИО;Филиал;Карта;Месяц 1;Месяц 2;Месяц 3;Средняя;Предложение;Решение;Сумма;Комментарий`. Проценты с запятой (`94,00`), пустой месяц — пустая ячейка. Поля с `;`, `"` или переводом строки — в кавычках с удвоением `"`.

- [ ] **Step 1: Написать `http/raises.test.ts`** и юнит-тест `raisesCsv` в `backend/src/modules/kpi/raises.test.ts` (поле с `;` и кавычкой экранируется; BOM в начале).

  HTTP-тесты:
  - `пример плана: 92, 96, 94 → avg 94, proposed 300000` — три оценки отправлены за 2026-07..09 через API с `setNow`;
  - `одна оценка → insufficient, 0`;
  - `решение при открытом месяце — 409 periods_open; после закрытия трёх месяцев — 200`;
  - `сумма 600000 — 422 bad_amount`;
  - `insufficient без комментария — 422`;
  - `повторное решение без комментария — 422, с комментарием — history.length 1`;
  - `пересчёт не трогает approved`;
  - `PUT шкалы с суммой выше потолка — 422 tier_amount_over_cap`;
  - `CSV: заголовок и строка сотрудника`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Run** все тесты модуля: `bun test src/modules/kpi/*.test.ts` и `bun run test:http:kpi` — PASS; типы чисты.
- [ ] **Step 5: Commit** `feat(kpi): квартальные повышения, шкала, выгрузка`.

---

### Task 10: Доработки API для админки

Пробелы нашёл автор плана 2 (`docs/superpowers/plans/2026-10-25-kpi-2-admin.md`, раздел «Пробелы плана 1»). Закрываем пункты 1, 2, 3 и 8.

**Files:**
- Modify: `backend/src/modules/kpi/types.ts`, `routes/evaluators.ts`, `routes/employees.ts`, `employees.ts`, `routes/reviews.ts`, `reviews.ts`, `routes/violations.ts`, `violations.ts`, `disputes.ts`, `raises.ts`, `raises.test.ts`
- Test: `backend/src/modules/kpi/http/admin-gaps.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface KpiUserOption { id: string; name: string; login: string }
  // ReviewForm получает поле
  open_dispute: boolean; // есть открытый спор по этой оценке
  ```
- `GET /kpi/users` возвращает `KpiUserOption[]` (`name` — «Имя Фамилия», пусто → login).
- `GET /kpi/employees?include_uncarded=1` — только для `kpi.manage` (у остальных параметр игнорируется). Отдаёт всех активных сотрудников в видимости, в том числе без карты (`card: null`, `card_source` как есть: `override` для «не оценивается», `null` без карты).
- `kpi.approve` получает чтение там, где сейчас только evaluate/view: `GET /kpi/reviews`, `GET /kpi/reviews/form`, `GET /kpi/reviews/:id/events`, `GET /kpi/violations`, `GET /kpi/violation-photos/:id/file`. Видимость у `kpi.approve` — вся сеть (`seesNetwork`).

Заодно — три доработки по ревью задач 7 и 8:
- **Фото.** `GET /kpi/violation-photos/:id/file` отдаёт файл, только если `path.resolve(file_path)` лежит внутри `uploadsBase()`, иначе 404 `not_found`. Заголовки ответа: `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=3600`.
- **Разбор спора по оценке.** `changeReviewTx` получает опцию `{ rightsChecked?: boolean }`. `resolveDispute` передаёт `true`: права разбирающего уже проверены, и `can_resolve` должен означать, что «принять» сработает (спека 7.5: оценщик, у которого сотрудник в назначениях, — по текущему положению или по снимку). Проверка закрытого месяца остаётся.
- **Повышения (ревью задачи 9).**
  - CSV: строковая ячейка (ФИО, филиал, карта, комментарий), которая начинается с `=`, `+`, `-`, `@`, табуляции или `\r`, получает префикс `'` — защита от формул Excel. Числа не трогать.
  - Решение по умолчанию (сумма = предложение) тоже проходит проверку «целое от 0 до `raise_cap`»: потолок могли снизить после настройки шкалы.
  - `saveTiers` берёт `pg_advisory_xact_lock(hashtext('kpi_raise_tiers'))` в начале транзакции.
  - `decided_at` в `history` хранится в ISO (`new Date(...).toISOString()`).
- **Гонка спора и закрытия месяца.** `openDispute` внутри транзакции делает `insert into kpi_periods (period) … on conflict do nothing` и `select … for update` по строке месяца до проверки `isPeriodClosed`. Порядок блокировок — сначала предмет спора, потом месяц: цикла с `closePeriod` нет.

- [ ] **Step 1: Написать `http/admin-gaps.test.ts`** (период 2025-08, cleanupKpi в beforeAll/afterAll):
  - `users: элементы ровно с ключами id, name, login`;
  - `include_uncarded=1 у kpi.manage: техничка без назначения видна с card=null; у kpi.view параметр не расширяет список`;
  - `kpi.approve без view: форма, события, нарушения и фото — 200`;
  - `ReviewForm.open_dispute: false без спора; true после вставки строки kpi_disputes status=open по этой оценке`.
  - `фото: ответ с nosniff и Cache-Control private; строка фото с file_path вне uploadsBase — 404`;
  - `CSV: комментарий "=HYPERLINK(1)" выгружается как "'=HYPERLINK(1)"` (юнит-тест `raisesCsv`);
  - `решение по умолчанию при raise_cap ниже предложения — 422 bad_amount`;
  - `спор по оценке после перевода сотрудника: оценщик нового филиала (без назначения на старый) видит can_resolve=true и принимает спор — 200`.
- [ ] **Step 2: Run** `bun run test:http:kpi` — новые тесты FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Run** — PASS всё; типы чисты.
- [ ] **Step 5: Commit** `feat(kpi): API для админки — пользователи, сотрудники без карты, чтение для approve`.
