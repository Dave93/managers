# Sales Plans Copy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователю возможность копировать план продаж (одиночно или массово) на другой месяц с пропуском конфликтующих пар `(terminal_id, year, month)`.

**Architecture:** Один новый backend-endpoint `POST /sales_plans/copy`, который атомарно создаёт копии в транзакции и возвращает разделённые списки `created`/`skipped`. Frontend получает кнопку «Выбрать» → режим выбора + плавающую панель массового копирования, а также меню «⋯» на каждой карточке для одиночного копирования. Обе точки входа открывают одну общую модалку `CopyPlanDialog` с селекторами «Год / Месяц».

**Tech Stack:** Backend — Bun + Elysia + Drizzle (PostgreSQL). Frontend — Next.js 15 + React 19 + TanStack Query + Eden client + shadcn/Radix UI + sonner для тостов + lucide-react для иконок.

**Spec:** `docs/superpowers/specs/2026-05-02-sales-plans-copy-design.md`

**Контекст для нового инженера:**
- В этом репо нет автоматических тестов (`backend/package.json: "test": "echo no test"`). Каждая задача завершается ручной проверкой через curl и/или UI и коммитом.
- API типы синхронизируются автоматически: после изменения `backend/src/modules/sales_plans/controller.ts` Eden клиент в admin сразу «видит» новый endpoint в `apiClient.api.sales_plans.copy.post(...)` без регенерации.
- Backend dev-server: `cd backend && bun run --watch src/index.ts` (порт 6761). Admin: `cd admin && bun dev` (порт 6762). Удобно держать оба запущенными.
- Permission `sales_plans.add` уже есть в БД (см. seed-комментарий в `backend/src/modules/sales_plans/controller.ts:111-119`); новый endpoint реиспользует её.
- Аутентификация в admin куки/JWT — проще всего получить cookie из браузерной сессии и подставить в curl как `Cookie: connect.sid=...` (или другое имя cookie вашего сетапа). Альтернатива — открыть DevTools Network → найти любой запрос на `/api/sales_plans` → скопировать его как «Copy as cURL».

---

## File Structure

**Файлы, которые меняются:**

| Путь | Что делает | Действие |
|---|---|---|
| `backend/src/modules/sales_plans/controller.ts` | Все CRUD ручки sales_plans + новый `POST /sales_plans/copy` | Modify (добавить ручку перед последним `;`) |
| `admin/app/[locale]/admin/sales-plans/list/data-table.tsx` | Список планов (карточки + фильтры) | Modify (selectMode, чек-боксы, меню «⋯», плавающая панель) |
| `admin/app/[locale]/admin/sales-plans/list/copy-plan-dialog.tsx` | Модалка выбора целевого месяца + вызов `/sales_plans/copy` | Create |

**Файлы, которые НЕ меняются:**
- `backend/drizzle/schema.ts` — структура БД готова, новые поля не нужны.
- `backend/drizzle/migrations/*` — миграций не делаем.
- Существующие endpoints `GET / POST / PATCH / DELETE /sales_plans` — без изменений.

---

## Task 1: Backend endpoint `POST /sales_plans/copy`

**Files:**
- Modify: `backend/src/modules/sales_plans/controller.ts` (добавление в конец цепочки `.post(...)` перед закрывающим `;`)

- [ ] **Step 1: Открыть `backend/src/modules/sales_plans/controller.ts` и найти место вставки**

Файл — это одна цепочка `.use(ctx).get(...).get(...).get(...).post(...).patch(...).delete(...).post(...).get(...);`.

Нужно вставить новый `.post("/sales_plans/copy", ...)` **перед** последним `.get("/sales_plan_stats/dashboard", ...)` (строка ~594) — но самое чистое место сразу после существующего `.post("/sales_plans", ...)` (около строки 391, перед `// ─── CRUD: Update plan items ───`). Логически новая ручка ближе всего к `POST /sales_plans`.

- [ ] **Step 2: Добавить endpoint**

Вставить после закрывающей `)` существующего `.post("/sales_plans", …)` и до `// ─── CRUD: Update plan items ───`:

```ts
  // ─── CRUD: Copy plans to another month ───
  .post(
    "/sales_plans/copy",
    async ({ body, drizzle, user, set }) => {
      const { source_plan_ids, target_year, target_month } = body;

      // 1. Загрузить source-планы
      const sources = await drizzle
        .select({
          id: sales_plans.id,
          terminal_id: sales_plans.terminal_id,
          organization_id: sales_plans.organization_id,
        })
        .from(sales_plans)
        .where(inArray(sales_plans.id, source_plan_ids))
        .execute();

      const foundIds = new Set(sources.map((s) => s.id));
      const skipped: {
        source_plan_id: string;
        terminal_id: string | null;
        reason: "exists" | "source_not_found";
      }[] = [];

      // 2. Не найденные id
      for (const id of source_plan_ids) {
        if (!foundIds.has(id)) {
          skipped.push({ source_plan_id: id, terminal_id: null, reason: "source_not_found" });
        }
      }

      if (sources.length === 0) {
        return { created: [], skipped };
      }

      // 3. Конфликты: какие пары (terminal_id, target_year, target_month) уже есть
      const sourceTerminalIds = sources.map((s) => s.terminal_id);
      const existing = await drizzle
        .select({ terminal_id: sales_plans.terminal_id })
        .from(sales_plans)
        .where(
          and(
            inArray(sales_plans.terminal_id, sourceTerminalIds),
            eq(sales_plans.year, target_year),
            eq(sales_plans.month, target_month)
          )
        )
        .execute();

      const conflictingTerminals = new Set(existing.map((e) => e.terminal_id));

      // 4. Дедуп внутри одного запроса (несколько source-id с одним terminal_id)
      const seenTerminals = new Set<string>();
      const toCreate: typeof sources = [];
      for (const s of sources) {
        if (conflictingTerminals.has(s.terminal_id) || seenTerminals.has(s.terminal_id)) {
          skipped.push({
            source_plan_id: s.id,
            terminal_id: s.terminal_id,
            reason: "exists",
          });
          continue;
        }
        seenTerminals.add(s.terminal_id);
        toCreate.push(s);
      }

      if (toCreate.length === 0) {
        return { created: [], skipped };
      }

      // 5. Загрузить items всех создаваемых source-планов одним запросом
      const sourceIdsToCreate = toCreate.map((s) => s.id);
      const sourceItems = await drizzle
        .select()
        .from(sales_plan_items)
        .where(inArray(sales_plan_items.plan_id, sourceIdsToCreate))
        .execute();

      const itemsBySource: Record<string, typeof sourceItems> = {};
      for (const item of sourceItems) {
        if (!itemsBySource[item.plan_id]) itemsBySource[item.plan_id] = [];
        itemsBySource[item.plan_id].push(item);
      }

      // 6. Транзакция: insert планов + items
      const created: { id: string; terminal_id: string }[] = [];

      await drizzle.transaction(async (tx) => {
        for (const src of toCreate) {
          const inserted = await tx
            .insert(sales_plans)
            .values({
              terminal_id: src.terminal_id,
              organization_id: src.organization_id,
              year: target_year,
              month: target_month,
              created_by: user?.id,
            })
            .returning({ id: sales_plans.id })
            .execute();

          const newPlanId = inserted[0].id;
          created.push({ id: newPlanId, terminal_id: src.terminal_id });

          const items = itemsBySource[src.id] ?? [];
          if (items.length > 0) {
            await tx
              .insert(sales_plan_items)
              .values(
                items.map((it) => ({
                  plan_id: newPlanId,
                  product_id: it.product_id,
                  product_name: it.product_name,
                  planned_qty: it.planned_qty,
                }))
              )
              .execute();
          }
        }
      });

      return { created, skipped };
    },
    {
      permission: "sales_plans.add",
      body: t.Object({
        source_plan_ids: t.Array(t.String(), { minItems: 1 }),
        target_year: t.Integer({ minimum: 2020, maximum: 2100 }),
        target_month: t.Integer({ minimum: 1, maximum: 12 }),
      }),
    }
  )
```

Импорты в начале файла (`sales_plans, sales_plan_items, sales_plan_stats, terminals, credentials` и `SQLWrapper, sql, and, eq, inArray`) уже включают всё необходимое — добавлять ничего не нужно.

- [ ] **Step 3: Запустить backend**

```bash
cd backend && bun run --watch src/index.ts
```

Ожидание: сервер стартует без ошибок типов (`bun` тут также проверяет TS). Если есть ошибка — прочитать сообщение и поправить (типичные: пропущенный импорт, опечатка в имени поля).

- [ ] **Step 4: Smoke-тест успешного копирования через curl**

Получить cookie из любой залогиненной сессии admin (DevTools → Network → "Copy as cURL" любого запроса) и подставить в команду ниже. Заменить `<PLAN_ID>` на реальный id одного из существующих планов (можно взять из `GET /api/sales_plans?limit=5&offset=0`).

```bash
curl -X POST http://localhost:6761/api/sales_plans/copy \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{
    "source_plan_ids": ["<PLAN_ID>"],
    "target_year": 2027,
    "target_month": 1
  }'
```

Ожидание (если 2027/01 для этого терминала ещё нет):
```json
{ "created": [{ "id": "<new-uuid>", "terminal_id": "<terminal-uuid>" }], "skipped": [] }
```

Проверить в БД, что план реально создался:
```sql
SELECT id, terminal_id, year, month FROM sales_plans
 WHERE year=2027 AND month=1
 ORDER BY created_at DESC LIMIT 3;

SELECT plan_id, product_name, planned_qty FROM sales_plan_items
 WHERE plan_id='<new-uuid>';
```

Items нового плана должны 1-в-1 соответствовать items source-плана (тот же `product_id`, `product_name`, `planned_qty`).

- [ ] **Step 5: Smoke-тест конфликта**

Повторить тот же запрос ещё раз с тем же `target_year/target_month`.

Ожидание:
```json
{ "created": [], "skipped": [{ "source_plan_id": "<PLAN_ID>", "terminal_id": "<term>", "reason": "exists" }] }
```

В БД новых записей появиться не должно (`SELECT count(*) FROM sales_plans WHERE year=2027 AND month=1 AND terminal_id=<term>` = 1).

- [ ] **Step 6: Smoke-тест частичного успеха**

Сделать запрос с двумя id, где один уже скопирован, а другой — нет:

```bash
curl -X POST http://localhost:6761/api/sales_plans/copy \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{
    "source_plan_ids": ["<PLAN_ID_A>", "<PLAN_ID_B>"],
    "target_year": 2027,
    "target_month": 1
  }'
```

Ожидание: один объект в `created`, один в `skipped` с `reason: "exists"`.

- [ ] **Step 7: Smoke-тест несуществующего id**

```bash
curl -X POST http://localhost:6761/api/sales_plans/copy \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{
    "source_plan_ids": ["00000000-0000-0000-0000-000000000000"],
    "target_year": 2027,
    "target_month": 2
  }'
```

Ожидание:
```json
{ "created": [], "skipped": [{ "source_plan_id": "00000000-...", "terminal_id": null, "reason": "source_not_found" }] }
```

- [ ] **Step 8: Smoke-тест валидации схемы**

```bash
# Пустой массив
curl -X POST http://localhost:6761/api/sales_plans/copy \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{ "source_plan_ids": [], "target_year": 2027, "target_month": 1 }'

# month вне диапазона
curl -X POST http://localhost:6761/api/sales_plans/copy \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{ "source_plan_ids": ["x"], "target_year": 2027, "target_month": 13 }'
```

Ожидание: оба возвращают `422`/`400` с ошибкой валидации Elysia (точный код зависит от настройки validator hook — главное чтобы НЕ было `200`).

- [ ] **Step 9: Очистить тестовые данные**

```sql
DELETE FROM sales_plan_items WHERE plan_id IN
  (SELECT id FROM sales_plans WHERE year=2027 AND month IN (1,2));
DELETE FROM sales_plans WHERE year=2027 AND month IN (1,2);
```

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/sales_plans/controller.ts
git commit -m "$(cat <<'EOF'
feat(sales_plans): добавить endpoint POST /sales_plans/copy

Поддерживает копирование одного или нескольких планов на другой месяц
с пропуском конфликтных пар (terminal_id, year, month). Items копируются
1:1, статистика продаж не переносится. Транзакционная вставка.
EOF
)"
```

---

## Task 2: Frontend — выделить компонент карточки + меню «⋯»

**Files:**
- Modify: `admin/app/[locale]/admin/sales-plans/list/data-table.tsx`

Перед добавлением selectMode разнесём карточку и добавим меню «⋯», чтобы коммиты были чистыми и можно было проверить одиночное копирование, не путая его с массовым.

- [ ] **Step 1: Добавить импорты в `data-table.tsx`**

В начале файла (после существующих импортов) добавить:

```tsx
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@admin/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import { CopyPlanDialog } from "./copy-plan-dialog";
```

Замечание: `CopyPlanDialog` пока не существует — создадим в Task 3. Если линтер ругается на несуществующий импорт, оставить эту строку закомментированной до Task 3 и раскомментировать там.

- [ ] **Step 2: Добавить состояние модалки и роутер в `DataTable`**

После строки `const [monthFilter, setMonthFilter] = useState(String(now.getMonth() + 1));`:

```tsx
const router = useRouter();
const [copyDialogOpen, setCopyDialogOpen] = useState(false);
const [copySourceIds, setCopySourceIds] = useState<string[]>([]);
const [copySourceLabel, setCopySourceLabel] = useState("");
const [copySourceYear, setCopySourceYear] = useState(now.getFullYear());
const [copySourceMonth, setCopySourceMonth] = useState(now.getMonth() + 1);
```

- [ ] **Step 3: Добавить хелпер открытия модалки**

После `useQuery(...)` блока:

```tsx
const openSingleCopy = (plan: SalesPlan) => {
  setCopySourceIds([plan.id]);
  setCopySourceLabel(
    `${plan.terminal_name || plan.terminal_id.substring(0, 8)} · ${MONTHS[plan.month - 1]} ${plan.year}`
  );
  setCopySourceYear(plan.year);
  setCopySourceMonth(plan.month);
  setCopyDialogOpen(true);
};
```

- [ ] **Step 4: Заменить `<Link>`-обёртку карточки**

Удалить:

```tsx
<Link
  key={plan.id}
  href={`/${locale}/admin/sales-plans/${plan.id}/edit`}
  className="block"
>
  <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3 active:bg-muted/50 transition-colors">
    ...
  </div>
</Link>
```

И заменить на (импорт `Link` остаётся — пока не удалять):

```tsx
<div
  key={plan.id}
  role="button"
  tabIndex={0}
  onClick={() => router.push(`/${locale}/admin/sales-plans/${plan.id}/edit`)}
  onKeyDown={(e) => {
    if (e.key === "Enter") router.push(`/${locale}/admin/sales-plans/${plan.id}/edit`);
  }}
  className="rounded-xl border bg-card p-4 shadow-sm space-y-3 active:bg-muted/50 transition-colors cursor-pointer"
>
  <div className="flex items-center justify-between">
    <span className="font-semibold">
      {plan.terminal_name || plan.terminal_id.substring(0, 8)}
    </span>
    <div className="flex items-center gap-2">
      <span className={`text-xl font-bold ${getProgressColor(plan.progress_pct)}`}>
        {plan.progress_pct}%
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          asChild
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="p-1 rounded hover:bg-muted"
            aria-label="Действия"
          >
            <MoreVertical className="size-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            onSelect={() => router.push(`/${locale}/admin/sales-plans/${plan.id}/edit`)}
          >
            Редактировать
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openSingleCopy(plan)}>
            Копировать
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>

  <div className={`rounded-full h-2 ${getProgressTrack(plan.progress_pct)}`}>
    <div
      className={`h-full rounded-full ${getProgressBg(plan.progress_pct)}`}
      style={{ width: `${Math.min(plan.progress_pct, 100)}%` }}
    />
  </div>

  <div className="flex items-center justify-between text-sm text-muted-foreground">
    <span>{MONTHS[plan.month - 1]} {plan.year}</span>
    <span>{plan.items_count} продуктов</span>
  </div>

  <div className="text-xs text-muted-foreground">
    Создан: {dayjs(plan.created_at).format("DD.MM.YYYY")}
  </div>
</div>
```

(Импорт `Link` теперь не используется — удалить строку `import Link from "next/link";` или оставить, если ESLint не ругается на неиспользуемый импорт.)

- [ ] **Step 5: Закомментировать импорт `CopyPlanDialog`**

Чтобы можно было собрать сейчас, временно:

```tsx
// import { CopyPlanDialog } from "./copy-plan-dialog";
```

И в JSX в конце возвращаемого блока (перед закрывающим `</div>` корневого `<div className="space-y-4">`) **пока не вставлять** `<CopyPlanDialog ... />`. Сделаем в Task 3.

- [ ] **Step 6: Запустить admin-dev и проверить визуально**

```bash
cd admin && bun dev
```

Открыть `http://localhost:6762/<locale>/admin/sales-plans/list`. Ожидание:

1. Карточки выглядят как раньше + справа от процента появилась иконка-троеточие.
2. Тап по карточке (вне иконки) → переход на `/edit/<id>` (как раньше).
3. Тап по троеточию → открывается dropdown с пунктами «Редактировать» и «Копировать». Карточка при этом НЕ переходит на edit.
4. «Редактировать» → переход на edit.
5. «Копировать» → ничего видимого (модалки пока нет — это ОК).

- [ ] **Step 7: Commit**

```bash
git add admin/app/\[locale\]/admin/sales-plans/list/data-table.tsx
git commit -m "$(cat <<'EOF'
feat(sales-plans): меню '⋯' на карточке плана с действиями

Заменяет Link-обёртку на router.push, освобождая событийный канал
для DropdownMenu. Пока два пункта: Редактировать, Копировать
(копирование без модалки активируется в следующем коммите).
EOF
)"
```

---

## Task 3: Компонент `CopyPlanDialog`

**Files:**
- Create: `admin/app/[locale]/admin/sales-plans/list/copy-plan-dialog.tsx`

- [ ] **Step 1: Создать файл `copy-plan-dialog.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@admin/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import { toast } from "sonner";

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sourcePlanIds: string[];
  sourceLabel: string;          // "Les Ailes Markaz-5 · Апрель 2026" или "5 планов · Апрель 2026"
  sourceYear: number;
  sourceMonth: number;          // 1..12
  onSuccess: () => void;        // вызывается ПОСЛЕ инвалидации запросов
};

function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

export function CopyPlanDialog({
  open,
  onOpenChange,
  sourcePlanIds,
  sourceLabel,
  sourceYear,
  sourceMonth,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();

  const [targetYear, setTargetYear] = useState(String(sourceYear));
  const [targetMonth, setTargetMonth] = useState(String(sourceMonth));

  // При каждом открытии — пересчитать дефолт = source + 1 месяц
  useEffect(() => {
    if (open) {
      const { year, month } = nextMonth(sourceYear, sourceMonth);
      setTargetYear(String(year));
      setTargetMonth(String(month));
    }
  }, [open, sourceYear, sourceMonth]);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, status } = await apiClient.api.sales_plans.copy.post({
        source_plan_ids: sourcePlanIds,
        target_year: Number(targetYear),
        target_month: Number(targetMonth),
      });
      if (status !== 200) {
        throw new Error((data as any)?.message ?? "Ошибка копирования");
      }
      return data as { created: any[]; skipped: any[] };
    },
    onSuccess: (res) => {
      const createdN = res.created.length;
      const skippedN = res.skipped.length;

      if (createdN === 0 && skippedN > 0) {
        toast.error("Все планы уже существуют в выбранном месяце");
      } else if (skippedN === 0) {
        toast.success(`Скопировано: ${createdN}`);
      } else {
        toast(`Создано: ${createdN}. Пропущено: ${skippedN} (уже существуют)`);
      }

      queryClient.invalidateQueries({ queryKey: ["sales_plans"] });
      onOpenChange(false);
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isMulti = sourcePlanIds.length > 1;
  const title = isMulti ? `Копировать планы (${sourcePlanIds.length})` : "Копировать план";
  const description = isMulti
    ? `${sourceLabel} будет скопирован в выбранный месяц`
    : `${sourceLabel} будет скопирован в выбранный месяц`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{description}</p>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Год</label>
            <Select value={targetYear} onValueChange={setTargetYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2025">2025</SelectItem>
                <SelectItem value="2026">2026</SelectItem>
                <SelectItem value="2027">2027</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Месяц</label>
            <Select value={targetMonth} onValueChange={setTargetMonth}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((name, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Копирование..." : "Копировать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Раскомментировать импорт и вставить компонент в `data-table.tsx`**

Раскомментировать строку:

```tsx
import { CopyPlanDialog } from "./copy-plan-dialog";
```

В конце возвращаемого JSX `DataTable`, ПЕРЕД закрывающим `</div>` корневого блока `<div className="space-y-4">`, вставить:

```tsx
<CopyPlanDialog
  open={copyDialogOpen}
  onOpenChange={setCopyDialogOpen}
  sourcePlanIds={copySourceIds}
  sourceLabel={
    copySourceIds.length > 1
      ? `${copySourceIds.length} планов · ${MONTHS[copySourceMonth - 1]} ${copySourceYear}`
      : copySourceLabel
  }
  sourceYear={copySourceYear}
  sourceMonth={copySourceMonth}
  onSuccess={() => {
    setCopySourceIds([]);
    setCopySourceLabel("");
  }}
/>
```

- [ ] **Step 3: Smoke-тест одиночного копирования**

```bash
cd admin && bun dev
```

В UI:
1. Открыть список планов с фильтром «Год: 2026, Месяц: Апрель» (где есть существующие планы).
2. На любой карточке тап по «⋯» → «Копировать».
3. Открывается модалка «Копировать план» с подзаголовком «Les Ailes ... · Апрель 2026 будет скопирован...». Год/Месяц по умолчанию — Май 2026.
4. Поменять месяц на «Июль» → нажать «Копировать».
5. Появляется toast «Скопировано: 1». Модалка закрылась.
6. Сменить фильтр в шапке на «Июль 2026» → должна появиться карточка скопированного плана с тем же терминалом и теми же продуктами (`X продуктов`).
7. Открыть `/sales-plans/<id>/edit` для нового плана — список товаров и qty 1-в-1 совпадают с источником.

- [ ] **Step 4: Smoke-тест конфликта**

Повторить копирование того же плана в тот же «Июль 2026».

Ожидание: toast.error «Все планы уже существуют в выбранном месяце». Список не меняется. В БД новых записей нет.

- [ ] **Step 5: Smoke-тест декабрь→январь+1**

Открыть фильтр «Декабрь 2026» (если планов нет — создать один через UI). На карточке тап «⋯» → «Копировать». Дефолт-селекты должны показать «Январь 2027» (год сдвинулся).

- [ ] **Step 6: Очистить тестовые планы (через UI или SQL)**

```sql
DELETE FROM sales_plan_items WHERE plan_id IN
  (SELECT id FROM sales_plans WHERE year=2026 AND month=7 AND created_at > now() - interval '1 hour');
DELETE FROM sales_plans
  WHERE year=2026 AND month=7 AND created_at > now() - interval '1 hour';
```

- [ ] **Step 7: Commit**

```bash
git add admin/app/\[locale\]/admin/sales-plans/list/copy-plan-dialog.tsx \
        admin/app/\[locale\]/admin/sales-plans/list/data-table.tsx
git commit -m "$(cat <<'EOF'
feat(sales-plans): модалка копирования плана через меню '⋯'

Добавляет CopyPlanDialog с селекторами целевого года и месяца.
По умолчанию — следующий месяц от источника (с переходом на
следующий год при декабре). Toast разделяет created/skipped.
EOF
)"
```

---

## Task 4: Frontend — режим выбора и массовое копирование

**Files:**
- Modify: `admin/app/[locale]/admin/sales-plans/list/data-table.tsx`

- [ ] **Step 1: Добавить состояния selectMode**

После уже существующих state-объявлений в `DataTable`:

```tsx
const [selectMode, setSelectMode] = useState(false);
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
```

- [ ] **Step 2: Сбрасывать selectMode при смене фильтров**

Заменить обработчики `Select`:

```tsx
<Select value={yearFilter} onValueChange={(v) => { setYearFilter(v); setPageIndex(0); }}>
```

на:

```tsx
<Select
  value={yearFilter}
  onValueChange={(v) => {
    setYearFilter(v);
    setPageIndex(0);
    setSelectMode(false);
    setSelectedIds(new Set());
  }}
>
```

Такое же изменение для `monthFilter`.

- [ ] **Step 3: Добавить кнопку «Выбрать» / «Отмена» в шапку**

После двух `<Select>` в шапке (но внутри `<div className="flex items-center gap-2">`) добавить:

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={() => {
    if (selectMode) {
      setSelectedIds(new Set());
    }
    setSelectMode((v) => !v);
  }}
>
  {selectMode ? "Отмена" : "Выбрать"}
</Button>
```

- [ ] **Step 4: Хелпер toggle**

После `openSingleCopy`:

```tsx
const toggleSelected = (planId: string) => {
  setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(planId)) next.delete(planId);
    else next.add(planId);
    return next;
  });
};
```

- [ ] **Step 5: Изменить рендер карточки для selectMode**

В блоке `{plans.map((plan) => ( ... ))}` заменить корневой `<div role="button" ...>` на условный рендер:

```tsx
{plans.map((plan) => {
  const isSelected = selectedIds.has(plan.id);
  return (
    <div
      key={plan.id}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (selectMode) {
          toggleSelected(plan.id);
        } else {
          router.push(`/${locale}/admin/sales-plans/${plan.id}/edit`);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (selectMode) toggleSelected(plan.id);
          else router.push(`/${locale}/admin/sales-plans/${plan.id}/edit`);
        }
      }}
      className={`rounded-xl border bg-card p-4 shadow-sm space-y-3 active:bg-muted/50 transition-colors cursor-pointer ${isSelected ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {selectMode && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleSelected(plan.id)}
              onClick={(e) => e.stopPropagation()}
              className="size-4 accent-primary"
              aria-label={`Выбрать ${plan.terminal_name ?? plan.terminal_id}`}
            />
          )}
          <span className="font-semibold">
            {plan.terminal_name || plan.terminal_id.substring(0, 8)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xl font-bold ${getProgressColor(plan.progress_pct)}`}>
            {plan.progress_pct}%
          </span>
          {!selectMode && (
            <DropdownMenu>
              <DropdownMenuTrigger
                asChild
                onClick={(e) => e.stopPropagation()}
              >
                <button className="p-1 rounded hover:bg-muted" aria-label="Действия">
                  <MoreVertical className="size-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem
                  onSelect={() => router.push(`/${locale}/admin/sales-plans/${plan.id}/edit`)}
                >
                  Редактировать
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openSingleCopy(plan)}>
                  Копировать
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className={`rounded-full h-2 ${getProgressTrack(plan.progress_pct)}`}>
        <div
          className={`h-full rounded-full ${getProgressBg(plan.progress_pct)}`}
          style={{ width: `${Math.min(plan.progress_pct, 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{MONTHS[plan.month - 1]} {plan.year}</span>
        <span>{plan.items_count} продуктов</span>
      </div>

      <div className="text-xs text-muted-foreground">
        Создан: {dayjs(plan.created_at).format("DD.MM.YYYY")}
      </div>
    </div>
  );
})}
```

- [ ] **Step 6: Добавить плавающую панель массового действия**

После блока с пагинацией `{total > 0 && (...)}`, перед `<CopyPlanDialog ... />`, добавить:

```tsx
{selectMode && selectedIds.size > 0 && (
  <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border bg-card/95 backdrop-blur p-3 shadow-lg">
    <span className="text-sm font-medium">Выбрано: {selectedIds.size}</span>
    <Button
      onClick={() => {
        setCopySourceIds([...selectedIds]);
        setCopySourceLabel(""); // используется только в одиночном режиме
        setCopySourceYear(Number(yearFilter));
        setCopySourceMonth(Number(monthFilter));
        setCopyDialogOpen(true);
      }}
    >
      Копировать
    </Button>
  </div>
)}
```

- [ ] **Step 7: Расширить `onSuccess` модалки — выходить из selectMode**

Изменить `onSuccess` у `<CopyPlanDialog ...>`:

```tsx
onSuccess={() => {
  setCopySourceIds([]);
  setCopySourceLabel("");
  setSelectMode(false);
  setSelectedIds(new Set());
}}
```

- [ ] **Step 8: Smoke-тест selectMode + массовое копирование**

```bash
cd admin && bun dev
```

В UI:
1. Список «Год: 2026, Месяц: Апрель».
2. Тап «Выбрать» — кнопка меняется на «Отмена», на карточках появились чек-боксы, меню «⋯» исчезло.
3. Отметить 3 разные карточки. Внизу появилась панель «Выбрано: 3 [Копировать]».
4. Тап «Копировать» → модалка «Копировать планы (3)», подзаголовок «3 планов · Апрель 2026...», дефолт = Май 2026.
5. Выбрать «Сентябрь 2026» → «Копировать».
6. Toast «Скопировано: 3» (или с пропусками, если для каких-то терминалов сентябрь уже есть). selectMode выключился, чек-боксы пропали.
7. Сменить фильтр на «Сентябрь 2026» — три новых карточки на месте.

- [ ] **Step 9: Smoke-тест выхода из selectMode при смене фильтра**

1. Включить «Выбрать», отметить 2 карточки.
2. Сменить «Месяц» в фильтре с Апрель на Май.
3. selectMode выключен, чек-боксов нет, плавающей панели нет.

- [ ] **Step 10: Smoke-тест частичного skip в массовом**

1. Создать ситуацию: для 2 терминалов уже есть планы на «Октябрь 2026», для 3-го — нет.
2. Включить «Выбрать», отметить все 3 в исходном месяце.
3. «Копировать» → выбрать «Октябрь 2026» → «Копировать».
4. Toast «Создано: 1. Пропущено: 2 (уже существуют)».
5. На «Октябрь 2026» теперь все 3 терминала имеют план (один новый + два уже существовавших).

- [ ] **Step 11: Очистить тестовые данные**

```sql
DELETE FROM sales_plan_items WHERE plan_id IN
  (SELECT id FROM sales_plans WHERE year=2026 AND month IN (9, 10)
     AND created_at > now() - interval '1 hour');
DELETE FROM sales_plans
  WHERE year=2026 AND month IN (9, 10) AND created_at > now() - interval '1 hour';
```

- [ ] **Step 12: Commit**

```bash
git add admin/app/\[locale\]/admin/sales-plans/list/data-table.tsx
git commit -m "$(cat <<'EOF'
feat(sales-plans): режим выбора и массовое копирование планов

Кнопка 'Выбрать' включает режим с чек-боксами на карточках и
плавающей панелью 'Копировать (N)'. selectMode сбрасывается при
смене фильтра год/месяц и после успешного копирования.
EOF
)"
```

---

## Task 5: Финальная проверка

- [ ] **Step 1: Lint admin**

```bash
cd admin && bun lint
```

Ожидание: нет новых ошибок (могут быть pre-existing — игнорируем). Если ругается на `Link` неиспользуемый — удалить импорт.

- [ ] **Step 2: Сценарий end-to-end**

1. Запустить и backend, и admin.
2. Создать новый план через `/sales-plans/create` (терминал X, Апрель 2026, 2 продукта).
3. Скопировать его одиночно через «⋯» → «Копировать» → Май 2026.
4. Открыть скопированный план — всё совпадает.
5. Удалить через UI/SQL обе записи.
6. На двух разных терминалах создать планы на Апрель 2026.
7. «Выбрать» → отметить оба → «Копировать» → Июнь 2026.
8. Toast «Скопировано: 2», в списке Июнь 2026 — оба терминала.
9. Повторить шаг 7 → toast.error «все уже существуют».

- [ ] **Step 3: Финальный коммит — пустой sanity merge marker (опционально)**

Если все коммиты до этого были чистыми, шаг можно пропустить. Иначе:

```bash
git log --oneline -5
```

Должно быть три feat-коммита (Task 1, 2+3, 4). Если что-то упустили — подравнять.

---

## Notes for the engineer

- **Не переустанавливать пакеты.** Все нужные зависимости (`@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `lucide-react`, `sonner`, `@tanstack/react-query`) уже стоят в `admin/package.json`.
- **Не трогать `backend/drizzle/schema.ts` и миграции.** Структура БД не меняется.
- **Eden-типы.** После сохранения backend-файла Bun watch перезапускает сервер, и admin tsserver автоматически подтягивает новые типы. Если `apiClient.api.sales_plans.copy` подсвечивается как `any` — перезапустить tsserver в IDE (или закрыть/открыть файл).
- **CSRF / cookie auth** при curl-проверках. Если cookie-аутентификация требует CSRF-токена — проще проверять через UI вместо curl. Backend и UI ходят на один API-сервер, токены берутся одинаково.
- **Toast «default» (не success/error)** для частичного успеха — это `toast(...)` без модификатора. Если в проекте используется только `.success/.error/.info` — заменить на `toast.info(...)`.
