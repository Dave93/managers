"use client";

// Таблица заявок офиса. Разметка и пагинация те же, что у
// app/[locale]/passport/enrollments/data-table.tsx: у админки нет общего
// <DataTable>, каждый список держит свой, и общий data-table-pagination не
// подходит (печатает английское «row(s) selected» и не знает про серверную
// пагинацию).
//
// Четыре состояния различаются видом, а не только текстом:
//  * загрузка: скелет строк по форме таблицы, не спиннер;
//  * пусто: текст и подсказка про сброс фильтров;
//  * 403: панель с перечнем нужных прав;
//  * ошибка (сеть, 5xx): текст ошибки и кнопка «Повторить».
// Скелет держится ровно пока нет ни данных, ни ошибки: и успех, и отказ его
// гасят, а повторов у запроса нет (см. use-tickets.ts), так что зависнуть
// ему не на чем.

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ColumnDef,
  PaginationState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";
import { Inbox, RotateCw, ShieldAlert, TriangleAlert } from "lucide-react";

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
import {
  apiMessage,
  type ApiError,
  type TicketListQuery,
  type TicketRow,
} from "@admin/lib/tickets-api";
import { useTicketList } from "@admin/lib/use-tickets";

type Filters = NonNullable<TicketListQuery["filters"]>;

interface DataTableProps {
  columns: ColumnDef<TicketRow, any>[];
  filters: Filters;
  hasFilters: boolean;
  onResetFilters: () => void;
  onOpen: (id: string) => void;
}

const SKELETON_ROWS = 8;
// Разная ширина, чтобы скелет не выглядел решёткой одинаковых плашек.
const SKELETON_WIDTHS = ["w-20", "w-24", "w-28", "w-40", "w-24", "w-24", "w-12", "w-16"];

// GET /tickets проверяет ровно одно право. Текст панели копируют в форму роли,
// поэтому называем только то, что маршрут действительно требует.
const REQUIRED_RIGHT = "tickets.list";

function ForbiddenPanel() {
  return (
    <div role="alert" className="flex items-start gap-3 px-5 py-6">
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="min-w-0 space-y-2.5">
        <p className="text-[14px] font-semibold leading-tight">Нет доступа к заявкам</p>
        <p className="max-w-xl text-[12.5px] leading-snug text-muted-foreground">
          Сервер ответил отказом (403). Чаще всего так выглядит новая роль, которой
          ещё не выдали право на список заявок. Для этого экрана нужно право:
        </p>
        <code className="inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
          {REQUIRED_RIGHT}
        </code>
        <p className="max-w-xl text-[12px] leading-snug text-muted-foreground">
          Попросите администратора добавить его роли, затем перезагрузите страницу.
        </p>
      </div>
    </div>
  );
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
  // У сетевого сбоя нет HTTP-статуса: запрос не дошёл или оборвался.
  const network = error.status === undefined;
  return (
    <div role="alert" className="flex items-start gap-3 px-5 py-6">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 space-y-2.5">
        <p className="text-[14px] font-semibold leading-tight">
          {network ? "Нет связи с сервером" : "Не удалось загрузить заявки"}
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
  filters,
  hasFilters,
  onResetFilters,
  onOpen,
}: DataTableProps) {
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  // Любое изменение фильтров возвращает на первую страницу: суженный фильтр не
  // должен оставить пользователя на седьмой странице двухстраничной выдачи.
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [filtersKey]);

  const query = useMemo<TicketListQuery>(
    () => ({
      limit: pageSize,
      offset: pageIndex * pageSize,
      ...(filters.length ? { filters } : {}),
    }),
    // filters приходит новым массивом на каждый рендер страницы, ключ стабилен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageSize, pageIndex, filtersKey]
  );

  // isPending, а не isLoading: запрос без данных и без ошибки, но не идущий
  // прямо сейчас (пауза), нельзя показывать как «Заявок нет».
  const { data, isPending: isLoading, isError, error, isFetching, dataUpdatedAt } =
    useTicketList(query);
  const qc = useQueryClient();
  // «Повторить» перезапрашивает и список, и счётчики над ним: они ходят в тот же
  // маршрут и упали по той же причине.
  const retryAll = () => qc.invalidateQueries({ queryKey: ["tickets", "list"] });

  const defaultData = useMemo<TicketRow[]>(() => [], []);
  const rows = data?.data ?? defaultData;
  const total = data?.total ?? 0;

  const table = useReactTable({
    data: rows,
    columns,
    // Всегда число: -1 («неизвестно») оставил бы кнопку «вперёд» живой при
    // пустой выдаче.
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
    state: { pagination: { pageIndex, pageSize } },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getPaginationRowModel: getPaginationRowModel(),
  });

  const apiError = error as ApiError | null;
  // Панель на всё место таблицы только пока показывать нечего. Если строки уже
  // загружены, а упал очередной опрос раз в минуту, они остаются на экране, а
  // сбой виден тонкой полосой над ними.
  const forbidden = isError && !data && apiError?.status === 403;
  const failed = isError && !data && !forbidden;
  const staleError = isError && Boolean(data);

  if (forbidden) {
    return (
      <div className="rounded-lg border bg-card">
        <ForbiddenPanel />
      </div>
    );
  }
  if (failed) {
    return (
      <div className="rounded-lg border bg-card">
        <ErrorPanel
          error={apiError as ApiError}
          retrying={isFetching}
          onRetry={retryAll}
        />
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
            {apiError?.status === 403
              ? "Доступ к заявкам пропал."
              : "Не удалось обновить список."}{" "}
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
            onClick={retryAll}
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
              Array.from({ length: SKELETON_ROWS }, (_, i) => (
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
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  onClick={() => onOpen(row.original.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && e.key === "Enter") {
                      onOpen(row.original.id);
                    }
                  }}
                  className="cursor-pointer outline-none hover:bg-muted/40 focus-visible:bg-muted/60"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-40 text-center">
                  <Inbox className="mx-auto mb-2 size-5 text-muted-foreground" />
                  <p className="text-[13px] font-medium">Заявок нет</p>
                  <p className="mx-auto mt-1 max-w-md text-[12px] leading-snug text-muted-foreground">
                    {hasFilters
                      ? "По этим фильтрам ничего не нашлось. Фильтры можно сбросить, и список покажет все заявки."
                      : "Пока ни одной заявки. Новые появятся здесь сразу после создания."}
                  </p>
                  {hasFilters && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={onResetFilters}
                    >
                      Сбросить фильтры
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Строк:</span>
          <Select
            value={`${pageSize}`}
            onValueChange={(v) => table.setPageSize(Number(v))}
          >
            <SelectTrigger className="h-8 w-[72px]">
              <SelectValue placeholder={`${pageSize}`} />
            </SelectTrigger>
            <SelectContent side="top">
              {[10, 20, 50, 100].map((ps) => (
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
            стр. {pageIndex + 1} из {Math.max(table.getPageCount(), 1)}
          </span>
          <Button
            variant="outline"
            className="hidden size-8 p-0 lg:flex"
            aria-label="Первая страница"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <DoubleArrowLeftIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            className="size-8 p-0"
            aria-label="Предыдущая страница"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            className="size-8 p-0"
            aria-label="Следующая страница"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            className="hidden size-8 p-0 lg:flex"
            aria-label="Последняя страница"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <DoubleArrowRightIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
