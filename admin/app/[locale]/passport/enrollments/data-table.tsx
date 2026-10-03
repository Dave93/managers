"use client";

// Per-section table, copied from app/[locale]/attestation/tests/data-table.tsx
// (there is no shared <DataTable> in this admin — every list route owns one).
// Differences from the source, all forced by this endpoint:
//  * the query goes through lib/passport-api.ts, because passportController is
//    registered with a type-erasing cast and Eden cannot see its routes;
//  * filters come in as a prop and reset the page index, so a narrowed filter
//    cannot leave the user stranded on page 7 of a 2-page result;
//  * the rows are handed back up via onResult, so the metrics strip counts the
//    same rows the table is showing instead of issuing a second query.

import { useEffect, useMemo, useState } from "react";
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

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import type {
  PassportEnrollmentRow,
  PassportStatusFilter,
} from "@admin/lib/passport-api";

import { useEnrollments } from "./_components/use-enrollments";

export interface EnrollmentFilters {
  status: PassportStatusFilter;
  terminal_id: string;
  program_id: string;
  employee_id: string;
}

interface DataTableProps {
  columns: ColumnDef<PassportEnrollmentRow, any>[];
  filters: EnrollmentFilters;
  onResult?: (r: {
    rows: PassportEnrollmentRow[];
    total: number;
    loading: boolean;
  }) => void;
}

export function DataTable({ columns, filters, onResult }: DataTableProps) {
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  // Any filter change goes back to the first page.
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [
    filters.status,
    filters.terminal_id,
    filters.program_id,
    filters.employee_id,
  ]);

  // Every param is a string and every empty one is OMITTED, not sent blank:
  // terminal_id/program_id/employee_id are uuid-formatted server-side and a
  // stringified "" would 422 the whole list (lib/passport-api.ts builds the
  // query object the same way for the same reason).
  const query = useMemo(
    () => ({
      limit: String(pageSize),
      offset: String(pageIndex * pageSize),
      status: filters.status,
      ...(filters.terminal_id ? { terminal_id: filters.terminal_id } : {}),
      ...(filters.program_id ? { program_id: filters.program_id } : {}),
      ...(filters.employee_id ? { employee_id: filters.employee_id } : {}),
    }),
    [
      pageSize,
      pageIndex,
      filters.status,
      filters.terminal_id,
      filters.program_id,
      filters.employee_id,
    ]
  );

  const { data, isLoading, isError, error } = useEnrollments(query);

  const defaultData = useMemo<PassportEnrollmentRow[]>(() => [], []);
  const rows = data?.data ?? defaultData;
  const total = Number(data?.total ?? 0);

  useEffect(() => {
    onResult?.({ rows, total, loading: isLoading });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, total, isLoading]);

  const pagination = useMemo(
    () => ({ pageIndex, pageSize }),
    [pageIndex, pageSize]
  );

  const table = useReactTable({
    data: rows,
    columns,
    pageCount: total ? Math.ceil(total / pageSize) : -1,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card">
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
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-[12.5px] text-muted-foreground"
                >
                  Загрузка…
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-[12.5px] text-destructive"
                >
                  {(error as any)?.status === 403
                    ? "Нет доступа к списку стажировок."
                    : (error as any)?.message ?? "Не удалось загрузить список"}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/40">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-28 text-center">
                  <p className="text-[13px] font-medium">Стажировок нет</p>
                  <p className="mx-auto mt-1 max-w-md text-[12px] leading-snug text-muted-foreground">
                    По этому фильтру ничего не нашлось. По умолчанию показаны
                    только идущие стажировки — переключите фильтр на «Все», чтобы
                    увидеть завершённые.
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
            всего: {total}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] tabular-nums text-muted-foreground">
            стр. {pageIndex + 1} из {Math.max(table.getPageCount(), 1)}
          </span>
          <Button
            variant="outline"
            className="hidden size-8 p-0 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <DoubleArrowLeftIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            className="size-8 p-0"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            className="size-8 p-0"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            className="hidden size-8 p-0 lg:flex"
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
