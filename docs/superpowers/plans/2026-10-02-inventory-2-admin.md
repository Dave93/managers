# Инвентаризации, план 2: экраны админки — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** экраны инвентаризации в админке: список и старт, таблица ввода для телефона, планшета и POS с офлайн-очередью и параллельным вводом, обзор для офиса, редактор шаблонов, пункты меню и тексты на 4 языках.

**Architecture:** чистая логика (разбор ввода «2,5+3», точные суммы, очередь операций в localStorage, наложение неотправленных операций на ответ сервера, периоды) лежит в `admin/lib/inventory/` с тестами `bun:test`. Хук `useCountSync` связывает очередь, TanStack Query (`refetchInterval` 10 с) и сеть. Страницы — client components под `admin/app/[locale]/inventory/`. API — через `admin/lib/inventory-api.ts` (`(apiClient.api as any).inventory`, типы из `@backend/modules/inventory/types`), как в `admin/lib/staff-roles.ts`.

**Tech Stack:** Next.js 15, React 19, TanStack Query 5, next-intl, Tailwind, shadcn/radix-компоненты из `admin/components/ui`, `uuid`, `sonner`, `lucide-react`, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-02-inventory-counts-design.md`. **Зависит от:** `docs/superpowers/plans/2026-10-02-inventory-1-backend.md` (все роуты и `types.ts`).

## Global Constraints

- Учётных цифр iiko на экранах нет.
- Офлайн-очередь хранится в localStorage под ключами `inventory:queue:<countId>` и `inventory:detail:<countId>`. Если localStorage недоступен (приватный режим), очередь живёт в памяти вкладки.
- id записи генерируется через `uuid` v4 (`crypto.randomUUID` работает только на https).
- Офлайн работает, пока открыта страница ввода. Перезагрузка страницы без сети не поддерживается: `middleware.ts` на каждый переход ходит в `/api/users/me`.
- Строка таблицы не ниже 44 px, поле ввода `inputmode="decimal"`, запятая и точка — десятичный разделитель.
- Все тексты экранов — через `useTranslations("inventory")`. Пункты бокового меню в `nav-config.tsx` пишутся по-русски строкой, как соседние.
- Маршруты и ссылки внутри страниц — через `Link`/`useRouter` из `@admin/i18n/routing`.
- Коммиты на ветке `feature/inventory-counts`, в конце сообщения строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Связь пропала посреди ввода:** записи копятся, счётчик «не отправлено» растёт, после `online` уходят ровно один раз. Пин: тесты `applyResult` и `overlay` (дедупликация по id) в Task 1 и офлайн-сценарий в Task 7.
- **Ответ на sync потерялся, но сервер запись принял:** на экране нет двойного счёта. Пин: тест `overlay` «pending add с id, который уже пришёл от сервера» в Task 1.
- **Инвентаризацию отправили, пока у помощника была очередь:** записи помечены «не принято» и не пропадают. Пин: тест `rejectAll` в Task 1 и сценарий с двумя окнами в Task 7.
- **Дробные суммы:** `0,1+0,2` даёт `0,3`, а не `0,30000000000000004`. Пин: тест `sumQty` в Task 1.
- **Ввод «2.5», «2,5», « 2,5 + 3 », «-1», «2,5+», «1,23456»:** первые три принимаются, остальные отклоняются с подсказкой. Пин: тесты `parseQtyInput` в Task 1.

---

### Task 1: Чистая логика: ввод, суммы, периоды, очередь

**Files:**
- Create: `admin/lib/inventory/qty.ts`, `admin/lib/inventory/periods.ts`, `admin/lib/inventory/queue.ts`
- Test: `admin/lib/inventory/qty.test.ts`, `admin/lib/inventory/periods.test.ts`, `admin/lib/inventory/queue.test.ts`

**Interfaces:**
- Consumes: типы `InventoryCountDetail`, `InventoryEntry`, `InventoryLine`, `InventorySyncOp`, `InventorySyncResult` из `@backend/modules/inventory/types`.
- Produces:
  - `parseQtyInput(raw: string): { ok: true; values: number[] } | { ok: false; error: "empty" | "invalid" | "too_many_decimals" | "too_big" }`
  - `sumQty(values: (string | number)[]): string` — точка, без хвостовых нулей
  - `formatQty(v: string | null | undefined): string` — запятая, `""` для null
  - `recentPeriods(now: Date, n: number): string[]`, `periodLabel(period: string, locale: string): string`
  - `type QueuedOp = { op: InventorySyncOp; state: "pending" | "rejected"; reason?: string }`
  - `interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }`
  - `loadQueue(kv, countId)`, `saveQueue(kv, countId, q)`, `pendingOps(q): InventorySyncOp[]`, `applyResult(q, r): QueuedOp[]`, `rejectAll(q, ids, reason): QueuedOp[]`
  - `type OverlayEntry = InventoryEntry & { pending?: boolean }`, `type OverlayLine = Omit<InventoryLine, "entries"> & { entries: OverlayEntry[] }`, `type OverlayDetail = Omit<InventoryCountDetail, "lines"> & { lines: OverlayLine[] }`
  - `overlay(detail: InventoryCountDetail, q: QueuedOp[], youLabel: string): OverlayDetail`
  - `cacheDetail(kv, detail)`, `loadCachedDetail(kv, countId): InventoryCountDetail | null`
  - `isLineDone(line: OverlayLine): boolean`

- [ ] **Step 1: Падающие тесты `qty.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { formatQty, parseQtyInput, sumQty } from "./qty";

describe("parseQtyInput", () => {
  test("одно число с запятой или точкой", () => {
    expect(parseQtyInput("2,5")).toEqual({ ok: true, values: [2.5] });
    expect(parseQtyInput("2.5")).toEqual({ ok: true, values: [2.5] });
    expect(parseQtyInput("0")).toEqual({ ok: true, values: [0] });
  });
  test("сумма через плюс с пробелами — несколько записей", () => {
    expect(parseQtyInput(" 2,5 + 3 ")).toEqual({ ok: true, values: [2.5, 3] });
    expect(parseQtyInput("1+1+0,25")).toEqual({ ok: true, values: [1, 1, 0.25] });
  });
  test("ошибки", () => {
    expect(parseQtyInput("")).toEqual({ ok: false, error: "empty" });
    expect(parseQtyInput("   ")).toEqual({ ok: false, error: "empty" });
    expect(parseQtyInput("-1")).toEqual({ ok: false, error: "invalid" });
    expect(parseQtyInput("2,5+")).toEqual({ ok: false, error: "invalid" });
    expect(parseQtyInput("abc")).toEqual({ ok: false, error: "invalid" });
    expect(parseQtyInput("1,23456")).toEqual({ ok: false, error: "too_many_decimals" });
    expect(parseQtyInput("1000001")).toEqual({ ok: false, error: "too_big" });
  });
});

describe("sumQty / formatQty", () => {
  test("точная десятичная сумма", () => {
    expect(sumQty([0.1, 0.2])).toBe("0.3");
    expect(sumQty(["2.5000", 3])).toBe("5.5");
    expect(sumQty([])).toBe("0");
    expect(sumQty(["1.2345", "0.0001"])).toBe("1.2346");
  });
  test("формат с запятой", () => {
    expect(formatQty("5.5")).toBe("5,5");
    expect(formatQty("5.5000")).toBe("5,5");
    expect(formatQty("12")).toBe("12");
    expect(formatQty(null)).toBe("");
  });
});
```

- [ ] **Step 2: Падающие тесты `periods.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { periodLabel, recentPeriods } from "./periods";

describe("recentPeriods", () => {
  test("последние n периодов по Ташкенту, текущий первым", () => {
    expect(recentPeriods(new Date("2026-10-31T22:00:00Z"), 3)).toEqual(["2026-11-30", "2026-10-31", "2026-09-30"]);
    expect(recentPeriods(new Date("2026-01-15T10:00:00Z"), 2)).toEqual(["2026-01-31", "2025-12-31"]);
  });
});

describe("periodLabel", () => {
  test("месяц и год по локали", () => {
    expect(periodLabel("2026-10-31", "ru").toLowerCase()).toContain("2026");
    expect(periodLabel("2026-10-31", "ru").toLowerCase()).toContain("октябр");
  });
});
```

- [ ] **Step 3: Падающие тесты `queue.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import type { InventoryCountDetail } from "@backend/modules/inventory/types";
import { applyResult, isLineDone, loadQueue, overlay, pendingOps, rejectAll, saveQueue, type KV, type QueuedOp } from "./queue";

function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";

function detail(): InventoryCountDetail {
  return {
    id: "c", store_id: "s", store_name: "Склад", template_id: "t", template_name: "Месячная",
    period: "2026-10-31", status: "draft", created_at: "", submitted_at: null, submitted_by_name: null,
    lines_total: 2, lines_done: 1, participants: ["Иван"], viewer_id: "me", access: "write",
    can_manage: true, can_reopen: false,
    lines: [
      {
        id: L1, product_id: "p1", product_name: "Говядина", unit_name: "кг", group_id: null, group_name: "Мясо",
        source: "template", skipped: false, fact_qty: null, total: "2.5",
        entries: [{ id: "e1", line_id: L1, qty: "2.5", created_by: "u1", created_by_name: "Иван", client_created_at: "2026-10-31T10:00:00Z" }],
      },
      {
        id: L2, product_id: "p2", product_name: "Соль", unit_name: "кг", group_id: null, group_name: "Без группы",
        source: "template", skipped: false, fact_qty: null, total: "0", entries: [],
      },
    ],
  };
}

const add = (id: string, line_id: string, qty: number): QueuedOp => ({
  state: "pending",
  op: { op: "add", id, line_id, qty, client_created_at: "2026-10-31T11:00:00Z" },
});
const del = (id: string): QueuedOp => ({ state: "pending", op: { op: "delete", id } });

describe("очередь в KV", () => {
  test("сохраняет и читает, пустая очередь удаляет ключ", () => {
    const kv = memoryKV();
    saveQueue(kv, "c", [add("a", L1, 1)]);
    expect(loadQueue(kv, "c")).toEqual([add("a", L1, 1)]);
    saveQueue(kv, "c", []);
    expect(kv.data.has("inventory:queue:c")).toBe(false);
  });
  test("битый JSON — пустая очередь", () => {
    const kv = memoryKV();
    kv.setItem("inventory:queue:c", "{oops");
    expect(loadQueue(kv, "c")).toEqual([]);
  });
});

describe("applyResult / rejectAll", () => {
  test("применённые уходят, отклонённые помечаются", () => {
    const q = [add("a", L1, 1), add("b", L1, -1), add("c", L2, 2)];
    const next = applyResult(q, { applied: ["a"], rejected: [{ id: "b", reason: "invalid_qty" }] });
    expect(next).toEqual([{ ...add("b", L1, -1), state: "rejected", reason: "invalid_qty" }, add("c", L2, 2)]);
    expect(pendingOps(next).map((o) => o.id)).toEqual(["c"]);
  });
  test("add и delete с одним id уходят вместе", () => {
    const q = [add("a", L1, 1), del("a")];
    expect(applyResult(q, { applied: ["a", "a"], rejected: [] })).toEqual([]);
  });
  test("rejectAll помечает пачку", () => {
    const q = [add("a", L1, 1), add("b", L1, 2)];
    expect(rejectAll(q, ["a"], "not_draft")[0]).toEqual({ ...add("a", L1, 1), state: "rejected", reason: "not_draft" });
    expect(rejectAll(q, ["a"], "not_draft")[1]).toEqual(add("b", L1, 2));
  });
});

describe("overlay", () => {
  test("неотправленная запись добавляется к строке и в итог", () => {
    const o = overlay(detail(), [add("n1", L2, 0.1), add("n2", L2, 0.2)], "Вы");
    const l2 = o.lines.find((l) => l.id === L2)!;
    expect(l2.total).toBe("0.3");
    expect(l2.entries.map((e) => [e.id, e.pending, e.created_by_name])).toEqual([
      ["n1", true, "Вы"],
      ["n2", true, "Вы"],
    ]);
    expect(o.lines_done).toBe(2);
  });
  test("неотправленное удаление скрывает запись", () => {
    const o = overlay(detail(), [del("e1")], "Вы");
    const l1 = o.lines.find((l) => l.id === L1)!;
    expect(l1.entries).toEqual([]);
    expect(l1.total).toBe("0");
    expect(o.lines_done).toBe(0);
  });
  test("pending add с id, который уже пришёл от сервера, не дублируется", () => {
    const o = overlay(detail(), [add("e1", L1, 2.5)], "Вы");
    const l1 = o.lines.find((l) => l.id === L1)!;
    expect(l1.entries.length).toBe(1);
    expect(l1.total).toBe("2.5");
  });
  test("отклонённые операции в итог не входят", () => {
    const o = overlay(detail(), [{ ...add("x", L2, 5), state: "rejected", reason: "not_draft" }], "Вы");
    expect(o.lines.find((l) => l.id === L2)!.total).toBe("0");
  });
  test("isLineDone: записи или «не считали»", () => {
    const o = overlay(detail(), [], "Вы");
    expect(isLineDone(o.lines[0])).toBe(true);
    expect(isLineDone(o.lines[1])).toBe(false);
    expect(isLineDone({ ...o.lines[1], skipped: true })).toBe(true);
  });
});
```

- [ ] **Step 4: Убедиться, что падают**

```bash
cd admin && bun test lib/inventory/
```
Ожидается FAIL: модули не найдены.

- [ ] **Step 5: `qty.ts`**

```ts
export const MAX_QTY = 1_000_000;
const SCALE = 10_000;

export type ParseQtyResult =
  | { ok: true; values: number[] }
  | { ok: false; error: "empty" | "invalid" | "too_many_decimals" | "too_big" };

// «2,5 + 3» → две записи [2.5, 3]. Каждое слагаемое — отдельная запись,
// чтобы параллельные участники не затирали друг друга.
export function parseQtyInput(raw: string): ParseQtyResult {
  const s = raw.replace(/\s+/g, "");
  if (!s) return { ok: false, error: "empty" };
  const values: number[] = [];
  for (const part of s.split("+")) {
    if (!/^\d+([.,]\d+)?$/.test(part)) return { ok: false, error: "invalid" };
    const normalized = part.replace(",", ".");
    const frac = normalized.split(".")[1] ?? "";
    if (frac.length > 4) return { ok: false, error: "too_many_decimals" };
    const v = Number(normalized);
    if (v > MAX_QTY) return { ok: false, error: "too_big" };
    values.push(v);
  }
  return { ok: true, values };
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
}

// Сумма в целых десятитысячных: без хвостов вида 0.30000000000000004.
export function sumQty(values: (string | number)[]): string {
  let total = 0;
  for (const v of values) total += Math.round(Number(v) * SCALE);
  return trimZeros((total / SCALE).toFixed(4));
}

export function formatQty(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  return trimZeros(Number(v).toFixed(4)).replace(".", ",");
}
```

- [ ] **Step 6: `periods.ts`**

```ts
// Asia/Tashkent — UTC+5 круглый год (то же правило, что backend/src/modules/inventory/rules.ts).
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

function lastDay(y: number, m: number): string {
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** Последние n месячных периодов (последний день месяца), текущий первым. */
export function recentPeriods(now: Date, n: number): string[] {
  const t = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  let y = t.getUTCFullYear();
  let m = t.getUTCMonth() + 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(lastDay(y, m));
    if (m === 1) {
      y -= 1;
      m = 12;
    } else {
      m -= 1;
    }
  }
  return out;
}

export function periodLabel(period: string, locale: string): string {
  const [y, m] = period.split("-").map(Number);
  const intlLocale = locale === "uz-Latn" ? "uz" : locale === "uz-Cyrl" ? "uz-Cyrl" : locale;
  const d = new Date(Date.UTC(y, m - 1, 15));
  try {
    return d.toLocaleDateString(intlLocale, { month: "long", year: "numeric", timeZone: "UTC" });
  } catch {
    return `${pad(m)}.${y}`;
  }
}
```

- [ ] **Step 7: `queue.ts`**

```ts
import type {
  InventoryCountDetail,
  InventoryEntry,
  InventoryLine,
  InventorySyncOp,
  InventorySyncResult,
} from "@backend/modules/inventory/types";
import { sumQty } from "./qty";

export type QueuedOp = { op: InventorySyncOp; state: "pending" | "rejected"; reason?: string };

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const queueKey = (countId: string) => `inventory:queue:${countId}`;
const detailKey = (countId: string) => `inventory:detail:${countId}`;

export function loadQueue(kv: KV, countId: string): QueuedOp[] {
  try {
    const raw = kv.getItem(queueKey(countId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveQueue(kv: KV, countId: string, q: QueuedOp[]): void {
  try {
    if (q.length) kv.setItem(queueKey(countId), JSON.stringify(q));
    else kv.removeItem(queueKey(countId));
  } catch {
    // Переполнение или запрет хранилища: очередь остаётся в памяти вкладки.
  }
}

export function pendingOps(q: QueuedOp[]): InventorySyncOp[] {
  return q.filter((x) => x.state === "pending").map((x) => x.op);
}

export function applyResult(q: QueuedOp[], r: InventorySyncResult): QueuedOp[] {
  const applied = new Set(r.applied);
  const rejected = new Map(r.rejected.map((x) => [x.id, x.reason]));
  const out: QueuedOp[] = [];
  for (const item of q) {
    if (item.state !== "pending") {
      out.push(item);
      continue;
    }
    if (rejected.has(item.op.id)) {
      out.push({ ...item, state: "rejected", reason: rejected.get(item.op.id) });
      continue;
    }
    if (applied.has(item.op.id)) continue;
    out.push(item);
  }
  return out;
}

export function rejectAll(q: QueuedOp[], ids: string[], reason: string): QueuedOp[] {
  const set = new Set(ids);
  return q.map((item) => (item.state === "pending" && set.has(item.op.id) ? { ...item, state: "rejected", reason } : item));
}

export type OverlayEntry = InventoryEntry & { pending?: boolean };
export type OverlayLine = Omit<InventoryLine, "entries"> & { entries: OverlayEntry[] };
export type OverlayDetail = Omit<InventoryCountDetail, "lines"> & { lines: OverlayLine[] };

export function isLineDone(line: OverlayLine): boolean {
  return line.skipped || line.entries.length > 0;
}

// Ответ сервера + ещё не отправленные операции этого устройства.
export function overlay(detail: InventoryCountDetail, q: QueuedOp[], youLabel: string): OverlayDetail {
  const pending = q.filter((x) => x.state === "pending").map((x) => x.op);
  const deleted = new Set(pending.filter((o) => o.op === "delete").map((o) => o.id));
  const serverIds = new Set(detail.lines.flatMap((l) => l.entries.map((e) => e.id)));
  const addsByLine = new Map<string, OverlayEntry[]>();
  for (const o of pending) {
    if (o.op !== "add" || serverIds.has(o.id) || deleted.has(o.id)) continue;
    const list = addsByLine.get(o.line_id) ?? [];
    list.push({
      id: o.id,
      line_id: o.line_id,
      qty: String(o.qty),
      created_by: detail.viewer_id,
      created_by_name: youLabel,
      client_created_at: o.client_created_at,
      pending: true,
    });
    addsByLine.set(o.line_id, list);
  }
  const lines: OverlayLine[] = detail.lines.map((l) => {
    const entries: OverlayEntry[] = [...l.entries.filter((e) => !deleted.has(e.id)), ...(addsByLine.get(l.id) ?? [])];
    return { ...l, entries, total: sumQty(entries.map((e) => e.qty)) };
  });
  return { ...detail, lines, lines_done: lines.filter(isLineDone).length };
}

export function cacheDetail(kv: KV, detail: InventoryCountDetail): void {
  try {
    kv.setItem(detailKey(detail.id), JSON.stringify(detail));
  } catch {
    // не критично
  }
}

export function loadCachedDetail(kv: KV, countId: string): InventoryCountDetail | null {
  try {
    const raw = kv.getItem(detailKey(countId));
    return raw ? (JSON.parse(raw) as InventoryCountDetail) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 8: Тесты проходят**

```bash
cd admin && bun test lib/inventory/
```
Ожидается PASS. Если `periodLabel` для `ru` в окружении bun не даёт «октябр…» (урезанный ICU), заменить в тесте проверку месяца на `not.toBe("")` и записать это в отчёт.

- [ ] **Step 9: Commit**

```bash
git add admin/lib/inventory
git commit -m "feat(admin/inventory): разбор ввода, точные суммы, периоды, офлайн-очередь

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Клиент API и хук синхронизации

**Files:**
- Create: `admin/lib/inventory-api.ts`
- Create: `admin/lib/inventory/use-count-sync.ts`
- Create: `admin/lib/inventory/use-permissions.ts`

**Interfaces:**
- Consumes: Task 1 целиком; роуты плана 1.
- Produces:
  - `class InventoryApiError extends Error { status: number; body: any }`
  - `inventoryApi` с методами: `stores()`, `periods()`, `availableTemplates(storeId)`, `listCounts(storeId)`, `createCount({store_id, template_id, period})`, `getCount(id)`, `sync(id, ops)`, `addLine(id, productId)`, `setSkipped(id, lineId, skipped)`, `submit(id, skipIncomplete)`, `reopen(id)`, `cancel(id)`, `products(q)`, `overview(period, organizationId?)`, `organizations()`, `folders()`, `templates.list(orgId?)`, `templates.get(id)`, `templates.create(input)`, `templates.update(id, patch)`, `templates.remove(id)`, `templates.setItems(id, productIds)`, `templates.suggestions(id)`
  - `useCountSync(countId: string, youLabel: string): { detail: OverlayDetail | undefined; isLoading: boolean; error: unknown; online: boolean; pendingCount: number; rejectedCount: number; addEntries(lineId: string, values: number[]): void; deleteEntry(id: string): void; dismissRejected(): void; refetch(): Promise<unknown> }`
  - `useMyPermissions(): string[] | undefined`

- [ ] **Step 1: `admin/lib/inventory-api.ts`**

```ts
// Клиентский слой модуля инвентаризаций.
//
// Роуты /api/inventory/* живут на inventoryControllerImpl, экспортированном
// как `as unknown as Elysia` (TS2589, см. backend/src/app.ts), поэтому Eden
// их типы не выводит. Типы ответов берём из backend/src/modules/inventory/types.ts
// (`import type` — в бандл ничего не попадает). Один `as any` на весь модуль.

import { apiClient } from "@admin/utils/eden";
import type {
  InventoryCountDetail,
  InventoryCountSummary,
  InventoryFolders,
  InventoryOverviewRow,
  InventoryProduct,
  InventoryStore,
  InventorySuggestion,
  InventorySyncOp,
  InventorySyncResult,
  InventoryTemplateDetail,
  InventoryTemplateSummary,
} from "@backend/modules/inventory/types";

export class InventoryApiError extends Error {
  constructor(public status: number, public body: any) {
    super(typeof body?.error === "string" ? body.error : typeof body === "string" ? body : `HTTP ${status}`);
  }
}

// Eden не бросает на 4xx — он возвращает { data, error }. Без этой проверки
// react-query посчитал бы 409/422 успехом.
async function call<T>(p: Promise<any>): Promise<T> {
  const res = await p;
  if (res?.error) throw new InventoryApiError(res.error.status ?? res.status ?? 0, res.error.value ?? res.error);
  return res?.data as T;
}

const inv = (apiClient.api as any).inventory;

export const inventoryApi = {
  stores: () => call<InventoryStore[]>(inv.stores.get()),
  periods: () => call<{ periods: string[] }>(inv.periods.get()),
  availableTemplates: (storeId: string) =>
    call<InventoryTemplateSummary[]>(inv.templates.available.get({ query: { store_id: storeId } })),
  listCounts: (storeId: string) => call<InventoryCountSummary[]>(inv.counts.get({ query: { store_id: storeId } })),
  createCount: (body: { store_id: string; template_id: string; period: string }) =>
    call<{ id: string; existing: boolean }>(inv.counts.post(body)),
  getCount: (id: string) => call<InventoryCountDetail>(inv.counts({ id }).get()),
  sync: (id: string, ops: InventorySyncOp[]) => call<InventorySyncResult>(inv.counts({ id }).entries.sync.post({ ops })),
  addLine: (id: string, productId: string) =>
    call<{ line_id: string; created: boolean }>(inv.counts({ id }).lines.post({ product_id: productId })),
  setSkipped: (id: string, lineId: string, skipped: boolean) =>
    call<{ ok: true }>(inv.counts({ id }).lines({ lineId }).patch({ skipped })),
  submit: (id: string, skipIncomplete: boolean) =>
    call<{ ok: true }>(inv.counts({ id }).submit.post({ skip_incomplete: skipIncomplete })),
  reopen: (id: string) => call<{ ok: true }>(inv.counts({ id }).reopen.post({})),
  cancel: (id: string) => call<{ ok: true }>(inv.counts({ id }).cancel.post({})),
  products: (q: string) => call<InventoryProduct[]>(inv.products.get({ query: { q, limit: "20" } })),
  overview: (period: string, organizationId?: string) =>
    call<InventoryOverviewRow[]>(
      inv.overview.get({ query: organizationId ? { period, organization_id: organizationId } : { period } })
    ),
  organizations: () => call<{ id: string; name: string }[]>(inv.organizations.get()),
  folders: () => call<InventoryFolders>(inv.folders.get()),
  templates: {
    list: (organizationId?: string) =>
      call<InventoryTemplateSummary[]>(
        inv.templates.get({ query: organizationId ? { organization_id: organizationId } : {} })
      ),
    get: (id: string) => call<InventoryTemplateDetail>(inv.templates({ id }).get()),
    create: (input: { organization_id: string; name: string }) => call<{ id: string }>(inv.templates.post(input)),
    update: (id: string, patch: { name?: string; active?: boolean; sort?: number }) =>
      call<{ ok: true }>(inv.templates({ id }).patch(patch)),
    remove: (id: string) => call<{ ok: true }>(inv.templates({ id }).delete()),
    setItems: (id: string, productIds: string[]) =>
      call<{ items_count: number }>(inv.templates({ id }).items.put({ product_ids: productIds })),
    suggestions: (id: string) => call<InventorySuggestion[]>(inv.templates({ id }).suggestions.get()),
  },
};
```

- [ ] **Step 2: `admin/lib/inventory/use-permissions.ts`**

```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";

// Тот же ключ и запрос, что в components/can-access.tsx: один кэш, без лишнего запроса.
export function useMyPermissions(): string[] | undefined {
  const { data } = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
  });
  return (data as any)?.permissions;
}
```

- [ ] **Step 3: `admin/lib/inventory/use-count-sync.ts`**

```ts
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import {
  applyResult,
  cacheDetail,
  loadCachedDetail,
  loadQueue,
  overlay,
  pendingOps,
  rejectAll,
  saveQueue,
  type KV,
  type QueuedOp,
} from "./queue";

const BATCH = 200;
const REFETCH_MS = 10_000;
const RETRY_MS = 5_000;

// localStorage может бросать (приватный режим, запрет сайта) — тогда память вкладки.
const memory = new Map<string, string>();
const memoryKV: KV = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};
function storage(): KV {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const probe = "__inventory_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    // падаем в память
  }
  return memoryKV;
}

export function useCountSync(countId: string, youLabel: string) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["inventory_count", countId], [countId]);
  const [queue, setQueue] = useState<QueuedOp[]>(() => loadQueue(storage(), countId));
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const flushing = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const d = await inventoryApi.getCount(countId);
      cacheDetail(storage(), d);
      return d;
    },
    initialData: () => loadCachedDetail(storage(), countId) ?? undefined,
    initialDataUpdatedAt: 0,
    refetchInterval: REFETCH_MS,
  });

  useEffect(() => saveQueue(storage(), countId, queue), [countId, queue]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    const ops = pendingOps(queueRef.current).slice(0, BATCH);
    if (!ops.length) return;
    flushing.current = true;
    try {
      const result = await inventoryApi.sync(countId, ops);
      setQueue((q) => applyResult(q, result));
      setOnline(true);
      void qc.invalidateQueries({ queryKey });
    } catch (e) {
      if (e instanceof InventoryApiError && (e.status === 409 || e.status === 403)) {
        setQueue((q) => rejectAll(q, ops.map((o) => o.id), e.status === 409 ? "not_draft" : "forbidden"));
        void qc.invalidateQueries({ queryKey });
      } else if (typeof navigator !== "undefined" && !navigator.onLine) {
        setOnline(false);
      }
      // Иначе сетевая ошибка: операции остаются pending, повтор по таймеру.
    } finally {
      flushing.current = false;
      // Пока шла пачка, могли добавиться новые операции.
      setTimeout(() => {
        if (pendingOps(queueRef.current).length) void flushRef.current();
      }, 300);
    }
  }, [countId, qc, queryKey]);
  flushRef.current = flush;

  useEffect(() => {
    if (online && pendingOps(queue).length) void flush();
  }, [queue, online, flush]);

  useEffect(() => {
    const t = setInterval(() => {
      if (pendingOps(queueRef.current).length) void flushRef.current();
    }, RETRY_MS);
    return () => clearInterval(t);
  }, []);

  const addEntries = useCallback((lineId: string, values: number[]) => {
    const now = new Date().toISOString();
    setQueue((q) => [
      ...q,
      ...values.map(
        (qty): QueuedOp => ({ state: "pending", op: { op: "add", id: uuidv4(), line_id: lineId, qty, client_created_at: now } })
      ),
    ]);
  }, []);

  const deleteEntry = useCallback((id: string) => {
    setQueue((q) => [...q, { state: "pending", op: { op: "delete", id } }]);
  }, []);

  const dismissRejected = useCallback(() => setQueue((q) => q.filter((x) => x.state !== "rejected")), []);

  const detail = useMemo(() => (query.data ? overlay(query.data, queue, youLabel) : undefined), [query.data, queue, youLabel]);

  return {
    detail,
    isLoading: query.isLoading,
    error: query.error,
    online,
    pendingCount: pendingOps(queue).length,
    rejectedCount: queue.filter((x) => x.state === "rejected" && x.op.op === "add").length,
    addEntries,
    deleteEntry,
    dismissRejected,
    refetch: query.refetch,
  };
}
```

- [ ] **Step 4: Проверить типы**

```bash
cd admin && bunx tsc --noEmit -p . 2>&1 | grep -E "lib/inventory" | head -20
```
Ожидается: пусто (ошибок в новых файлах нет). Ошибки в чужих файлах игнорировать.

- [ ] **Step 5: Commit**

```bash
git add admin/lib/inventory-api.ts admin/lib/inventory/use-count-sync.ts admin/lib/inventory/use-permissions.ts
git commit -m "feat(admin/inventory): клиент API и хук синхронизации с офлайн-очередью

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Тексты на 4 языках и пункты меню

**Files:**
- Modify: `admin/messages/ru.json`, `admin/messages/en.json`, `admin/messages/uz-Latn.json`, `admin/messages/uz-Cyrl.json` (новый верхний ключ `"inventory"`)
- Modify: `admin/components/layout/manager-layout.tsx` (заменить заглушку «Settings»)
- Modify: `admin/components/layout/nav-config.tsx` (группа «Инвентаризация»)

**Interfaces:**
- Produces: пространство имён `inventory` с ключами ниже. Следующие задачи используют **только** эти ключи.

- [ ] **Step 1: Добавить `"inventory"` в `admin/messages/ru.json`**

Вставить ключ верхнего уровня рядом с `"staffRoles"` (JSON должен остаться валидным, запятые между ключами):

```json
"inventory": {
  "title": "Инвентаризация",
  "store": "Склад",
  "chooseStore": "Выберите склад",
  "noStores": "Вы не привязаны ни к одному складу. Обратитесь к администратору.",
  "start": "Начать инвентаризацию",
  "template": "Шаблон",
  "period": "Период",
  "create": "Начать",
  "noTemplates": "Для этого склада нет активных шаблонов",
  "empty": "Инвентаризаций пока нет",
  "progress": "{done} из {total}",
  "participants": "Вводят: {names}",
  "submittedBy": "Отправил: {name}",
  "readOnly": "Только просмотр",
  "back": "Назад",
  "status": { "draft": "Черновик", "submitted": "Отправлена", "cancelled": "Отменена" },
  "tabs": { "mine": "Мои склады", "overview": "Обзор" },
  "overview": { "notStarted": "Не начата", "organization": "Организация", "all": "Все", "open": "Открыть" },
  "table": {
    "product": "Позиция",
    "unit": "Ед.",
    "fact": "Факт",
    "search": "Поиск по названию",
    "filterAll": "Все",
    "filterTodo": "Не посчитано",
    "filterMine": "Мои",
    "enter": "+ ввести",
    "added": "добавлено",
    "skipped": "не считали",
    "nothing": "Ничего не найдено"
  },
  "line": {
    "skip": "Не считали",
    "unskip": "Вернуть в подсчёт",
    "entries": "Записи",
    "delete": "Удалить",
    "you": "Вы",
    "pending": "не отправлено"
  },
  "addProduct": {
    "button": "+ товар не из списка",
    "title": "Добавить товар",
    "search": "Название товара (от 2 букв)",
    "nothing": "Ничего не найдено",
    "offline": "Без сети добавить нельзя"
  },
  "sync": {
    "online": "онлайн",
    "offline": "офлайн",
    "pending": "не отправлено: {count}",
    "rejected": "Не принято записей: {count}. Инвентаризация уже отправлена — попросите менеджера вернуть её в черновик.",
    "dismiss": "Скрыть"
  },
  "submit": {
    "button": "Отправить",
    "title": "Отправить инвентаризацию?",
    "counted": "Посчитано: {count}",
    "skipped": "Не считали: {count}",
    "incomplete": "Не заполнено: {count}",
    "skipAll": "Отметить незаполненные как «не считали» и отправить",
    "confirm": "Отправить",
    "cancel": "Вернуться",
    "pendingBlock": "Сначала дождитесь отправки всех записей с этого устройства",
    "done": "Инвентаризация отправлена"
  },
  "reopen": "Вернуть в черновик",
  "reopened": "Инвентаризация снова в черновике",
  "cancelCount": "Отменить инвентаризацию",
  "cancelConfirm": "Отменить черновик? Записи останутся в истории.",
  "cancelled": "Инвентаризация отменена",
  "errors": {
    "invalidQty": "Введите число, например 2,5 или 2,5+3",
    "generic": "Ошибка: {message}"
  },
  "templates": {
    "title": "Шаблоны инвентаризаций",
    "new": "Новый шаблон",
    "name": "Название",
    "active": "Активен",
    "items": "Позиций",
    "organization": "Организация",
    "save": "Сохранить",
    "saved": "Сохранено",
    "selected": "Выбрано: {count}",
    "search": "Поиск товара",
    "suggestions": "Добавляли при пересчёте",
    "addToTemplate": "Добавить в шаблон",
    "times": "{count} раз",
    "delete": "Удалить",
    "deleted": "Шаблон удалён",
    "inUse": "Шаблон уже использовался — его можно только деактивировать",
    "back": "К шаблонам",
    "noSuggestions": "Пока ничего не добавляли"
  }
}
```

- [ ] **Step 2: То же для `en.json`**

```json
"inventory": {
  "title": "Stock count",
  "store": "Store",
  "chooseStore": "Choose a store",
  "noStores": "You are not assigned to any store. Contact the administrator.",
  "start": "Start a stock count",
  "template": "Template",
  "period": "Period",
  "create": "Start",
  "noTemplates": "No active templates for this store",
  "empty": "No stock counts yet",
  "progress": "{done} of {total}",
  "participants": "Counting: {names}",
  "submittedBy": "Submitted by: {name}",
  "readOnly": "Read only",
  "back": "Back",
  "status": { "draft": "Draft", "submitted": "Submitted", "cancelled": "Cancelled" },
  "tabs": { "mine": "My stores", "overview": "Overview" },
  "overview": { "notStarted": "Not started", "organization": "Organization", "all": "All", "open": "Open" },
  "table": {
    "product": "Item",
    "unit": "Unit",
    "fact": "Counted",
    "search": "Search by name",
    "filterAll": "All",
    "filterTodo": "Not counted",
    "filterMine": "Mine",
    "enter": "+ enter",
    "added": "added",
    "skipped": "not counted",
    "nothing": "Nothing found"
  },
  "line": {
    "skip": "Not counted",
    "unskip": "Count again",
    "entries": "Entries",
    "delete": "Delete",
    "you": "You",
    "pending": "not sent"
  },
  "addProduct": {
    "button": "+ item not in the list",
    "title": "Add an item",
    "search": "Item name (2+ letters)",
    "nothing": "Nothing found",
    "offline": "Cannot add while offline"
  },
  "sync": {
    "online": "online",
    "offline": "offline",
    "pending": "not sent: {count}",
    "rejected": "Entries not accepted: {count}. The count was already submitted — ask the manager to reopen it.",
    "dismiss": "Hide"
  },
  "submit": {
    "button": "Submit",
    "title": "Submit the stock count?",
    "counted": "Counted: {count}",
    "skipped": "Not counted: {count}",
    "incomplete": "Empty: {count}",
    "skipAll": "Mark empty items as “not counted” and submit",
    "confirm": "Submit",
    "cancel": "Go back",
    "pendingBlock": "Wait until all entries from this device are sent",
    "done": "Stock count submitted"
  },
  "reopen": "Reopen as draft",
  "reopened": "The stock count is a draft again",
  "cancelCount": "Cancel the stock count",
  "cancelConfirm": "Cancel this draft? Entries stay in the history.",
  "cancelled": "Stock count cancelled",
  "errors": {
    "invalidQty": "Enter a number, e.g. 2.5 or 2.5+3",
    "generic": "Error: {message}"
  },
  "templates": {
    "title": "Stock count templates",
    "new": "New template",
    "name": "Name",
    "active": "Active",
    "items": "Items",
    "organization": "Organization",
    "save": "Save",
    "saved": "Saved",
    "selected": "Selected: {count}",
    "search": "Search item",
    "suggestions": "Added during counts",
    "addToTemplate": "Add to template",
    "times": "{count} times",
    "delete": "Delete",
    "deleted": "Template deleted",
    "inUse": "The template has been used — it can only be deactivated",
    "back": "Back to templates",
    "noSuggestions": "Nothing added yet"
  }
}
```

- [ ] **Step 3: То же для `uz-Latn.json` (черновой перевод)**

```json
"inventory": {
  "title": "Inventarizatsiya",
  "store": "Ombor",
  "chooseStore": "Omborni tanlang",
  "noStores": "Siz hech qaysi omborga biriktirilmagansiz. Administratorga murojaat qiling.",
  "start": "Inventarizatsiyani boshlash",
  "template": "Shablon",
  "period": "Davr",
  "create": "Boshlash",
  "noTemplates": "Bu ombor uchun faol shablon yo‘q",
  "empty": "Hozircha inventarizatsiya yo‘q",
  "progress": "{total} dan {done}",
  "participants": "Kiritmoqda: {names}",
  "submittedBy": "Yubordi: {name}",
  "readOnly": "Faqat ko‘rish",
  "back": "Orqaga",
  "status": { "draft": "Qoralama", "submitted": "Yuborilgan", "cancelled": "Bekor qilingan" },
  "tabs": { "mine": "Mening omborlarim", "overview": "Umumiy ko‘rinish" },
  "overview": { "notStarted": "Boshlanmagan", "organization": "Tashkilot", "all": "Hammasi", "open": "Ochish" },
  "table": {
    "product": "Pozitsiya",
    "unit": "O‘lch.",
    "fact": "Fakt",
    "search": "Nomi bo‘yicha qidirish",
    "filterAll": "Hammasi",
    "filterTodo": "Sanalmagan",
    "filterMine": "Meniki",
    "enter": "+ kiritish",
    "added": "qo‘shilgan",
    "skipped": "sanalmadi",
    "nothing": "Hech narsa topilmadi"
  },
  "line": {
    "skip": "Sanalmadi",
    "unskip": "Sanashga qaytarish",
    "entries": "Yozuvlar",
    "delete": "O‘chirish",
    "you": "Siz",
    "pending": "yuborilmagan"
  },
  "addProduct": {
    "button": "+ ro‘yxatda yo‘q mahsulot",
    "title": "Mahsulot qo‘shish",
    "search": "Mahsulot nomi (kamida 2 harf)",
    "nothing": "Hech narsa topilmadi",
    "offline": "Internetsiz qo‘shib bo‘lmaydi"
  },
  "sync": {
    "online": "onlayn",
    "offline": "oflayn",
    "pending": "yuborilmagan: {count}",
    "rejected": "Qabul qilinmagan yozuvlar: {count}. Inventarizatsiya allaqachon yuborilgan — menejerdan qoralamaga qaytarishni so‘rang.",
    "dismiss": "Yashirish"
  },
  "submit": {
    "button": "Yuborish",
    "title": "Inventarizatsiyani yuborasizmi?",
    "counted": "Sanalgan: {count}",
    "skipped": "Sanalmagan: {count}",
    "incomplete": "To‘ldirilmagan: {count}",
    "skipAll": "To‘ldirilmaganlarni «sanalmadi» deb belgilab yuborish",
    "confirm": "Yuborish",
    "cancel": "Qaytish",
    "pendingBlock": "Avval bu qurilmadagi barcha yozuvlar yuborilishini kuting",
    "done": "Inventarizatsiya yuborildi"
  },
  "reopen": "Qoralamaga qaytarish",
  "reopened": "Inventarizatsiya yana qoralamada",
  "cancelCount": "Inventarizatsiyani bekor qilish",
  "cancelConfirm": "Qoralama bekor qilinsinmi? Yozuvlar tarixda qoladi.",
  "cancelled": "Inventarizatsiya bekor qilindi",
  "errors": {
    "invalidQty": "Son kiriting, masalan 2,5 yoki 2,5+3",
    "generic": "Xato: {message}"
  },
  "templates": {
    "title": "Inventarizatsiya shablonlari",
    "new": "Yangi shablon",
    "name": "Nomi",
    "active": "Faol",
    "items": "Pozitsiyalar",
    "organization": "Tashkilot",
    "save": "Saqlash",
    "saved": "Saqlandi",
    "selected": "Tanlangan: {count}",
    "search": "Mahsulot qidirish",
    "suggestions": "Sanash paytida qo‘shilgan",
    "addToTemplate": "Shablonga qo‘shish",
    "times": "{count} marta",
    "delete": "O‘chirish",
    "deleted": "Shablon o‘chirildi",
    "inUse": "Shablon ishlatilgan — uni faqat o‘chirib qo‘yish mumkin",
    "back": "Shablonlarga",
    "noSuggestions": "Hozircha hech narsa qo‘shilmagan"
  }
}
```

- [ ] **Step 4: То же для `uz-Cyrl.json` (черновой перевод)**

```json
"inventory": {
  "title": "Инвентаризация",
  "store": "Омбор",
  "chooseStore": "Омборни танланг",
  "noStores": "Сиз ҳеч қайси омборга бириктирилмагансиз. Администраторга мурожаат қилинг.",
  "start": "Инвентаризацияни бошлаш",
  "template": "Шаблон",
  "period": "Давр",
  "create": "Бошлаш",
  "noTemplates": "Бу омбор учун фаол шаблон йўқ",
  "empty": "Ҳозирча инвентаризация йўқ",
  "progress": "{total} дан {done}",
  "participants": "Киритмоқда: {names}",
  "submittedBy": "Юборди: {name}",
  "readOnly": "Фақат кўриш",
  "back": "Орқага",
  "status": { "draft": "Қоралама", "submitted": "Юборилган", "cancelled": "Бекор қилинган" },
  "tabs": { "mine": "Менинг омборларим", "overview": "Умумий кўриниш" },
  "overview": { "notStarted": "Бошланмаган", "organization": "Ташкилот", "all": "Ҳаммаси", "open": "Очиш" },
  "table": {
    "product": "Позиция",
    "unit": "Ўлч.",
    "fact": "Факт",
    "search": "Номи бўйича қидириш",
    "filterAll": "Ҳаммаси",
    "filterTodo": "Саналмаган",
    "filterMine": "Меники",
    "enter": "+ киритиш",
    "added": "қўшилган",
    "skipped": "саналмади",
    "nothing": "Ҳеч нарса топилмади"
  },
  "line": {
    "skip": "Саналмади",
    "unskip": "Санашга қайтариш",
    "entries": "Ёзувлар",
    "delete": "Ўчириш",
    "you": "Сиз",
    "pending": "юборилмаган"
  },
  "addProduct": {
    "button": "+ рўйхатда йўқ маҳсулот",
    "title": "Маҳсулот қўшиш",
    "search": "Маҳсулот номи (камида 2 ҳарф)",
    "nothing": "Ҳеч нарса топилмади",
    "offline": "Интернетсиз қўшиб бўлмайди"
  },
  "sync": {
    "online": "онлайн",
    "offline": "офлайн",
    "pending": "юборилмаган: {count}",
    "rejected": "Қабул қилинмаган ёзувлар: {count}. Инвентаризация аллақачон юборилган — менежердан қораламага қайтаришни сўранг.",
    "dismiss": "Яшириш"
  },
  "submit": {
    "button": "Юбориш",
    "title": "Инвентаризацияни юборасизми?",
    "counted": "Саналган: {count}",
    "skipped": "Саналмаган: {count}",
    "incomplete": "Тўлдирилмаган: {count}",
    "skipAll": "Тўлдирилмаганларни «саналмади» деб белгилаб юбориш",
    "confirm": "Юбориш",
    "cancel": "Қайтиш",
    "pendingBlock": "Аввал бу қурилмадаги барча ёзувлар юборилишини кутинг",
    "done": "Инвентаризация юборилди"
  },
  "reopen": "Қораламага қайтариш",
  "reopened": "Инвентаризация яна қораламада",
  "cancelCount": "Инвентаризацияни бекор қилиш",
  "cancelConfirm": "Қоралама бекор қилинсинми? Ёзувлар тарихда қолади.",
  "cancelled": "Инвентаризация бекор қилинди",
  "errors": {
    "invalidQty": "Сон киритинг, масалан 2,5 ёки 2,5+3",
    "generic": "Хато: {message}"
  },
  "templates": {
    "title": "Инвентаризация шаблонлари",
    "new": "Янги шаблон",
    "name": "Номи",
    "active": "Фаол",
    "items": "Позициялар",
    "organization": "Ташкилот",
    "save": "Сақлаш",
    "saved": "Сақланди",
    "selected": "Танланган: {count}",
    "search": "Маҳсулот қидириш",
    "suggestions": "Санаш пайтида қўшилган",
    "addToTemplate": "Шаблонга қўшиш",
    "times": "{count} марта",
    "delete": "Ўчириш",
    "deleted": "Шаблон ўчирилди",
    "inUse": "Шаблон ишлатилган — уни фақат ўчириб қўйиш мумкин",
    "back": "Шаблонларга",
    "noSuggestions": "Ҳозирча ҳеч нарса қўшилмаган"
  }
}
```

- [ ] **Step 5: Проверить, что JSON валиден и ключи совпадают**

```bash
cd admin && python3 - <<'E'
import json
keys = {}
def flat(d, p=""):
    out = set()
    for k, v in d.items():
        out |= flat(v, p + k + ".") if isinstance(v, dict) else {p + k}
    return out
for loc in ["ru", "en", "uz-Latn", "uz-Cyrl"]:
    keys[loc] = flat(json.load(open(f"messages/{loc}.json"))["inventory"])
base = keys["ru"]
for loc, k in keys.items():
    print(loc, len(k), "missing:", sorted(base - k), "extra:", sorted(k - base))
E
```
Ожидается: у всех четырёх одинаковое число ключей, `missing: []`, `extra: []`.

- [ ] **Step 6: Меню менеджера — заменить заглушку «Settings»**

В `admin/components/layout/manager-layout.tsx` найти блок `<Link href="/" ...>`, внутри которого `<span ...>Settings</span>` (второй `href="/"` в файле, сразу после ссылки Asrabox). Заменить весь этот `<Link>...</Link>` на:

```tsx
          <CanAccess permission="inventory.count">
            <Link
              href="/inventory"
              type="button"
              className="inline-flex flex-col items-center justify-center px-5 hover:bg-gray-50 dark:hover:bg-gray-800 group"
            >
              <ClipboardList
                aria-hidden="true"
                className="w-5 h-5 mb-2 text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-500"
              />
              <span className="text-sm text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-500">
                {t("title")}
              </span>
            </Link>
          </CanAccess>
```

В шапку файла добавить:
```tsx
"use client";
import { ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
```
(если `"use client"` уже есть — не дублировать). В начало тела `ManagerLayout` добавить `const t = useTranslations("inventory");`. Компонент рендерится внутри `MainLayout`, который уже client, поэтому `"use client"` здесь безопасен.

- [ ] **Step 7: Боковое меню — группа в `nav-config.tsx`**

В импорт `lucide-react` добавить `ClipboardList`. В массив `buildNav` после пункта «Состав филиалов» добавить:

```tsx
    {
      kind: "group",
      title: "Инвентаризация",
      icon: ClipboardList,
      permission: "inventory.count",
      items: [
        { title: "Инвентаризации", href: p("/inventory"), permission: "inventory.count" },
        { title: "Шаблоны инвентаризаций", href: p("/inventory/templates"), permission: "inventory.templates" },
      ],
    },
```

- [ ] **Step 8: Проверить и закоммитить**

```bash
cd admin && bun lint 2>&1 | grep -E "manager-layout|nav-config" | head
```
Ожидается: пусто.

```bash
git add admin/messages admin/components/layout/manager-layout.tsx admin/components/layout/nav-config.tsx
git commit -m "feat(admin/inventory): тексты на 4 языках и пункты меню

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Список инвентаризаций, старт и обзор офиса

**Files:**
- Create: `admin/app/[locale]/inventory/page.tsx`
- Create: `admin/app/[locale]/inventory/_components/status-badge.tsx`
- Create: `admin/app/[locale]/inventory/_components/count-card.tsx`
- Create: `admin/app/[locale]/inventory/_components/start-dialog.tsx`
- Create: `admin/app/[locale]/inventory/_components/overview.tsx`

**Interfaces:**
- Consumes: `inventoryApi`, `InventoryApiError` (Task 2), `useMyPermissions` (Task 2), `periodLabel`, `recentPeriods` (Task 1), ключи `inventory.*` (Task 3).
- Produces: `StatusBadge({ status })`, `CountCard({ count })`, `StartDialog({ storeId, onCreated(id) })`, `Overview()`.

- [ ] **Step 1: `status-badge.tsx`**

```tsx
"use client";
import { useTranslations } from "next-intl";
import { Badge } from "@admin/components/ui/badge";
import type { InventoryCountStatus } from "@backend/modules/inventory/types";

const VARIANT: Record<InventoryCountStatus, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  submitted: "default",
  cancelled: "outline",
};

export function StatusBadge({ status }: { status: InventoryCountStatus }) {
  const t = useTranslations("inventory.status");
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
```

- [ ] **Step 2: `count-card.tsx`**

```tsx
"use client";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@admin/i18n/routing";
import { periodLabel } from "@admin/lib/inventory/periods";
import type { InventoryCountSummary } from "@backend/modules/inventory/types";
import { StatusBadge } from "./status-badge";

export function CountCard({ count }: { count: InventoryCountSummary }) {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const pct = count.lines_total ? Math.round((count.lines_done / count.lines_total) * 100) : 0;
  return (
    <Link
      href={`/inventory/${count.id}`}
      className="block rounded-lg border p-4 min-h-[44px] hover:bg-muted/50 active:bg-muted transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{count.template_name}</div>
        <StatusBadge status={count.status} />
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{periodLabel(count.period, locale)}</div>
      <div className="mt-3 h-2 rounded bg-muted overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-sm">{t("progress", { done: count.lines_done, total: count.lines_total })}</div>
      {count.participants.length > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">{t("participants", { names: count.participants.join(", ") })}</div>
      )}
      {count.submitted_by_name && (
        <div className="mt-1 text-xs text-muted-foreground">{t("submittedBy", { name: count.submitted_by_name })}</div>
      )}
    </Link>
  );
}
```

- [ ] **Step 3: `start-dialog.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@admin/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { inventoryApi } from "@admin/lib/inventory-api";
import { periodLabel } from "@admin/lib/inventory/periods";

export function StartDialog({ storeId, onCreated }: { storeId: string; onCreated: (id: string) => void }) {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [period, setPeriod] = useState("");

  const templates = useQuery({
    queryKey: ["inventory_available_templates", storeId],
    queryFn: () => inventoryApi.availableTemplates(storeId),
    enabled: open && !!storeId,
  });
  const periods = useQuery({ queryKey: ["inventory_periods"], queryFn: inventoryApi.periods, enabled: open });

  useEffect(() => {
    if (templates.data?.length === 1) setTemplateId(templates.data[0].id);
  }, [templates.data]);
  useEffect(() => {
    if (periods.data?.periods.length) setPeriod((p) => p || periods.data!.periods[0]);
  }, [periods.data]);

  const create = useMutation({
    mutationFn: () => inventoryApi.createCount({ store_id: storeId, template_id: templateId, period }),
    onSuccess: (r) => {
      setOpen(false);
      onCreated(r.id);
    },
    onError: (e: Error) => toast.error(t("errors.generic", { message: e.message })),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="w-full sm:w-auto" disabled={!storeId}>
          {t("start")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("start")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">{t("template")}</div>
            {templates.data && templates.data.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("noTemplates")}</div>
            ) : (
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder={t("template")} />
                </SelectTrigger>
                <SelectContent>
                  {(templates.data ?? []).map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name} · {tpl.items_count}
                      {tpl.organization_name ? ` · ${tpl.organization_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">{t("period")}</div>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder={t("period")} />
              </SelectTrigger>
              <SelectContent>
                {(periods.data?.periods ?? []).map((p) => (
                  <SelectItem key={p} value={p}>
                    {periodLabel(p, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button size="lg" onClick={() => create.mutate()} disabled={!templateId || !period || create.isPending}>
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: `overview.tsx`**

```tsx
"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@admin/i18n/routing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { inventoryApi } from "@admin/lib/inventory-api";
import { periodLabel, recentPeriods } from "@admin/lib/inventory/periods";
import { StatusBadge } from "./status-badge";

const ALL = "__all__";

export function Overview() {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const periods = useMemo(() => recentPeriods(new Date(), 12), []);
  const [period, setPeriod] = useState(periods[0]);
  const [org, setOrg] = useState(ALL);

  const orgs = useQuery({ queryKey: ["inventory_orgs"], queryFn: inventoryApi.organizations });
  const rows = useQuery({
    queryKey: ["inventory_overview", period, org],
    queryFn: () => inventoryApi.overview(period, org === ALL ? undefined : org),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-48 h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p} value={p}>
                {periodLabel(p, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="w-56 h-11">
            <SelectValue placeholder={t("overview.organization")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("overview.all")}</SelectItem>
            {(orgs.data ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("store")}</TableHead>
            <TableHead>{t("template")}</TableHead>
            <TableHead>{t("status.draft")} / {t("status.submitted")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows.data ?? []).flatMap((r) =>
            r.counts.length === 0
              ? [
                  <TableRow key={r.store_id}>
                    <TableCell>{r.store_name}</TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell className="text-destructive">{t("overview.notStarted")}</TableCell>
                    <TableCell />
                  </TableRow>,
                ]
              : r.counts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{r.store_name}</TableCell>
                    <TableCell>{c.template_name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={c.status} />
                        <span className="text-sm">{t("progress", { done: c.lines_done, total: c.lines_total })}</span>
                      </div>
                      {c.submitted_by_name && (
                        <div className="text-xs text-muted-foreground">{t("submittedBy", { name: c.submitted_by_name })}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link className="underline" href={`/inventory/${c.id}`}>
                        {t("overview.open")}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 5: `page.tsx` (список)**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "@admin/i18n/routing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { inventoryApi } from "@admin/lib/inventory-api";
import { useMyPermissions } from "@admin/lib/inventory/use-permissions";
import { CountCard } from "./_components/count-card";
import { Overview } from "./_components/overview";
import { StartDialog } from "./_components/start-dialog";

const STORE_KEY = "inventory:store";

function readStore(): string {
  try {
    return window.localStorage.getItem(STORE_KEY) ?? "";
  } catch {
    return "";
  }
}

function MyStores() {
  const t = useTranslations("inventory");
  const router = useRouter();
  const qc = useQueryClient();
  const perms = useMyPermissions() ?? [];
  const stores = useQuery({ queryKey: ["inventory_stores"], queryFn: inventoryApi.stores });
  const [storeId, setStoreId] = useState("");

  useEffect(() => {
    if (!stores.data?.length) return;
    const saved = readStore();
    setStoreId(stores.data.some((s) => s.id === saved) ? saved : stores.data[0].id);
  }, [stores.data]);

  const pick = (id: string) => {
    setStoreId(id);
    try {
      window.localStorage.setItem(STORE_KEY, id);
    } catch {
      // не критично
    }
  };

  const counts = useQuery({
    queryKey: ["inventory_counts", storeId],
    queryFn: () => inventoryApi.listCounts(storeId),
    enabled: !!storeId,
  });

  if (stores.data && stores.data.length === 0) {
    return <div className="text-muted-foreground">{t("noStores")}</div>;
  }

  return (
    <div className="space-y-4">
      {(stores.data?.length ?? 0) > 1 && (
        <Select value={storeId} onValueChange={pick}>
          <SelectTrigger className="h-11 w-full sm:w-80">
            <SelectValue placeholder={t("chooseStore")} />
          </SelectTrigger>
          <SelectContent>
            {stores.data!.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {perms.includes("inventory.manage") && (
        <StartDialog
          storeId={storeId}
          onCreated={(id) => {
            void qc.invalidateQueries({ queryKey: ["inventory_counts", storeId] });
            router.push(`/inventory/${id}`);
          }}
        />
      )}
      {counts.data && counts.data.length === 0 && <div className="text-muted-foreground">{t("empty")}</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(counts.data ?? []).map((c) => (
          <CountCard key={c.id} count={c} />
        ))}
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const t = useTranslations("inventory");
  const perms = useMyPermissions() ?? [];
  const office = perms.includes("inventory.templates");
  return (
    <div className="p-4 pb-24 space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {office ? (
        <Tabs defaultValue="mine">
          <TabsList>
            <TabsTrigger value="mine">{t("tabs.mine")}</TabsTrigger>
            <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          </TabsList>
          <TabsContent value="mine" className="pt-4">
            <MyStores />
          </TabsContent>
          <TabsContent value="overview" className="pt-4">
            <Overview />
          </TabsContent>
        </Tabs>
      ) : (
        <MyStores />
      )}
    </div>
  );
}
```

`pb-24` оставляет место под нижнее меню менеджера (`h-16`, fixed).

- [ ] **Step 6: Проверить типы и lint**

```bash
cd admin && bunx tsc --noEmit -p . 2>&1 | grep "inventory" | head; bun lint 2>&1 | grep "inventory" | head
```
Ожидается: пусто.

- [ ] **Step 7: Commit**

```bash
git add "admin/app/[locale]/inventory"
git commit -m "feat(admin/inventory): список инвентаризаций, старт по шаблону, обзор офиса

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Экран ввода

**Files:**
- Create: `admin/app/[locale]/inventory/[id]/page.tsx`
- Create: `admin/app/[locale]/inventory/_components/count-header.tsx`
- Create: `admin/app/[locale]/inventory/_components/count-table.tsx`
- Create: `admin/app/[locale]/inventory/_components/entries-popover.tsx`
- Create: `admin/app/[locale]/inventory/_components/add-product-dialog.tsx`
- Create: `admin/app/[locale]/inventory/_components/submit-dialog.tsx`

**Interfaces:**
- Consumes: `useCountSync` (Task 2), `inventoryApi`, `parseQtyInput`, `formatQty`, `isLineDone`, `OverlayDetail`, `OverlayLine`, `OverlayEntry` (Task 1), `StatusBadge` (Task 4), `periodLabel`.
- Produces: страница `/[locale]/inventory/[id]`.

- [ ] **Step 1: `count-header.tsx`**

```tsx
"use client";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@admin/components/ui/button";
import { periodLabel } from "@admin/lib/inventory/periods";
import type { OverlayDetail } from "@admin/lib/inventory/queue";
import { StatusBadge } from "./status-badge";

export function CountHeader({
  detail,
  online,
  pendingCount,
  rejectedCount,
  onDismissRejected,
}: {
  detail: OverlayDetail;
  online: boolean;
  pendingCount: number;
  rejectedCount: number;
  onDismissRejected: () => void;
}) {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const pct = detail.lines_total ? Math.round((detail.lines_done / detail.lines_total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{detail.store_name}</h1>
        <StatusBadge status={detail.status} />
        {detail.access === "read" && <span className="text-sm text-muted-foreground">{t("readOnly")}</span>}
      </div>
      <div className="text-sm text-muted-foreground">
        {detail.template_name} · {periodLabel(detail.period, locale)}
      </div>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 rounded bg-muted overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-sm tabular-nums">{t("progress", { done: detail.lines_done, total: detail.lines_total })}</span>
        <span className={`text-sm ${online ? "text-green-600" : "text-orange-600"}`}>
          {online ? "●" : "○"} {online ? t("sync.online") : t("sync.offline")}
        </span>
        {pendingCount > 0 && <span className="text-sm text-orange-600">{t("sync.pending", { count: pendingCount })}</span>}
      </div>
      {rejectedCount > 0 && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm flex items-start justify-between gap-3">
          <span>{t("sync.rejected", { count: rejectedCount })}</span>
          <Button variant="ghost" size="sm" onClick={onDismissRejected}>
            {t("sync.dismiss")}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `entries-popover.tsx`**

```tsx
"use client";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";
import { formatQty } from "@admin/lib/inventory/qty";
import type { OverlayLine } from "@admin/lib/inventory/queue";

export function EntriesPopover({
  line,
  viewerId,
  canDeleteAny,
  editable,
  onDelete,
}: {
  line: OverlayLine;
  viewerId: string;
  canDeleteAny: boolean;
  editable: boolean;
  onDelete: (entryId: string) => void;
}) {
  const t = useTranslations("inventory.line");
  if (line.entries.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="min-w-[44px] min-h-[44px] px-2 text-left tabular-nums font-medium"
          aria-label={t("entries")}
        >
          {formatQty(line.total)}
          {line.entries.length > 1 && (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-xs">
              {line.entries.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="text-sm font-medium mb-2">{t("entries")}</div>
        <ul className="space-y-1">
          {line.entries.map((e) => {
            const time = new Date(e.client_created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const deletable = editable && (canDeleteAny || e.created_by === viewerId);
            return (
              <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="tabular-nums">
                  {formatQty(e.qty)} — {e.created_by_name} {time}
                  {e.pending && <span className="ml-1 text-orange-600">({t("pending")})</span>}
                </span>
                {deletable && (
                  <button
                    type="button"
                    className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-destructive"
                    onClick={() => onDelete(e.id)}
                    aria-label={t("delete")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: `count-table.tsx`**

```tsx
"use client";
import { Fragment, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@admin/components/ui/dropdown-menu";
import { Input } from "@admin/components/ui/input";
import { parseQtyInput } from "@admin/lib/inventory/qty";
import { isLineDone, type OverlayDetail, type OverlayLine } from "@admin/lib/inventory/queue";
import { EntriesPopover } from "./entries-popover";

type Filter = "all" | "todo" | "mine";

export function CountTable({
  detail,
  online,
  onAdd,
  onDelete,
  onSkip,
}: {
  detail: OverlayDetail;
  online: boolean;
  onAdd: (lineId: string, values: number[]) => void;
  onDelete: (entryId: string) => void;
  onSkip: (lineId: string, skipped: boolean) => void;
}) {
  const t = useTranslations("inventory");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const editable = detail.status === "draft" && detail.access === "write";

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = detail.lines.filter((l) => {
      if (q && !l.product_name.toLowerCase().includes(q)) return false;
      if (filter === "todo" && isLineDone(l)) return false;
      if (filter === "mine" && !l.entries.some((e) => e.created_by === detail.viewer_id)) return false;
      return true;
    });
    const map = new Map<string, OverlayLine[]>();
    for (const l of visible) map.set(l.group_name, [...(map.get(l.group_name) ?? []), l]);
    const all = new Map<string, OverlayLine[]>();
    for (const l of detail.lines) all.set(l.group_name, [...(all.get(l.group_name) ?? []), l]);
    return [...map.entries()].map(([name, lines]) => {
      const groupAll = all.get(name) ?? lines;
      return { name, lines, done: groupAll.filter(isLineDone).length, total: groupAll.length };
    });
  }, [detail, search, filter]);

  // Порядок полей ввода на экране — для перехода к следующей непосчитанной позиции.
  const order = useMemo(
    () => groups.filter((g) => !collapsed.has(g.name)).flatMap((g) => g.lines.map((l) => l.id)),
    [groups, collapsed]
  );
  const doneById = useMemo(() => new Map(detail.lines.map((l) => [l.id, isLineDone(l)])), [detail.lines]);

  const focusNext = (fromId: string) => {
    const idx = order.indexOf(fromId);
    for (let i = idx + 1; i < order.length; i++) {
      if (!doneById.get(order[i])) {
        const el = inputs.current.get(order[i]);
        if (el) {
          el.focus();
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        return;
      }
    }
  };

  const submitDraft = (line: OverlayLine) => {
    const raw = drafts[line.id] ?? "";
    const parsed = parseQtyInput(raw);
    if (!parsed.ok) {
      if (parsed.error !== "empty") toast.error(t("errors.invalidQty"));
      return;
    }
    onAdd(line.id, parsed.values);
    setDrafts((d) => ({ ...d, [line.id]: "" }));
    focusNext(line.id);
  };

  const toggle = (name: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("table.search")}
          className="h-11 flex-1 min-w-[180px]"
        />
        <div className="flex rounded-md border overflow-hidden">
          {(["all", "todo", "mine"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 min-h-[44px] text-sm ${filter === f ? "bg-primary text-primary-foreground" : ""}`}
            >
              {t(f === "all" ? "table.filterAll" : f === "todo" ? "table.filterTodo" : "table.filterMine")}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border">
        <div className="grid grid-cols-[1fr_3.5rem_minmax(8rem,12rem)_2.75rem] items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
          <div>{t("table.product")}</div>
          <div>{t("table.unit")}</div>
          <div>{t("table.fact")}</div>
          <div />
        </div>
        {groups.length === 0 && <div className="p-4 text-sm text-muted-foreground">{t("table.nothing")}</div>}
        {groups.map((g) => (
          <Fragment key={g.name}>
            <button
              type="button"
              onClick={() => toggle(g.name)}
              className="flex w-full items-center gap-2 border-b bg-muted/30 px-3 min-h-[44px] text-left text-sm font-semibold uppercase"
            >
              {collapsed.has(g.name) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span className="flex-1">{g.name}</span>
              <span className="tabular-nums font-normal normal-case">
                {g.done}/{g.total} {g.done === g.total ? "✓" : ""}
              </span>
            </button>
            {!collapsed.has(g.name) &&
              g.lines.map((line) => (
                <div
                  key={line.id}
                  className="grid grid-cols-[1fr_3.5rem_minmax(8rem,12rem)_2.75rem] items-center gap-2 border-b px-3 min-h-[44px]"
                >
                  <div className="py-2 text-sm leading-tight">
                    {line.product_name}
                    {line.source === "added" && <span className="ml-2 text-xs text-blue-600">{t("table.added")}</span>}
                    {line.skipped && <span className="ml-2 text-xs text-muted-foreground">{t("table.skipped")}</span>}
                  </div>
                  <div className="text-sm text-muted-foreground">{line.unit_name ?? ""}</div>
                  <div className="flex items-center gap-1">
                    <EntriesPopover
                      line={line}
                      viewerId={detail.viewer_id}
                      canDeleteAny={detail.can_manage}
                      editable={editable}
                      onDelete={onDelete}
                    />
                    {editable && !line.skipped && (
                      <Input
                        ref={(el) => {
                          if (el) inputs.current.set(line.id, el);
                          else inputs.current.delete(line.id);
                        }}
                        value={drafts[line.id] ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [line.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            submitDraft(line);
                          }
                        }}
                        inputMode="decimal"
                        enterKeyHint="next"
                        autoComplete="off"
                        placeholder={line.entries.length ? "+" : t("table.enter")}
                        className="h-11 min-w-0 flex-1 tabular-nums"
                      />
                    )}
                  </div>
                  <div>
                    {editable && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="menu">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={!online} onClick={() => onSkip(line.id, !line.skipped)}>
                            {line.skipped ? t("line.unskip") : t("line.skip")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
```

`Input` из `@admin/components/ui/input` должен прокидывать `ref` (shadcn-вариант делает это через `forwardRef` или, в React 19, обычным пропом). Если `ref` не доходит до `<input>`, заменить `Input` на обычный `<input className="...">` с теми же классами из `components/ui/input.tsx`.

- [ ] **Step 4: `add-product-dialog.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { inventoryApi } from "@admin/lib/inventory-api";

export function AddProductDialog({ countId, online, onAdded }: { countId: string; online: boolean; onAdded: () => void }) {
  const t = useTranslations("inventory");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);

  const results = useQuery({
    queryKey: ["inventory_products", debounced],
    queryFn: () => inventoryApi.products(debounced),
    enabled: open && debounced.length >= 2,
  });

  const add = useMutation({
    mutationFn: (productId: string) => inventoryApi.addLine(countId, productId),
    onSuccess: () => {
      setOpen(false);
      setQ("");
      onAdded();
    },
    onError: (e: Error) => toast.error(t("errors.generic", { message: e.message })),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" disabled={!online} title={online ? undefined : t("addProduct.offline")}>
          {t("addProduct.button")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addProduct.title")}</DialogTitle>
        </DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("addProduct.search")} className="h-11" />
        <div className="max-h-80 overflow-y-auto divide-y">
          {results.data && results.data.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">{t("addProduct.nothing")}</div>
          )}
          {(results.data ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 min-h-[44px] py-2 hover:bg-muted"
              disabled={add.isPending}
              onClick={() => add.mutate(p.id)}
            >
              <div className="text-sm">{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {p.group_name}
                {p.unit_name ? ` · ${p.unit_name}` : ""}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: `submit-dialog.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@admin/components/ui/dialog";
import { inventoryApi } from "@admin/lib/inventory-api";
import type { OverlayDetail } from "@admin/lib/inventory/queue";

export function SubmitDialog({
  detail,
  pendingCount,
  onDone,
}: {
  detail: OverlayDetail;
  pendingCount: number;
  onDone: () => void;
}) {
  const t = useTranslations("inventory.submit");
  const tRoot = useTranslations("inventory");
  const [open, setOpen] = useState(false);
  const skipped = detail.lines.filter((l) => l.skipped).length;
  const counted = detail.lines.filter((l) => !l.skipped && l.entries.length > 0).length;
  const incomplete = detail.lines.length - skipped - counted;

  const submit = useMutation({
    mutationFn: (skipIncomplete: boolean) => inventoryApi.submit(detail.id, skipIncomplete),
    onSuccess: () => {
      setOpen(false);
      toast.success(t("done"));
      onDone();
    },
    onError: (e: Error) => toast.error(tRoot("errors.generic", { message: e.message })),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg">{t("button")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 text-sm">
          <div>{t("counted", { count: counted })}</div>
          <div>{t("skipped", { count: skipped })}</div>
          <div className={incomplete > 0 ? "text-destructive font-medium" : ""}>{t("incomplete", { count: incomplete })}</div>
          {pendingCount > 0 && <div className="text-orange-600">{t("pendingBlock")}</div>}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" size="lg" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          {incomplete > 0 ? (
            <Button size="lg" disabled={pendingCount > 0 || submit.isPending} onClick={() => submit.mutate(true)}>
              {t("skipAll")}
            </Button>
          ) : (
            <Button size="lg" disabled={pendingCount > 0 || submit.isPending} onClick={() => submit.mutate(false)}>
              {t("confirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: `[id]/page.tsx`**

```tsx
"use client";
import { useParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Link } from "@admin/i18n/routing";
import { inventoryApi } from "@admin/lib/inventory-api";
import { useCountSync } from "@admin/lib/inventory/use-count-sync";
import { AddProductDialog } from "../_components/add-product-dialog";
import { CountHeader } from "../_components/count-header";
import { CountTable } from "../_components/count-table";
import { SubmitDialog } from "../_components/submit-dialog";

export default function CountPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("inventory");
  const sync = useCountSync(id, t("line.you"));
  const { detail } = sync;

  const skip = useMutation({
    mutationFn: ({ lineId, skipped }: { lineId: string; skipped: boolean }) => inventoryApi.setSkipped(id, lineId, skipped),
    onSuccess: () => void sync.refetch(),
    onError: (e: Error) => toast.error(t("errors.generic", { message: e.message })),
  });
  const reopen = useMutation({
    mutationFn: () => inventoryApi.reopen(id),
    onSuccess: () => {
      toast.success(t("reopened"));
      void sync.refetch();
    },
    onError: (e: Error) => toast.error(t("errors.generic", { message: e.message })),
  });
  const cancel = useMutation({
    mutationFn: () => inventoryApi.cancel(id),
    onSuccess: () => {
      toast.success(t("cancelled"));
      void sync.refetch();
    },
    onError: (e: Error) => toast.error(t("errors.generic", { message: e.message })),
  });

  if (!detail) {
    return (
      <div className="p-4">
        {sync.error ? t("errors.generic", { message: (sync.error as Error).message }) : "…"}
      </div>
    );
  }

  const editable = detail.status === "draft" && detail.access === "write";

  return (
    <div className="p-3 sm:p-4 pb-40 space-y-4">
      <Link href="/inventory" className="text-sm underline">
        ← {t("back")}
      </Link>
      <CountHeader
        detail={detail}
        online={sync.online}
        pendingCount={sync.pendingCount}
        rejectedCount={sync.rejectedCount}
        onDismissRejected={sync.dismissRejected}
      />
      <CountTable
        detail={detail}
        online={sync.online}
        onAdd={sync.addEntries}
        onDelete={sync.deleteEntry}
        onSkip={(lineId, skipped) => skip.mutate({ lineId, skipped })}
      />
      <div className="fixed bottom-16 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur px-3 py-2 md:bottom-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          {editable && <AddProductDialog countId={id} online={sync.online} onAdded={() => void sync.refetch()} />}
          <div className="flex flex-wrap items-center gap-2">
            {editable && detail.can_manage && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  if (window.confirm(t("cancelConfirm"))) cancel.mutate();
                }}
              >
                {t("cancelCount")}
              </Button>
            )}
            {editable && detail.can_manage && (
              <SubmitDialog detail={detail} pendingCount={sync.pendingCount} onDone={() => void sync.refetch()} />
            )}
            {detail.can_reopen && (
              <Button variant="outline" size="lg" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
                {t("reopen")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

`bottom-16` поднимает панель над нижним меню менеджера (`h-16`). На `md` и шире меню менеджера тоже остаётся, но у админов его нет. Если на планшете панель перекрывает меню, убрать `md:bottom-0`.

- [ ] **Step 7: Проверить типы и lint**

```bash
cd admin && bunx tsc --noEmit -p . 2>&1 | grep "inventory" | head; bun lint 2>&1 | grep "inventory" | head
```
Ожидается: пусто.

- [ ] **Step 8: Commit**

```bash
git add "admin/app/[locale]/inventory"
git commit -m "feat(admin/inventory): экран ввода — таблица, записи, товар вне списка, отправка

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Шаблоны

**Files:**
- Create: `admin/app/[locale]/inventory/templates/page.tsx`
- Create: `admin/app/[locale]/inventory/templates/[id]/page.tsx`
- Create: `admin/lib/inventory/folder-tree.ts`
- Test: `admin/lib/inventory/folder-tree.test.ts`

**Interfaces:**
- Consumes: `inventoryApi.templates.*`, `inventoryApi.folders`, `inventoryApi.organizations`, тип `InventoryFolders`.
- Produces:
  - `type FolderNode = { id: string; name: string; children: FolderNode[]; products: { id: string; name: string; unit_name: string | null }[]; productIds: string[] }` — `productIds` включают товары всех потомков
  - `buildFolderTree(f: InventoryFolders): FolderNode[]` — корни, пустые ветки отброшены, товары без папки собраны в корень `{ id: "__none__", name: "Без группы" }`

- [ ] **Step 1: Падающий тест `folder-tree.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { buildFolderTree } from "./folder-tree";

describe("buildFolderTree", () => {
  test("вложенность, накопленные productIds, пустые ветки отброшены, товары без папки", () => {
    const tree = buildFolderTree({
      groups: [
        { id: "root", name: "Склад", parent_id: null },
        { id: "meat", name: "Мясо", parent_id: "root" },
        { id: "empty", name: "Пусто", parent_id: "root" },
        { id: "orphan", name: "Сирота", parent_id: "missing" },
      ],
      products: [
        { id: "p1", name: "Говядина", unit_name: "кг", parent_id: "meat" },
        { id: "p2", name: "Соль", unit_name: "кг", parent_id: null },
        { id: "p3", name: "Перец", unit_name: "кг", parent_id: "orphan" },
      ],
    });
    const names = tree.map((n) => n.name);
    expect(names).toEqual(["Без группы", "Склад", "Сирота"]);
    const sklad = tree.find((n) => n.id === "root")!;
    expect(sklad.children.map((c) => c.id)).toEqual(["meat"]);
    expect(sklad.productIds).toEqual(["p1"]);
    expect(tree.find((n) => n.id === "__none__")!.productIds).toEqual(["p2"]);
    expect(tree.find((n) => n.id === "orphan")!.productIds).toEqual(["p3"]);
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

```bash
cd admin && bun test lib/inventory/folder-tree.test.ts
```
Ожидается FAIL.

- [ ] **Step 3: `folder-tree.ts`**

```ts
import type { InventoryFolders } from "@backend/modules/inventory/types";

export type FolderProduct = { id: string; name: string; unit_name: string | null };
export type FolderNode = {
  id: string;
  name: string;
  children: FolderNode[];
  products: FolderProduct[];
  productIds: string[];
};

export const NO_GROUP_ID = "__none__";

export function buildFolderTree(f: InventoryFolders): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  for (const g of f.groups) nodes.set(g.id, { id: g.id, name: g.name, children: [], products: [], productIds: [] });
  const noGroup: FolderNode = { id: NO_GROUP_ID, name: "Без группы", children: [], products: [], productIds: [] };

  for (const p of f.products) {
    const node = p.parent_id ? nodes.get(p.parent_id) : undefined;
    (node ?? noGroup).products.push({ id: p.id, name: p.name, unit_name: p.unit_name });
  }

  const roots: FolderNode[] = [];
  for (const g of f.groups) {
    const node = nodes.get(g.id)!;
    const parent = g.parent_id ? nodes.get(g.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // Снизу вверх: собрать productIds и выбросить ветки без товаров.
  const finalize = (n: FolderNode): boolean => {
    n.children = n.children.filter(finalize);
    n.productIds = [...n.products.map((p) => p.id), ...n.children.flatMap((c) => c.productIds)];
    return n.productIds.length > 0;
  };
  const out = roots.filter(finalize);
  finalize(noGroup);
  if (noGroup.productIds.length) out.push(noGroup);
  return out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
```

- [ ] **Step 4: Тест проходит**

```bash
cd admin && bun test lib/inventory/
```
Ожидается PASS (все тесты папки).

- [ ] **Step 5: `templates/page.tsx` (список)**

```tsx
"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { Link, useRouter } from "@admin/i18n/routing";
import { inventoryApi } from "@admin/lib/inventory-api";

const ALL = "__all__";

export default function TemplatesPage() {
  const t = useTranslations("inventory.templates");
  const tRoot = useTranslations("inventory");
  const router = useRouter();
  const [org, setOrg] = useState(ALL);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [newOrg, setNewOrg] = useState("");

  const orgs = useQuery({ queryKey: ["inventory_orgs"], queryFn: inventoryApi.organizations });
  const list = useQuery({
    queryKey: ["inventory_templates", org],
    queryFn: () => inventoryApi.templates.list(org === ALL ? undefined : org),
  });
  const create = useMutation({
    mutationFn: () => inventoryApi.templates.create({ organization_id: newOrg, name }),
    onSuccess: (r) => router.push(`/inventory/templates/${r.id}`),
    onError: (e: Error) => toast.error(tRoot("errors.generic", { message: e.message })),
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>{t("new")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("new")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("name")} />
              <Select value={newOrg} onValueChange={setNewOrg}>
                <SelectTrigger>
                  <SelectValue placeholder={t("organization")} />
                </SelectTrigger>
                <SelectContent>
                  {(orgs.data ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button disabled={!name.trim() || !newOrg || create.isPending} onClick={() => create.mutate()}>
                {t("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Select value={org} onValueChange={setOrg}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{tRoot("overview.all")}</SelectItem>
          {(orgs.data ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("organization")}</TableHead>
            <TableHead>{t("items")}</TableHead>
            <TableHead>{t("active")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(list.data ?? []).map((tpl) => (
            <TableRow key={tpl.id}>
              <TableCell>
                <Link className="underline" href={`/inventory/templates/${tpl.id}`}>
                  {tpl.name}
                </Link>
              </TableCell>
              <TableCell>{tpl.organization_name ?? "—"}</TableCell>
              <TableCell className="tabular-nums">{tpl.items_count}</TableCell>
              <TableCell>{tpl.active ? "✓" : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 6: `templates/[id]/page.tsx` (редактор)**

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Switch } from "@admin/components/ui/switch";
import { Link, useRouter } from "@admin/i18n/routing";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import { buildFolderTree, type FolderNode } from "@admin/lib/inventory/folder-tree";

function Folder({
  node,
  selected,
  toggleMany,
  query,
}: {
  node: FolderNode;
  selected: Set<string>;
  toggleMany: (ids: string[], on: boolean) => void;
  query: string;
}) {
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const products = q ? node.products.filter((p) => p.name.toLowerCase().includes(q)) : node.products;
  const childMatches = (n: FolderNode): boolean =>
    !q || n.products.some((p) => p.name.toLowerCase().includes(q)) || n.children.some(childMatches);
  if (!childMatches(node)) return null;
  const chosen = node.productIds.filter((id) => selected.has(id)).length;
  const all = chosen === node.productIds.length;
  const expanded = open || !!q;
  return (
    <div className="pl-3">
      <div className="flex items-center gap-2 min-h-[36px]">
        <button type="button" onClick={() => setOpen(!open)} className="p-1" aria-label="toggle">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={all}
          ref={(el) => {
            if (el) el.indeterminate = chosen > 0 && !all;
          }}
          onChange={() => toggleMany(node.productIds, !all)}
        />
        <span className="font-medium">{node.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {chosen}/{node.productIds.length}
        </span>
      </div>
      {expanded && (
        <div className="pl-6">
          {node.children.map((c) => (
            <Folder key={c.id} node={c} selected={selected} toggleMany={toggleMany} query={query} />
          ))}
          {products.map((p) => (
            <label key={p.id} className="flex items-center gap-2 min-h-[32px] text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={selected.has(p.id)}
                onChange={(e) => toggleMany([p.id], e.target.checked)}
              />
              {p.name}
              {p.unit_name && <span className="text-xs text-muted-foreground">{p.unit_name}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("inventory.templates");
  const tRoot = useTranslations("inventory");
  const router = useRouter();
  const qc = useQueryClient();

  const tpl = useQuery({ queryKey: ["inventory_template", id], queryFn: () => inventoryApi.templates.get(id) });
  const folders = useQuery({ queryKey: ["inventory_folders"], queryFn: inventoryApi.folders, staleTime: 5 * 60_000 });
  const sugg = useQuery({ queryKey: ["inventory_template_sugg", id], queryFn: () => inventoryApi.templates.suggestions(id) });

  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!tpl.data) return;
    setName(tpl.data.name);
    setActive(tpl.data.active);
    setSelected(new Set(tpl.data.product_ids));
  }, [tpl.data]);

  const tree = useMemo(() => (folders.data ? buildFolderTree(folders.data) : []), [folders.data]);

  const toggleMany = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const pid of ids) {
        if (on) next.add(pid);
        else next.delete(pid);
      }
      return next;
    });

  const save = useMutation({
    mutationFn: async () => {
      await inventoryApi.templates.update(id, { name, active });
      await inventoryApi.templates.setItems(id, [...selected]);
    },
    onSuccess: () => {
      toast.success(t("saved"));
      void qc.invalidateQueries({ queryKey: ["inventory_template", id] });
      void qc.invalidateQueries({ queryKey: ["inventory_templates"] });
      void qc.invalidateQueries({ queryKey: ["inventory_template_sugg", id] });
    },
    onError: (e: Error) => toast.error(tRoot("errors.generic", { message: e.message })),
  });

  const remove = useMutation({
    mutationFn: () => inventoryApi.templates.remove(id),
    onSuccess: () => {
      toast.success(t("deleted"));
      router.push("/inventory/templates");
    },
    onError: (e: Error) =>
      toast.error(e instanceof InventoryApiError && e.status === 409 ? t("inUse") : tRoot("errors.generic", { message: e.message })),
  });

  if (!tpl.data) return <div className="p-4">…</div>;

  return (
    <div className="p-4 space-y-4">
      <Link href="/inventory/templates" className="text-sm underline">
        ← {t("back")}
      </Link>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <div className="text-sm">{t("name")}</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-80" />
        </div>
        <label className="flex items-center gap-2 pb-2">
          <Switch checked={active} onCheckedChange={setActive} />
          {t("active")}
        </label>
        <div className="text-sm text-muted-foreground pb-2">{tpl.data.organization_name}</div>
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
          {t("delete")}
        </Button>
        <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
          {t("save")}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center gap-3">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className="max-w-sm" />
            <span className="text-sm tabular-nums">{t("selected", { count: selected.size })}</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto -ml-3">
            {tree.map((n) => (
              <Folder key={n.id} node={n} selected={selected} toggleMany={toggleMany} query={query} />
            ))}
          </div>
        </div>
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium">{t("suggestions")}</div>
          {sugg.data && sugg.data.length === 0 && <div className="text-sm text-muted-foreground">{t("noSuggestions")}</div>}
          {(sugg.data ?? []).map((s) => (
            <div key={s.product_id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {s.product_name} <span className="text-muted-foreground">· {t("times", { count: s.times })}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={selected.has(s.product_id)}
                onClick={() => toggleMany([s.product_id], true)}
              >
                {t("addToTemplate")}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

«Добавить в шаблон» ставит галочку локально, на сервер уходит по «Сохранить» вместе с остальным составом.

- [ ] **Step 7: Проверить типы и lint**

```bash
cd admin && bunx tsc --noEmit -p . 2>&1 | grep "inventory" | head; bun lint 2>&1 | grep "inventory" | head
```
Ожидается: пусто.

- [ ] **Step 8: Commit**

```bash
git add "admin/app/[locale]/inventory/templates" admin/lib/inventory/folder-tree.ts admin/lib/inventory/folder-tree.test.ts
git commit -m "feat(admin/inventory): шаблоны — список, дерево папок iiko, подсказки

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Ручная проверка в браузере

**Files:** без изменений в коде, если всё работает. Найденные баги чинятся отдельными коммитами `fix(admin/inventory): …`.

- [ ] **Step 1: Завести локальных тестовых пользователей (только локальная база)**

```bash
cd backend && bun -e '
import { drizzleDb } from "./src/lib/db";
import { roles, roles_permissions, permissions, users, users_stores, corporation_store } from "./drizzle/schema";
import { hashPassword } from "./src/lib/bcrypt";
import { inArray, eq } from "drizzle-orm";
const need = ["manager_layout","admin_layout","inventory.count","inventory.manage","inventory.templates"];
const perms = await drizzleDb.select().from(permissions).where(inArray(permissions.slug, need));
async function mkRole(code, slugs) {
  const [r] = await drizzleDb.insert(roles).values({ name: code, code, active: true }).returning();
  await drizzleDb.insert(roles_permissions).values(perms.filter(p => slugs.includes(p.slug)).map(p => ({ role_id: r.id, permission_id: p.id })));
  return r.id;
}
const mRole = await mkRole("inv_test_manager", ["manager_layout","inventory.count","inventory.manage"]);
const hRole = await mkRole("inv_test_helper", ["manager_layout","inventory.count"]);
const oRole = await mkRole("inv_test_office", ["admin_layout","inventory.count","inventory.templates"]);
const [store] = await drizzleDb.select().from(corporation_store).where(eq(corporation_store.name, "19004 - Склад Les Юнусабад"));
for (const [login, role] of [["inv_manager", mRole], ["inv_helper", hRole], ["inv_office", oRole]]) {
  const { hash, salt } = await hashPassword("inv12345");
  const [u] = await drizzleDb.insert(users).values({ login, password: hash, salt, status: "active", role_id: role, first_name: login }).returning();
  if (login !== "inv_office" && store) await drizzleDb.insert(users_stores).values({ user_id: u.id, corporation_store_id: store.id });
}
console.log("ok", store?.id);
process.exit(0);
'
```
Если `roles` требует других NOT NULL-полей, а склада 19004 в локальной базе нет, посмотреть определение `roles` в `schema.ts` и выбрать любой склад из `corporation_store`. Затем запустить сид прав плана 1, если права ещё не засеяны, и перезапустить бэкенд, чтобы обновился кэш ролей в Redis.

- [ ] **Step 2: Поднять сервисы**

```bash
cd backend && bun run --watch src/index.ts     # терминал 1
cd admin && bun dev                            # терминал 2, порт 6762
```

- [ ] **Step 3: Шаблон (офис)**

Войти как `inv_office` / `inv12345` → `/ru/inventory/templates` → «Новый шаблон» (Les Ailes) → отметить папку «Склад / Мясные продукты» и ещё 3–4 товара → «Сохранить». Ожидается toast «Сохранено», счётчик «Выбрано: N».

- [ ] **Step 4: Ввод на телефоне (ширина 390 px)**

В DevTools включить эмуляцию iPhone 12 (390×844). Войти как `inv_manager`, нажать «Инвентаризация» в нижнем меню → «Начать инвентаризацию» → шаблон и период → таблица. Проверить:
- Ввести `2,5` + Enter: в строке «2,5», фокус на следующей непосчитанной позиции, прогресс растёт.
- Ввести `2,5+3` в другой строке: «5,5» и бейдж «2»; тап по сумме показывает две записи, удаление одной даёт «2,5» или «3».
- Меню строки → «Не считали»: метка «не считали», поле ввода пропадает, прогресс растёт.
- «+ товар не из списка» → найти товар → он появляется в своей папке с меткой «добавлено».
- Фильтры «Не посчитано» и «Мои», поиск.
- Нижняя панель не перекрывает таблицу и меню.

- [ ] **Step 5: Параллельный ввод (планшет 1280×800)**

Во втором профиле браузера (или в инкогнито) войти как `inv_helper`, открыть ту же инвентаризацию. Ввести записи в обоих окнах. Ожидается: записи другого окна появляются не позже чем через 10 секунд. У помощника нет кнопок «Отправить» и «Отменить», чужую запись он удалить не может.

- [ ] **Step 6: Офлайн**

В окне помощника DevTools → Network → Offline. Ввести 5 записей: индикатор «○ офлайн», «не отправлено: 5», суммы на экране уже учитывают записи. Включить сеть: счётчик уходит в 0. Проверить в базе:
```bash
psql "$(grep '^DATABASE_URL' backend/.env | cut -d= -f2-)" -Atc "select count(*) from inventory_count_entries where created_by = (select id from users where login='inv_helper') and deleted_at is null"
```
Ожидается: столько записей, сколько ввёл помощник, без дублей.

- [ ] **Step 7: Отправка при неотправленных записях помощника**

У помощника снова Offline, ввести 2 записи. Менеджер нажимает «Отправить» → «Отметить незаполненные…» → отправлено. Помощник включает сеть. Ожидается баннер «Не принято записей: 2…», статус «Отправлена», таблица только для чтения. Менеджер нажимает «Вернуть в черновик». Помощник нажимает «Скрыть» и вводит записи заново: они принимаются.

- [ ] **Step 8: Обзор офиса**

`inv_office` → `/ru/inventory` → вкладка «Обзор» → текущий период: склад с инвентаризацией и прогрессом, остальные склады «Не начата». «Открыть» показывает таблицу только для чтения.

- [ ] **Step 9: Убрать тестовых пользователей из локальной базы**

```bash
psql "$(grep '^DATABASE_URL' backend/.env | cut -d= -f2-)" <<'SQL'
delete from users_stores where user_id in (select id from users where login in ('inv_manager','inv_helper','inv_office'));
delete from users where login in ('inv_manager','inv_helper','inv_office');
delete from roles_permissions where role_id in (select id from roles where code like 'inv_test_%');
delete from roles where code like 'inv_test_%';
SQL
```

- [ ] **Step 10: Финальные проверки**

```bash
cd admin && bun test lib/inventory/ && bun lint 2>&1 | tail -3
cd ../backend && bun test src/modules/inventory/rules.test.ts && bun run test:http:inventory
```
Ожидается: всё зелёное. В отчёте перечислить, что проверено руками, и все найденные и исправленные баги.

---

## Self-review (сделан при написании)

- **Покрытие спеки, п. 9:** 9.1 — Task 4; 9.2 — Task 5 (таблица, группы, ввод с переходом фокуса, `2,5+3`, бейдж записей, «не считали», фильтры, поиск, товар вне списка, офлайн-индикаторы, сводка при отправке, только чтение после отправки, возврат); 9.3 — Task 6; 9.4 — Task 3; 9.5 — Task 3. П. 8 (клиентская часть синхронизации) — Tasks 1–2. П. 10 (409 у участника с очередью) — Task 2 и Task 7, шаг 7.
- **Типы:** `OverlayDetail`, `OverlayLine`, `QueuedOp`, `inventoryApi.*` называются одинаково во всех задачах; `viewer_id` есть в `InventoryCountDetail` (план 1, Task 2).
- **Отступление от спеки:** офлайн-хранилище — localStorage (спека исправлена тем же коммитом). Офлайн работает только пока страница открыта, это тоже записано в спеку.
