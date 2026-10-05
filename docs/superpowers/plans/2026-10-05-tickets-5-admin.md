# Заявки — План 5: админка офиса и планшет менеджера

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать людям экраны: офис видит заявки, фирмы, типы и очередь на оплату; менеджер филиала создаёт заявку с планшета и принимает работу.

**Architecture:** Next.js-админка `office_admin`, те же приёмы, что в разделе «Паспорт»: страница + `columns.tsx` + `data-table.tsx` + `_components/*`, типизированные обёртки в `admin/lib/tickets-api.ts`, TanStack Query в `use-*.ts`, доступ через `CanAccess`. Бэкенд не трогаем, кроме двух правок, которые всплыли при живой настройке: чтение списка типов закрыто не тем правом, и привязка к боту затирает язык исполнителя.

**Tech Stack:** Next.js 15, React 19, TypeScript, TanStack Query, shadcn/ui + Tailwind, next-intl, Eden-клиент к Elysia.

**Spec:** `docs/superpowers/specs/2026-09-12-tickets-design.md` (разделы 9 «Планшет менеджера» и 10 «Офис: наблюдение и оплата»)

**Предыдущие планы:** `docs/superpowers/plans/2026-09-12-tickets-1-backend-core.md`, `docs/superpowers/plans/2026-09-14-tickets-2-notifications.md`. Журналы решений: `docs/superpowers/tickets-plan1-ledger.md`, `docs/superpowers/tickets-plan2-ledger.md`.

## Global Constraints

- Репозиторий на сервере: `/home/davr/managers`, ветка `feature/tickets-admin` от `main`. `git push` не работает, всё локально.
- `bun` не в PATH при неинтерактивном ssh: `export PATH=/root/.bun/bin:$PATH`.
- **Сборка админки только под node20:** `export PATH=/root/.nvm/versions/node/v20.19.0/bin:$PATH`. Системный node16 падает.
- **Перед `bun run build` обязателен проход типов** (`bunx tsc --noEmit`): неудачная сборка стирает рабочий `.next`, и раздел уезжает в 500 на проде.
- Рабочее дерево грязное. Коммитить только свои файлы поимённо, `git add -A` запрещён.
- `pkill -f` запрещён — он уже ронял прод-воркеры. Процессы останавливать по сохранённому PID.
- Прод-данные не трогать: заявок 0, фирма `adminz` и два исполнителя заведены вручную и нужны для живой проверки.
- Хром интерфейса (заголовки, кнопки) — через next-intl, ключи в `admin/messages/{ru,en,uz-Latn,uz-Cyrl}.json`. Операционная проза (тексты подтверждений, предупреждения) остаётся по-русски на месте — так сделано в «Паспорте».
- Права: экран офиса под `tickets.list_all`, планшет под `tickets.create`, справочники под `tickets.types.manage` и `tickets.contractors.manage`, оплата под `tickets.payment.approve`. Чтение данных во всех случаях требует ещё и `tickets.list`.
- Тестового раннера во фронте нет (`package.json` знает только `lint`). Гейт задачи фронта: `bunx tsc --noEmit` без ошибок в своих файлах, `bun lint` без новых предупреждений, и живой прогон экрана в браузере по сценариям из задачи.

## Review Focus

Пять классов входа, которые спека подразумевает, но ни одна задача их сама по себе не проверяет. Тест на каждый добавлен в задачу, которой принадлежит код.

1. **Тип без привязанной фирмы.** «Реклама ТВ» сейчас ровно такой. Плитка должна быть видна и помечена как недоступная, а не исчезать и не падать с 422 после заполнения формы и выбора фотографий. — Задача 8.
2. **Сессия без терминалов открывает планшет.** Офисная роль (`terminals: []`) означает «все филиалы»; на экране создания это не выбор из сотни филиалов, а явный отказ с объяснением. — Задача 8.
3. **Приёмка заявки, по которой нет фотографий результата.** Исполнитель ещё не сдал работу: панель «было/стало» обязана показывать левую половину и честную заглушку справа, а не пустой блок. — Задача 9.
4. **Вложение, которого нет на диске.** Файл удалён или каталог не создан: карточка показывает заглушку на месте фото и остаётся рабочей. — Задача 4.
5. **Пустой список и отказ в правах.** Нулевой результат, 403 и ошибка сети выглядят по-разному и ни один из них не оставляет вечный спиннер. — Задача 3.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `backend/src/modules/tickets/controller.ts` (правка) | чтение списка типов доступно управляющему типами |
| `backend/src/modules/tickets/bot-controller.ts` (правка) | привязка к боту не затирает язык, заданный в карточке |
| `admin/lib/tickets-api.ts` | типы строк и обёртки Eden для всех роутов заявок |
| `admin/app/[locale]/tickets/_components/use-tickets.ts` | TanStack Query: списки, карточка, мутации, разбор ошибок |
| `admin/app/[locale]/tickets/_components/status.tsx` | статус и приоритет как бейджи, «висит N часов» |
| `admin/app/[locale]/tickets/_components/photo-strip.tsx` | лента вложений с заглушкой на битый файл |
| `admin/app/[locale]/tickets/columns.tsx`, `data-table.tsx`, `page.tsx` | список заявок офиса |
| `admin/app/[locale]/tickets/_components/ticket-sheet.tsx` | карточка заявки: поля, фото, события, комментарии, акт |
| `admin/app/[locale]/tickets/payments/page.tsx` (+ columns, data-table) | очередь «К оплате», массовое утверждение |
| `admin/app/[locale]/tickets/contractors/page.tsx` (+ `_components/*`) | фирмы, их люди, выдача приглашения |
| `admin/app/[locale]/tickets/types/page.tsx` (+ `_components/fields-editor.tsx`) | типы заявок и редактор схемы полей |
| `admin/app/[locale]/branch-tickets/page.tsx` | планшет: список заявок филиала |
| `admin/app/[locale]/branch-tickets/new/page.tsx` (+ `_components/*`) | планшет: создание в два шага |
| `admin/app/[locale]/branch-tickets/_components/accept-panel.tsx` | планшет: приёмка «было/стало» |
| `admin/components/layout/nav-config.tsx` (правка) | пункты меню |
| `admin/messages/*.json` (правка) | ключи интерфейса |

---

### Task 1: Две правки бэкенда, найденные на живой настройке

**Files:**
- Modify: `backend/src/modules/tickets/controller.ts`
- Modify: `backend/src/modules/tickets/bot-controller.ts`
- Test: `backend/src/modules/tickets/bot.test.ts`

**Interfaces:**
- Consumes: ничего нового
- Produces: `GET /api/ticket_types` доступен под `tickets.types.manage`; `resolveBindLang(current, fromTelegram)` в `bot-controller.ts`

Обе правки нашлись 05.10.2026, когда заводили фирму `adminz` руками: админ с правом «типы и схемы полей» получал 403 на чтение собственного справочника, а Ходжиакбару после нажатия START язык в карточке переписался с узбекского на русский, потому что в его телеграме русский интерфейс.

- [ ] **Step 1: Написать падающий тест на язык**

В `backend/src/modules/tickets/bot.test.ts` добавить:

```ts
import { resolveBindLang } from "./bot-controller";

describe("resolveBindLang", () => {
  it("сохраняет язык, заданный в карточке", () => {
    expect(resolveBindLang("uz", "ru")).toBe("uz");
    expect(resolveBindLang("ru", "uz")).toBe("ru");
  });

  it("берёт язык телеграма, если в карточке дефолт и телеграм узбекский", () => {
    expect(resolveBindLang(null, "uz")).toBe("uz");
    expect(resolveBindLang(undefined, "uz")).toBe("uz");
  });

  it("падает на русский, когда неизвестно ничего", () => {
    expect(resolveBindLang(null, undefined)).toBe("ru");
    expect(resolveBindLang(null, "en")).toBe("ru");
  });

  it("не принимает мусор вместо языка", () => {
    expect(resolveBindLang(null, { evil: true } as any)).toBe("ru");
    expect(resolveBindLang(42 as any, "uz")).toBe("uz");
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/bot.test.ts
```
Ожидается: FAIL, `resolveBindLang is not a function`.

- [ ] **Step 3: Реализовать**

В `bot-controller.ts`:

```ts
// Язык в карточке задаёт администратор, который знает, на каком языке
// человек читает. language_code из телеграма — это язык ИНТЕРФЕЙСА его
// приложения, а не язык человека: у подрядчика-узбека сплошь и рядом стоит
// русский Telegram. Поэтому телеграм спрашиваем только тогда, когда в
// карточке ничего осмысленного нет.
export function resolveBindLang(current: unknown, fromTelegram: unknown): "ru" | "uz" {
  if (current === "uz" || current === "ru") return current;
  return fromTelegram === "uz" ? "uz" : "ru";
}
```

и в обработчике вебхука заменить вычисление языка на вызов `resolveBindLang(executorRow?.lang, message?.from?.language_code)`. Для этого привязка сначала читает текущую строку исполнителя по `invite_code` (тем же `WHERE`, что и `UPDATE`: `invite_used_at IS NULL AND is_active = true`), затем выполняет `UPDATE` с посчитанным языком. Если чтение ничего не вернуло — поведение прежнее: ответ «ссылка недействительна», 200.

- [ ] **Step 4: Запустить тест, убедиться что проходит**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH
bun test src/modules/tickets/bot.test.ts
```
Ожидается: все тесты файла зелёные, включая прежние про `parseStartPayload`.

- [ ] **Step 5: Открыть чтение типов управляющему типами**

В `controller.ts` роут `GET /ticket_types` сейчас стоит под `permission: "tickets.create"`. Макрос проверяет ровно одно право, поэтому добавить рядом второй роут с тем же обработчиком:

```ts
  .get("/ticket_types/manage", listTicketTypesHandler, { permission: "tickets.types.manage", query: listTicketTypesQuery })
```

Обработчик и схему запроса вынести в именованные константы над цепочкой и переиспользовать в обоих роутах — копия тела обработчика в двух местах разъедется при первой же правке. Оба роута отдают одинаковый ответ; разница только в том, кого пускают.

- [ ] **Step 6: Проверить роуты**

```bash
cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && PORT=6799 timeout 150 bun src/index.ts &
sleep 95
for p in "ticket_types" "ticket_types/manage"; do printf "%-22s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:6799/api/$p"; done
```
Ожидается: оба `401` (без сессии), ни одного `404`. Процесс завершится сам по таймауту — не убивать его через `pkill`.

- [ ] **Step 7: Коммит**

```bash
cd /home/davr/managers
git add backend/src/modules/tickets/controller.ts backend/src/modules/tickets/bot-controller.ts backend/src/modules/tickets/bot.test.ts
git commit -m "fix(tickets): чтение типов под types.manage, привязка не затирает язык"
```

---

### Task 2: Клиент API админки

**Files:**
- Create: `admin/lib/tickets-api.ts`

**Interfaces:**
- Consumes: `apiClient` из `@admin/utils/eden`
- Produces: типы `TicketRow`, `TicketCard`, `TicketTypeRow`, `ContractorRow`, `ExecutorRow`, `WorkItemRow`, `TicketEventRow`, `FieldDef`, `TicketStatus`, `TicketPriority`, `PaymentStatus`; функции `listTickets`, `getTicket`, `closeTicket`, `reopenTicket`, `cancelTicket`, `addComment`, `markSeen`, `approvePayments`, `rejectPayments`, `listTypes`, `listTypesForManage`, `createType`, `updateType`, `listContractors`, `createContractor`, `updateContractor`, `listExecutors`, `createExecutor`, `updateExecutor`, `issueInvite`, `attachmentUrl`, `apiMessage`

Образец — `admin/lib/passport-api.ts`: тот же стиль, те же приёмы разбора ошибок Eden.

- [ ] **Step 1: Написать файл**

```ts
"use client";

// Единственное место, где админка знает URL-ы и формы ответов заявок.
// Экраны импортируют отсюда типы и функции, а не собирают запросы руками —
// иначе смена формы ответа правится в пяти файлах из шести.

import { apiClient } from "@admin/utils/eden";

export type TicketStatus = "new" | "in_progress" | "done" | "closed" | "cancelled";
export type TicketPriority = "normal" | "urgent";
export type PaymentStatus = "pending" | "approved" | "rejected";

export type FieldOption = { value: string; label_ru: string; label_uz: string };
export type FieldDef = {
  key: string;
  type: "select" | "text";
  required: boolean;
  label_ru: string;
  label_uz: string;
  options?: FieldOption[];
};

export type TicketRow = {
  id: string;
  seq: number;
  number: string;
  status: TicketStatus;
  priority: TicketPriority;
  details: Record<string, string>;
  created_at: string;
  assigned_at: string | null;
  done_at: string | null;
  manager_seen_at: string | null;
  work_total_amount: string | null;
  payment_status: PaymentStatus;
  type_name: string | null;
  terminal_name: string | null;
  executor_name: string | null;
};

export type AttachmentRow = {
  id: string;
  phase: "problem" | "result";
  mime: string;
  size_bytes: number;
  created_at: string;
};

export type CommentRow = {
  id: string;
  author_kind: "manager" | "executor" | "office";
  body: string;
  created_at: string;
};

export type WorkItemRow = {
  id: string;
  position: number;
  title: string;
  qty: string;
  unit: string | null;
  amount: string;
};

export type TicketEventRow = {
  id: string;
  type: string;
  actor_kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type TicketTypeRow = {
  id: string;
  code: string;
  number_prefix: string;
  name_ru: string;
  name_uz: string;
  icon: string | null;
  executor_kind: "external" | "staff";
  contractor_id: string | null;
  fields_schema: FieldDef[];
  requires_cost: boolean;
  active: boolean;
  sort: number;
};

export type TicketCard = TicketRow & {
  description: string | null;
  reopen_count: number;
  payment_comment: string | null;
  type: TicketTypeRow | null;
  attachments: AttachmentRow[];
  comments: CommentRow[];
  work_items: WorkItemRow[];
  events: TicketEventRow[];
};

export type ContractorRow = {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  is_active: boolean;
};

export type ExecutorRow = {
  id: string;
  kind: "external" | "staff";
  contractor_id: string | null;
  full_name: string;
  phone: string | null;
  lang: string;
  tg_user_id: number | null;
  invite_used_at: string | null;
  is_active: boolean;
};

export interface ApiError extends Error {
  status?: number;
  value?: unknown;
}

// Eden возвращает провал как {data: null, error}, а TanStack Query ждёт
// исключение. Статус и тело переносим, потому что экраны различают 403 и 409.
export function unwrap<T>(res: { data: T | null; error: any }): T {
  if (res.error) {
    const e = new Error(apiMessage(res.error)) as ApiError;
    e.status = res.error.status;
    e.value = res.error.value;
    throw e;
  }
  return res.data as T;
}

export function apiMessage(error: any): string {
  const v = error?.value ?? error;
  if (typeof v?.message === "string") return v.message;
  if (Array.isArray(v?.errors) && typeof v.errors[0] === "string") return v.errors[0];
  if (typeof error?.message === "string") return error.message;
  return "Не удалось выполнить запрос";
}

const API = process.env.NEXT_PUBLIC_TRPC_API_URL ?? "";

// Вложения отдаёт авторизованный роут потоком с диска; прямых ссылок на
// файлы нет намеренно, иначе по ссылке было бы видно чужие филиалы.
export function attachmentUrl(attachmentId: string): string {
  return `${API}/api/tickets/attachments/${attachmentId}/file`;
}

export type TicketListQuery = {
  limit: number;
  offset: number;
  filters?: Array<{ field: string; operator: string; value: unknown }>;
};

export async function listTickets(q: TicketListQuery) {
  return unwrap(
    await apiClient.api.tickets.get({
      query: {
        limit: String(q.limit),
        offset: String(q.offset),
        ...(q.filters?.length ? { filters: JSON.stringify(q.filters) } : {}),
      },
    })
  ) as { total: string | number; data: TicketRow[] };
}

export async function getTicket(id: string) {
  return unwrap(await apiClient.api.tickets({ id }).get()) as TicketCard;
}

export async function closeTicket(id: string) {
  return unwrap(await apiClient.api.tickets({ id }).close.post());
}

export async function reopenTicket(id: string, comment: string) {
  return unwrap(await apiClient.api.tickets({ id }).reopen.post({ comment }));
}

export async function cancelTicket(id: string, comment?: string) {
  return unwrap(await apiClient.api.tickets({ id }).cancel.post({ comment }));
}

export async function addComment(id: string, body: string) {
  return unwrap(await apiClient.api.tickets({ id }).comments.post({ body }));
}

export async function markSeen(id: string) {
  return unwrap(await apiClient.api.tickets({ id }).seen.post());
}

export async function approvePayments(ids: string[]) {
  return unwrap(await apiClient.api.tickets.payment.approve.post({ ids })) as {
    approved: number;
    skipped: number;
  };
}

export async function rejectPayments(ids: string[], comment: string) {
  return unwrap(await apiClient.api.tickets.payment.reject.post({ ids, comment })) as {
    rejected: number;
    skipped: number;
  };
}

export async function listTypes() {
  return unwrap(await apiClient.api.ticket_types.get()) as { data: TicketTypeRow[] };
}

// Отдельный роут для управляющего типами: GET /ticket_types закрыт правом
// «создание с планшета», и у администратора его нет (см. Task 1).
export async function listTypesForManage() {
  return unwrap(await apiClient.api.ticket_types.manage.get()) as { data: TicketTypeRow[] };
}

export async function createType(body: Partial<TicketTypeRow>) {
  return unwrap(await apiClient.api.ticket_types.post(body as any)) as TicketTypeRow;
}

export async function updateType(id: string, body: Partial<TicketTypeRow>) {
  return unwrap(await apiClient.api.ticket_types({ id }).put(body as any)) as TicketTypeRow;
}

export async function listContractors() {
  return unwrap(await apiClient.api.ticket_contractors.get()) as { data: ContractorRow[] };
}

export async function createContractor(body: { name: string; phone?: string; note?: string }) {
  return unwrap(await apiClient.api.ticket_contractors.post(body)) as ContractorRow;
}

export async function updateContractor(id: string, body: Partial<ContractorRow>) {
  return unwrap(await apiClient.api.ticket_contractors({ id }).put(body as any)) as ContractorRow;
}

export async function listExecutors(contractorId?: string) {
  return unwrap(
    await apiClient.api.ticket_executors.get({
      query: contractorId ? { contractor_id: contractorId } : {},
    })
  ) as { data: ExecutorRow[] };
}

export async function createExecutor(body: {
  kind: "external" | "staff";
  contractor_id?: string;
  user_id?: string;
  full_name: string;
  phone?: string;
  lang?: string;
}) {
  return unwrap(await apiClient.api.ticket_executors.post(body)) as ExecutorRow;
}

export async function updateExecutor(id: string, body: Partial<ExecutorRow>) {
  return unwrap(await apiClient.api.ticket_executors({ id }).put(body as any)) as ExecutorRow;
}

export async function issueInvite(id: string) {
  return unwrap(await apiClient.api.ticket_executors({ id }).invite.post()) as {
    invite_code: string;
    link: string;
  };
}
```

- [ ] **Step 2: Проверить типы**

```bash
cd /home/davr/managers/admin && export PATH=/root/.nvm/versions/node/v20.19.0/bin:/root/.bun/bin:$PATH
bunx tsc --noEmit 2>&1 | grep "lib/tickets-api" | head -20
```
Ожидается: пусто. Если Eden ругается на форму пути (`apiClient.api.tickets({id}).close.post()`), сверить с реальным деревом роутов — имена берутся из `backend/src/modules/tickets/controller.ts` — и поправить вызов, а не глушить ошибку через `as any` на весь модуль.

- [ ] **Step 3: Коммит**

```bash
cd /home/davr/managers
git add admin/lib/tickets-api.ts
git commit -m "feat(tickets-admin): типизированный клиент API заявок"
```

---

### Task 3: Список заявок офиса

**Files:**
- Create: `admin/app/[locale]/tickets/_components/use-tickets.ts`
- Create: `admin/app/[locale]/tickets/_components/status.tsx`
- Create: `admin/app/[locale]/tickets/columns.tsx`
- Create: `admin/app/[locale]/tickets/data-table.tsx`
- Create: `admin/app/[locale]/tickets/page.tsx`

**Interfaces:**
- Consumes: всё из `@admin/lib/tickets-api`
- Produces: `useTicketList(filters)`, `useTicketCard(id)`, `StatusBadge`, `PriorityBadge`, `WaitingFor` (из `status.tsx`), страница `/[locale]/tickets`

Экран отвечает на вопрос «что сейчас происходит»: сверху счётчики по статусам, затем фильтры (статус, тип, филиал, приоритет), затем таблица. Колонка «висит» — единственная замена дедлайнам, которых в системе нет: она показывает, сколько заявка стоит в текущем статусе, и подсвечивает всё, что старше суток.

- [ ] **Step 1: Написать `status.tsx`**

```tsx
"use client";

import { Badge } from "@components/ui/badge";
import { cn } from "@admin/lib/utils";
import type { TicketPriority, TicketStatus } from "@admin/lib/tickets-api";

const STATUS_RU: Record<TicketStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  done: "Сдана",
  closed: "Закрыта",
  cancelled: "Отменена",
};

const STATUS_TONE: Record<TicketStatus, string> = {
  new: "bg-blue-100 text-blue-900",
  in_progress: "bg-amber-100 text-amber-900",
  done: "bg-violet-100 text-violet-900",
  closed: "bg-emerald-100 text-emerald-900",
  cancelled: "bg-zinc-200 text-zinc-700",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <Badge className={cn("font-medium", STATUS_TONE[status])}>{STATUS_RU[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  if (priority !== "urgent") return null;
  return <Badge className="bg-red-100 font-medium text-red-900">Срочная</Badge>;
}

// Сколько заявка стоит в текущем состоянии. Дедлайнов в системе нет, и это
// единственное место, где видно «висит и никто не взял».
export function waitingHours(row: {
  status: TicketStatus;
  created_at: string;
  assigned_at: string | null;
  done_at: string | null;
}, now: number = Date.now()): number | null {
  const since =
    row.status === "new" ? row.created_at :
    row.status === "in_progress" ? (row.assigned_at ?? row.created_at) :
    row.status === "done" ? (row.done_at ?? row.created_at) :
    null;
  if (!since) return null;
  const ms = now - new Date(since.replace(" ", "T")).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 3_600_000);
}

export function WaitingFor(props: {
  status: TicketStatus;
  created_at: string;
  assigned_at: string | null;
  done_at: string | null;
}) {
  const h = waitingHours(props);
  if (h === null) return <span className="text-muted-foreground">—</span>;
  const label = h < 1 ? "меньше часа" : h < 24 ? `${h} ч` : `${Math.floor(h / 24)} дн`;
  return <span className={cn(h >= 24 && "font-semibold text-red-600")}>{label}</span>;
}
```

- [ ] **Step 2: Написать `use-tickets.ts`**

```tsx
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listTickets, getTicket, closeTicket, reopenTicket, cancelTicket,
  addComment, markSeen, type TicketListQuery,
} from "@admin/lib/tickets-api";

export const ticketKeys = {
  list: (q: TicketListQuery) => ["tickets", "list", q] as const,
  card: (id: string) => ["tickets", "card", id] as const,
};

export function useTicketList(q: TicketListQuery) {
  return useQuery({ queryKey: ticketKeys.list(q), queryFn: () => listTickets(q) });
}

export function useTicketCard(id: string | null) {
  return useQuery({
    queryKey: ticketKeys.card(id ?? ""),
    queryFn: () => getTicket(id as string),
    enabled: Boolean(id),
  });
}

export function useTicketActions(onDone?: () => void) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tickets"] });
    onDone?.();
  };
  return {
    close: useMutation({ mutationFn: (id: string) => closeTicket(id), onSuccess: invalidate }),
    reopen: useMutation({
      mutationFn: (v: { id: string; comment: string }) => reopenTicket(v.id, v.comment),
      onSuccess: invalidate,
    }),
    cancel: useMutation({
      mutationFn: (v: { id: string; comment?: string }) => cancelTicket(v.id, v.comment),
      onSuccess: invalidate,
    }),
    comment: useMutation({
      mutationFn: (v: { id: string; body: string }) => addComment(v.id, v.body),
      onSuccess: invalidate,
    }),
    seen: useMutation({ mutationFn: (id: string) => markSeen(id) }),
  };
}
```

- [ ] **Step 3: Написать `columns.tsx`, `data-table.tsx`, `page.tsx`**

`columns.tsx` — колонки: номер (моноширинный), тип, филиал, симптом (первое заполненное значение `details`), статус (`StatusBadge` + `PriorityBadge`), исполнитель, «висит» (`WaitingFor`), сумма (если есть). Клик по строке открывает карточку — обработчик приходит из страницы пропсом `onOpen(id)`.

`data-table.tsx` — обёртка над таблицей по образцу `app/[locale]/passport/enrollments/data-table.tsx`: та же разметка, пагинация через `@components/ui/data-table-pagination`, то же поведение при пустом результате.

`page.tsx` — экран:
- шапка со счётчиками: «Новые», «В работе», «Сдано, ждёт приёмки», «Закрыто за 7 дней». Числа берутся из того же запроса списка с `limit: 1` и разными фильтрами по статусу — отдельного эндпоинта статистики нет и заводить его ради четырёх чисел не нужно;
- фильтры: статус (мультивыбор), тип, филиал, приоритет, «только непринятые» — состояние в URL через `nuqs`, как на других экранах;
- таблица и карточка (`TicketSheet` из задачи 4; до её появления — заглушка `onOpen` без действия, страница от этого не ломается).

**Состояния, обязательные к реализации** (пункт 5 из Review Focus):
- загрузка — скелет строк, не спиннер на весь экран;
- пустой результат — текст «Заявок нет» и подсказка, что фильтры можно сбросить;
- 403 — панель «Нет доступа к заявкам» с перечислением нужных прав (`tickets.list` и `tickets.list_all`), потому что это самая частая причина пустого экрана у новой роли;
- ошибка сети — текст ошибки из `apiMessage` и кнопка «Повторить».

- [ ] **Step 4: Проверить типы и линт**

```bash
cd /home/davr/managers/admin && export PATH=/root/.nvm/versions/node/v20.19.0/bin:/root/.bun/bin:$PATH
bunx tsc --noEmit 2>&1 | grep "app/\[locale\]/tickets" | head -20
bun lint 2>&1 | tail -5
```
Ожидается: по заявкам ошибок нет, линт без новых предупреждений.

- [ ] **Step 5: Живой прогон**

Поднять дев-сервер на свободном порту и открыть экран:

```bash
cd /home/davr/managers/admin && export PATH=/root/.nvm/versions/node/v20.19.0/bin:/root/.bun/bin:$PATH
PORT=6765 bun run dev -p 6765 > /tmp/admin-dev.log 2>&1 &
echo $! > /tmp/admin-dev.pid
```

Проверить в браузере `http://127.0.0.1:6765/ru/tickets` под админской сессией: счётчики показывают нули, таблица пустая, видно состояние «Заявок нет». Затем остановить сервер **по сохранённому PID** (`kill $(cat /tmp/admin-dev.pid)`), не через `pkill`.

- [ ] **Step 6: Коммит**

```bash
cd /home/davr/managers
git add admin/app/\[locale\]/tickets/_components/use-tickets.ts admin/app/\[locale\]/tickets/_components/status.tsx admin/app/\[locale\]/tickets/columns.tsx admin/app/\[locale\]/tickets/data-table.tsx admin/app/\[locale\]/tickets/page.tsx
git commit -m "feat(tickets-admin): список заявок офиса"
```

---

### Task 4: Карточка заявки

**Files:**
- Create: `admin/app/[locale]/tickets/_components/photo-strip.tsx`
- Create: `admin/app/[locale]/tickets/_components/ticket-sheet.tsx`
- Modify: `admin/app/[locale]/tickets/page.tsx` (подключить карточку)

**Interfaces:**
- Consumes: `useTicketCard`, `useTicketActions`, `attachmentUrl`, `StatusBadge`, `PriorityBadge`
- Produces: `PhotoStrip`, `TicketSheet` (пропсы `{ ticketId: string | null; onClose: () => void }`)

Карточка — боковая панель (`@components/ui/sheet`), как журнал в «Паспорте». Внутри по порядку: шапка (номер, тип, филиал, статус, приоритет), поля заявки по схеме типа (подписи из `fields_schema`, а не ключи), фото проблемы, фото результата, акт выполненных работ с итогом, переписка, лента событий, действия.

- [ ] **Step 1: Написать `photo-strip.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { attachmentUrl, type AttachmentRow } from "@admin/lib/tickets-api";

// Файл отдаёт авторизованный роут; он может ответить 404, если строка в базе
// есть, а файла на диске нет — так бывает после ручной чистки каталога.
// Показать разбитую картинку вместо карточки нельзя: человек решит, что
// сломался весь экран.
function Thumb({ a, onOpen }: { a: AttachmentRow; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="flex size-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground">
        <ImageOff className="size-5" />
        <span className="text-[11px]">нет файла</span>
      </div>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="size-24 overflow-hidden rounded-md border">
      <img
        src={attachmentUrl(a.id)}
        alt=""
        className="size-full object-cover"
        onError={() => setBroken(true)}
      />
    </button>
  );
}

export function PhotoStrip({
  title,
  items,
  empty,
}: {
  title: string;
  items: AttachmentRow[];
  empty: string;
}) {
  const [full, setFull] = useState<string | null>(null);
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">{title}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((a) => (
            <Thumb key={a.id} a={a} onOpen={() => setFull(attachmentUrl(a.id))} />
          ))}
        </div>
      )}
      {full && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setFull(null)}
        >
          <img src={full} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Написать `ticket-sheet.tsx`**

Содержание:
- поля заявки: по `card.type.fields_schema` сопоставить ключ → подпись (`label_ru`) и значение → подпись варианта (`options[].label_ru`); если ключа в схеме нет (тип правили после создания заявки) — показать ключ как есть, значение сырым, с пометкой «поле удалено из типа»;
- `PhotoStrip` «Фото проблемы» (`phase === "problem"`, пусто → «Менеджер не приложил фото») и «Фото результата» (`phase === "result"`, пусто → «Исполнитель ещё не сдал работу»);
- акт: таблица позиций и итог; если `work_items` пуст — «Акт не заполнен»;
- сумма и её состояние (`payment_status`) с подписью «на утверждении офиса», если `pending`;
- переписка: список комментариев с автором (`manager` → «Филиал», `executor` → «Исполнитель», `office` → «Офис») и поле отправки;
- лента событий: тип события по-русски и время;
- действия: «Принять работу» (только при `status === "done"`), «Вернуть в работу» (при `done`, требует комментарий — кнопка неактивна, пока поле пустое), «Отменить» (при `new`/`in_progress`). Каждое действие после успеха закрывает панель и обновляет список.

Ошибки мутаций показывать текстом из `apiMessage` рядом с кнопкой: 409 здесь означает «статус уже изменился», и человеку надо сказать именно это, а не «ошибка».

- [ ] **Step 3: Подключить к списку**

В `page.tsx` держать `const [openId, setOpenId] = useState<string | null>(null)`, передавать `onOpen={setOpenId}` в таблицу и рендерить `<TicketSheet ticketId={openId} onClose={() => setOpenId(null)} />`.

- [ ] **Step 4: Проверить типы, линт и живой прогон**

Те же команды, что в задаче 3. В браузере: карточка открывается по клику на строку, закрывается крестом и по Esc; при пустом списке проверить нечего — тогда временно создать заявку из задачи 8 и вернуться к этой проверке (отметить в отчёте, что проверка отложена).

**Проверка пункта 4 из Review Focus:** открыть карточку заявки с вложением и в DevTools заблокировать запрос к `/api/tickets/attachments/*` (Network → Block request URL), обновить панель: на месте фото должна появиться заглушка «нет файла», остальная карточка остаётся рабочей.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add admin/app/\[locale\]/tickets/_components/photo-strip.tsx admin/app/\[locale\]/tickets/_components/ticket-sheet.tsx admin/app/\[locale\]/tickets/page.tsx
git commit -m "feat(tickets-admin): карточка заявки"
```

---

### Task 5: Очередь «К оплате»

**Files:**
- Create: `admin/app/[locale]/tickets/payments/page.tsx`
- Create: `admin/app/[locale]/tickets/payments/columns.tsx`
- Create: `admin/app/[locale]/tickets/payments/_components/use-payments.ts`

**Interfaces:**
- Consumes: `listTickets`, `approvePayments`, `rejectPayments`, `getTicket`
- Produces: страница `/[locale]/tickets/payments`

Экран финансиста. В очереди — заявки `status = closed` и `payment_status = pending`. Строка раскрывается в акт и фото результата, чтобы утверждать не вслепую. Галочки и массовое утверждение обязательны: раз в неделю закрывают пачку, по одной никто кликать не станет.

- [ ] **Step 1: Написать `use-payments.ts`**

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { approvePayments, listTickets, rejectPayments } from "@admin/lib/tickets-api";

const PENDING_FILTERS = [
  { field: "status", operator: "=", value: "closed" },
  { field: "payment_status", operator: "=", value: "pending" },
];

export function usePaymentQueue(limit = 100, offset = 0) {
  return useQuery({
    queryKey: ["tickets", "payments", limit, offset],
    queryFn: () => listTickets({ limit, offset, filters: PENDING_FILTERS }),
  });
}

export function usePaymentActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tickets"] });
  return {
    approve: useMutation({ mutationFn: (ids: string[]) => approvePayments(ids), onSuccess: invalidate }),
    reject: useMutation({
      mutationFn: (v: { ids: string[]; comment: string }) => rejectPayments(v.ids, v.comment),
      onSuccess: invalidate,
    }),
  };
}
```

- [ ] **Step 2: Написать экран**

- колонки: галочка, номер, филиал, тип, фирма (из карточки, подгружается при раскрытии), сумма, дата закрытия, кнопка раскрытия;
- раскрытая строка: позиции акта с итогом и фото результата (`PhotoStrip` из задачи 4, только `phase === "result"`);
- панель действий поверх таблицы, появляется при выбранных строках: «Утвердить N» и «Отклонить N» (отклонение требует комментарий);
- после ответа показать итог: «Утверждено N, пропущено M». `skipped` означает, что строка уже не в очереди — например, её утвердил другой человек; текст так и писать, иначе цифра читается как ошибка.

- [ ] **Step 3: Проверить типы, линт, живой прогон**

Те же команды. В браузере: очередь пустая (заявок нет) — проверить, что видно «Нет заявок к оплате», кнопки действий спрятаны.

- [ ] **Step 4: Коммит**

```bash
cd /home/davr/managers
git add admin/app/\[locale\]/tickets/payments
git commit -m "feat(tickets-admin): очередь К оплате с массовым утверждением"
```

---

### Task 6: Фирмы и исполнители

**Files:**
- Create: `admin/app/[locale]/tickets/contractors/page.tsx`
- Create: `admin/app/[locale]/tickets/contractors/_components/contractor-sheet.tsx`
- Create: `admin/app/[locale]/tickets/contractors/_components/executor-sheet.tsx`
- Create: `admin/app/[locale]/tickets/contractors/_components/use-contractors.ts`

**Interfaces:**
- Consumes: `listContractors`, `createContractor`, `updateContractor`, `listExecutors`, `createExecutor`, `updateExecutor`, `issueInvite`
- Produces: страница `/[locale]/tickets/contractors`

Экран, которого сейчас не хватает физически: фирму `adminz` и двух её людей заводили запросами к API. Слева список фирм, справа — люди выбранной фирмы.

- [ ] **Step 1: Написать `use-contractors.ts`** — запросы и мутации по образцу `use-tickets.ts`, ключи `["ticket_contractors"]` и `["ticket_executors", contractorId]`.

- [ ] **Step 2: Написать экраны**

Фирма: название, телефон, примечание, признак активности.

Исполнитель: имя, телефон, язык (переключатель «Русский / Oʻzbekcha»), признак активности, состояние привязки к боту. Состояние показывать явно: «Привязан к боту» с датой либо «Не привязан». Кнопка «Пригласить в бот» выдаёт ссылку, кладёт её в буфер и показывает текстом, чтобы можно было переслать вручную.

Рядом с кнопкой — предупреждение: выдача новой ссылки гасит предыдущую. Это не теория: ссылка одноразовая, и выпуск новой сбрасывает `invite_used_at` вместе с кодом.

Если `TICKETS_BOT_USERNAME` на бэкенде не настроен, роут отвечает 500 — показать это понятным текстом («Бот не настроен, обратитесь к администратору»), а не «Не удалось выполнить запрос».

- [ ] **Step 3: Проверить типы, линт, живой прогон**

В браузере: видна фирма `adminz`, в ней Ходжиакбар (привязан) и Исломбек (не привязан). Выдать приглашение **только Исломбеку** — у него оно и так не использовано, старое погаснет, и это ожидаемо; Ходжиакбару приглашение не трогать, иначе он отвалится от бота.

- [ ] **Step 4: Коммит**

```bash
cd /home/davr/managers
git add admin/app/\[locale\]/tickets/contractors
git commit -m "feat(tickets-admin): фирмы, исполнители и приглашения"
```

---

### Task 7: Типы заявок и редактор полей

**Files:**
- Create: `admin/app/[locale]/tickets/types/page.tsx`
- Create: `admin/app/[locale]/tickets/types/_components/type-sheet.tsx`
- Create: `admin/app/[locale]/tickets/types/_components/fields-editor.tsx`
- Create: `admin/app/[locale]/tickets/types/_components/use-types.ts`

**Interfaces:**
- Consumes: `listTypesForManage`, `createType`, `updateType`, `listContractors`
- Produces: страница `/[locale]/tickets/types`

Схему полей редактируют формой. Голого JSON в textarea быть не должно: сломанная схема ломает создание заявки на планшете в разгар смены, а чинить её там некому.

- [ ] **Step 1: Написать `fields-editor.tsx`**

Редактор массива полей. Для каждого поля: ключ (латиница, `snake_case`), тип (`select` / `text`), обязательность, подписи русская и узбекская. Для `select` — список вариантов, у каждого значение и две подписи, с кнопками «добавить» и «удалить».

Валидация на клиенте повторяет серверную (`backend/src/modules/tickets/fields.ts`): ключ по `^[a-z][a-z0-9_]{0,30}$`, ключи не повторяются, у `select` хотя бы один вариант, значения вариантов не повторяются, обе подписи заполнены. Кнопка сохранения неактивна, пока есть ошибка, и рядом с полем написано, что именно не так.

Сервер всё равно проверит повторно и ответит 422 со списком ошибок — показать их над формой.

- [ ] **Step 2: Написать экран типов**

Список типов: название, код, префикс номера, фирма, активность, число полей. Создание и правка в боковой панели.

**Важно про фирму:** тип с `executor_kind = "external"` и пустой фирмой — легальное состояние «фирма ещё не привязана» (так заведены оба типа сидом). Такой тип показывать с предупреждением «Фирма не выбрана — заявки по этому типу создать нельзя», а не прятать и не считать ошибкой.

- [ ] **Step 3: Проверить типы, линт, живой прогон**

В браузере: видны «Реклама ТВ» (без фирмы, с предупреждением) и «Камеры» (фирма adminz). Открыть «Камеры», проверить, что редактор показывает три поля со всеми вариантами, и сохранить без изменений — ответ 200, схема не испортилась (сверить `jsonb_array_length(fields_schema)` до и после, должно остаться 3).

- [ ] **Step 4: Коммит**

```bash
cd /home/davr/managers
git add admin/app/\[locale\]/tickets/types
git commit -m "feat(tickets-admin): типы заявок и редактор схемы полей"
```

---

### Task 8: Планшет — создание заявки

**Files:**
- Create: `admin/app/[locale]/branch-tickets/new/page.tsx`
- Create: `admin/app/[locale]/branch-tickets/_components/type-tiles.tsx`
- Create: `admin/app/[locale]/branch-tickets/_components/dynamic-fields.tsx`
- Create: `admin/app/[locale]/branch-tickets/_components/photo-input.tsx`
- Create: `admin/app/[locale]/branch-tickets/_components/use-branch-tickets.ts`

**Interfaces:**
- Consumes: `listTypes`, `attachmentUrl`, `apiMessage`
- Produces: страница `/[locale]/branch-tickets/new`, `TypeTiles`, `DynamicFields`, `PhotoInput`, `useCreateTicket()`

Планшет держат горизонтально, палец толстый: минимальная цель 44 px, выпадающих списков нет там, где влезают плитки. Два шага: выбор типа крупными плитками, затем поля этого типа, приоритет, фотографии.

Создание — один запрос `multipart/form-data` на `POST /api/tickets` с полями `type_id`, `priority`, `details` (JSON-строка), `description` и `photos[]`. Eden для multipart не используем: собираем `FormData` и шлём `fetch` с `credentials: "include"`.

- [ ] **Step 1: Написать `photo-input.tsx`**

Зона «Снять / Выбрать» (`<input type="file" accept="image/jpeg,image/png" capture="environment" multiple>`), превью выбранного с крестиками, счётчик «N из 5».

**Сжатие перед отправкой обязательно:** фото с планшета — 4-8 МБ, пять штук упираются в лимит 10 МБ на файл и забивают диск. Ужимать по длинной стороне до 1600 px через `canvas.toBlob(..., "image/jpeg", 0.85)`, сохраняя расширение и тип. Если `toBlob` вернул `null` (бывает на очень больших изображениях в Safari), отправлять оригинал, а не падать.

- [ ] **Step 2: Написать `type-tiles.tsx` и `dynamic-fields.tsx`**

`TypeTiles` — сетка плиток 2-3 в ряд: иконка, название, под ним код. Плитка типа без фирмы — приглушённая, с подписью «Фирма не назначена», клик по ней не ведёт на второй шаг, а показывает поясняющий текст. **Это пункт 1 из Review Focus:** «Реклама ТВ» сейчас именно такой, и менеджер не должен узнавать об этом после заполнения формы и выбора фотографий.

`DynamicFields` — отрисовка `fields_schema`: `select` превращается в ряд кнопок-пилюль (не `<select>`), `text` — в одно поле «опишите словами». Обязательные поля помечены, кнопка отправки неактивна, пока они пусты, и под кнопкой написано, чего не хватает.

- [ ] **Step 3: Написать страницу создания**

- шаг 1: `TypeTiles`;
- шаг 2: `DynamicFields`, переключатель приоритета («Обычная» / «Срочная»), `PhotoInput`, кнопка «Создать заявку»;
- филиал и автор не спрашиваются — подставляются из сессии;
- после успеха — переход в список филиала с подсветкой созданной заявки.

**Пункт 2 из Review Focus:** если у сессии пустой массив терминалов (офисная роль), экран создания показывает отказ: «Этот экран для менеджера филиала. У вашей роли нет привязки к филиалу». Создание в этом случае не отправляется — иначе `terminal_id` окажется пустым и сервер ответит 403, что читается как поломка.

- [ ] **Step 4: Проверить типы, линт, живой прогон**

В браузере под сессией менеджера филиала: пройти оба шага, создать заявку по типу «Камеры» с одной фотографией. Проверить в базе, что строка появилась и к ней привязано вложение:

```bash
ssh root@choparpizza.uz "psql \"\$(grep -m1 DATABASE_URL /home/davr/managers/backend/.env | cut -d= -f2-)\" -c 'select t.id, t.status, t.priority, count(a.id) as photos from tickets t left join ticket_attachments a on a.ticket_id = t.id group by t.id, t.status, t.priority'"
```

Отдельно проверить два случая Review Focus: клик по плитке «Реклама ТВ» (без фирмы) не пускает на второй шаг и объясняет почему; вход на экран под админской сессией (без терминалов) показывает отказ.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add admin/app/\[locale\]/branch-tickets/new admin/app/\[locale\]/branch-tickets/_components
git commit -m "feat(tickets-admin): планшет — создание заявки в два шага"
```

---

### Task 9: Планшет — список филиала и приёмка

**Files:**
- Create: `admin/app/[locale]/branch-tickets/page.tsx`
- Create: `admin/app/[locale]/branch-tickets/_components/accept-panel.tsx`

**Interfaces:**
- Consumes: `useTicketList`, `useTicketCard`, `useTicketActions`, `PhotoStrip`, `WaitingFor`
- Produces: страница `/[locale]/branch-tickets`

Список карточками, не таблицей: у филиала единицы заявок, а не сотни. Порядок групп — по тому, что требует действия: «Ждут вашего подтверждения», «В работе», «Новые»; закрытые и отменённые за вкладкой.

- [ ] **Step 1: Написать список**

Карточка: номер, тип, симптом, кто взял, «висит» (`WaitingFor`), превью фото, точка непрочитанного. Точка показывается, когда в заявке есть события новее `manager_seen_at` — Telegram менеджеру не шлётся намеренно, и это единственный способ заметить комментарий исполнителя. Открытие карточки вызывает `markSeen(id)`.

- [ ] **Step 2: Написать `accept-panel.tsx`**

Две колонки: слева «Было» (фото проблемы), справа «Стало» (фото результата), между ними список выполненных работ и итог. Кнопки: «Принять работу» и «Вернуть в работу» (вторая требует комментарий).

**Пункт 3 из Review Focus:** если фотографий результата нет (исполнитель ещё не сдал), правая колонка показывает «Исполнитель ещё не сдал работу», а кнопка «Принять работу» отсутствует — принимать нечего. Панель при этом остаётся открытой и показывает левую половину.

Сумма видна, но не редактируется, с подписью «на утверждении офиса».

- [ ] **Step 3: Проверить типы, линт, живой прогон**

В браузере под сессией менеджера: созданная в задаче 8 заявка видна в группе «Новые», карточка открывается, точка непрочитанного гаснет после открытия (проверить, что `manager_seen_at` в базе обновился).

- [ ] **Step 4: Коммит**

```bash
cd /home/davr/managers
git add admin/app/\[locale\]/branch-tickets/page.tsx admin/app/\[locale\]/branch-tickets/_components/accept-panel.tsx
git commit -m "feat(tickets-admin): планшет — список филиала и приёмка работы"
```

---

### Task 10: Меню, переводы, сборка

**Files:**
- Modify: `admin/components/layout/nav-config.tsx`
- Modify: `admin/messages/ru.json`, `admin/messages/en.json`, `admin/messages/uz-Latn.json`, `admin/messages/uz-Cyrl.json`

**Interfaces:**
- Consumes: страницы задач 3-9
- Produces: пункты меню и ключи переводов

- [ ] **Step 1: Добавить пункты меню**

В `buildNav` — группа «Заявки» (иконка `Wrench`, уже импортирована) с пунктами:

```ts
    {
      kind: "group",
      title: "Заявки",
      icon: Wrench,
      items: [
        { title: "Все заявки", href: p("/tickets"), permission: "tickets.list_all" },
        { title: "К оплате", href: p("/tickets/payments"), permission: "tickets.payment.approve" },
        { title: "Подрядные фирмы", href: p("/tickets/contractors"), permission: "tickets.contractors.manage" },
        { title: "Типы заявок", href: p("/tickets/types"), permission: "tickets.types.manage" },
      ],
    },
```

и отдельной ссылкой для филиала:

```ts
    { kind: "link", title: "Заявки филиала", href: p("/branch-tickets"), icon: Wrench, permission: "tickets.create" },
```

- [ ] **Step 2: Добавить ключи переводов**

Раздел `tickets` в каждом из четырёх файлов `admin/messages/*.json`: заголовки экранов, названия колонок, подписи кнопок. Узбекские переводы — латиницей в `uz-Latn.json` и кириллицей в `uz-Cyrl.json`; английский в `en.json` можно держать коротким, но ключи обязаны присутствовать во всех четырёх файлах — отсутствующий ключ next-intl показывает как сырое имя ключа на экране.

- [ ] **Step 3: Проверить, что ключи есть везде**

```bash
cd /home/davr/managers/admin
python3 - <<'PY'
import json
files = ["ru", "en", "uz-Latn", "uz-Cyrl"]
sets = {}
for f in files:
    d = json.load(open(f"messages/{f}.json"))
    def walk(prefix, node):
        for k, v in node.items():
            if isinstance(v, dict): walk(f"{prefix}{k}.", v)
            else: yield f"{prefix}{k}"
    sets[f] = set(walk("", d.get("tickets", {})))
base = sets["ru"]
for f in files:
    missing = base - sets[f]
    print(f, "missing:", sorted(missing)[:10] if missing else "ок")
PY
```
Ожидается: по каждому файлу «ок».

- [ ] **Step 4: Проход типов и сборка**

```bash
cd /home/davr/managers/admin && export PATH=/root/.nvm/versions/node/v20.19.0/bin:/root/.bun/bin:$PATH
bunx tsc --noEmit 2>&1 | tail -20
```
Ожидается: ни одной ошибки в файлах заявок. **Пока проход типов не чист, сборку не запускать** — неудачная сборка стирает рабочий `.next`, и раздел уезжает в 500 на проде.

```bash
cp -r .next .next.bak_tickets_$(date +%s)
bun run build 2>&1 | tail -15
```
Ожидается: `Compiled successfully`, в списке маршрутов есть `/[locale]/tickets`, `/[locale]/tickets/payments`, `/[locale]/tickets/contractors`, `/[locale]/tickets/types`, `/[locale]/branch-tickets`, `/[locale]/branch-tickets/new`.

- [ ] **Step 5: Коммит**

```bash
cd /home/davr/managers
git add admin/components/layout/nav-config.tsx admin/messages/ru.json admin/messages/en.json admin/messages/uz-Latn.json admin/messages/uz-Cyrl.json
git commit -m "feat(tickets-admin): меню и переводы разделов заявок"
```

---

### Task 11: Деплой

**Files:** правок кода нет

- [ ] **Step 1: Влить ветку в main**

```bash
cd /home/davr/managers && git checkout main && git merge --no-ff feature/tickets-admin
```

- [ ] **Step 2: Пересобрать админку**

```bash
cd /home/davr/managers/admin && export PATH=/root/.nvm/versions/node/v20.19.0/bin:/root/.bun/bin:$PATH
bunx tsc --noEmit 2>&1 | tail -5
cp -r .next .next.bak_tickets_$(date +%s)
bun run build 2>&1 | tail -10
pm2 restart office_admin
```

Порядок обязателен: проход типов → резервная копия `.next` → сборка → рестарт. Если сборка упала, `.next` уже испорчен — восстановить из копии и только потом перезапускать.

- [ ] **Step 3: Пересобрать бэкенд (правки задачи 1)**

По `backend/DEPLOY.md`: копия бинаря, `bun build --compile`, смоук на 6798, `mv app.new app`, `pm2 restart office_api`. Проверка тремя способами: роут снаружи отдаёт 401 (не 404), счётчик рестартов pm2 сдвинулся, `readlink -f /proc/PID/exe` без «(deleted)».

- [ ] **Step 4: Живая проверка на проде**

Открыть под админской сессией `https://office.lesailes.uz/ru/tickets`, `/ru/tickets/contractors`, `/ru/tickets/types`, `/ru/tickets/payments`; под сессией менеджера — `/ru/branch-tickets`. Проверить, что пункты меню видны ровно тем ролям, у кого есть право.

- [ ] **Step 5: Записать в журнал**

Дописать в `docs/superpowers/tickets-progress.md` дату, коммиты, что проверено, и остаток (мини-апп и API исполнителя — Планы 3 и 4).

---

## Что дальше

- **План 3** — API исполнителя `/tickets/tg/*`: начинается с разбиения `controller.ts` на `shared` и файлы роутов, затем макрос `tgExecutor` на `initData`, захват заявки одним `UPDATE ... WHERE status='new'`, сдача работы с актом и фото.
- **План 4** — мини-апп подрядчика: три экрана на Vite, `MainButton` телеграма, темы и два языка.
- **План 6** — деплой мини-аппа и nginx-блок `/tickets-app/`.
