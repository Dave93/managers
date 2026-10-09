"use client";

// Таблица очереди «К оплате». Четыре состояния и пагинация те же, что у
// ../data-table.tsx (список заявок офиса); отличается тем, что запрос живёт на
// странице: ей нужны строки для галочек и суммы выбранного.
//
//  * загрузка: скелет по форме таблицы;
//  * пусто: «Нет заявок к оплате»;
//  * 403: панель с названием права;
//  * ошибка (сеть, 5xx): текст и «Повторить».
// Если строки уже загружены, а очередной опрос упал, они остаются на экране, а
// сбой виден полосой над ними.

import { Fragment, useMemo } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";
import { Inbox, RotateCw, TriangleAlert } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Skeleton } from "@components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { apiMessage, type ApiError, type TicketRow } from "@admin/lib/tickets-api";

import { AccessPanel, PAYMENT_RIGHTS } from "./_components/access-panel";
import { PaymentDetail } from "./_components/payment-detail";

// Серверный потолок POST /tickets/payment/approve|reject — 200 заявок за раз
// (MAX_PAYMENT_IDS в controller.ts). Размер страницы не выше него, чтобы
// «выбрать все на странице» никогда не упиралось в 422.
export const PAGE_SIZES = [20, 50, 100, 200];

const SKELETON_ROWS = 6;
const SKELETON_WIDTHS = ["w-4", "w-20", "w-24", "w-28", "w-24", "w-24", "w-24", "w-16"];

type Queue = UseQueryResult<{ total: number; data: TicketRow[] }, Error>;

interface DataTableProps {
  columns: ColumnDef<TicketRow, any>[];
  queue: Queue;
  rows: TicketRow[];
  expanded: ReadonlySet<string>;
  pageIndex: number;
  pageSize: number;
  onPageIndex: (i: number) => void;
  onPageSize: (s: number) => void;
  onRetry: () => void;
}

function ErrorPanel({
  error,
  retrying,
  onRetry,
}: {
  error: ApiError;
  retrying: boolean;
  onRetry: () => void;
}) {
  const network = error.status === undefined;
  return (
    <div role="alert" className="flex items-start gap-3 px-5 py-6">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 space-y-2.5">
        <p className="text-[14px] font-semibold leading-tight">
          {network ? "Нет связи с сервером" : "Не удалось загрузить очередь"}
        </p>
        <p className="max-w-xl break-words text-[12.5px] leading-snug text-muted-foreground">
          {network
            ? "Запрос не дошёл до сервера. Проверьте соединение и повторите."
            : apiMessage(error)}
        </p>
        {network && (
          <p className="break-words font-mono text-[11px] text-muted-foreground">
            {apiMessage(error)}
          </p>
        )}
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          <RotateCw className={retrying ? "size-3.5 animate-spin" : "size-3.5"} />
          {retrying ? "Повторяем…" : "Повторить"}
        </Button>
      </div>
    </div>
  );
}

export function DataTable({
  columns,
  queue,
  rows,
  expanded,
  pageIndex,
  pageSize,
  onPageIndex,
  onPageSize,
  onRetry,
}: DataTableProps) {
  // isPending, а не isLoading: запрос без данных и без ошибки, но не идущий
  // (ждём список прав, пауза), нельзя показывать как «Нет заявок к оплате».
  const { data, isPending: isLoading, isError, error, isFetching, dataUpdatedAt } = queue;
  const total = data?.total ?? 0;
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);

  const table = useReactTable({
    data: rows,
    columns,
    // id строки = id заявки, а не индекс в массиве: иначе после любого
    // обновления состояние, привязанное к строке, переехало бы на другую.
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount,
  });

  const apiError = error as ApiError | null;
  const forbidden = isError && !data && apiError?.status === 403;
  const failed = isError && !data && !forbidden;
  const staleError = isError && Boolean(data);
  const colCount = columns.length;
  const skeletonKeys = useMemo(() => Array.from({ length: SKELETON_ROWS }, (_, i) => i), []);

  // Отказ сервера в чтении очереди: GET /tickets проверяет ровно tickets.list.
  if (forbidden) return <AccessPanel missing={[PAYMENT_RIGHTS.list]} serverDenied />;
  if (failed) {
    return (
      <div className="rounded-lg border bg-card">
        <ErrorPanel error={apiError as ApiError} retrying={isFetching} onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {staleError && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          <span>
            {apiError?.status === 403 ? "Доступ к заявкам пропал." : "Не удалось обновить очередь."}{" "}
            Показаны данные на{" "}
            {new Date(dataUpdatedAt).toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            .
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-[12px]"
            onClick={onRetry}
            disabled={isFetching}
          >
            {isFetching ? "Повторяем…" : "Повторить"}
          </Button>
        </div>
      )}
      <div className="rounded-lg border bg-card" aria-busy={isLoading}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="h-9 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              skeletonKeys.map((i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  {columns.map((c, j) => (
                    <TableCell key={String(c.id ?? j)} className="py-3">
                      <Skeleton
                        className={`h-3.5 ${SKELETON_WIDTHS[j % SKELETON_WIDTHS.length]}`}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow className="hover:bg-muted/40">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-2 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {expanded.has(row.original.id) && (
                    <PaymentDetail ticket={row.original} colSpan={colCount} />
                  )}
                </Fragment>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="h-40 text-center">
                  <Inbox className="mx-auto mb-2 size-5 text-muted-foreground" />
                  <p className="text-[13px] font-medium">Нет заявок к оплате</p>
                  <p className="mx-auto mt-1 max-w-md text-[12px] leading-snug text-muted-foreground">
                    Здесь появляются закрытые заявки с актом, по которым ещё не принято решение
                    об оплате.
                  </p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Строк:</span>
          <Select value={`${pageSize}`} onValueChange={(v) => onPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[72px]">
              <SelectValue placeholder={`${pageSize}`} />
            </SelectTrigger>
            <SelectContent side="top">
              {PAGE_SIZES.map((ps) => (
                <SelectItem key={ps} value={`${ps}`}>
                  {ps}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            всего: {isLoading ? "…" : total}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] tabular-nums text-muted-foreground">
            стр. {pageIndex + 1} из {pageCount}
          </span>
          <Button
            variant="outline"
            className="hidden size-8 p-0 lg:flex"
            aria-label="Первая страница"
            onClick={() => onPageIndex(0)}
            disabled={pageIndex <= 0}
          >
            <DoubleArrowLeftIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            className="size-8 p-0"
            aria-label="Предыдущая страница"
            onClick={() => onPageIndex(pageIndex - 1)}
            disabled={pageIndex <= 0}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            className="size-8 p-0"
            aria-label="Следующая страница"
            onClick={() => onPageIndex(pageIndex + 1)}
            disabled={pageIndex + 1 >= pageCount}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            className="hidden size-8 p-0 lg:flex"
            aria-label="Последняя страница"
            onClick={() => onPageIndex(pageCount - 1)}
            disabled={pageIndex + 1 >= pageCount}
          >
            <DoubleArrowRightIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
