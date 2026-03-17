# Playground Tickets Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a QR-code ticket system for children's playground: API for generation/validation, iiko plugin for printing QR on receipts, admin pages for scanning and listing tickets.

**Architecture:** Three components — (1) Elysia backend module with PostgreSQL table for tickets, (2) C# iiko plugin extension that calls the API and prints QR on bills via BillChequeExtender pattern, (3) Next.js admin pages for QR scanning and ticket list. Auth uses api_tokens for plugin, session+permissions for admin.

**Tech Stack:** Bun/Elysia, Drizzle ORM, PostgreSQL, Next.js 15, React 19, TanStack Table/Query, html5-qrcode, C# .NET 4.7.2, iiko Front API V8

**Spec:** `docs/superpowers/specs/2026-03-17-playground-tickets-design.md`

---

## File Structure

### Backend (C:\projects\managers\backend)
- **Create:** `src/modules/playground_tickets/controller.ts` — route handlers (generate, validate, list)
- **Modify:** `drizzle/schema.ts` — add playground_tickets table definition
- **Modify:** `src/controllers.ts` — register playgroundTicketsController

### Admin Frontend (C:\projects\managers\admin)
- **Create:** `app/[locale]/admin/playground/scan/page.tsx` — QR scanner page
- **Create:** `app/[locale]/admin/playground/list/page.tsx` — tickets list page
- **Create:** `app/[locale]/admin/playground/list/columns.tsx` — table column definitions
- **Create:** `app/[locale]/admin/playground/list/data-table.tsx` — TanStack table component
- **Modify:** `components/layout/main-nav.tsx` — add "Детская площадка" nav item

### iiko Plugin (C:\projects\tablo_full\new_webserver\Resto.Front.Api.SamplePlugin)
- **Create:** `PlaygroundTicketHelper.cs` — API call + response model
- **Create:** `BillChequeExtender.cs` — receipt extension with QR code
- **Modify:** `CustomWebserver.cs` — add BillChequeExtender init + playground logic in BeforeOrderBill
- **Modify:** `Properties/Settings.Designer.cs` — add ManagersApiUrl, ManagersApiToken, PlaygroundMinAmount
- **Modify:** `app.config` — add new settings values

---

## Task 1: Database Schema

**Files:**
- Modify: `C:\projects\managers\backend\drizzle\schema.ts`

- [ ] **Step 1: Add playground_tickets table to schema**

Add at the end of `schema.ts`:

```typescript
export const playground_tickets = pgTable(
  "playground_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    terminal_id: uuid("terminal_id").notNull(),
    organization_id: uuid("organization_id").notNull(),
    order_number: varchar("order_number", { length: 255 }).notNull(),
    order_amount: integer("order_amount").notNull(),
    children_count: integer("children_count").notNull(),
    is_used: boolean("is_used").default(false).notNull(),
    used_at: timestamp("used_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      terminal_order_unique: uniqueIndex("playground_tickets_terminal_order_key").on(
        table.terminal_id,
        table.order_number
      ),
      terminal_id_idx: index("idx_playground_tickets_terminal_id").on(table.terminal_id),
      created_at_idx: index("idx_playground_tickets_created_at").on(table.created_at),
      organization_id_idx: index("idx_playground_tickets_organization_id").on(
        table.organization_id
      ),
    };
  }
);
```

- [ ] **Step 2: Generate and apply migration**

Run from `C:\projects\managers\backend`:
```bash
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

Expected: Migration file created in `drizzle/migrations/`, table `playground_tickets` created in PostgreSQL.

- [ ] **Step 3: Commit**

```bash
git add backend/drizzle/schema.ts backend/drizzle/migrations/
git commit -m "feat: add playground_tickets table schema and migration"
```

---

## Task 2: Backend Controller

**Files:**
- Create: `C:\projects\managers\backend\src\modules\playground_tickets\controller.ts`
- Modify: `C:\projects\managers\backend\src\controllers.ts`

- [ ] **Step 1: Create playground tickets controller**

Create `backend/src/modules/playground_tickets/controller.ts`:

```typescript
import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { playground_tickets, terminals } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq, gte, lte } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const playgroundTicketsController = new Elysia({
  name: "@api/playground_tickets",
})
  .use(ctx)
  // Generate ticket — Bearer token auth (same pattern as stoplist webhook)
  .post(
    "/playground_tickets/generate",
    async ({
      // @ts-ignore
      bearer,
      body: { terminal_id, order_number, order_amount },
      set,
      drizzle,
      cacheController,
    }) => {
      if (!bearer) {
        set.status = 401;
        return { message: "Token not found" };
      }

      const apiTokens = await cacheController.getCachedApiTokens({});
      const token = apiTokens.find((item: any) => item.token === bearer);

      if (!token) {
        set.status = 401;
        return { message: "Token not found" };
      }

      if (!token.active) {
        set.status = 401;
        return { message: "Token not active" };
      }

      const organization_id = token.organization_id;
      const children_count = Math.floor(order_amount / 50000);

      if (children_count < 1) {
        set.status = 400;
        return { message: "Order amount too low for playground ticket" };
      }

      // Idempotent insert — ON CONFLICT DO NOTHING to handle HttpHelper retries
      const inserted = await drizzle
        .insert(playground_tickets)
        .values({
          terminal_id,
          organization_id,
          order_number,
          order_amount,
          children_count,
        })
        .onConflictDoNothing({
          target: [playground_tickets.terminal_id, playground_tickets.order_number],
        })
        .returning()
        .execute();

      // If conflict (retry), return existing ticket
      if (inserted.length === 0) {
        const existing = await drizzle
          .select()
          .from(playground_tickets)
          .where(
            and(
              eq(playground_tickets.terminal_id, terminal_id),
              eq(playground_tickets.order_number, order_number)
            )
          )
          .execute();
        const ticket = existing[0];
        return {
          ticket_id: ticket.id,
          children_count: ticket.children_count,
          qr_data: `PLAYGROUND:${ticket.id}`,
        };
      }

      const ticket = inserted[0];

      return {
        ticket_id: ticket.id,
        children_count: ticket.children_count,
        qr_data: `PLAYGROUND:${ticket.id}`,
      };
    },
    {
      body: t.Object({
        terminal_id: t.String(),
        order_number: t.String(),
        order_amount: t.Number(),
      }),
    }
  )
  // Validate ticket — session auth + permission
  .post(
    "/playground_tickets/validate",
    async ({ body: { qr_data }, user, set, drizzle }) => {
      const prefix = "PLAYGROUND:";
      if (!qr_data.startsWith(prefix)) {
        set.status = 400;
        return { message: "Not a playground ticket" };
      }

      const ticket_id = qr_data.substring(prefix.length);

      const results = await drizzle
        .select({
          id: playground_tickets.id,
          terminal_id: playground_tickets.terminal_id,
          organization_id: playground_tickets.organization_id,
          order_number: playground_tickets.order_number,
          order_amount: playground_tickets.order_amount,
          children_count: playground_tickets.children_count,
          is_used: playground_tickets.is_used,
          used_at: playground_tickets.used_at,
          created_at: playground_tickets.created_at,
          terminal_name: terminals.name,
        })
        .from(playground_tickets)
        .leftJoin(terminals, eq(playground_tickets.terminal_id, terminals.id))
        .where(eq(playground_tickets.id, ticket_id))
        .execute();

      if (results.length === 0) {
        set.status = 404;
        return { message: "Ticket not found" };
      }

      const ticket = results[0];

      if (ticket.is_used) {
        set.status = 400;
        return { message: "Ticket already used", used_at: ticket.used_at };
      }

      // Check if ticket was created today (Asia/Tashkent = UTC+5)
      const now = new Date();
      const tashkentOffset = 5 * 60 * 60 * 1000;
      const tashkentNow = new Date(now.getTime() + tashkentOffset);
      const createdAt = new Date(ticket.created_at!);
      const tashkentCreated = new Date(createdAt.getTime() + tashkentOffset);

      const todayStr = tashkentNow.toISOString().split("T")[0];
      const createdStr = tashkentCreated.toISOString().split("T")[0];

      if (todayStr !== createdStr) {
        set.status = 400;
        return { message: "Ticket expired" };
      }

      // Mark as used
      await drizzle
        .update(playground_tickets)
        .set({
          is_used: true,
          used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .where(eq(playground_tickets.id, ticket_id))
        .execute();

      return {
        ticket_id: ticket.id,
        children_count: ticket.children_count,
        order_number: ticket.order_number,
        order_amount: ticket.order_amount,
        terminal_name: ticket.terminal_name,
      };
    },
    {
      permission: "playground_tickets.validate",
      body: t.Object({
        qr_data: t.String(),
      }),
    }
  )
  // List tickets — session auth + permission, scoped by user's terminals
  .get(
    "/playground_tickets",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
      terminals: userTerminals,
    }) => {
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, playground_tickets, {
          terminals,
        });
      }

      // Scope by user's assigned terminals for multi-tenant isolation
      if (userTerminals && userTerminals.length > 0) {
        whereClause.push(
          sql`${playground_tickets.terminal_id} IN (${sql.join(
            userTerminals.map((tid: string) => sql`${tid}::uuid`),
            sql`, `
          )})`
        );
      }

      const countResult = await drizzle
        .select({ count: sql`count(*)` })
        .from(playground_tickets)
        .leftJoin(terminals, eq(playground_tickets.terminal_id, terminals.id))
        .where(and(...whereClause))
        .execute();

      const ticketsList = await drizzle
        .select({
          id: playground_tickets.id,
          terminal_id: playground_tickets.terminal_id,
          organization_id: playground_tickets.organization_id,
          order_number: playground_tickets.order_number,
          order_amount: playground_tickets.order_amount,
          children_count: playground_tickets.children_count,
          is_used: playground_tickets.is_used,
          used_at: playground_tickets.used_at,
          created_at: playground_tickets.created_at,
          terminal_name: terminals.name,
        })
        .from(playground_tickets)
        .leftJoin(terminals, eq(playground_tickets.terminal_id, terminals.id))
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute();

      return {
        total: countResult[0].count,
        data: ticketsList,
      };
    },
    {
      permission: "playground_tickets.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  );
```

- [ ] **Step 2: Register controller in controllers.ts**

In `C:\projects\managers\backend\src\controllers.ts`, add import and `.use()`:

Add import:
```typescript
import { playgroundTicketsController } from "./modules/playground_tickets/controller";
```

Add `.use(playgroundTicketsController)` at the end of the chain, before the semicolon.

- [ ] **Step 3: Verify backend starts without errors**

Run from `C:\projects\managers\backend`:
```bash
bun run --watch src/index.ts
```

Expected: Server starts on port 6761 without errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/playground_tickets/controller.ts backend/src/controllers.ts
git commit -m "feat: add playground tickets API (generate, validate, list)"
```

---

## Task 3: Admin — Ticket List Page

**Files:**
- Create: `C:\projects\managers\admin\app\[locale]\admin\playground\list\page.tsx`
- Create: `C:\projects\managers\admin\app\[locale]\admin\playground\list\columns.tsx`
- Create: `C:\projects\managers\admin\app\[locale]\admin\playground\list\data-table.tsx`

- [ ] **Step 1: Create the list page**

Create `admin/app/[locale]/admin/playground/list/page.tsx`:

```typescript
"use client";
import { Suspense } from "react";
import { DataTable } from "./data-table";
import { playgroundTicketsColumns } from "./columns";

function PlaygroundTicketsContent() {
  return (
    <div>
      <div className="flex justify-between pb-4">
        <h2 className="text-3xl font-bold tracking-tight">
          Билеты детской площадки
        </h2>
      </div>
      <div className="py-10">
        <DataTable columns={playgroundTicketsColumns} />
      </div>
    </div>
  );
}

export default function PlaygroundTicketsListPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlaygroundTicketsContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Create column definitions**

Create `admin/app/[locale]/admin/playground/list/columns.tsx`:

```typescript
"use client";
import { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { Badge } from "@admin/components/ui/badge";

type PlaygroundTicket = {
  id: string;
  terminal_name: string | null;
  order_number: string;
  order_amount: number;
  children_count: number;
  is_used: boolean;
  used_at: string | null;
  created_at: string;
};

export const playgroundTicketsColumns: ColumnDef<PlaygroundTicket>[] = [
  {
    accessorKey: "id",
    header: "ID",
    cell: ({ row }) => {
      return <span className="font-mono">{row.original.id.substring(0, 8)}</span>;
    },
  },
  {
    accessorKey: "terminal_name",
    header: "Терминал",
  },
  {
    accessorKey: "order_number",
    header: "Номер заказа",
  },
  {
    accessorKey: "order_amount",
    header: "Сумма",
    cell: ({ row }) => {
      return (
        <span>
          {Intl.NumberFormat("ru-RU").format(row.original.order_amount)} сум
        </span>
      );
    },
  },
  {
    accessorKey: "children_count",
    header: "Кол-во детей",
  },
  {
    accessorKey: "is_used",
    header: "Статус",
    cell: ({ row }) => {
      const isUsed = row.original.is_used;
      return (
        <Badge variant={isUsed ? "destructive" : "default"}>
          {isUsed ? "Использован" : "Активен"}
        </Badge>
      );
    },
  },
  {
    accessorKey: "created_at",
    header: "Дата создания",
    cell: ({ row }) => {
      return <span>{dayjs(row.original.created_at).format("DD.MM.YYYY HH:mm")}</span>;
    },
  },
  {
    accessorKey: "used_at",
    header: "Дата использования",
    cell: ({ row }) => {
      const usedAt = row.original.used_at;
      return usedAt ? (
        <span>{dayjs(usedAt).format("DD.MM.YYYY HH:mm")}</span>
      ) : (
        <span>—</span>
      );
    },
  },
];
```

- [ ] **Step 3: Create data table component**

Create `admin/app/[locale]/admin/playground/list/data-table.tsx`:

```typescript
"use client";

import {
  ColumnDef,
  PaginationState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";

import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@admin/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
}

export function DataTable<TData, TValue>({
  columns,
}: DataTableProps<TData, TValue>) {
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filters = useMemo(() => {
    const res: any[] = [];
    if (statusFilter === "used") {
      res.push({ field: "is_used", operator: "eq", value: true });
    } else if (statusFilter === "active") {
      res.push({ field: "is_used", operator: "eq", value: false });
    }
    return res;
  }, [statusFilter]);

  const { data, isLoading } = useQuery({
    queryKey: [
      "playground_tickets",
      { limit: pageSize, offset: pageIndex * pageSize, filters },
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.playground_tickets.get({
        query: {
          limit: pageSize.toString(),
          offset: (pageIndex * pageSize).toString(),
          filters: JSON.stringify(filters),
        },
      });
      return data;
    },
  });

  const pagination = useMemo(
    () => ({ pageIndex, pageSize }),
    [pageIndex, pageSize]
  );

  const table = useReactTable({
    data: (data?.data as TData[]) ?? [],
    columns,
    pageCount: data?.total ? Math.ceil(Number(data.total) / pageSize) : -1,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="used">Использованные</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  Нет данных
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Назад
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Вперёд
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add admin/app/\[locale\]/admin/playground/
git commit -m "feat: add playground tickets list page with filters"
```

---

## Task 4: Admin — QR Scanner Page

**Files:**
- Create: `C:\projects\managers\admin\app\[locale]\admin\playground\scan\page.tsx`

- [ ] **Step 1: Install html5-qrcode dependency**

Run from `C:\projects\managers\admin`:
```bash
bun add html5-qrcode
```

- [ ] **Step 2: Create scanner page**

Create `admin/app/[locale]/admin/playground/scan/page.tsx`:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";

type ValidationResult = {
  type: "success" | "error" | "warning";
  title: string;
  details?: string[];
};

export default function PlaygroundScanPage() {
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = "qr-reader";

  const handleQrData = useCallback(async (qrData: string) => {
    // Stop scanner while processing
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop();
      setIsScanning(false);
    }

    if (!qrData.startsWith("PLAYGROUND:")) {
      setResult({
        type: "warning",
        title: "Это не билет детской площадки",
      });
      return;
    }

    try {
      const { data, error, status } = await apiClient.api.playground_tickets.validate.post({
        qr_data: qrData,
      });

      if (status === 200 && data && "ticket_id" in data) {
        setResult({
          type: "success",
          title: `Билет действителен`,
          details: [
            `Кол-во детей: ${data.children_count}`,
            `Номер заказа: ${data.order_number}`,
            `Сумма: ${Intl.NumberFormat("ru-RU").format(data.order_amount)} сум`,
            `Терминал: ${data.terminal_name}`,
          ],
        });
      } else {
        const errorData = data as any;
        let title = "Ошибка валидации";
        if (errorData?.message === "Ticket already used") {
          title = "Билет уже использован";
          const usedAt = errorData.used_at
            ? new Date(errorData.used_at).toLocaleString("ru-RU")
            : "";
          setResult({
            type: "error",
            title,
            details: usedAt ? [`Использован: ${usedAt}`] : undefined,
          });
        } else if (errorData?.message === "Ticket expired") {
          setResult({ type: "error", title: "Билет просрочен" });
        } else if (errorData?.message === "Ticket not found") {
          setResult({ type: "error", title: "Билет не найден" });
        } else {
          setResult({ type: "error", title: errorData?.message || title });
        }
      }
    } catch (err) {
      setResult({
        type: "error",
        title: "Ошибка сети. Попробуйте ещё раз.",
      });
    }
  }, []);

  const startScanner = useCallback(async () => {
    setResult(null);
    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(scannerContainerId);
      }
      await scannerRef.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => handleQrData(decodedText),
        () => {}
      );
      setIsScanning(true);
    } catch (err) {
      console.error("Camera error:", err);
      setResult({
        type: "warning",
        title: "Не удалось запустить камеру. Используйте ручной ввод.",
      });
    }
  }, [handleQrData]);

  useEffect(() => {
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop();
      }
    };
  }, []);

  const handleManualSubmit = () => {
    if (manualInput.trim()) {
      const qrData = manualInput.trim().startsWith("PLAYGROUND:")
        ? manualInput.trim()
        : `PLAYGROUND:${manualInput.trim()}`;
      handleQrData(qrData);
    }
  };

  const bgColor =
    result?.type === "success"
      ? "bg-green-100 border-green-500 text-green-800"
      : result?.type === "error"
        ? "bg-red-100 border-red-500 text-red-800"
        : result?.type === "warning"
          ? "bg-yellow-100 border-yellow-500 text-yellow-800"
          : "";

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-3xl font-bold tracking-tight pb-4">
        Сканирование билета
      </h2>

      <div id={scannerContainerId} className="mb-4 rounded-lg overflow-hidden" />

      {!isScanning && (
        <Button onClick={startScanner} className="w-full mb-4">
          Запустить камеру
        </Button>
      )}

      <div className="flex gap-2 mb-4">
        <Input
          placeholder="Или введите ID билета вручную"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
        />
        <Button variant="outline" onClick={handleManualSubmit}>
          Проверить
        </Button>
      </div>

      {result && (
        <div className={`border-2 rounded-lg p-6 ${bgColor}`}>
          <h3 className="text-xl font-bold mb-2">{result.title}</h3>
          {result.details && (
            <ul className="space-y-1">
              {result.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <Button
          onClick={() => {
            setResult(null);
            setManualInput("");
            startScanner();
          }}
          className="w-full mt-4"
        >
          Сканировать ещё
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add admin/app/\[locale\]/admin/playground/scan/ admin/package.json admin/bun.lockb
git commit -m "feat: add playground ticket QR scanner page"
```

---

## Task 5: Admin — Navigation

**Files:**
- Modify: `C:\projects\managers\admin\components\layout\main-nav.tsx`

- [ ] **Step 1: Add playground menu to navigation**

In `main-nav.tsx`, add a new dropdown menu item for "Детская площадка" in the `NavigationMenuDemo` component. Add after the existing "Кассы" `CanAccess` block:

```typescript
<CanAccess permission="playground_tickets.list">
  <NavigationMenuItem>
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 h-9 px-4 py-2 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground rounded-md text-sm">
        Детская площадка
        <ChevronDown size={18} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[240px]">
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/admin/playground/scan`}>Сканирование</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/admin/playground/list`}>Список билетов</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </NavigationMenuItem>
</CanAccess>
```

- [ ] **Step 2: Verify navigation renders in browser**

Open `http://localhost:6762` and verify the "Детская площадка" dropdown appears in the admin nav (requires `playground_tickets.list` permission).

- [ ] **Step 3: Commit**

```bash
git add admin/components/layout/main-nav.tsx
git commit -m "feat: add playground navigation to admin sidebar"
```

---

## Task 6: iiko Plugin — Settings

**Files:**
- Modify: `C:\projects\tablo_full\new_webserver\Resto.Front.Api.SamplePlugin\app.config`
- Modify: `C:\projects\tablo_full\new_webserver\Resto.Front.Api.SamplePlugin\Properties\Settings.Designer.cs`

- [ ] **Step 1: Add new settings to Settings.Designer.cs**

Add these properties to the `Settings` class in `Properties/Settings.Designer.cs`, after the existing `EatsApiToken` property:

```csharp
[global::System.Configuration.UserScopedSettingAttribute()]
[global::System.Diagnostics.DebuggerNonUserCodeAttribute()]
[global::System.Configuration.DefaultSettingValueAttribute("https://api.managers.lesailes.uz")]
public string ManagersApiUrl {
    get {
        return ((string)(this["ManagersApiUrl"]));
    }
    set {
        this["ManagersApiUrl"] = value;
    }
}

[global::System.Configuration.UserScopedSettingAttribute()]
[global::System.Diagnostics.DebuggerNonUserCodeAttribute()]
[global::System.Configuration.DefaultSettingValueAttribute("")]
public string ManagersApiToken {
    get {
        return ((string)(this["ManagersApiToken"]));
    }
    set {
        this["ManagersApiToken"] = value;
    }
}

[global::System.Configuration.UserScopedSettingAttribute()]
[global::System.Diagnostics.DebuggerNonUserCodeAttribute()]
[global::System.Configuration.DefaultSettingValueAttribute("50000")]
public int PlaygroundMinAmount {
    get {
        return ((int)(this["PlaygroundMinAmount"]));
    }
    set {
        this["PlaygroundMinAmount"] = value;
    }
}
```

- [ ] **Step 2: Add settings to app.config**

Add these settings inside the `<Resto.Front.Api.CustomWebserver.Properties.Settings>` section within `<userSettings>`, after the `EatsApiToken` setting:

```xml
<setting name="ManagersApiUrl" serializeAs="String">
    <value>https://api.managers.lesailes.uz</value>
</setting>
<setting name="ManagersApiToken" serializeAs="String">
    <value></value>
</setting>
<setting name="PlaygroundMinAmount" serializeAs="String">
    <value>50000</value>
</setting>
```

- [ ] **Step 3: Commit**

```bash
git add Resto.Front.Api.SamplePlugin/Properties/Settings.Designer.cs Resto.Front.Api.SamplePlugin/app.config
git commit -m "feat: add playground ticket settings to iiko plugin config"
```

---

## Task 7: iiko Plugin — PlaygroundTicketHelper

**Files:**
- Create: `C:\projects\tablo_full\new_webserver\Resto.Front.Api.SamplePlugin\Helpers\PlaygroundTicketHelper.cs`

- [ ] **Step 1: Create helper class with API call and response model**

Create `Helpers/PlaygroundTicketHelper.cs`:

```csharp
using System;
using Newtonsoft.Json;
using Resto.Front.Api.CustomWebserver.Properties;

namespace Resto.Front.Api.CustomWebserver.Helpers
{
    public class PlaygroundTicketRequest
    {
        [JsonProperty("terminal_id")]
        public string TerminalId { get; set; }

        [JsonProperty("order_number")]
        public string OrderNumber { get; set; }

        [JsonProperty("order_amount")]
        public int OrderAmount { get; set; }
    }

    public class PlaygroundTicketResponse
    {
        [JsonProperty("ticket_id")]
        public string TicketId { get; set; }

        [JsonProperty("children_count")]
        public int ChildrenCount { get; set; }

        [JsonProperty("qr_data")]
        public string QrData { get; set; }
    }

    public static class PlaygroundTicketHelper
    {
        public static PlaygroundTicketResponse GenerateTicket(string terminalId, string orderNumber, int orderAmount)
        {
            var apiUrl = Settings.Default.ManagersApiUrl.TrimEnd('/') + "/api/playground_tickets/generate";
            var apiToken = Settings.Default.ManagersApiToken;

            var request = new PlaygroundTicketRequest
            {
                TerminalId = terminalId,
                OrderNumber = orderNumber,
                OrderAmount = orderAmount
            };

            PluginContext.Log.InfoFormat("Playground: Generating ticket for order {0}, amount {1}", orderNumber, orderAmount);

            var result = HttpHelper.PostWithRetry(apiUrl, apiToken, request, maxRetries: 3, timeoutMs: 5000);

            if (!result.Success)
            {
                PluginContext.Log.ErrorFormat("Playground: Failed to generate ticket after {0} attempts: {1}", result.AttemptsUsed, result.ErrorMessage);
                return null;
            }

            try
            {
                var response = JsonConvert.DeserializeObject<PlaygroundTicketResponse>(result.Response);
                PluginContext.Log.InfoFormat("Playground: Ticket generated - ID: {0}, Children: {1}", response.TicketId, response.ChildrenCount);
                return response;
            }
            catch (Exception ex)
            {
                PluginContext.Log.ErrorFormat("Playground: Failed to parse response: {0}", ex.Message);
                return null;
            }
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add Resto.Front.Api.SamplePlugin/Helpers/PlaygroundTicketHelper.cs
git commit -m "feat: add PlaygroundTicketHelper for API communication"
```

---

## Task 8: iiko Plugin — BillChequeExtender with QR

**Files:**
- Create: `C:\projects\tablo_full\new_webserver\Resto.Front.Api.SamplePlugin\BillChequeExtender.cs`

- [ ] **Step 1: Create BillChequeExtender**

Create `Resto.Front.Api.SamplePlugin/BillChequeExtender.cs`:

```csharp
using System;
using System.Collections.Concurrent;
using System.Xml.Linq;
using Resto.Front.Api.Data.Cheques;

namespace Resto.Front.Api.CustomWebserver
{
    internal sealed class BillChequeExtender : IDisposable
    {
        private readonly IDisposable subscription;
        private readonly ConcurrentDictionary<Guid, PlaygroundTicketData> pendingTickets = new ConcurrentDictionary<Guid, PlaygroundTicketData>();

        internal BillChequeExtender()
        {
            subscription = PluginContext.Notifications.BillChequePrinting.Subscribe(AddBillChequeExtensions);
        }

        internal void SetTicketForOrder(Guid orderId, string qrData, int childrenCount)
        {
            pendingTickets[orderId] = new PlaygroundTicketData
            {
                QrData = qrData,
                ChildrenCount = childrenCount,
                ValidUntil = DateTime.Today.AddDays(1).AddSeconds(-1).ToString("dd.MM.yyyy HH:mm")
            };
        }

        private BillCheque AddBillChequeExtensions(Guid orderId)
        {
            PlaygroundTicketData ticketData;
            if (!pendingTickets.TryRemove(orderId, out ticketData))
            {
                return new BillCheque();
            }

            var afterFooter = new XElement(Tags.Center,
                new XElement(Tags.Center, "═══════════════════════════"),
                new XElement(Tags.Center, new XAttribute(Data.Cheques.Attributes.Bold, ""),  "БИЛЕТ ДЕТСКОЙ ПЛОЩАДКИ"),
                new XElement(Tags.Center, $"Кол-во детей: {ticketData.ChildrenCount}"),
                new XElement(Tags.Center, $"Действителен до: {ticketData.ValidUntil}"),
                new XElement(Tags.QRCode, ticketData.QrData),
                new XElement(Tags.Center, "═══════════════════════════")
            );

            return new BillCheque
            {
                AfterFooter = afterFooter
            };
        }

        public void Dispose()
        {
            subscription.Dispose();
        }

        private class PlaygroundTicketData
        {
            public string QrData { get; set; }
            public int ChildrenCount { get; set; }
            public string ValidUntil { get; set; }
        }
    }
}
```

**Note:** The exact XElement tag for QR code in iiko may be `Tags.QRCode` or `Tags.BarCode` — verify against iiko Resto.Front.Api V8 SDK documentation. If `Tags.QRCode` is not available, use:
```csharp
new XElement("qrcode", ticketData.QrData)
```

- [ ] **Step 2: Commit**

```bash
git add Resto.Front.Api.SamplePlugin/BillChequeExtender.cs
git commit -m "feat: add BillChequeExtender for playground QR code printing"
```

---

## Task 9: iiko Plugin — Integrate into CustomWebserver.cs

**Files:**
- Modify: `C:\projects\tablo_full\new_webserver\Resto.Front.Api.SamplePlugin\CustomWebserver.cs`

- [ ] **Step 1: Add BillChequeExtender field and initialization**

Add field declaration after `private readonly CompositeDisposable composableSubscriptions;` (line 30):

```csharp
private readonly BillChequeExtender billChequeExtender;
```

Add initialization at the beginning of the constructor, after `PluginContext.Log.Info("Initializing CustomWebserver");` (line 34):

```csharp
billChequeExtender = new BillChequeExtender();
```

- [ ] **Step 2: Add playground ticket logic to OnBeforeOrderBill**

Replace the `OnBeforeOrderBill` method (lines 256-306) with:

```csharp
private void OnBeforeOrderBill([NotNull] IOrder order, [NotNull] IOperationService os, IViewManager vm)
{
    try
    {
        PluginContext.Log.Info("Я.Еда: Оплата заказа");

        var orderNumber = order.ExternalNumber;

        if (orderNumber != null && orderNumber.Length > 0)
        {
            PluginContext.Log.Info($"Я.Еда: Оплата заказа {orderNumber}");

            var payments = order.Payments;

            for (int i = 0; i < payments.Count; i++)
            {
                PluginContext.Log.Info($"Оплата {i}: {payments[i].Id} {payments[i].Type.Id}");
            }

            Guid guid = new Guid(Settings.Default.YandexPaymentId);
            var yandexPayment = payments.FirstOrDefault(x => x.Type.Id == guid);
            if (yandexPayment == null)
            {
                PluginContext.Log.Info("Я.Еда: Оплата не найдена");
                return;
            }

            PluginContext.Log.Info("Я.Еда: Оплата найдена");

            var testWindow = new OtpWindow("Введите проверочный код Я.Еды", orderNumber, order.OpenTime);
            PluginContext.Log.InfoFormat("created new instance of TestWindow");
            testWindow.ShowDialog();
            PluginContext.Log.InfoFormat("showed dialog of TestWindow");
            var result = testWindow.InputValueTask.Result;

            if (result != "true")
            {
                throw new OperationCanceledException(result);
            }
        }
    }
    catch (Exception ex)
    {
        PluginContext.Log.Error("Я.Еда: Ошибка при оплате заказа", ex);
        if (ex is OperationCanceledException)
        {
            throw new OperationCanceledException(ex.Message);
        }
    }

    // Playground ticket generation — runs after Yandex verification, never blocks sale
    try
    {
        var orderSum = (int)order.ResultSum;
        var minAmount = Settings.Default.PlaygroundMinAmount;

        if (orderSum >= minAmount && !string.IsNullOrEmpty(Settings.Default.ManagersApiToken))
        {
            var terminalId = PluginContext.Operations.GetHostTerminalsGroup().Id.ToString();
            var orderNum = order.Number.ToString();

            PluginContext.Log.InfoFormat("Playground: Order sum {0} >= {1}, generating ticket", orderSum, minAmount);

            var ticket = Helpers.PlaygroundTicketHelper.GenerateTicket(terminalId, orderNum, orderSum);

            if (ticket != null)
            {
                billChequeExtender.SetTicketForOrder(order.Id, ticket.QrData, ticket.ChildrenCount);
                PluginContext.Log.InfoFormat("Playground: Ticket set for order {0}", order.Id);
            }
        }
    }
    catch (Exception ex)
    {
        PluginContext.Log.Error("Playground: Error generating ticket", ex);
        // Never block sale due to playground ticket error
    }
}
```

- [ ] **Step 3: Add BillChequeExtender disposal**

In the `Dispose` method, add before `composableSubscriptions?.Dispose();` (line 187):

```csharp
billChequeExtender?.Dispose();
```

- [ ] **Step 4: Add missing using directive**

Add to the top of the file if not already present:

```csharp
using Resto.Front.Api.CustomWebserver.Helpers;
```

- [ ] **Step 5: Build the project**

Build in Visual Studio or run:
```bash
msbuild Resto.Front.Api.CustomWebserver.csproj /p:Configuration=Debug
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add Resto.Front.Api.SamplePlugin/CustomWebserver.cs
git commit -m "feat: integrate playground ticket generation into BeforeOrderBill"
```

---

## Task 10: Add Permissions to Database

**Files:** None (database insert via SQL)

- [ ] **Step 1: Insert playground permissions**

Run SQL against the managers PostgreSQL database:

```sql
INSERT INTO permissions (slug, description, active) VALUES
  ('playground_tickets.list', 'View playground tickets', true),
  ('playground_tickets.validate', 'Validate playground tickets', true);
```

- [ ] **Step 2: Assign permissions to admin role**

Find the admin role ID, then insert into `roles_permissions`:

```sql
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code = 'admin'
AND p.slug IN ('playground_tickets.list', 'playground_tickets.validate');
```

- [ ] **Step 3: Clear Redis cache**

Restart the backend server or call the cache refresh to pick up new permissions.

---

## Task 11: End-to-End Verification

- [ ] **Step 1: Test generate endpoint**

```bash
curl -X POST http://localhost:6761/api/playground_tickets/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -d '{"terminal_id": "TERMINAL_UUID", "order_number": "TEST-001", "order_amount": 150000}'
```

Expected: `{ "ticket_id": "uuid", "children_count": 3, "qr_data": "PLAYGROUND:uuid" }`

- [ ] **Step 2: Test validate endpoint**

Via browser at `http://localhost:6762/ru/admin/playground/scan` — enter the ticket ID manually and verify green success result.

- [ ] **Step 3: Test idempotency**

Re-run the same generate call — should return the same ticket_id.

- [ ] **Step 4: Test expiry/used states**

Validate same ticket again — should return "Ticket already used" error.

- [ ] **Step 5: Test list page**

Navigate to `http://localhost:6762/ru/admin/playground/list` — verify the test ticket appears with correct data.

- [ ] **Step 6: Final commit**

```bash
git commit -m "feat: playground ticket system complete"
```
