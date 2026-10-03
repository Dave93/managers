# Кассовые смены на дашборде — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ночной синк кассовых смен iiko и кассиров по сменам в managers, API с ограничением по терминалам и виджет-таймлайн на дашборде с порогами нарушений, которые настраиваются в самом виджете.

**Architecture:** Отдельный cron-бинарь `cron/cash_shifts_sync` читает `v2/cashshifts/list`, `corporation/groups`, `employees` и OLAP SALES и делает upsert в две новые таблицы. Модуль `backend/src/modules/cash_shifts` отдаёт два GET-маршрута по образцу `/stoplist/by-day`. Виджет `CashShiftsByDay.tsx` рисует полосу дней и таймлайн дня, нарушения считает на клиенте чистая функция `computeFlags` с порогами из zustand `persist`.

**Tech Stack:** Bun 1.x (скомпилированные бинари), Drizzle ORM + PostgreSQL 18, Elysia, Next.js 15 + React 19, TanStack Query, zustand 5, xml2js, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-10-cash-shifts-widget-design.md`

## Global Constraints

- Репозиторий существует только на сервере: `ssh choparpizza.uz`, каталог `/home/davr/managers`. Все пути в плане указаны относительно него.
- Рабочее дерево грязное. Чужие файлы не трогать. Коммитить только `git -c user.name=Davron -c user.email=davrdev0808@gmail.com commit -m "..." -- <пути>` с явным списком путей, без `git add -A` и без временного индекса.
- Файлы редактировать на месте (Edit/heredoc в конкретный файл). Целиком через `scp` не перезаливать файлы, которые могут меняться параллельно.
- Bun в non-interactive ssh отсутствует в PATH: `export PATH=/root/.bun/bin:$PATH`. Для сборки admin нужен node 20: `export PATH=/root/.nvm/versions/node/v20.19.0/bin:$PATH`.
- `cron/*` и `backend/app` работают скомпилированными бинарями. Правка `.ts` без `bun build --compile` ничего не меняет в проде.
- Время iiko наивное ташкентское. При записи в БД дописывать `+05:00`.
- Каждый процесс, получивший токен resto API, вызывает `/resto/api/logout?key=` в `finally`.
- Никогда не вызывать `cashshifts/closedSessionDocument/{id}` и `cashshifts/save`: первый создаёт документ, второй принимает смену.
- Правка crontab, `pm2 restart`, `drizzle-kit migrate` и запуск бэкфилла выполняются только после явного «го» пользователя.
- Имена в iiko-ответе смен: `responsibleUserId`, `pointOfSaleId`, `conceptionId`. Документация с ними расходится.
- Пороги по умолчанию: позднее открытие после `10:30`, позднее закрытие после `05:00` следующего дня, максимальная длительность `16` ч, скрывать смены короче `5` мин. Ключ localStorage `cash-shift-widget-settings`.
- Permission для API: `charts.list`. Период списка не больше 92 дней.

## File Structure

| Файл | Ответственность |
|---|---|
| `backend/drizzle/schema.ts` (modify) | таблицы `cash_shifts`, `cash_shift_cashiers` |
| `backend/drizzle/migrations/00NN_cash_shifts.sql` (generate) | миграция двух таблиц |
| `cron/src/modules/cash_shifts/parse.ts` | чистые функции: время, XML, маппинг смены, кассиры, сверка, куски дат |
| `cron/src/modules/cash_shifts/parse.test.ts` | тесты `parse.ts` |
| `cron/src/modules/cash_shifts/iiko.ts` | клиент resto API: auth, повтор при 401, logout |
| `cron/cash_shifts_sync.ts` | точка входа: аргументы, цикл по кускам, запись в БД, лог |
| `backend/src/modules/cash_shifts/scope.ts` | ограничение по терминалам: чистая функция и SQL-фрагмент |
| `backend/tests/cash_shifts/scope.test.ts` | тесты `scope.ts` |
| `backend/src/modules/cash_shifts/controller.ts` | `GET /api/cash_shifts`, `GET /api/cash_shifts/day` |
| `backend/src/app.ts` (modify) | регистрация контроллера |
| `admin/app/[locale]/dashboard/cash-shifts/flags.ts` | `computeFlags`, пороги по умолчанию, время Ташкента |
| `admin/app/[locale]/dashboard/cash-shifts/timeline.ts` | ось и позиции баров |
| `admin/app/[locale]/dashboard/cash-shifts/flags.test.ts` | тесты `flags.ts` и `timeline.ts` |
| `admin/store/states/cash_shift_settings.ts` | zustand-стор порогов с `persist` |
| `admin/app/[locale]/dashboard/cash-shifts/types.ts` | типы ответов API |
| `admin/app/[locale]/dashboard/cash-shifts/format.ts` | форматирование времени, длительности, денег |
| `admin/app/[locale]/dashboard/cash-shifts/SettingsPopover.tsx` | шестерёнка и popover порогов |
| `admin/app/[locale]/dashboard/cash-shifts/DayStrip.tsx` | полоса дней периода |
| `admin/app/[locale]/dashboard/cash-shifts/DayTimeline.tsx` | таймлайн дня и popover смены |
| `admin/app/[locale]/dashboard/CashShiftsByDay.tsx` | виджет: запросы, состояние, компоновка |
| `admin/app/[locale]/dashboard/page.client.tsx` (modify) | подключение виджета |

---

### Task 1: Таблицы и миграция

**Files:**
- Modify: `backend/drizzle/schema.ts` (дописать в конец файла)
- Create: `backend/drizzle/migrations/00NN_cash_shifts.sql` (генерирует drizzle-kit)

**Interfaces:**
- Produces: drizzle-таблицы `cash_shifts` и `cash_shift_cashiers`, их импортируют Task 3 и Task 5. Имена свойств совпадают с именами колонок (snake_case). `numeric` в TS имеет тип `string`, `date` задан с `mode: "string"`.

- [ ] **Step 1: Убедиться, что `date`, `numeric`, `index`, `primaryKey` импортированы в schema.ts**

Run: `ssh choparpizza.uz 'cd /home/davr/managers && sed -n 1,30p backend/drizzle/schema.ts | grep -n -E "^\s+(date|numeric|index|primaryKey|uuid|integer|text|timestamp),"'`
Expected: шесть-восемь строк, включая `date,`, `numeric,`, `index,`, `primaryKey,`. Если чего-то нет, добавить в список импорта из `drizzle-orm/pg-core`.

- [ ] **Step 2: Дописать таблицы в конец `backend/drizzle/schema.ts`**

```ts
// ---- Кассовые смены iiko (виджет «Кассовые смены» на дашборде) -------------
// Наполняет cron/cash_shifts_sync раз в сутки из resto v2/cashshifts/list.
// id — id смены в iiko. terminal_id = null, если точка продаж не привязана к
// терминалу через corporation/groups → credentials(model='terminals', type='iiko_id').
export const cash_shifts = pgTable(
  "cash_shifts",
  {
    id: uuid("id").primaryKey().notNull(),
    terminal_id: uuid("terminal_id"),
    iiko_group_id: uuid("iiko_group_id"),
    iiko_group_name: text("iiko_group_name"),
    point_of_sale_id: uuid("point_of_sale_id").notNull(),
    cash_reg_number: integer("cash_reg_number").notNull(),
    cash_register_name: text("cash_register_name"),
    session_number: integer("session_number").notNull(),
    open_at: timestamp("open_at", { withTimezone: true, mode: "string" }).notNull(),
    close_at: timestamp("close_at", { withTimezone: true, mode: "string" }),
    business_date: date("business_date", { mode: "string" }).notNull(),
    status: text("status").notNull(),
    responsible_user_id: uuid("responsible_user_id"),
    responsible_user_name: text("responsible_user_name"),
    manager_id: uuid("manager_id"),
    manager_name: text("manager_name"),
    pay_orders: numeric("pay_orders", { precision: 18, scale: 2 }).default("0").notNull(),
    sales_cash: numeric("sales_cash", { precision: 18, scale: 2 }).default("0").notNull(),
    sales_card: numeric("sales_card", { precision: 18, scale: 2 }).default("0").notNull(),
    sales_credit: numeric("sales_credit", { precision: 18, scale: 2 }).default("0").notNull(),
    pay_in: numeric("pay_in", { precision: 18, scale: 2 }).default("0").notNull(),
    pay_out: numeric("pay_out", { precision: 18, scale: 2 }).default("0").notNull(),
    cash_diff: numeric("cash_diff", { precision: 18, scale: 2 }).default("0").notNull(),
    synced_at: timestamp("synced_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      business_date_idx: index("idx_cash_shifts_business_date").on(table.business_date),
      terminal_date_idx: index("idx_cash_shifts_terminal_date").on(
        table.terminal_id,
        table.business_date
      ),
    };
  }
);

// Кассиры смены из OLAP SALES (SessionID × Cashier.Id). Пересобирается целиком
// для каждой синкнутой смены.
export const cash_shift_cashiers = pgTable(
  "cash_shift_cashiers",
  {
    shift_id: uuid("shift_id")
      .notNull()
      .references(() => cash_shifts.id, { onDelete: "cascade" }),
    cashier_id: uuid("cashier_id").notNull(),
    cashier_name: text("cashier_name").notNull(),
    cashier_code: text("cashier_code"),
    orders_count: integer("orders_count").notNull(),
    revenue: numeric("revenue", { precision: 18, scale: 2 }).notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.shift_id, table.cashier_id] }),
    };
  }
);
```

- [ ] **Step 3: Сгенерировать миграцию**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && set -a && . ./.env && set +a && bunx drizzle-kit generate --name cash_shifts && ls -t drizzle/migrations/*.sql | head -1 | xargs cat'`
Expected: новый файл `drizzle/migrations/0023_cash_shifts.sql` (номер может отличаться), внутри только `CREATE TABLE "cash_shifts"`, `CREATE TABLE "cash_shift_cashiers"`, внешний ключ `cash_shift_cashiers_shift_id_cash_shifts_id_fk` и два `CREATE INDEX`.

Если в SQL есть любые другие операторы (ALTER чужих таблиц, DROP, другие CREATE), остановиться: удалить сгенерированный `.sql`, откатить изменения в `drizzle/migrations/meta/_journal.json` и новом снапшоте и спросить пользователя. Чужой дрейф схемы в эту миграцию не включается.

- [ ] **Step 4: Проверить, что последняя применённая миграция совпадает с концом журнала до новой**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/backend && sudo -u postgres psql -d managers -At -c "select max(created_at) from drizzle.__drizzle_migrations" && python3 -c "import json;e=json.load(open(\"drizzle/migrations/meta/_journal.json\"))[\"entries\"];print(e[-2][\"tag\"],e[-2][\"when\"]);print(e[-1][\"tag\"],e[-1][\"when\"])"'`
Expected: `max(created_at)` равен `when` предпоследней записи (`0022_hard_lake`, 1787655656856). Последняя запись — новая `cash_shifts`. Если числа не совпадают, `drizzle-kit migrate` применит больше одной миграции: остановиться и спросить пользователя.

- [ ] **Step 5: Применить миграцию (после «го» пользователя)**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && set -a && . ./.env && set +a && bunx drizzle-kit migrate && sudo -u postgres psql -d managers -c "\d cash_shifts" -c "\d cash_shift_cashiers"'`
Expected: обе таблицы описаны, у `cash_shifts` есть индексы `idx_cash_shifts_business_date` и `idx_cash_shifts_terminal_date`, у `cash_shift_cashiers` PK `(shift_id, cashier_id)` и FK с `ON DELETE CASCADE`.

- [ ] **Step 6: Commit**

```bash
ssh choparpizza.uz 'cd /home/davr/managers && git add backend/drizzle/migrations/0023_cash_shifts.sql backend/drizzle/migrations/meta/_journal.json backend/drizzle/migrations/meta/0023_snapshot.json && git -c user.name=Davron -c user.email=davrdev0808@gmail.com commit -m "feat(db): cash_shifts and cash_shift_cashiers tables" -- backend/drizzle/schema.ts backend/drizzle/migrations/0023_cash_shifts.sql backend/drizzle/migrations/meta/_journal.json backend/drizzle/migrations/meta/0023_snapshot.json'
```
Номер `0023` заменить на фактический из Step 3.

---

### Task 2: Чистые функции синка

**Files:**
- Create: `cron/src/modules/cash_shifts/parse.ts`
- Test: `cron/src/modules/cash_shifts/parse.test.ts`

**Interfaces:**
- Produces (для Task 3):
  - `type PosInfo = { groupId: string; groupName: string; posName: string }`
  - `type ShiftRow` — объект со всеми колонками `cash_shifts`, деньги строками
  - `type CashierRow = { shift_id: string; cashier_id: string; cashier_name: string; cashier_code: string | null; orders_count: number; revenue: string }`
  - `type MapContext = { pos: Map<string, PosInfo>; terminalByGroup: Map<string, string>; names: Map<string, string>; registerNames: Map<string, string>; syncedAt: string }`
  - `iikoTsToIso(v: string): string`
  - `businessDateOf(openDate: string): string`
  - `parseGroupsXml(xml: string): Promise<Map<string, PosInfo>>`
  - `parseEmployeesXml(xml: string): Promise<Map<string, string>>`
  - `mapShift(raw: any, ctx: MapContext): ShiftRow`
  - `aggregateCashiers(rows: any[], shiftIds: Set<string>): { cashiers: CashierRow[]; registerNames: Map<string, string> }`
  - `reconcile(shifts: ShiftRow[], cashiers: CashierRow[], tolerance?: number): { id: string; cash_reg_number: number; pay_orders: number; revenue: number }[]`
  - `addDays(d: string, n: number): string`
  - `dateChunks(from: string, to: string, size?: number): { from: string; to: string }[]`
  - `tashkentToday(now?: Date): string`
  - `chunk<T>(arr: T[], size: number): T[][]`

- [ ] **Step 1: Написать падающие тесты**

`cron/src/modules/cash_shifts/parse.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import {
  iikoTsToIso,
  businessDateOf,
  parseGroupsXml,
  parseEmployeesXml,
  mapShift,
  aggregateCashiers,
  reconcile,
  addDays,
  dateChunks,
  tashkentToday,
  chunk,
  type MapContext,
} from "./parse";

const GROUPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><groupDtoes>
<groupDto><id>b51063f2-2fa0-459d-8f7c-94b8650dcb0f</id><name>Chopar Pizza Ko'kcha</name>
<pointOfSaleDtoes><pointOfSaleDto><id>2728b30c-ecf9-4982-9111-d2ae09357d71</id><name>Kassa</name><main>false</main></pointOfSaleDto></pointOfSaleDtoes></groupDto>
<groupDto><id>02d19593-6072-48d8-9937-88615b52cb39</id><name>CESIM CEF</name><pointOfSaleDtoes/></groupDto>
</groupDtoes>`;

const EMPLOYEES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><employees>
<employee><id>e5e7f423-29c5-4e9d-9b4f-f16065fb4423</id><code>1</code><name>Behruz</name></employee>
<employee><id>68c9d8e9-84ed-4eaf-ba0a-0b821b3281f2</id><code>2</code><name>Komron Polatov</name></employee>
</employees>`;

const RAW_SHIFT = {
  id: "0c6e812a-9697-4c19-85ff-4db59c5cdaa0",
  sessionNumber: 889,
  fiscalNumber: null,
  cashRegNumber: 1022,
  cashRegSerial: null,
  openDate: "2026-09-09T08:59:34.304",
  closeDate: "2026-09-09T21:19:14.45",
  acceptDate: null,
  managerId: "68c9d8e9-84ed-4eaf-ba0a-0b821b3281f2",
  responsibleUserId: "e5e7f423-29c5-4e9d-9b4f-f16065fb4423",
  sessionStartCash: 0,
  payOrders: 11343000,
  sumWriteoffOrders: 0,
  salesCash: 6037000,
  salesCredit: 0,
  salesCard: 5306000,
  payIn: 0,
  payOut: 0,
  payIncome: -6037000,
  cashRemain: 0,
  cashDiff: -6037000,
  sessionStatus: "UNACCEPTED",
  conceptionId: "622659d4-066e-4773-b1d7-d769253b6e60",
  pointOfSaleId: "2728b30c-ecf9-4982-9111-d2ae09357d71",
};

async function ctx(): Promise<MapContext> {
  return {
    pos: await parseGroupsXml(GROUPS_XML),
    terminalByGroup: new Map([
      ["b51063f2-2fa0-459d-8f7c-94b8650dcb0f", "11111111-1111-1111-1111-111111111111"],
    ]),
    names: await parseEmployeesXml(EMPLOYEES_XML),
    registerNames: new Map([[RAW_SHIFT.id, "21018 Kukcha kassa"]]),
    syncedAt: "2026-09-10T04:30:00.000Z",
  };
}

describe("time helpers", () => {
  test("iikoTsToIso appends Tashkent offset and keeps fraction as is", () => {
    expect(iikoTsToIso("2026-09-09T21:19:14.45")).toBe("2026-09-09T21:19:14.45+05:00");
    expect(iikoTsToIso("2026-09-09T09:01:17.073")).toBe("2026-09-09T09:01:17.073+05:00");
    expect(iikoTsToIso("2026-09-09 09:01:17")).toBe("2026-09-09T09:01:17+05:00");
  });
  test("iikoTsToIso rejects unexpected shapes", () => {
    expect(() => iikoTsToIso("2026-09-09T09:01:17Z")).toThrow("unexpected iiko timestamp");
    expect(() => iikoTsToIso("garbage")).toThrow("unexpected iiko timestamp");
  });
  test("businessDateOf takes the local calendar date of opening", () => {
    expect(businessDateOf("2026-09-09T01:31:56.316")).toBe("2026-09-09");
  });
  test("addDays and dateChunks", () => {
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(dateChunks("2026-06-12", "2026-06-25")).toEqual([
      { from: "2026-06-12", to: "2026-06-18" },
      { from: "2026-06-19", to: "2026-06-25" },
    ]);
    expect(dateChunks("2026-09-07", "2026-09-10")).toEqual([
      { from: "2026-09-07", to: "2026-09-10" },
    ]);
    expect(() => dateChunks("2026-09-10", "2026-09-01")).toThrow();
  });
  test("tashkentToday shifts UTC by five hours", () => {
    expect(tashkentToday(new Date("2026-09-09T19:30:00Z"))).toBe("2026-09-10");
    expect(tashkentToday(new Date("2026-09-09T18:59:00Z"))).toBe("2026-09-09");
  });
  test("chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("xml", () => {
  test("parseGroupsXml maps point of sale to its group and skips empty groups", async () => {
    const pos = await parseGroupsXml(GROUPS_XML);
    expect(pos.size).toBe(1);
    expect(pos.get("2728b30c-ecf9-4982-9111-d2ae09357d71")).toEqual({
      groupId: "b51063f2-2fa0-459d-8f7c-94b8650dcb0f",
      groupName: "Chopar Pizza Ko'kcha",
      posName: "Kassa",
    });
  });
  test("parseEmployeesXml maps id to name", async () => {
    const names = await parseEmployeesXml(EMPLOYEES_XML);
    expect(names.get("68c9d8e9-84ed-4eaf-ba0a-0b821b3281f2")).toBe("Komron Polatov");
  });
});

describe("mapShift", () => {
  test("maps a real shift to a row", async () => {
    const row = mapShift(RAW_SHIFT, await ctx());
    expect(row).toEqual({
      id: RAW_SHIFT.id,
      terminal_id: "11111111-1111-1111-1111-111111111111",
      iiko_group_id: "b51063f2-2fa0-459d-8f7c-94b8650dcb0f",
      iiko_group_name: "Chopar Pizza Ko'kcha",
      point_of_sale_id: "2728b30c-ecf9-4982-9111-d2ae09357d71",
      cash_reg_number: 1022,
      cash_register_name: "21018 Kukcha kassa",
      session_number: 889,
      open_at: "2026-09-09T08:59:34.304+05:00",
      close_at: "2026-09-09T21:19:14.45+05:00",
      business_date: "2026-09-09",
      status: "UNACCEPTED",
      responsible_user_id: "e5e7f423-29c5-4e9d-9b4f-f16065fb4423",
      responsible_user_name: "Behruz",
      manager_id: "68c9d8e9-84ed-4eaf-ba0a-0b821b3281f2",
      manager_name: "Komron Polatov",
      pay_orders: "11343000",
      sales_cash: "6037000",
      sales_card: "5306000",
      sales_credit: "0",
      pay_in: "0",
      pay_out: "0",
      cash_diff: "-6037000",
      synced_at: "2026-09-10T04:30:00.000Z",
    });
  });
  test("open shift has null close_at", async () => {
    const row = mapShift({ ...RAW_SHIFT, closeDate: null, sessionStatus: "OPEN" }, await ctx());
    expect(row.close_at).toBeNull();
    expect(row.status).toBe("OPEN");
  });
  test("unknown point of sale leaves terminal and group null and falls back to OLAP register name", async () => {
    const row = mapShift(
      { ...RAW_SHIFT, pointOfSaleId: "99999999-9999-9999-9999-999999999999" },
      await ctx()
    );
    expect(row.terminal_id).toBeNull();
    expect(row.iiko_group_id).toBeNull();
    expect(row.iiko_group_name).toBeNull();
    expect(row.cash_register_name).toBe("21018 Kukcha kassa");
  });
  test("documented field names (pointOfSale instead of pointOfSaleId) fail loudly", async () => {
    const { pointOfSaleId, ...rest } = RAW_SHIFT;
    const c = await ctx();
    expect(() => mapShift({ ...rest, pointOfSale: pointOfSaleId }, c)).toThrow(
      'field "pointOfSaleId" missing'
    );
  });
});

describe("cashiers", () => {
  const S1 = "a401b573-533f-4a79-b593-a4af0aaf1c3a";
  const S2 = "4cd5f4cf-33c5-492c-b1b4-a1e454ee33d7";
  const rows = [
    { SessionID: S1, "Cashier.Id": "461d12fd-5a9a-453a-9eab-fd05ea547b27", Cashier: "Узбегим", "Cashier.Code": "6549530", CashRegisterName: "21001 - Andijon O'zbegim kassa", "UniqOrderId.OrdersCount": 100, DishDiscountSumInt: 10000000 },
    { SessionID: S1, "Cashier.Id": "461d12fd-5a9a-453a-9eab-fd05ea547b27", Cashier: "Узбегим", "Cashier.Code": "6549530", CashRegisterName: "21001 - Andijon O'zbegim kassa", "UniqOrderId.OrdersCount": 6, DishDiscountSumInt: 631000 },
    { SessionID: S2, "Cashier.Id": "d3df4a7f-7cac-4889-8522-f139b1a533ea", Cashier: "Baxrom", "Cashier.Code": "654940", CashRegisterName: "21004 Ekopark kassa", "UniqOrderId.OrdersCount": 2, DishDiscountSumInt: 133000 },
    { SessionID: S2, "Cashier.Id": null, Cashier: null, "Cashier.Code": null, CashRegisterName: "21004 Ekopark kassa", "UniqOrderId.OrdersCount": 1, DishDiscountSumInt: 5000 },
    { SessionID: "ffffffff-ffff-ffff-ffff-ffffffffffff", "Cashier.Id": "d3df4a7f-7cac-4889-8522-f139b1a533ea", Cashier: "Baxrom", "UniqOrderId.OrdersCount": 9, DishDiscountSumInt: 900 },
  ];

  test("aggregateCashiers sums split rows, drops foreign sessions, keeps orders without cashier", () => {
    const { cashiers, registerNames } = aggregateCashiers(rows, new Set([S1, S2]));
    expect(cashiers).toEqual([
      { shift_id: S1, cashier_id: "461d12fd-5a9a-453a-9eab-fd05ea547b27", cashier_name: "Узбегим", cashier_code: "6549530", orders_count: 106, revenue: "10631000" },
      { shift_id: S2, cashier_id: "d3df4a7f-7cac-4889-8522-f139b1a533ea", cashier_name: "Baxrom", cashier_code: "654940", orders_count: 2, revenue: "133000" },
      { shift_id: S2, cashier_id: "00000000-0000-0000-0000-000000000000", cashier_name: "—", cashier_code: null, orders_count: 1, revenue: "5000" },
    ]);
    expect(registerNames.get(S1)).toBe("21001 - Andijon O'zbegim kassa");
    expect(registerNames.has("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe(false);
  });

  test("reconcile reports only shifts whose cashier revenue differs from pay_orders by more than 1", () => {
    const { cashiers } = aggregateCashiers(rows, new Set([S1, S2]));
    const shifts = [
      { id: S1, cash_reg_number: 2012, pay_orders: "10631000" },
      { id: S2, cash_reg_number: 22, pay_orders: "2174000" },
    ] as any;
    expect(reconcile(shifts, cashiers)).toEqual([
      { id: S2, cash_reg_number: 22, pay_orders: 2174000, revenue: 138000 },
    ]);
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/cron && export PATH=/root/.bun/bin:$PATH && bun test src/modules/cash_shifts'`
Expected: FAIL, `Cannot find module './parse'`.

- [ ] **Step 3: Реализовать `cron/src/modules/cash_shifts/parse.ts`**

```ts
// Pure helpers for cron/cash_shifts_sync.ts. No network, no DB: everything
// here is covered by parse.test.ts.
import { parseStringPromise } from "xml2js";

export type PosInfo = { groupId: string; groupName: string; posName: string };

export type ShiftRow = {
  id: string;
  terminal_id: string | null;
  iiko_group_id: string | null;
  iiko_group_name: string | null;
  point_of_sale_id: string;
  cash_reg_number: number;
  cash_register_name: string | null;
  session_number: number;
  open_at: string;
  close_at: string | null;
  business_date: string;
  status: string;
  responsible_user_id: string | null;
  responsible_user_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  pay_orders: string;
  sales_cash: string;
  sales_card: string;
  sales_credit: string;
  pay_in: string;
  pay_out: string;
  cash_diff: string;
  synced_at: string;
};

export type CashierRow = {
  shift_id: string;
  cashier_id: string;
  cashier_name: string;
  cashier_code: string | null;
  orders_count: number;
  revenue: string;
};

export type MapContext = {
  pos: Map<string, PosInfo>;
  terminalByGroup: Map<string, string>;
  names: Map<string, string>;
  registerNames: Map<string, string>;
  syncedAt: string;
};

const DAY_MS = 86_400_000;
const NAIVE_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

// iiko reports shift times as naive Tashkent wall-clock time. Postgres needs
// the offset to store the right instant in timestamptz.
export function iikoTsToIso(v: string): string {
  const s = String(v).trim().replace(" ", "T");
  if (!NAIVE_TS.test(s)) throw new Error(`unexpected iiko timestamp: ${v}`);
  return `${s}+05:00`;
}

export function businessDateOf(openDate: string): string {
  return iikoTsToIso(openDate).slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function dateChunks(from: string, to: string, size = 7): { from: string; to: string }[] {
  if (from > to) throw new Error(`dateChunks: from ${from} is after to ${to}`);
  const out: { from: string; to: string }[] = [];
  let cur = from;
  while (cur <= to) {
    const end = addDays(cur, size - 1) < to ? addDays(cur, size - 1) : to;
    out.push({ from: cur, to: end });
    cur = addDays(end, 1);
  }
  return out;
}

// Uzbekistan has no DST, a fixed +5h is exact.
export function tashkentToday(now = new Date()): string {
  return new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// corporation/groups: groupDto → pointOfSaleDtoes → pointOfSaleDto. An empty
// <pointOfSaleDtoes/> parses to [""], which yields no points of sale.
export async function parseGroupsXml(xml: string): Promise<Map<string, PosInfo>> {
  const parsed = await parseStringPromise(xml);
  const map = new Map<string, PosInfo>();
  for (const g of parsed?.groupDtoes?.groupDto ?? []) {
    const groupId = g.id?.[0];
    if (!groupId) continue;
    const groupName = g.name?.[0] ?? "";
    for (const p of g.pointOfSaleDtoes?.[0]?.pointOfSaleDto ?? []) {
      const id = p.id?.[0];
      if (id) map.set(id, { groupId, groupName, posName: p.name?.[0] ?? "" });
    }
  }
  return map;
}

export async function parseEmployeesXml(xml: string): Promise<Map<string, string>> {
  const parsed = await parseStringPromise(xml);
  const map = new Map<string, string>();
  for (const e of parsed?.employees?.employee ?? []) {
    const id = e.id?.[0];
    if (id) map.set(id, e.name?.[0] ?? "");
  }
  return map;
}

// The live API uses responsibleUserId/pointOfSaleId while the docs say
// responsibleUser/pointOfSale. If iiko ever switches, stop the run instead of
// writing nulls.
const REQUIRED = ["id", "openDate", "pointOfSaleId", "cashRegNumber", "sessionNumber", "sessionStatus"] as const;

const money = (v: unknown) => String(Number(v ?? 0) || 0);

export function mapShift(raw: any, c: MapContext): ShiftRow {
  for (const k of REQUIRED) {
    const v = raw?.[k];
    if (v === undefined || v === null || v === "") {
      throw new Error(`cashshifts/list: field "${k}" missing in shift ${raw?.id ?? "?"}, API shape changed?`);
    }
  }
  const pos = c.pos.get(raw.pointOfSaleId);
  const groupId = pos?.groupId ?? null;
  const nameOf = (id: string | null | undefined) => (id ? c.names.get(id) ?? null : null);
  return {
    id: raw.id,
    terminal_id: groupId ? c.terminalByGroup.get(groupId) ?? null : null,
    iiko_group_id: groupId,
    iiko_group_name: pos?.groupName ?? null,
    point_of_sale_id: raw.pointOfSaleId,
    cash_reg_number: Number(raw.cashRegNumber),
    cash_register_name: c.registerNames.get(raw.id) ?? pos?.posName ?? null,
    session_number: Number(raw.sessionNumber),
    open_at: iikoTsToIso(raw.openDate),
    close_at: raw.closeDate ? iikoTsToIso(raw.closeDate) : null,
    business_date: businessDateOf(raw.openDate),
    status: String(raw.sessionStatus),
    responsible_user_id: raw.responsibleUserId ?? null,
    responsible_user_name: nameOf(raw.responsibleUserId),
    manager_id: raw.managerId ?? null,
    manager_name: nameOf(raw.managerId),
    pay_orders: money(raw.payOrders),
    sales_cash: money(raw.salesCash),
    sales_card: money(raw.salesCard),
    sales_credit: money(raw.salesCredit),
    pay_in: money(raw.payIn),
    pay_out: money(raw.payOut),
    cash_diff: money(raw.cashDiff),
    synced_at: c.syncedAt,
  };
}

// OLAP SALES rows grouped by SessionID × Cashier.Id (× name/code/register,
// which can split one cashier into several rows). Orders without a cashier
// keep a zero uuid so the per-shift sum still reconciles with payOrders.
export function aggregateCashiers(
  rows: any[],
  shiftIds: Set<string>
): { cashiers: CashierRow[]; registerNames: Map<string, string> } {
  const acc = new Map<string, Omit<CashierRow, "revenue"> & { revenue: number }>();
  const registerNames = new Map<string, string>();
  for (const r of rows) {
    const sid = r["SessionID"];
    if (!sid || !shiftIds.has(sid)) continue;
    const cid = r["Cashier.Id"] || ZERO_UUID;
    const key = `${sid}|${cid}`;
    const cur = acc.get(key) ?? {
      shift_id: sid,
      cashier_id: cid,
      cashier_name: r["Cashier"] || "—",
      cashier_code: r["Cashier.Code"] || null,
      orders_count: 0,
      revenue: 0,
    };
    cur.orders_count += Number(r["UniqOrderId.OrdersCount"]) || 0;
    cur.revenue += Number(r["DishDiscountSumInt"]) || 0;
    acc.set(key, cur);
    if (r["CashRegisterName"] && !registerNames.has(sid)) registerNames.set(sid, r["CashRegisterName"]);
  }
  return {
    cashiers: [...acc.values()].map((c) => ({ ...c, revenue: String(c.revenue) })),
    registerNames,
  };
}

export function reconcile(
  shifts: Pick<ShiftRow, "id" | "cash_reg_number" | "pay_orders">[],
  cashiers: CashierRow[],
  tolerance = 1
): { id: string; cash_reg_number: number; pay_orders: number; revenue: number }[] {
  const sum = new Map<string, number>();
  for (const c of cashiers) sum.set(c.shift_id, (sum.get(c.shift_id) ?? 0) + Number(c.revenue));
  return shifts
    .filter((s) => Math.abs(Number(s.pay_orders) - (sum.get(s.id) ?? 0)) > tolerance)
    .map((s) => ({
      id: s.id,
      cash_reg_number: s.cash_reg_number,
      pay_orders: Number(s.pay_orders),
      revenue: sum.get(s.id) ?? 0,
    }));
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/cron && export PATH=/root/.bun/bin:$PATH && bun test src/modules/cash_shifts'`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

```bash
ssh choparpizza.uz 'cd /home/davr/managers && git add cron/src/modules/cash_shifts/parse.ts cron/src/modules/cash_shifts/parse.test.ts && git -c user.name=Davron -c user.email=davrdev0808@gmail.com commit -m "feat(cron): pure helpers for iiko cash shift sync" -- cron/src/modules/cash_shifts/parse.ts cron/src/modules/cash_shifts/parse.test.ts'
```

---

### Task 3: Клиент iiko и скрипт синка

**Files:**
- Create: `cron/src/modules/cash_shifts/iiko.ts`
- Create: `cron/cash_shifts_sync.ts`
- Build: `cron/cash_shifts_sync` (бинарь, в git не коммитится)

**Interfaces:**
- Consumes: всё из Task 2; `cash_shifts`, `cash_shift_cashiers` из Task 1; `drizzleDb` из `@backend/lib/db`.
- Produces: бинарь `cron/cash_shifts_sync [--from YYYY-MM-DD --to YYYY-MM-DD]`, код выхода 0 или 1, лог в stdout/stderr. Task 4 запускает его из crontab.

- [ ] **Step 1: Написать `cron/src/modules/cash_shifts/iiko.ts`**

```ts
// Minimal resto API client for the cash shift sync: one token, re-auth on 401
// (a re-auth does not use up a retry), logout on demand. Every holder of a
// token occupies an iiko license seat until it logs out or the token expires.
const BASE = "https://les-ailes-co-co.iiko.it/resto/api";
const MAX_ATTEMPTS = 3;

export class IikoResto {
  private token: string | null = null;

  async auth(): Promise<string> {
    const res = await fetch(
      `${BASE}/auth?login=${encodeURIComponent(process.env.IIKO_LOGIN ?? "")}&pass=${encodeURIComponent(process.env.IIKO_PASSWORD ?? "")}`
    );
    const token = (await res.text()).trim();
    if (!res.ok || !/^[0-9a-f-]{30,40}$/i.test(token)) {
      throw new Error(`[auth] failed, status ${res.status}, body: ${token.slice(0, 120)}`);
    }
    this.token = token;
    return token;
  }

  async request(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string> = {},
    body?: unknown
  ): Promise<Response> {
    let reauths = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const key = this.token ?? (await this.auth());
        const qs = new URLSearchParams({ key, ...params });
        const res = await fetch(`${BASE}${path}?${qs}`, {
          method,
          headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(600_000),
        });
        if (res.status === 401 && reauths < 2) {
          reauths++;
          this.token = null;
          attempt--;
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
        return res;
      } catch (e) {
        console.error(`[iiko] ${path} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(e as Error).message}`);
        if (attempt === MAX_ATTEMPTS) throw e;
        await Bun.sleep(10_000 * attempt);
      }
    }
    throw new Error("unreachable");
  }

  async logout(): Promise<void> {
    if (!this.token) return;
    try {
      await fetch(`${BASE}/logout?key=${this.token}`);
    } catch (e) {
      console.error(`[iiko] logout failed: ${(e as Error).message}`);
    }
    this.token = null;
  }
}
```

- [ ] **Step 2: Написать `cron/cash_shifts_sync.ts`**

```ts
/**
 * Sync iiko cash shifts and per-shift cashiers into managers.
 *
 * Usage (from /home/davr/managers/cron, env from ./.env):
 *   ./cash_shifts_sync                                  # today-3 .. today (Tashkent)
 *   ./cash_shifts_sync --from 2026-06-12 --to 2026-09-10
 *
 * Spec: docs/superpowers/specs/2026-09-10-cash-shifts-widget-design.md
 */
import { drizzleDb } from "@backend/lib/db";
import { cash_shifts, cash_shift_cashiers } from "backend/drizzle/schema";
import { inArray, sql } from "drizzle-orm";
import { IikoResto } from "./src/modules/cash_shifts/iiko";
import {
  addDays,
  aggregateCashiers,
  chunk,
  dateChunks,
  mapShift,
  parseEmployeesXml,
  parseGroupsXml,
  reconcile,
  tashkentToday,
  type CashierRow,
  type ShiftRow,
} from "./src/modules/cash_shifts/parse";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv: string[]): { from: string; to: string } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const today = tashkentToday();
  const from = get("--from") ?? addDays(today, -3);
  const to = get("--to") ?? today;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new Error(`bad --from/--to: ${from} ${to}`);
  return { from, to };
}

async function loadTerminalByGroup(): Promise<Map<string, string>> {
  const res: any = await drizzleDb.execute(sql`
    SELECT key, model_id FROM credentials WHERE model = 'terminals' AND type = 'iiko_id'`);
  const rows: any[] = Array.isArray(res) ? res : res?.rows ?? [];
  return new Map(rows.map((r) => [String(r.key), String(r.model_id)]));
}

async function fetchShifts(iiko: IikoResto, from: string, to: string): Promise<any[]> {
  const res = await iiko.request("GET", "/v2/cashshifts/list", {
    openDateFrom: from,
    openDateTo: to,
    status: "ANY",
  });
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`cashshifts/list: expected array, got ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// SALES is inclusive at both ends of DateRange (TRANSACTIONS is not).
async function fetchCashierOlap(iiko: IikoResto, from: string, to: string): Promise<any[]> {
  const res = await iiko.request("POST", "/v2/reports/olap", {}, {
    reportType: "SALES",
    buildSummary: "false",
    groupByRowFields: ["SessionID", "Cashier.Id", "Cashier", "Cashier.Code", "CashRegisterName"],
    aggregateFields: ["UniqOrderId.OrdersCount", "DishDiscountSumInt"],
    filters: {
      "OpenDate.Typed": { filterType: "DateRange", periodType: "CUSTOM", from, to, includeLow: true, includeHigh: true },
      OrderDeleted: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
      DeletedWithWriteoff: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
    },
  });
  const data: any = await res.json();
  if (!Array.isArray(data?.data)) throw new Error(`olap: unexpected shape ${JSON.stringify(data).slice(0, 200)}`);
  return data.data;
}

const UPDATE_COLS = [
  "terminal_id", "iiko_group_id", "iiko_group_name", "point_of_sale_id", "cash_reg_number",
  "cash_register_name", "session_number", "open_at", "close_at", "business_date", "status",
  "responsible_user_id", "responsible_user_name", "manager_id", "manager_name", "pay_orders",
  "sales_cash", "sales_card", "sales_credit", "pay_in", "pay_out", "cash_diff", "synced_at",
] as const;

async function saveChunk(rows: ShiftRow[], cashiers: CashierRow[]): Promise<void> {
  if (rows.length === 0) return;
  const set = Object.fromEntries(UPDATE_COLS.map((c) => [c, sql.raw(`excluded.${c}`)]));
  await drizzleDb.transaction(async (tx) => {
    for (const part of chunk(rows, 500)) {
      await tx.insert(cash_shifts).values(part).onConflictDoUpdate({ target: cash_shifts.id, set });
    }
    await tx
      .delete(cash_shift_cashiers)
      .where(inArray(cash_shift_cashiers.shift_id, rows.map((r) => r.id)));
    for (const part of chunk(cashiers, 1000)) {
      await tx.insert(cash_shift_cashiers).values(part);
    }
  });
}

async function main(): Promise<number> {
  const { from, to } = parseArgs(process.argv);
  const started = Date.now();
  console.log(`[cash_shifts] start ${new Date().toISOString()} window ${from}..${to}`);
  const iiko = new IikoResto();
  try {
    const [groupsXml, employeesXml] = [
      await (await iiko.request("GET", "/corporation/groups")).text(),
      await (await iiko.request("GET", "/employees")).text(),
    ];
    const pos = await parseGroupsXml(groupsXml);
    const names = await parseEmployeesXml(employeesXml);
    const terminalByGroup = await loadTerminalByGroup();
    console.log(`[cash_shifts] dictionaries: pos=${pos.size} employees=${names.size} terminals=${terminalByGroup.size}`);

    const totals = { shifts: 0, cashiers: 0, mismatches: 0, unmapped: 0 };
    for (const part of dateChunks(from, to)) {
      const raw = await fetchShifts(iiko, part.from, part.to);
      const ids = new Set<string>(raw.map((r) => r.id));
      // Night-shift orders can land in the neighbouring accounting day.
      const olap = await fetchCashierOlap(iiko, addDays(part.from, -1), addDays(part.to, 1));
      const { cashiers, registerNames } = aggregateCashiers(olap, ids);
      const syncedAt = new Date().toISOString();
      const rows = raw.map((r) => mapShift(r, { pos, terminalByGroup, names, registerNames, syncedAt }));
      await saveChunk(rows, cashiers);

      const mismatches = reconcile(rows, cashiers);
      for (const m of mismatches) {
        console.warn(`[cash_shifts] mismatch shift=${m.id} reg=${m.cash_reg_number} pay_orders=${m.pay_orders} cashiers=${m.revenue}`);
      }
      const unmapped = rows.filter((r) => !r.terminal_id);
      for (const r of unmapped) {
        console.warn(`[cash_shifts] unmapped pos=${r.point_of_sale_id} group=${r.iiko_group_name ?? "?"} reg=${r.cash_reg_number}`);
      }
      totals.shifts += rows.length;
      totals.cashiers += cashiers.length;
      totals.mismatches += mismatches.length;
      totals.unmapped += unmapped.length;
      console.log(`[cash_shifts] ${part.from}..${part.to}: shifts=${rows.length} cashiers=${cashiers.length}`);
    }
    console.log(
      `[cash_shifts] done ${from}..${to} shifts=${totals.shifts} cashiers=${totals.cashiers} mismatches=${totals.mismatches} unmapped=${totals.unmapped} in ${Math.round((Date.now() - started) / 1000)}s`
    );
    return 0;
  } catch (e) {
    console.error(`[cash_shifts] FAILED: ${(e as Error).stack ?? e}`);
    return 1;
  } finally {
    await iiko.logout();
  }
}

main().then((code) => process.exit(code));
```

- [ ] **Step 3: Прогнать скрипт за 09.09.2026 из исходника**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/cron && export PATH=/root/.bun/bin:$PATH && set -a && . ./.env && set +a && bun run cash_shifts_sync.ts --from 2026-09-09 --to 2026-09-09; echo exit=$?'`
Expected: `exit=0` и строка `done 2026-09-09..2026-09-09 shifts=78 cashiers=... mismatches=0 unmapped=1`. Одна строка `unmapped ... group=Les Ailes Ekopark`.

- [ ] **Step 4: Сверить результат с БД**

Run:
```bash
ssh choparpizza.uz "sudo -u postgres psql -d managers -c \"
select count(*) shifts, count(terminal_id) mapped, count(*) filter (where close_at is null) open,
       min(open_at at time zone 'Asia/Tashkent') first_open, max(close_at at time zone 'Asia/Tashkent') last_close
from cash_shifts where business_date = '2026-09-09';\" -c \"
select count(*) from cash_shifts s
where s.business_date = '2026-09-09'
  and abs(s.pay_orders - coalesce((select sum(revenue) from cash_shift_cashiers c where c.shift_id = s.id), 0)) > 1;\""
```
Expected: `shifts=78`, `mapped=77`, `open=0`, `first_open=2026-09-09 01:31:56.316`, `last_close=2026-09-10 10:19:56.508`. Второй запрос возвращает 0.

- [ ] **Step 5: Проверить идемпотентность**

Run: повторить Step 3, затем `ssh choparpizza.uz "sudo -u postgres psql -d managers -At -c \"select count(*), count(distinct id) from cash_shifts; select count(*) from cash_shift_cashiers\""`
Expected: число смен то же (78, 78), число кассиров не выросло.

- [ ] **Step 6: Собрать бинарь**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/cron && export PATH=/root/.bun/bin:$PATH && bun build --compile --outfile cash_shifts_sync cash_shifts_sync.ts && ls -la cash_shifts_sync && set -a && . ./.env && set +a && ./cash_shifts_sync --from 2026-09-09 --to 2026-09-09; echo exit=$?'`
Expected: бинарь около 100 МБ, `exit=0`, та же итоговая строка, что в Step 3.

- [ ] **Step 7: Проверить, что бинарь сам читает `.env` из cwd, как `iiko_sync` в crontab**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/cron && env -i PATH=/usr/bin:/bin ./cash_shifts_sync --from 2026-09-10 --to 2026-09-10; echo exit=$?'`
Expected: `exit=0`. Если выпадает `[auth] failed` или ошибка подключения к БД, значит бинарь не видит `.env`; тогда в Task 4 строка crontab начинается с `set -a; . ./.env; set +a;`.

- [ ] **Step 8: Commit (бинарь не коммитится)**

```bash
ssh choparpizza.uz 'cd /home/davr/managers && git add cron/src/modules/cash_shifts/iiko.ts cron/cash_shifts_sync.ts && git -c user.name=Davron -c user.email=davrdev0808@gmail.com commit -m "feat(cron): nightly iiko cash shift sync" -- cron/src/modules/cash_shifts/iiko.ts cron/cash_shifts_sync.ts'
```
Бинарь `cron/cash_shifts_sync` не добавлять: остальные cron-бинари тоже живут в дереве вне git. `.gitignore` уже изменён в дереве чужой правкой, его не трогать.

---

### Task 4: Бэкфилл 90 дней и crontab

**Files:**
- Modify: root crontab на `choparpizza.uz`

**Interfaces:**
- Consumes: бинарь `cron/cash_shifts_sync` из Task 3.
- Produces: заполненные таблицы за 90 дней, ежедневный запуск в 04:30.

- [ ] **Step 1: Спросить у пользователя «го» на бэкфилл и правку crontab**

Показать команду бэкфилла и строку crontab из следующих шагов. Без явного согласия дальше не идти.

- [ ] **Step 2: Запустить бэкфилл в фоне**

Run (дата `--from` = дата запуска минус 90 дней, `--to` = дата запуска; пример для 2026-09-10):
```bash
ssh choparpizza.uz 'cd /home/davr/managers/cron && setsid ./cash_shifts_sync --from 2026-06-12 --to 2026-09-10 >> /root/cash_shifts_backfill.log 2>&1 < /dev/null & echo started'
```
`setsid … < /dev/null` обязателен: без него ssh-канал висит.

- [ ] **Step 3: Дождаться завершения и проверить итог**

Run: `ssh choparpizza.uz 'tail -3 /root/cash_shifts_backfill.log; pgrep -f cash_shifts_sync || echo finished'`
Expected: `finished` и строка `done 2026-06-12..2026-09-10 shifts=<примерно 7000> ... mismatches=<0 или единицы>`. Если несовпадений больше десятка, показать строки `mismatch` пользователю до продолжения.

Run: `ssh choparpizza.uz "sudo -u postgres psql -d managers -At -c \"select business_date, count(*) from cash_shifts group by 1 order by 1\" | awk -F'|' '\$2<40' "`
Expected: пусто. День с числом смен меньше 40 означает дыру; показать его пользователю.

- [ ] **Step 4: Добавить строку в crontab**

Run:
```bash
ssh choparpizza.uz '(crontab -l; echo "30 4 * * * cd /home/davr/managers/cron/ && /home/davr/managers/cron/cash_shifts_sync >> /root/cash_shifts_sync.log 2>&1") | crontab - && crontab -l | grep cash_shifts'
```
Если Task 3 Step 7 показал, что бинарь не видит `.env`, строка такая: `30 4 * * * cd /home/davr/managers/cron/ && set -a && . ./.env && set +a && /home/davr/managers/cron/cash_shifts_sync >> /root/cash_shifts_sync.log 2>&1`.
Expected: одна строка с `cash_shifts_sync`.

- [ ] **Step 5: Сохранить знание о синке в память**

Обновить `project_iiko_cashshifts_cashier.md` в памяти: бинарь, время запуска, лог, как пересобрать.

---

### Task 5: API кассовых смен

**Files:**
- Create: `backend/src/modules/cash_shifts/scope.ts`
- Test: `backend/tests/cash_shifts/scope.test.ts`
- Create: `backend/src/modules/cash_shifts/controller.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: таблицы из Task 1 (через сырой SQL), `ctx` из `@backend/context` (макрос `permission`, `c.terminals`).
- Produces (для Task 7):
  - `GET /api/cash_shifts?startDate=<ISO>&endDate=<ISO>&terminals=<uuid,...>` → `{ shifts: CashShiftLite[] }`
  - `GET /api/cash_shifts/day?day=YYYY-MM-DD&terminals=<uuid,...>` → `{ day: string; shifts: CashShiftFull[] }`
  - Поля `CashShiftLite`: `id, terminal_id, terminal_name, iiko_group_id, iiko_group_name, cash_reg_number, cash_register_name, business_date, open_at, close_at, status, pay_orders`. `open_at`/`close_at` в ISO UTC, `pay_orders` число.
  - Поля `CashShiftFull` = `CashShiftLite` плюс `session_number, responsible_user_name, manager_name, sales_cash, sales_card, sales_credit, pay_in, pay_out, cash_diff, cashiers: { cashier_id, cashier_name, cashier_code, orders_count, revenue }[]`.

- [ ] **Step 1: Написать падающий тест `backend/tests/cash_shifts/scope.test.ts`**

```ts
import { describe, test, expect } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { resolveTerminalScope, scopeFilter } from "../../src/modules/cash_shifts/scope";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const dialect = new PgDialect();

describe("resolveTerminalScope", () => {
  test("unrestricted admin without filter sees everything", () => {
    expect(resolveTerminalScope(undefined, [])).toEqual({ ids: [], restrict: false });
    expect(resolveTerminalScope(undefined, undefined)).toEqual({ ids: [], restrict: false });
  });
  test("filter narrows an unrestricted user", () => {
    expect(resolveTerminalScope(`${A},${B}`, [])).toEqual({ ids: [A, B], restrict: true });
  });
  test("restricted user without filter sees own terminals", () => {
    expect(resolveTerminalScope(undefined, [A, C])).toEqual({ ids: [A, C], restrict: true });
  });
  test("filter cannot widen a restricted user", () => {
    expect(resolveTerminalScope(`${A},${B}`, [A, C])).toEqual({ ids: [A], restrict: true });
    expect(resolveTerminalScope(B, [A, C])).toEqual({ ids: [], restrict: true });
  });
  test("garbage in the filter is ignored, but still restricts", () => {
    expect(resolveTerminalScope("1; drop table users", [])).toEqual({ ids: [], restrict: true });
  });
});

describe("scopeFilter", () => {
  test("no restriction adds nothing", () => {
    expect(dialect.sqlToQuery(scopeFilter({ ids: [], restrict: false })).sql).toBe("");
  });
  test("restricted with nothing resolved never leaks the network", () => {
    expect(dialect.sqlToQuery(scopeFilter({ ids: [], restrict: true })).sql).toBe("AND false");
  });
  test("restricted ids are bound as one jsonb parameter", () => {
    const q = dialect.sqlToQuery(scopeFilter({ ids: [A, C], restrict: true }));
    expect(q.sql).toContain("cs.terminal_id IN");
    expect(q.params).toEqual([JSON.stringify([A, C])]);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test tests/cash_shifts'`
Expected: FAIL, `Cannot find module '../../src/modules/cash_shifts/scope'`.

- [ ] **Step 3: Реализовать `backend/src/modules/cash_shifts/scope.ts`**

```ts
import { sql, type SQL } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TerminalScope = { ids: string[]; restrict: boolean };

// The dashboard filter speaks in managers terminal uuids, and so does
// cash_shifts.terminal_id (credentials iiko_id is 1:1 with terminals), so no
// brand pairing is needed here, unlike stoplist. A restricted user can only
// narrow their own set, never widen it.
export function resolveTerminalScope(
  terminalsParam: string | undefined,
  userTerminals: string[] | undefined
): TerminalScope {
  const wanted = terminalsParam
    ? terminalsParam.split(",").map((s) => s.trim()).filter((s) => UUID_RE.test(s))
    : null;
  const own = Array.isArray(userTerminals) && userTerminals.length > 0 ? userTerminals : null;
  if (!terminalsParam && !own) return { ids: [], restrict: false };
  if (wanted && own) return { ids: wanted.filter((id) => own.includes(id)), restrict: true };
  return { ids: wanted ?? own ?? [], restrict: true };
}

// Rows without a terminal (unmapped point of sale) only show up for an
// unrestricted request. An empty restricted scope must match nothing.
export function scopeFilter(scope: TerminalScope): SQL {
  if (!scope.restrict) return sql``;
  if (scope.ids.length === 0) return sql`AND false`;
  return sql`AND cs.terminal_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(scope.ids)}::jsonb)::uuid)`;
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun test tests/cash_shifts'`
Expected: PASS. Если `sqlToQuery(sql``).sql` возвращает не пустую строку, а пробел, поправить ожидание в тесте на `.trim()`, а не код.

- [ ] **Step 5: Написать `backend/src/modules/cash_shifts/controller.ts`**

```ts
import { ctx } from "@backend/context";
import { sql } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { resolveTerminalScope, scopeFilter } from "./scope";

const TZ = "Asia/Tashkent";
const MAX_RANGE_DAYS = 92;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const unwrapRows = (res: unknown): any[] =>
  Array.isArray(res) ? (res as any[]) : (((res as any)?.rows ?? []) as any[]);
const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);
const num = (v: unknown): number => (v == null ? 0 : Number(v));

const LITE_COLUMNS = sql`
  cs.id, cs.terminal_id, t.name AS terminal_name, cs.iiko_group_id, cs.iiko_group_name,
  cs.cash_reg_number, cs.cash_register_name, to_char(cs.business_date, 'YYYY-MM-DD') AS business_date,
  cs.open_at, cs.close_at, cs.status, cs.pay_orders`;

const liteRow = (r: any) => ({
  id: String(r.id),
  terminal_id: r.terminal_id ?? null,
  terminal_name: r.terminal_name ?? null,
  iiko_group_id: r.iiko_group_id ?? null,
  iiko_group_name: r.iiko_group_name ?? null,
  cash_reg_number: Number(r.cash_reg_number),
  cash_register_name: r.cash_register_name ?? null,
  business_date: String(r.business_date),
  open_at: iso(r.open_at)!,
  close_at: iso(r.close_at),
  status: String(r.status),
  pay_orders: num(r.pay_orders),
});

// Registered on the app root (src/app.ts) with an explicit /api prefix and a
// widened export, same as stoplistController: the apiController .use() chain
// overflows TS2589 and these routes are HTTP-only (no Eden consumers).
const cashShiftsControllerImpl = new Elysia({ name: "@api/cash_shifts", prefix: "/api" })
  .use(ctx)
  // Dashboard widget, level 1: all shifts of the period without cashiers.
  .get(
    "/cash_shifts",
    async (c: any) => {
      const { query, set, drizzle } = c;
      const startMs = Date.parse(query.startDate);
      const endMs = Date.parse(query.endDate);
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
        set.status = 422;
        return { message: "startDate and endDate must be ISO dates, startDate <= endDate" };
      }
      if ((endMs - startMs) / 86_400_000 > MAX_RANGE_DAYS) {
        set.status = 400;
        return { message: `period is limited to ${MAX_RANGE_DAYS} days` };
      }
      const scope = resolveTerminalScope(query.terminals, c.terminals as string[] | undefined);
      const rows = unwrapRows(
        await drizzle.execute(sql`
          SELECT ${LITE_COLUMNS}
          FROM cash_shifts cs
          LEFT JOIN terminals t ON t.id = cs.terminal_id
          WHERE cs.business_date
                BETWEEN (${query.startDate}::timestamptz AT TIME ZONE ${TZ})::date
                    AND (${query.endDate}::timestamptz AT TIME ZONE ${TZ})::date
          ${scopeFilter(scope)}
          ORDER BY cs.business_date DESC, t.name NULLS LAST, cs.cash_reg_number, cs.open_at`)
      );
      return { shifts: rows.map(liteRow) };
    },
    {
      permission: "charts.list",
      query: t.Object({
        startDate: t.String(),
        endDate: t.String(),
        terminals: t.Optional(t.String()),
      }),
    } as any
  )
  // Level 2: one business day with cashiers and money.
  .get(
    "/cash_shifts/day",
    async (c: any) => {
      const { query, set, drizzle } = c;
      if (!DAY_RE.test(query.day)) {
        set.status = 422;
        return { message: "day (YYYY-MM-DD) is required" };
      }
      const scope = resolveTerminalScope(query.terminals, c.terminals as string[] | undefined);
      const rows = unwrapRows(
        await drizzle.execute(sql`
          SELECT ${LITE_COLUMNS},
                 cs.session_number, cs.responsible_user_name, cs.manager_name,
                 cs.sales_cash, cs.sales_card, cs.sales_credit, cs.pay_in, cs.pay_out, cs.cash_diff,
                 COALESCE((
                   SELECT json_agg(json_build_object(
                            'cashier_id', c.cashier_id, 'cashier_name', c.cashier_name,
                            'cashier_code', c.cashier_code, 'orders_count', c.orders_count,
                            'revenue', c.revenue) ORDER BY c.revenue DESC)
                   FROM cash_shift_cashiers c WHERE c.shift_id = cs.id), '[]'::json) AS cashiers
          FROM cash_shifts cs
          LEFT JOIN terminals t ON t.id = cs.terminal_id
          WHERE cs.business_date = ${query.day}::date
          ${scopeFilter(scope)}
          ORDER BY t.name NULLS LAST, cs.cash_reg_number, cs.open_at`)
      );
      return {
        day: query.day,
        shifts: rows.map((r: any) => ({
          ...liteRow(r),
          session_number: Number(r.session_number),
          responsible_user_name: r.responsible_user_name ?? null,
          manager_name: r.manager_name ?? null,
          sales_cash: num(r.sales_cash),
          sales_card: num(r.sales_card),
          sales_credit: num(r.sales_credit),
          pay_in: num(r.pay_in),
          pay_out: num(r.pay_out),
          cash_diff: num(r.cash_diff),
          cashiers: (r.cashiers ?? []).map((x: any) => ({
            cashier_id: String(x.cashier_id),
            cashier_name: String(x.cashier_name),
            cashier_code: x.cashier_code ?? null,
            orders_count: Number(x.orders_count) || 0,
            revenue: num(x.revenue),
          })),
        })),
      };
    },
    {
      permission: "charts.list",
      query: t.Object({
        day: t.String(),
        terminals: t.Optional(t.String()),
      }),
    } as any
  );

// Widened export: keeps the app root .use() chain from overflowing TS
// instantiation depth; routes are HTTP-only (no Eden consumers).
export const cashShiftsController = cashShiftsControllerImpl as unknown as Elysia;
```

- [ ] **Step 6: Зарегистрировать контроллер в `backend/src/app.ts`**

После строки `import { stoplistController } from "./modules/stoplist/controller";` добавить:
```ts
import { cashShiftsController } from "./modules/cash_shifts/controller";
```
После строки `  .use(stoplistController)` добавить:
```ts
  .use(cashShiftsController)
```

- [ ] **Step 7: Проверить SQL маршрутов напрямую в БД**

Run:
```bash
ssh choparpizza.uz "sudo -u postgres psql -d managers -At -c \"
select count(*) from cash_shifts cs left join terminals t on t.id = cs.terminal_id
where cs.business_date between ('2026-09-08T19:00:00Z'::timestamptz at time zone 'Asia/Tashkent')::date
                           and ('2026-09-09T18:59:59Z'::timestamptz at time zone 'Asia/Tashkent')::date\""
```
Expected: `78`. Дашборд присылает `startDate`/`endDate` как начало и конец дня в UTC, и граница `AT TIME ZONE` должна давать ровно 09.09.

- [ ] **Step 8: Собрать и задеплоить бэкенд (после «го» пользователя)**

Сначала сверить, что попадёт в бинарь: `ssh choparpizza.uz 'cd /home/davr/managers && git status --short backend/src | grep -v "\.bak"'`. Показать пользователю список изменённых файлов вне `cash_shifts` (сейчас это `app.ts` и `credit/internal-app.ts`) и получить «го».

Run:
```bash
ssh choparpizza.uz 'cd /home/davr/managers/backend && export PATH=/root/.bun/bin:$PATH && bun build --compile --minify-whitespace --minify-syntax --target bun --outfile app.new src/index.ts && cp app app.bak_cashshifts_$(date +%s) && mv app.new app && pm2 restart office_api'
```
Подождать 40 секунд: порт 6761 молчит, пока бинарь стартует.

- [ ] **Step 9: Проверить маршруты**

Run: `ssh choparpizza.uz 'sleep 40; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:6761/api/cash_shifts?startDate=2026-09-08T19:00:00Z&endDate=2026-09-09T18:59:59Z"; curl -s "http://127.0.0.1:6761/api/cash_shifts/day?day=2026-09-09"'`
Expected: `401` и `{"message":"User not found"}`. 404 значит, что бинарь не пересобран или контроллер не зарегистрирован. Ответ с сессией (200 и 78 смен) проверяется в Task 7 через браузер.

- [ ] **Step 10: Commit**

```bash
ssh choparpizza.uz 'cd /home/davr/managers && git add backend/src/modules/cash_shifts/scope.ts backend/src/modules/cash_shifts/controller.ts backend/tests/cash_shifts/scope.test.ts && git -c user.name=Davron -c user.email=davrdev0808@gmail.com commit -m "feat(api): cash shifts endpoints for the dashboard

app.ts also carries the stoplistController registration that has been
running in production since 2026-08-25 but was never committed." -- backend/src/modules/cash_shifts/scope.ts backend/src/modules/cash_shifts/controller.ts backend/tests/cash_shifts/scope.test.ts backend/src/app.ts'
```

---

### Task 6: Нарушения, ось таймлайна и стор настроек

**Files:**
- Create: `admin/app/[locale]/dashboard/cash-shifts/flags.ts`
- Create: `admin/app/[locale]/dashboard/cash-shifts/timeline.ts`
- Test: `admin/app/[locale]/dashboard/cash-shifts/flags.test.ts`
- Create: `admin/store/states/cash_shift_settings.ts`

**Interfaces:**
- Produces (для Task 7):
  - `type ShiftSettings = { lateOpenAfter: string; lateCloseAfter: string; maxDurationHours: number; hideShorterThanMin: number }`
  - `DEFAULT_SHIFT_SETTINGS: ShiftSettings`
  - `type ShiftFlag = "late_open" | "late_close" | "too_long" | "unclosed"`
  - `type FlaggableShift = { id: string; terminal_id: string | null; iiko_group_id: string | null; business_date: string; open_at: string; close_at: string | null }`
  - `computeFlags<T extends FlaggableShift>(shifts: T[], settings: ShiftSettings, today: string): { visible: (T & { flags: ShiftFlag[] })[]; hiddenCount: number }`
  - `tashkentToday(now?: Date): string`, `hhmmToMinutes(v: string): number`
  - `timelineAxis(shifts: { open_at: string; close_at: string | null }[], day: string, nowMs: number): { startMs: number; endMs: number; ticks: number[] }`
  - `barGeometry(shift: { open_at: string; close_at: string | null }, axis: { startMs: number; endMs: number }, nowMs: number): { leftPct: number; widthPct: number; openEnded: boolean }`
  - `useCashShiftSettings()` → `ShiftSettings & { update(patch: Partial<ShiftSettings>): void; reset(): void }`

- [ ] **Step 1: Написать падающие тесты `admin/app/[locale]/dashboard/cash-shifts/flags.test.ts`**

```ts
/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { computeFlags, DEFAULT_SHIFT_SETTINGS, hhmmToMinutes, tashkentToday } from "./flags";
import { barGeometry, timelineAxis } from "./timeline";

const TODAY = "2026-09-10";
let n = 0;
const shift = (terminal: string | null, day: string, open: string, close: string | null, group: string | null = null) => ({
  id: `s${++n}`,
  terminal_id: terminal,
  iiko_group_id: group,
  business_date: day,
  open_at: `${open}+05:00`,
  close_at: close ? `${close}+05:00` : null,
});
const flagsOf = (shifts: ReturnType<typeof shift>[], settings = DEFAULT_SHIFT_SETTINGS) => {
  const { visible, hiddenCount } = computeFlags(shifts, settings, TODAY);
  return { byId: Object.fromEntries(visible.map((s) => [s.id, s.flags])), hiddenCount };
};

describe("computeFlags", () => {
  test("24h branch: shifts at 01:31 and 17:59 are not late", () => {
    // 01:31 → 17:00 is 15.5 h; the real 01:31 → 17:59 shift is 16.5 h and is
    // rightly flagged too_long by the default 16 h threshold.
    const a1 = shift("A", "2026-09-09", "2026-09-09T01:31:56", "2026-09-09T17:00:00");
    const a2 = shift("A", "2026-09-09", "2026-09-09T17:59:10", "2026-09-10T03:09:00");
    const { byId } = flagsOf([a1, a2]);
    expect(byId[a1.id]).toEqual([]);
    expect(byId[a2.id]).toEqual([]);
  });
  test("night shift after a day shift is not a late opening", () => {
    const b1 = shift("B", "2026-09-09", "2026-09-09T09:01:17", "2026-09-09T18:15:30");
    const b2 = shift("B", "2026-09-09", "2026-09-09T18:44:00", "2026-09-10T03:12:00");
    expect(flagsOf([b1, b2]).byId[b2.id]).toEqual([]);
  });
  test("first shift after 10:30 is a late opening", () => {
    const c1 = shift("C", "2026-09-09", "2026-09-09T11:20:00", "2026-09-09T18:57:00");
    expect(flagsOf([c1]).byId[c1.id]).toEqual(["late_open"]);
  });
  test("closing at 10:19 next day is a late close but not a long shift when it started at 19:02", () => {
    const d1 = shift("D", "2026-09-09", "2026-09-09T19:02:00", "2026-09-10T10:19:56");
    const d0 = shift("D", "2026-09-09", "2026-09-09T09:00:00", "2026-09-09T18:57:00");
    expect(flagsOf([d0, d1]).byId[d1.id]).toEqual(["late_close"]);
  });
  test("24h shift is both a late close and a long shift", () => {
    const e1 = shift("E", "2026-09-09", "2026-09-09T09:47:00", "2026-09-10T09:45:00");
    expect(flagsOf([e1]).byId[e1.id]).toEqual(["late_close", "too_long"]);
  });
  test("open shift of a past day is unclosed, of today it is fine", () => {
    const f1 = shift("F", "2026-09-08", "2026-09-08T09:00:00", null);
    const f2 = shift("G", TODAY, `${TODAY}T09:00:00`, null);
    const { byId } = flagsOf([f1, f2]);
    expect(byId[f1.id]).toEqual(["unclosed"]);
    expect(byId[f2.id]).toEqual([]);
  });
  test("empty shifts are hidden and do not count as the first shift of the day", () => {
    const h0 = shift("H", "2026-09-09", "2026-09-09T08:00:00", "2026-09-09T08:00:22");
    const h1 = shift("H", "2026-09-09", "2026-09-09T11:00:00", "2026-09-09T20:00:00");
    const { byId, hiddenCount } = flagsOf([h0, h1]);
    expect(hiddenCount).toBe(1);
    expect(byId[h0.id]).toBeUndefined();
    expect(byId[h1.id]).toEqual(["late_open"]);
  });
  test("second register of the same terminal opening at 12:00 is not late", () => {
    const i1 = shift("I", "2026-09-09", "2026-09-09T09:00:00", "2026-09-09T20:00:00");
    const i2 = shift("I", "2026-09-09", "2026-09-09T12:00:00", "2026-09-09T20:00:00");
    expect(flagsOf([i1, i2]).byId[i2.id]).toEqual([]);
  });
  test("unmapped registers are grouped by iiko group", () => {
    const j1 = shift(null, "2026-09-09", "2026-09-09T09:00:00", "2026-09-09T20:00:00", "g1");
    const j2 = shift(null, "2026-09-09", "2026-09-09T12:00:00", "2026-09-09T20:00:00", "g1");
    expect(flagsOf([j1, j2]).byId[j2.id]).toEqual([]);
  });
  test("thresholds come from settings", () => {
    const c1 = shift("C", "2026-09-09", "2026-09-09T11:20:00", "2026-09-09T18:57:00");
    expect(flagsOf([c1], { ...DEFAULT_SHIFT_SETTINGS, lateOpenAfter: "11:30" }).byId[c1.id]).toEqual([]);
  });
  test("a broken threshold string disables that rule instead of flagging everything", () => {
    const c1 = shift("C", "2026-09-09", "2026-09-09T11:20:00", "2026-09-09T18:57:00");
    expect(flagsOf([c1], { ...DEFAULT_SHIFT_SETTINGS, lateOpenAfter: "" }).byId[c1.id]).toEqual([]);
  });
});

describe("time helpers", () => {
  test("hhmmToMinutes", () => {
    expect(hhmmToMinutes("10:30")).toBe(630);
    expect(Number.isNaN(hhmmToMinutes("25:00"))).toBe(true);
    expect(Number.isNaN(hhmmToMinutes("abc"))).toBe(true);
  });
  test("tashkentToday", () => {
    expect(tashkentToday(new Date("2026-09-09T19:30:00Z"))).toBe("2026-09-10");
  });
});

describe("timeline", () => {
  const H = 3_600_000;
  const dayStart = Date.parse("2026-09-09T00:00:00+05:00");
  test("axis spans first open to last close rounded to hours", () => {
    const axis = timelineAxis(
      [
        { open_at: "2026-09-09T08:59:34+05:00", close_at: "2026-09-09T21:19:14+05:00" },
        { open_at: "2026-09-09T18:44:00+05:00", close_at: "2026-09-10T03:12:00+05:00" },
      ],
      "2026-09-09",
      dayStart + 48 * H
    );
    expect(axis.startMs).toBe(dayStart + 8 * H);
    expect(axis.endMs).toBe(dayStart + 28 * H);
    expect(axis.ticks[0]).toBe(dayStart + 8 * H);
  });
  test("axis is clamped to 00:00 D .. 12:00 D+1", () => {
    const axis = timelineAxis(
      [{ open_at: "2026-09-08T22:00:00+05:00", close_at: "2026-09-10T20:00:00+05:00" }],
      "2026-09-09",
      dayStart + 72 * H
    );
    expect(axis.startMs).toBe(dayStart);
    expect(axis.endMs).toBe(dayStart + 36 * H);
  });
  test("empty day gets a 08:00-24:00 axis", () => {
    const axis = timelineAxis([], "2026-09-09", dayStart + 48 * H);
    expect(axis.startMs).toBe(dayStart + 8 * H);
    expect(axis.endMs).toBe(dayStart + 24 * H);
  });
  test("bar geometry, open-ended bar stops at now", () => {
    const axis = { startMs: dayStart + 8 * H, endMs: dayStart + 24 * H };
    expect(barGeometry({ open_at: "2026-09-09T12:00:00+05:00", close_at: "2026-09-09T16:00:00+05:00" }, axis, dayStart + 48 * H)).toEqual({ leftPct: 25, widthPct: 25, openEnded: false });
    expect(barGeometry({ open_at: "2026-09-09T12:00:00+05:00", close_at: null }, axis, dayStart + 20 * H)).toEqual({ leftPct: 25, widthPct: 50, openEnded: true });
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/admin && export PATH=/root/.bun/bin:$PATH && bun test cash-shifts'`
Expected: FAIL, `Cannot find module './flags'`.

- [ ] **Step 3: Реализовать `admin/app/[locale]/dashboard/cash-shifts/flags.ts`**

```ts
// Violation rules for the cash shift widget. Pure: no React, no fetch, so the
// thresholds can be tested and changed without touching the UI.
// All wall-clock rules are in Tashkent time (UTC+5, no DST).

export type ShiftSettings = {
  lateOpenAfter: string; // "HH:MM", first shift of a location opened later is late
  lateCloseAfter: string; // "HH:MM" of the NEXT day
  maxDurationHours: number;
  hideShorterThanMin: number;
};

export const DEFAULT_SHIFT_SETTINGS: ShiftSettings = {
  lateOpenAfter: "10:30",
  lateCloseAfter: "05:00",
  maxDurationHours: 16,
  hideShorterThanMin: 5,
};

export type ShiftFlag = "late_open" | "late_close" | "too_long" | "unclosed";

export type FlaggableShift = {
  id: string;
  terminal_id: string | null;
  iiko_group_id: string | null;
  business_date: string;
  open_at: string;
  close_at: string | null;
};

const MIN_MS = 60_000;
const DAY_MIN = 1440;

export function hhmmToMinutes(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? "");
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : NaN;
}

export function tashkentToday(now = new Date()): string {
  return new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
}

export function dayStartMs(businessDate: string): number {
  return Date.parse(`${businessDate}T00:00:00+05:00`);
}

const durationMin = (s: FlaggableShift) =>
  s.close_at ? (Date.parse(s.close_at) - Date.parse(s.open_at)) / MIN_MS : null;

// A location is a terminal; an unmapped register falls back to its iiko group,
// and failing that stands on its own.
const locationKey = (s: FlaggableShift) =>
  `${s.terminal_id ?? `group:${s.iiko_group_id ?? s.id}`}|${s.business_date}`;

export function computeFlags<T extends FlaggableShift>(
  shifts: T[],
  settings: ShiftSettings,
  today: string
): { visible: (T & { flags: ShiftFlag[] })[]; hiddenCount: number } {
  const lateOpen = hhmmToMinutes(settings.lateOpenAfter);
  const lateClose = hhmmToMinutes(settings.lateCloseAfter);
  const maxMin = settings.maxDurationHours * 60;

  const visible: T[] = [];
  let hiddenCount = 0;
  for (const s of shifts) {
    const d = durationMin(s);
    if (d !== null && d < settings.hideShorterThanMin) hiddenCount++;
    else visible.push(s);
  }

  const first = new Map<string, T>();
  for (const s of visible) {
    const key = locationKey(s);
    const cur = first.get(key);
    if (!cur || Date.parse(s.open_at) < Date.parse(cur.open_at)) first.set(key, s);
  }
  const firstIds = new Set([...first.values()].map((s) => s.id));

  return {
    hiddenCount,
    visible: visible.map((s) => {
      const flags: ShiftFlag[] = [];
      const start = dayStartMs(s.business_date);
      if (
        firstIds.has(s.id) &&
        Number.isFinite(lateOpen) &&
        (Date.parse(s.open_at) - start) / MIN_MS > lateOpen
      ) {
        flags.push("late_open");
      }
      if (s.close_at) {
        if (Number.isFinite(lateClose) && (Date.parse(s.close_at) - start) / MIN_MS > DAY_MIN + lateClose) {
          flags.push("late_close");
        }
        if (Number.isFinite(maxMin) && durationMin(s)! > maxMin) flags.push("too_long");
      } else if (s.business_date < today) {
        flags.push("unclosed");
      }
      return { ...s, flags };
    }),
  };
}
```

- [ ] **Step 4: Реализовать `admin/app/[locale]/dashboard/cash-shifts/timeline.ts`**

```ts
import { dayStartMs } from "./flags";

const HOUR = 3_600_000;
const MIN_SPAN = 6 * HOUR;

type Span = { open_at: string; close_at: string | null };

// Axis from the first opening to the last closing, whole hours, never outside
// 00:00 of the day .. 12:00 of the next day. Open shifts end at "now".
export function timelineAxis(
  shifts: Span[],
  day: string,
  nowMs: number
): { startMs: number; endMs: number; ticks: number[] } {
  const lo = dayStartMs(day);
  const hi = lo + 36 * HOUR;
  if (shifts.length === 0) return withTicks(lo + 8 * HOUR, lo + 24 * HOUR);
  const opens = shifts.map((s) => Date.parse(s.open_at));
  const closes = shifts.map((s) => (s.close_at ? Date.parse(s.close_at) : Math.min(nowMs, hi)));
  let start = Math.max(lo, Math.floor(Math.min(...opens) / HOUR) * HOUR);
  let end = Math.min(hi, Math.ceil(Math.max(...closes) / HOUR) * HOUR);
  if (end - start < MIN_SPAN) end = Math.min(hi, start + MIN_SPAN);
  if (end - start < MIN_SPAN) start = Math.max(lo, end - MIN_SPAN);
  return withTicks(start, end);
}

function withTicks(startMs: number, endMs: number) {
  const step = endMs - startMs > 24 * HOUR ? 3 * HOUR : 2 * HOUR;
  const ticks: number[] = [];
  for (let t = startMs; t <= endMs; t += step) ticks.push(t);
  return { startMs, endMs, ticks };
}

export function barGeometry(
  shift: Span,
  axis: { startMs: number; endMs: number },
  nowMs: number
): { leftPct: number; widthPct: number; openEnded: boolean } {
  const span = axis.endMs - axis.startMs;
  const clamp = (v: number) => Math.min(axis.endMs, Math.max(axis.startMs, v));
  const from = clamp(Date.parse(shift.open_at));
  const to = clamp(shift.close_at ? Date.parse(shift.close_at) : nowMs);
  return {
    leftPct: ((from - axis.startMs) / span) * 100,
    widthPct: Math.max(0, ((to - from) / span) * 100),
    openEnded: !shift.close_at,
  };
}
```

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/admin && export PATH=/root/.bun/bin:$PATH && bun test cash-shifts'`
Expected: PASS, 0 fail.

- [ ] **Step 6: Написать стор `admin/store/states/cash_shift_settings.ts`**

```ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  DEFAULT_SHIFT_SETTINGS,
  type ShiftSettings,
} from "@admin/app/[locale]/dashboard/cash-shifts/flags";

// Thresholds of the «Кассовые смены» dashboard widget. Per browser: they only
// change how shifts are highlighted, never what the API returns.
type CashShiftSettingsState = ShiftSettings & {
  update: (patch: Partial<ShiftSettings>) => void;
  reset: () => void;
};

export const useCashShiftSettings = create<CashShiftSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SHIFT_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_SHIFT_SETTINGS }),
    }),
    {
      name: "cash-shift-widget-settings",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);
```

- [ ] **Step 7: Проверить типы новых файлов**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/admin && export PATH=/root/.nvm/versions/node/v20.19.0/bin:/root/.bun/bin:$PATH && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "cash-shifts|cash_shift_settings" || echo "no type errors in new files"'`
Expected: `no type errors in new files`. Ошибки в чужих файлах этой задачи не касаются.

- [ ] **Step 8: Commit**

```bash
ssh choparpizza.uz 'cd /home/davr/managers && git add "admin/app/[locale]/dashboard/cash-shifts/flags.ts" "admin/app/[locale]/dashboard/cash-shifts/timeline.ts" "admin/app/[locale]/dashboard/cash-shifts/flags.test.ts" admin/store/states/cash_shift_settings.ts && git -c user.name=Davron -c user.email=davrdev0808@gmail.com commit -m "feat(admin): cash shift violation rules and settings store" -- "admin/app/[locale]/dashboard/cash-shifts/flags.ts" "admin/app/[locale]/dashboard/cash-shifts/timeline.ts" "admin/app/[locale]/dashboard/cash-shifts/flags.test.ts" admin/store/states/cash_shift_settings.ts'
```

---

### Task 7: Виджет на дашборде

**Files:**
- Create: `admin/app/[locale]/dashboard/cash-shifts/types.ts`
- Create: `admin/app/[locale]/dashboard/cash-shifts/format.ts`
- Create: `admin/app/[locale]/dashboard/cash-shifts/SettingsPopover.tsx`
- Create: `admin/app/[locale]/dashboard/cash-shifts/DayStrip.tsx`
- Create: `admin/app/[locale]/dashboard/cash-shifts/DayTimeline.tsx`
- Create: `admin/app/[locale]/dashboard/CashShiftsByDay.tsx`
- Modify: `admin/app/[locale]/dashboard/page.client.tsx`

**Interfaces:**
- Consumes: маршруты из Task 5, `computeFlags`, `timelineAxis`, `barGeometry`, `tashkentToday`, `useCashShiftSettings` из Task 6, `useDateRangeState`, `useTerminalsFilter`, UI-компоненты `@admin/components/ui/{card,popover,button,input,label}`.
- Produces: `export default CashShiftsByDay` для `page.client.tsx`.

- [ ] **Step 1: Референсы и дизайн-скиллы до вёрстки**

По договорённости с пользователем: открыть dribbble через chrome-attach (запросы «shift timeline dashboard», «gantt schedule widget», «store opening hours dashboard»), снять 3–5 референсов и выписать 3–4 приёма, которые подходят к карточкам дашборда. Затем загрузить Skill `dataviz` и Skill `design-taste-frontend`. Код ниже задаёт структуру и поведение. Цвета, отступы и типографику можно поменять по итогам этого шага, но типы, пропсы и логика должны остаться такими же.

- [ ] **Step 2: `admin/app/[locale]/dashboard/cash-shifts/types.ts`**

```ts
export type CashShiftLite = {
  id: string;
  terminal_id: string | null;
  terminal_name: string | null;
  iiko_group_id: string | null;
  iiko_group_name: string | null;
  cash_reg_number: number;
  cash_register_name: string | null;
  business_date: string;
  open_at: string;
  close_at: string | null;
  status: string;
  pay_orders: number;
};

export type CashShiftCashier = {
  cashier_id: string;
  cashier_name: string;
  cashier_code: string | null;
  orders_count: number;
  revenue: number;
};

export type CashShiftFull = CashShiftLite & {
  session_number: number;
  responsible_user_name: string | null;
  manager_name: string | null;
  sales_cash: number;
  sales_card: number;
  sales_credit: number;
  pay_in: number;
  pay_out: number;
  cash_diff: number;
  cashiers: CashShiftCashier[];
};
```

- [ ] **Step 3: `admin/app/[locale]/dashboard/cash-shifts/format.ts`**

```ts
import type { ShiftFlag } from "./flags";

const TZ = "Asia/Tashkent";

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });

export const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00+05:00`).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    weekday: "short",
    timeZone: TZ,
  });

export function fmtDuration(fromIso: string, toIso: string | null, nowMs = Date.now()): string {
  const ms = (toIso ? Date.parse(toIso) : nowMs) - Date.parse(fromIso);
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

export const fmtMoney = (v: number) =>
  `${Math.round(v).toLocaleString("ru-RU")} сум`;

export const FLAG_LABEL: Record<ShiftFlag, string> = {
  late_open: "позднее открытие",
  late_close: "позднее закрытие",
  too_long: "долгая смена",
  unclosed: "не закрыта",
};
```

- [ ] **Step 4: `admin/app/[locale]/dashboard/cash-shifts/SettingsPopover.tsx`**

```tsx
"use client";
import { Settings } from "lucide-react";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";
import { useCashShiftSettings } from "@admin/store/states/cash_shift_settings";

export default function SettingsPopover() {
  const s = useCashShiftSettings();
  const numberField = (value: number, onChange: (v: number) => void, min: number, max: number) => (
    <Input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
      }}
      className="h-8 w-24"
    />
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Настройки порогов">
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="text-sm font-medium">Пороги нарушений</p>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="cs-late-open">Позднее открытие после</Label>
          <Input
            id="cs-late-open"
            type="time"
            value={s.lateOpenAfter}
            onChange={(e) => s.update({ lateOpenAfter: e.target.value })}
            className="h-8 w-24"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="cs-late-close">Позднее закрытие после (след. день)</Label>
          <Input
            id="cs-late-close"
            type="time"
            value={s.lateCloseAfter}
            onChange={(e) => s.update({ lateCloseAfter: e.target.value })}
            className="h-8 w-24"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label>Смена дольше, ч</Label>
          {numberField(s.maxDurationHours, (v) => s.update({ maxDurationHours: v }), 1, 48)}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label>Скрывать смены короче, мин</Label>
          {numberField(s.hideShorterThanMin, (v) => s.update({ hideShorterThanMin: v }), 0, 120)}
        </div>
        <p className="text-xs text-muted-foreground">
          «Не закрыта» отмечается всегда для прошедших дней. Настройки хранятся в этом браузере.
        </p>
        <Button variant="outline" size="sm" onClick={s.reset} className="w-full">
          Сбросить
        </Button>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: `admin/app/[locale]/dashboard/cash-shifts/DayStrip.tsx`**

```tsx
"use client";
import { cn } from "@admin/lib/utils";
import { fmtDay } from "./format";

export type DaySummary = { day: string; shifts: number; flagged: number };

export default function DayStrip({
  days,
  active,
  onSelect,
}: {
  days: DaySummary[];
  active: string | null;
  onSelect: (day: string) => void;
}) {
  if (days.length === 0) {
    return <p className="text-sm text-muted-foreground">Смен за период нет.</p>;
  }
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {days.map((d) => (
        <button
          key={d.day}
          type="button"
          onClick={() => onSelect(d.day)}
          className={cn(
            "min-w-[92px] rounded-md border px-3 py-2 text-left transition-colors",
            d.day === active ? "border-primary bg-primary/5" : "hover:bg-muted"
          )}
        >
          <div className="text-xs text-muted-foreground">{fmtDay(d.day)}</div>
          <div className="text-sm font-medium tabular-nums">{d.shifts} смен</div>
          <div
            className={cn(
              "text-xs tabular-nums",
              d.flagged > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
            )}
          >
            {d.flagged > 0 ? `${d.flagged} наруш.` : "без нарушений"}
          </div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: `admin/app/[locale]/dashboard/cash-shifts/DayTimeline.tsx`**

```tsx
"use client";
import React from "react";
import { cn } from "@admin/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";
import type { ShiftFlag } from "./flags";
import { barGeometry, timelineAxis } from "./timeline";
import { FLAG_LABEL, fmtDateTime, fmtDuration, fmtMoney, fmtTime } from "./format";
import type { CashShiftFull } from "./types";

type Flagged = CashShiftFull & { flags: ShiftFlag[] };
type Row = { key: string; label: string; unmapped: boolean; sub: string | null; shifts: Flagged[] };

// One row per register; the location label is printed only on its first row.
function buildRows(shifts: Flagged[]): Row[] {
  const byLocation = new Map<string, Flagged[]>();
  for (const s of shifts) {
    const loc = s.terminal_id ?? `group:${s.iiko_group_id ?? s.id}`;
    byLocation.set(loc, [...(byLocation.get(loc) ?? []), s]);
  }
  const rows: Row[] = [];
  for (const [loc, list] of byLocation) {
    const label = list[0].terminal_name ?? list[0].iiko_group_name ?? "Без названия";
    const unmapped = !list[0].terminal_id;
    const registers = [...new Set(list.map((s) => s.cash_reg_number))].sort((a, b) => a - b);
    registers.forEach((reg, i) => {
      const own = list.filter((s) => s.cash_reg_number === reg);
      rows.push({
        key: `${loc}|${reg}`,
        label: i === 0 ? label : "",
        unmapped: i === 0 && unmapped,
        sub: registers.length > 1 ? own[0].cash_register_name ?? `касса ${reg}` : null,
        shifts: own,
      });
    });
  }
  return rows;
}

const STRIPES =
  "repeating-linear-gradient(135deg, rgba(220,38,38,.55) 0 6px, rgba(220,38,38,.2) 6px 12px)";

function barClass(flags: ShiftFlag[]) {
  if (flags.includes("unclosed")) return "";
  if (flags.length > 0) return "bg-amber-500/90 hover:bg-amber-500";
  return "bg-slate-400/70 hover:bg-slate-500/80 dark:bg-slate-500/70";
}

function ShiftDetails({ s }: { s: Flagged }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="font-medium">
        {s.terminal_name ?? s.iiko_group_name} · {s.cash_register_name ?? `касса ${s.cash_reg_number}`}
      </div>
      <div className="tabular-nums">
        {fmtDateTime(s.open_at)} → {s.close_at ? fmtDateTime(s.close_at) : "открыта"} ·{" "}
        {fmtDuration(s.open_at, s.close_at)}
      </div>
      {s.flags.length > 0 && (
        <div className="text-amber-700 dark:text-amber-400">{s.flags.map((f) => FLAG_LABEL[f]).join(", ")}</div>
      )}
      <div className="text-muted-foreground">
        Смена № {s.session_number} · {s.status} · открыл: {s.responsible_user_name ?? "—"}
      </div>
      <div className="grid grid-cols-2 gap-x-3 tabular-nums">
        <span>Заказы</span><span className="text-right">{fmtMoney(s.pay_orders)}</span>
        <span>Наличные</span><span className="text-right">{fmtMoney(s.sales_cash)}</span>
        <span>Карта</span><span className="text-right">{fmtMoney(s.sales_card)}</span>
        <span>Расхождение</span><span className="text-right">{fmtMoney(s.cash_diff)}</span>
      </div>
      {s.cashiers.length > 0 && (
        <div>
          <div className="mb-1 text-xs uppercase text-muted-foreground">Кассиры</div>
          {s.cashiers.map((c) => (
            <div key={c.cashier_id} className="flex justify-between gap-3 tabular-nums">
              <span className="truncate">{c.cashier_name}</span>
              <span className="shrink-0 text-muted-foreground">
                {c.orders_count} зак. · {fmtMoney(c.revenue)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DayTimeline({ day, shifts }: { day: string; shifts: Flagged[] }) {
  // Frozen at mount: the widget is historical, open bars need an end, not a clock.
  const [nowMs] = React.useState(() => Date.now());
  const axis = React.useMemo(() => timelineAxis(shifts, day, nowMs), [shifts, day, nowMs]);
  const rows = React.useMemo(() => buildRows(shifts), [shifts]);
  const span = axis.endMs - axis.startMs;

  if (shifts.length === 0) {
    return <p className="text-sm text-muted-foreground">В этот день смен нет.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="relative ml-56 h-6 border-b text-xs text-muted-foreground">
          {axis.ticks.map((t) => (
            <span
              key={t}
              className="absolute -translate-x-1/2 tabular-nums"
              style={{ left: `${((t - axis.startMs) / span) * 100}%` }}
            >
              {fmtTime(new Date(t).toISOString())}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.key} className="flex h-8 items-center border-b border-dashed last:border-0">
            <div className="w-56 shrink-0 truncate pr-3 text-sm">
              {r.label}
              {r.unmapped && (
                <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">не привязан</span>
              )}
              {r.sub && <span className="ml-1 text-xs text-muted-foreground">{r.sub}</span>}
            </div>
            <div className="relative h-5 flex-1">
              {r.shifts.map((s) => {
                const g = barGeometry(s, axis, nowMs);
                return (
                  <Popover key={s.id}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Смена ${fmtTime(s.open_at)}–${s.close_at ? fmtTime(s.close_at) : "открыта"}`}
                        className={cn("absolute top-0 h-5 rounded-sm transition-colors", barClass(s.flags))}
                        style={{
                          left: `${g.leftPct}%`,
                          width: `max(${g.widthPct}%, 4px)`,
                          backgroundImage: s.flags.includes("unclosed") ? STRIPES : undefined,
                        }}
                      />
                    </PopoverTrigger>
                    <PopoverContent className="w-80">
                      <ShiftDetails s={s} />
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: `admin/app/[locale]/dashboard/CashShiftsByDay.tsx`**

```tsx
"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@admin/components/ui/card";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { useCashShiftSettings } from "@admin/store/states/cash_shift_settings";
import { computeFlags, tashkentToday } from "./cash-shifts/flags";
import DayStrip, { type DaySummary } from "./cash-shifts/DayStrip";
import DayTimeline from "./cash-shifts/DayTimeline";
import SettingsPopover from "./cash-shifts/SettingsPopover";
import type { CashShiftFull, CashShiftLite } from "./cash-shifts/types";

// Cash shift routes live on a widened (non-Eden) controller, so this widget
// uses same-origin fetch like StoplistByDay: Next.js proxies /api/* to the
// backend and the session cookie rides along.
async function getJson<T>(path: string, params: URLSearchParams): Promise<T> {
  const res = await fetch(`${path}?${params.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const CashShiftsByDay = () => {
  const { dateRange } = useDateRangeState();
  const [terminalsFilter] = useTerminalsFilter();
  const terminals = terminalsFilter ? terminalsFilter.toString() : undefined;
  const settings = useCashShiftSettings();
  const today = tashkentToday();

  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange?.from && dateRange?.to) return { startDate: dateRange.from, endDate: dateRange.to };
    const now = new Date();
    return { startDate: now, endDate: now };
  }, [dateRange]);

  const listQuery = useQuery<{ shifts: CashShiftLite[] }>({
    queryKey: ["cash_shifts", startDate, endDate, terminals],
    queryFn: () => {
      const p = new URLSearchParams({ startDate: startDate.toISOString(), endDate: endDate.toISOString() });
      if (terminals) p.set("terminals", terminals);
      return getJson("/api/cash_shifts", p);
    },
  });

  const days: DaySummary[] = React.useMemo(() => {
    const { visible } = computeFlags(listQuery.data?.shifts ?? [], settings, today);
    const acc = new Map<string, DaySummary>();
    for (const s of visible) {
      const d = acc.get(s.business_date) ?? { day: s.business_date, shifts: 0, flagged: 0 };
      d.shifts++;
      if (s.flags.length > 0) d.flagged++;
      acc.set(s.business_date, d);
    }
    return [...acc.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  }, [listQuery.data, settings, today]);

  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);
  const activeDay = React.useMemo(() => {
    if (selectedDay && days.some((d) => d.day === selectedDay)) return selectedDay;
    return days[0]?.day ?? null;
  }, [selectedDay, days]);

  const dayQuery = useQuery<{ day: string; shifts: CashShiftFull[] }>({
    queryKey: ["cash_shifts_day", activeDay, terminals],
    enabled: !!activeDay,
    queryFn: () => {
      const p = new URLSearchParams({ day: activeDay! });
      if (terminals) p.set("terminals", terminals);
      return getJson("/api/cash_shifts/day", p);
    },
  });

  const dayFlags = React.useMemo(
    () => computeFlags(dayQuery.data?.shifts ?? [], settings, today),
    [dayQuery.data, settings, today]
  );

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Кассовые смены</CardTitle>
        <SettingsPopover />
      </CardHeader>
      <CardContent className="space-y-4">
        {listQuery.isError ? (
          <p className="text-sm text-red-600">Не удалось загрузить смены.</p>
        ) : listQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : (
          <DayStrip days={days} active={activeDay} onSelect={setSelectedDay} />
        )}
        {activeDay &&
          (dayQuery.isError ? (
            <p className="text-sm text-red-600">Не удалось загрузить день.</p>
          ) : dayQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Загрузка дня…</p>
          ) : (
            <>
              <DayTimeline day={activeDay} shifts={dayFlags.visible} />
              {dayFlags.hiddenCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  Скрыто коротких смен: {dayFlags.hiddenCount}
                </p>
              )}
            </>
          ))}
      </CardContent>
    </Card>
  );
};

export default CashShiftsByDay;
```

- [ ] **Step 8: Подключить виджет в `page.client.tsx`**

После строки `import StoplistByDay from "./StoplistByDay";` добавить:
```tsx
import CashShiftsByDay from "./CashShiftsByDay";
```
После блока
```tsx
            <ChartWrapper className="md:col-span-2 lg:col-span-4 h-[480px] md:h-[600px]">
                <StoplistByDay />
            </ChartWrapper>
```
добавить:
```tsx
            <ChartWrapper className="md:col-span-2 lg:col-span-4">
                <CashShiftsByDay />
            </ChartWrapper>
```
Файл использует CRLF. Правка должна сохранить окончания строк: после неё `file "admin/app/[locale]/dashboard/page.client.tsx"` снова показывает `with CRLF line terminators`.

- [ ] **Step 9: Проверить типы и lint новых файлов**

Run: `ssh choparpizza.uz 'cd /home/davr/managers/admin && export PATH=/root/.nvm/versions/node/v20.19.0/bin:/root/.bun/bin:$PATH && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "cash-shifts|CashShiftsByDay|cash_shift_settings|page.client" || echo "no type errors in new files"; npx eslint "app/[locale]/dashboard/CashShiftsByDay.tsx" "app/[locale]/dashboard/cash-shifts"'`
Expected: `no type errors in new files`, eslint без ошибок.

- [ ] **Step 10: Собрать и задеплоить admin (после «го» пользователя)**

Run:
```bash
ssh choparpizza.uz 'cd /home/davr/managers/admin && export PATH=/root/.nvm/versions/node/v20.19.0/bin:/root/.bun/bin:$PATH && bun run build 2>&1 | tail -15 && pm2 restart office_admin'
```
Expected: сборка без ошибок, `office_admin` online.

- [ ] **Step 11: Проверить в браузере**

Через chrome-attach открыть дашборд admin, выбрать период «вчера» или 09.09.2026:
- полоса дней показывает 09.09 и число смен (78 минус скрытые короткие);
- таймлайн 09.09: у каждого филиала есть строки, у двухкассовых по подстроке на кассу, «Les Ailes Ekopark» помечен «не привязан»;
- смена кассы 1041 (19:02 → 10:19 следующего дня) янтарная с «позднее закрытие»;
- клик по бару показывает кассиров, суммы совпадают с `pay_orders`;
- в шестерёнке поставить «Позднее открытие после» на 08:00: число нарушений растёт. После перезагрузки страницы значение сохраняется, «Сбросить» возвращает 10:30;
- в DevTools запрос `/api/cash_shifts` возвращает 200.

- [ ] **Step 12: Commit**

`page.client.tsx` в дереве уже содержит незакоммиченное подключение `StoplistByDay` (в проде с 2026-08-25), а `StoplistByDay.tsx` не отслеживается. Чтобы HEAD собирался, в коммит входят оба файла. Перед коммитом сказать об этом пользователю.

```bash
ssh choparpizza.uz 'cd /home/davr/managers && git add "admin/app/[locale]/dashboard/CashShiftsByDay.tsx" "admin/app/[locale]/dashboard/cash-shifts/types.ts" "admin/app/[locale]/dashboard/cash-shifts/format.ts" "admin/app/[locale]/dashboard/cash-shifts/SettingsPopover.tsx" "admin/app/[locale]/dashboard/cash-shifts/DayStrip.tsx" "admin/app/[locale]/dashboard/cash-shifts/DayTimeline.tsx" "admin/app/[locale]/dashboard/StoplistByDay.tsx" && git -c user.name=Davron -c user.email=davrdev0808@gmail.com commit -m "feat(admin): cash shifts timeline widget on the dashboard

Also commits StoplistByDay.tsx and its page.client.tsx wiring, which
have been running in production since 2026-08-25 but were never
committed; without them HEAD would not build." -- "admin/app/[locale]/dashboard/CashShiftsByDay.tsx" "admin/app/[locale]/dashboard/cash-shifts/types.ts" "admin/app/[locale]/dashboard/cash-shifts/format.ts" "admin/app/[locale]/dashboard/cash-shifts/SettingsPopover.tsx" "admin/app/[locale]/dashboard/cash-shifts/DayStrip.tsx" "admin/app/[locale]/dashboard/cash-shifts/DayTimeline.tsx" "admin/app/[locale]/dashboard/StoplistByDay.tsx" "admin/app/[locale]/dashboard/page.client.tsx"'
```
