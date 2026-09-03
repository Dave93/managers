"use client";

import {
  ColumnDef,
  PaginationState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@admin/components/ui/table";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useIsMobile } from "@admin/utils/use-is-mobile";
import { AutoMobileCards } from "@admin/components/mobile/AutoMobileCards";
import {
  useStoplistBrandFilter,
  useStoplistSearchFilter,
  useStoplistStatusFilter,
} from "./filters.hook";
import type { StoplistRow } from "./columns";

// The stoplist endpoints live on a widened (non-Eden) controller, so this page
// talks to them with plain same-origin fetch — Next.js rewrites proxy /api/*
// to the backend and the session cookie rides along. Same as /stoplist and
// the dashboard StoplistByDay widget.
type StoplistListResponse = {
  total: number;
  summary: {
    open: number;
    open_over_day: number;
    products: number;
    hours_in_period: number;
  };
  data: StoplistRow[];
};

interface DataTableProps<TValue> {
  columns: ColumnDef<StoplistRow, TValue>[];
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function DataTable<TValue>({ columns }: DataTableProps<TValue>) {
  const { dateRange } = useDateRangeState();
  const { startDate, endDate } = useMemo(() => {
    if (dateRange?.from && dateRange?.to)
      return { startDate: dateRange.from, endDate: dateRange.to };
    const now = new Date();
    return { startDate: now, endDate: now };
  }, [dateRange]);
  const [terminals] = useTerminalsFilter();
  const [brand] = useStoplistBrandFilter();
  const [status] = useStoplistStatusFilter();
  const [searchRaw] = useStoplistSearchFilter();
  const search = useDebounced(searchRaw, 350);
  const isMobile = useIsMobile();

  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  // Any filter change resets to the first page.
  useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [startDate, endDate, terminals, brand, status, search]);

  const { data, isLoading, error } = useQuery<StoplistListResponse>({
    queryKey: [
      "stoplist_list",
      startDate,
      endDate,
      terminals,
      brand,
      status,
      search,
      pageIndex,
      pageSize,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        limit: String(pageSize),
        offset: String(pageIndex * pageSize),
        status,
      });
      if (terminals) params.set("terminals", terminals.toString());
      if (brand) params.set("brand", brand);
      if (search) params.set("search", search);
      const res = await fetch(`/api/stoplist/list?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const defaultData = useMemo<StoplistRow[]>(() => [], []);
  const pagination = useMemo(() => ({ pageIndex, pageSize }), [pageIndex, pageSize]);

  const table = useReactTable({
    data: data?.data ?? defaultData,
    columns,
    pageCount: data?.total ? Math.ceil(data.total / pageSize) : -1,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });

  const summary = data?.summary;
  const tiles = (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <div className="rounded-xl border p-3 text-center">
        <div className="text-2xl font-bold">{summary?.open ?? "—"}</div>
        <div className="text-xs text-muted-foreground">в стопе сейчас</div>
      </div>
      <div className="rounded-xl border p-3 text-center">
        <div className="text-2xl font-bold">{summary?.open_over_day ?? "—"}</div>
        <div className="text-xs text-muted-foreground">дольше суток</div>
      </div>
      <div className="rounded-xl border p-3 text-center">
        <div className="text-2xl font-bold">{summary?.products ?? "—"}</div>
        <div className="text-xs text-muted-foreground">продуктов за период</div>
      </div>
      <div className="rounded-xl border p-3 text-center">
        <div className="text-2xl font-bold">{summary?.hours_in_period ?? "—"}</div>
        <div className="text-xs text-muted-foreground">часов простоя за период</div>
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="py-10 text-center text-red-500">
        Не удалось загрузить стоп-лист
      </div>
    );
  }

  if (isMobile) {
    const rows = data?.data ?? [];
    return (
      <div className="space-y-4">
        {tiles}
        <AutoMobileCards
          rows={rows}
          columns={columns as any[]}
          isLoading={isLoading}
          onPrev={() =>
            setPagination((p) => ({ ...p, pageIndex: Math.max(0, p.pageIndex - 1) }))
          }
          onNext={() => setPagination((p) => ({ ...p, pageIndex: p.pageIndex + 1 }))}
          canPrev={pageIndex > 0}
          canNext={data?.total ? (pageIndex + 1) * pageSize < data.total : false}
          page={pageIndex}
          empty="За период стопов не было"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tiles}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
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
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  Загрузка…
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  За период стопов не было
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between px-2">
        <div className="flex-1 text-sm text-muted-foreground">
          {data?.total != null ? `${data.total.toLocaleString("ru-RU")} записей` : ""}
        </div>
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium">Строк на странице</p>
          <Select
            value={`${pageSize}`}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue placeholder={pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {[10, 20, 50, 100].map((s) => (
                <SelectItem key={s} value={`${s}`}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-[120px] items-center justify-center text-sm font-medium">
          Стр. {pageIndex + 1} из {Math.max(table.getPageCount(), 1)}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <DoubleArrowLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <DoubleArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
