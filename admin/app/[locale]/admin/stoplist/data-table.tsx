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
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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
import { TablePager } from "@admin/components/ui/table-pager";

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
  const t = useTranslations("stoplistPage");
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
        <div className="text-xs text-muted-foreground">{t("tiles.openNow")}</div>
      </div>
      <div className="rounded-xl border p-3 text-center">
        <div className="text-2xl font-bold">{summary?.open_over_day ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{t("tiles.overDay")}</div>
      </div>
      <div className="rounded-xl border p-3 text-center">
        <div className="text-2xl font-bold">{summary?.products ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{t("tiles.products")}</div>
      </div>
      <div className="rounded-xl border p-3 text-center">
        <div className="text-2xl font-bold">{summary?.hours_in_period ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{t("tiles.hoursInPeriod")}</div>
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="py-10 text-center text-red-500">
        {t("loadError")}
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
          empty={t("noStopsInPeriod")}
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
                  {t("loading")}
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
                  {t("noStopsInPeriod")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <TablePager
        pageIndex={pageIndex}
        pageCount={table.getPageCount()}
        pageSize={pageSize}
        total={data?.total}
        onPageChange={(i) => setPagination((p) => ({ ...p, pageIndex: i }))}
        onPageSizeChange={(size) => table.setPageSize(size)}
      />
    </div>
  );
}
