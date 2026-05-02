# Копирование планов продаж — дизайн

**Дата:** 2026-05-02
**Контекст:** `admin/app/[locale]/admin/sales-plans/list` + `backend/src/modules/sales_plans/controller.ts`

## Цель

Дать пользователю возможность копировать существующий план продаж на другой месяц — как одиночно (с конкретной карточки), так и массово (несколько планов одной операцией).

## Бизнес-правила

- **Уникальность пары `(terminal_id, year, month)` сохраняется.** Один терминал в одном месяце имеет максимум один план.
- **Конфликт = пропуск.** Если для целевой пары `(terminal_id, target_year, target_month)` уже существует план — копия не создаётся, существующий план не трогается.
- **Целевой период — один месяц** за операцию (мульти-месяцы не поддерживаются).
- **Что копируется:** `sales_plan_items` (продукт + `planned_qty` 1:1).
- **Что не копируется:** `sales_plan_stats` (история продаж — привязана к датам).
- **Источник:** список `source_plan_ids` (1+ id). Backend не фильтрует по `organization_id` источника — UI показывает только планы своей организации (через существующий фильтр `parseFilterFields`), поэтому массовый выбор всегда ограничен ею. Cross-org защита через прямой POST вне scope этого ввода.

## Backend

### Новый endpoint

`POST /sales_plans/copy` в `backend/src/modules/sales_plans/controller.ts`.

**Permission:** `sales_plans.add` (переиспользуем — это де-факто создание планов).

**Body schema (Elysia `t`):**

```ts
{
  source_plan_ids: t.Array(t.String(), { minItems: 1 }),
  target_year: t.Integer({ minimum: 2020, maximum: 2100 }),
  target_month: t.Integer({ minimum: 1, maximum: 12 }),
}
```

**Алгоритм:**

1. Загрузить `sales_plans` по `inArray(id, source_plan_ids)` + items (одним запросом или двумя).
2. Если найдено меньше id, чем запрошено — недостающие добавляются в `skipped` с `reason: "source_not_found"`.
3. Собрать множество terminal_id из найденных source-планов.
4. Одним запросом `SELECT terminal_id FROM sales_plans WHERE year=target_year AND month=target_month AND terminal_id IN (...)` найти конфликты.
5. В транзакции `drizzle.transaction`:
   - Для каждого source-плана без конфликта → `INSERT INTO sales_plans (terminal_id, organization_id, year=target_year, month=target_month, created_by=user.id)`.
   - Bulk `INSERT INTO sales_plan_items` копией items (по `product_id`, `product_name`, `planned_qty`) с новыми `plan_id`.
6. Source-план без items → новый план создаётся, items не вставляются.
7. Дедуп внутри запроса: если несколько source-id принадлежат одному терминалу — первый создаётся, остальные `skipped` с `reason: "exists"`.

**Response:**

```ts
{
  created: { id: string, terminal_id: string }[],
  skipped: {
    source_plan_id: string,
    terminal_id: string | null,
    reason: "exists" | "source_not_found"
  }[]
}
```

**Edge cases:**

- Пустой `source_plan_ids` → отсекается схемой (`minItems: 1`).
- `target_month` вне 1..12 / `target_year` вне диапазона → отсекается схемой.
- Транзакция падает на одном insert → весь rollback, 500.

## Frontend

### Изменения в `admin/app/[locale]/admin/sales-plans/list/data-table.tsx`

**Новые состояния:**

```ts
const [selectMode, setSelectMode] = useState(false);
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [copyDialogOpen, setCopyDialogOpen] = useState(false);
const [copySourceIds, setCopySourceIds] = useState<string[]>([]);
```

**Шапка:**

- Справа от селектов «Год / Месяц» — текстовая кнопка:
  - `selectMode === false` → «Выбрать»
  - `selectMode === true` → «Отмена»
- При выходе из selectMode чистится `selectedIds`.

**Карточка плана:**

- `selectMode === false` (нынешнее поведение + меню):
  - Тап по карточке → переход на `/sales-plans/[id]/edit` (как сейчас).
  - В правом верхнем углу карточки — кнопка-иконка «⋯» (три точки) рядом с процентом прогресса (процент сдвигается левее, чтобы освободить место). `stopPropagation` на тапе кнопки. Открывает `Popover/DropdownMenu` с пунктами:
    - **Редактировать** → переход на edit.
    - **Копировать** → `setCopySourceIds([plan.id]); setCopyDialogOpen(true)`.
- `selectMode === true`:
  - Слева на карточке — `Checkbox`, `checked = selectedIds.has(plan.id)`.
  - Тап по карточке (вся область, `Link` отключается) → toggle id в `selectedIds`.
  - Меню «⋯» в этом режиме скрыто.

**Плавающая панель действий** (рендерится только при `selectMode && selectedIds.size > 0`):

- Sticky внизу контента (или fixed над bottom-nav, если есть).
- Лево: «Выбрано: N».
- Право: кнопка «Копировать» → `setCopySourceIds([...selectedIds]); setCopyDialogOpen(true)`.

**Сброс selectMode** при смене фильтра год/месяц — иначе выбранные id будут несогласованы с показываемыми карточками.

### Новый компонент `CopyPlanDialog.tsx`

Расположение: `admin/app/[locale]/admin/sales-plans/list/copy-plan-dialog.tsx`.

**Props:**

```ts
{
  open: boolean,
  onOpenChange: (v: boolean) => void,
  sourcePlanIds: string[],
  sourceLabel: string,         // "Les Ailes Markaz-5 · Апрель 2026" или "5 планов · Апрель 2026"
  defaultYear: number,         // источник.year, если источник.month < 12; иначе источник.year + 1
  defaultMonth: number,        // источник.month === 12 ? 1 : источник.month + 1 — следующий месяц
  onSuccess: () => void,       // вызывает invalidateQueries + сброс selectMode
}
```

**UI:**

- `Dialog` (Radix) с заголовком «Копировать план» / «Копировать планы (N)».
- Подзаголовок: текст с `sourceLabel` + «будет скопирован в выбранный месяц».
- Два `Select`: Год (2025/2026/2027) + Месяц (Январь…Декабрь). Default — следующий месяц от источника.
- Кнопки: «Отмена» (закрывает) / «Копировать» (`disabled = mutation.isPending`).

**Mutation:**

- `apiClient.api.sales_plans.copy.post({ source_plan_ids, target_year, target_month })`.
- onSuccess:
  - Все попали в `created` → `toast.success("Скопировано: N")`.
  - Часть в `skipped` → `toast("Создано: X. Пропущено: Y (уже существуют)")`.
  - Все в `skipped` → `toast.error("Все планы уже существуют в выбранном месяце")`.
  - `queryClient.invalidateQueries({ queryKey: ["sales_plans"] })`.
  - `onSuccess()` для очистки selectMode.
  - Закрытие модалки.

## Permissions

- Сервер: новый endpoint защищён существующим `sales_plans.add`. Никаких новых строк в `permissions` / `roles_permissions`.

## Что вне scope

- Удаление плана из меню «⋯» (есть отдельный endpoint, но интеграция UI — отдельная задача).
- Множественный выбор целевых месяцев / диапазон.
- Изменение `planned_qty` в момент копирования (полная копия 1:1).
- Копирование между терминалами (одного терминала ↔ другого).
- Копирование `sales_plan_stats`.

## Файлы — что меняется

- **Изменяется** `backend/src/modules/sales_plans/controller.ts` — добавление endpoint `POST /sales_plans/copy`.
- **Изменяется** `admin/app/[locale]/admin/sales-plans/list/data-table.tsx` — selectMode, чек-боксы, кнопка «Выбрать», плавающая панель, меню «⋯» на карточке.
- **Создаётся** `admin/app/[locale]/admin/sales-plans/list/copy-plan-dialog.tsx` — модалка копирования.
- **Не меняются** schema/миграции, существующие endpoints, permissions в БД.
