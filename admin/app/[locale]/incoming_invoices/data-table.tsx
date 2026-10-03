"use client";

import {
  Column,
  PaginationState,
  SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Input } from "@admin/components/ui/input";
import { ChevronDown } from "lucide-react";
import { Fragment } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";

import { Button } from "@admin/components/ui/buttonOrigin";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";
import dayjs from "dayjs";

import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import { useStoplistFilterStore } from "./filters_store";
import { cn } from "@admin/lib/utils";
import { useIsMobile } from "@admin/utils/use-is-mobile";
import { MobileReportCards } from "@admin/components/mobile/MobileReportCards";

import "./style.css";

interface DataTableProps<TData, TValue> { }

function PerDayDetails({ row, showAct }: { row: any; showAct?: boolean }) {
  const entries = Object.keys(row)
    .filter((k) => /^\d{4}_\d{2}_\d{2}_(base|act)$/.test(k) && Number(row[k]) > 0)
    .map((k) => {
      const m = k.match(/^(\d{4})_(\d{2})_(\d{2})_(base|act)$/)!;
      return {
        date: `${m[3]}.${m[2]}.${m[1]}`,
        sortKey: `${m[1]}${m[2]}${m[3]}`,
        kind: m[4] as "base" | "act",
        value: Number(row[k]),
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.kind.localeCompare(b.kind));
  if (!entries.length) return <div className="text-sm text-muted-foreground">Нет движений</div>;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 md:grid-cols-4">
      {entries.map((e, i) => (
        <div key={i} className="flex items-baseline justify-between gap-2 border-b border-dashed border-slate-200 pb-1 dark:border-slate-700">
          <span className="text-muted-foreground">
            {e.date}{showAct ? <span className="ml-1 text-xs">{e.kind === "base" ? "опр." : "акт."}</span> : ""}
          </span>
          <span className="font-medium tabular-nums">
            {Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(e.value)} {row.unit ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}

const getCommonPinningStyles = (column: Column<any>): CSSProperties => {
  const isPinned = column.getIsPinned();
  const isLastLeftPinnedColumn =
    isPinned === "left" && column.getIsLastColumn("left");
  const isFirstRightPinnedColumn =
    isPinned === "right" && column.getIsFirstColumn("right");

  return {
    boxShadow: isLastLeftPinnedColumn
      ? "-4px 0 4px -4px gray inset"
      : isFirstRightPinnedColumn
        ? "4px 0 4px -4px gray inset"
        : undefined,
    left: isPinned === "left" ? `${column.getStart("left")}px` : undefined,
    right: isPinned === "right" ? `${column.getAfter("right")}px` : undefined,
    position: isPinned ? "sticky" : "relative",
    width: column.getSize(),
    zIndex: isPinned ? 1 : 0,
  };
};

export function DataTable<TData, TValue>({ }: DataTableProps<TData, TValue>) {
  const date = useStoplistFilterStore((state) => state.date);
  const storeId = useStoplistFilterStore((state) => state.storeId);
  const showActualColumn = useStoplistFilterStore(
    (state) => state.showActualColumn
  );
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const isMobileHook = useIsMobile();

  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "totalBase", desc: true }]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  // Article column collapsed (hidden) by default; a toggle reveals it.
  const [showArticle, setShowArticle] = useState(false);

  const filters = useMemo(() => {
    let res: {
      field: string;
      operator: string;
      value: string;
    }[] = [];

    if (date?.from) {
      res.push({
        field: "invoiceincomingdate",
        operator: "gte",
        value: dayjs(date.from).toISOString(),
      });
    }

    if (date?.to) {
      res.push({
        field: "invoiceincomingdate",
        operator: "lte",
        value: dayjs(date.to).toISOString(),
      });
    }

    if (storeId) {
      res.push({
        field: "storeId",
        operator: "eq",
        value: storeId,
      });
    }

    return JSON.stringify(res);
  }, [date, storeId]);
  // console.log("filters", date);
  const { data, isLoading } = useQuery({
    enabled: !!date,
    queryKey: [
      "incoming_invoices",
      {
        limit: pageSize,
        offset: pageIndex * pageSize,
        filters,
      },
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.invoices.incoming.get({
        query: {
          limit: pageSize.toString(),
          offset: (pageIndex * pageSize).toString(),
          filters,
        },
      });
      return data;
    },
  });

  const defaultData = useMemo(() => [], []);

  const filteredData = useMemo(() => {
    const rows = (data?.data ?? []) as any[];
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      String(r.name ?? "").toLowerCase().includes(q) ||
      String(r.supplierProductArticle ?? "").toLowerCase().includes(q)
    );
  }, [data, search]);

  // dates that actually have at least one nonzero value in filtered rows
  const activeDateKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of filteredData as any[]) {
      for (const k of Object.keys(r)) {
        const m = k.match(/^(\d{4}_\d{2}_\d{2})_(base|act)$/);
        if (m && Number(r[k] || 0) > 0) set.add(m[1]);
      }
    }
    return set;
  }, [filteredData]);

  const pagination = useMemo(
    () => ({
      pageIndex,
      pageSize,
    }),
    [pageIndex, pageSize]
  );

  const columnHelper = createColumnHelper();

  const columns = useMemo(() => {
    let cols = [
      {
        accessorKey: "name",
        header: "Название",
        enablePinning: true,
        size: 200,
        cell: ({ row }: any) => (
          <span className="block truncate" title={(row.original as any).name}>{(row.original as any).name}</span>
        ),
      },
      {
        accessorKey: "supplierProductArticle",
        header: "Артикул",
      },
      {
        accessorKey: "unit",
        header: "Единица измерения",
        enablePinning: true,
        size: 110,
      },
      columnHelper.group({
        id: "group",
        header: () => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-semibold text-red-600"
            onClick={() =>
              setSorting((prev) => {
                const cur = prev[0];
                return [{ id: "totalBase", desc: cur?.id === "totalBase" ? !cur.desc : true }];
              })
            }
          >
            Всего {sorting[0]?.id === "totalBase" ? (sorting[0].desc ? "↓" : "↑") : "⇅"}
          </button>
        ),
        // @ts-ignore
        columns: [
          // @ts-ignore
          columnHelper.accessor(
            (row: any) => {
              let res = 0;
              Object.keys(row).forEach((key) => {
                if (key.indexOf("_base") > -1) res += +row[key];
              });
              return res;
            },
            {
              id: "totalBase",
              header: () => null,
              enableSorting: true,
              sortDescFirst: true,
              cell: ({ getValue }) => {
                const res = Number(getValue()) || 0;
                return <span>{res ? Intl.NumberFormat("ru-RU").format(res) : ""}</span>;
              },
            }
          ),
        ],
      }),
    ];
    if (date && date.from && date.to) {
      let from = dayjs(date.from);
      let to = dayjs(date.to).add(1, "day");
      for (var m = from; m.isBefore(to); m = m.add(1, "day")) {
        const dateKey = m.format("YYYY_MM_DD");
        if (!activeDateKeys.has(dateKey)) continue;
        cols.push(
          // @ts-ignore
          columnHelper.group({
            id: m.format("YYYY-MM-DD"),
            header: m.format("DD.MM.YYYY"),
            // @ts-ignore
            columns: [
              // @ts-ignore
              columnHelper.accessor(m.format("YYYY_MM_DD") + "_base", {
                cell: (info: any) => {
                  const v = info.getValue();
                  if (!v) return "";
                  return Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
                },
                header: () => "Опр.",
              }),
            ],
          })
        );
      }
    }
    return cols;
  }, [date, activeDateKeys, sorting]);

  const columnsWithActual = useMemo(() => {
    let cols = [
      {
        accessorKey: "name",
        header: "Название",
        enablePinning: true,
        size: 200,
        cell: ({ row }: any) => (
          <span className="block truncate" title={(row.original as any).name}>{(row.original as any).name}</span>
        ),
      },
      {
        accessorKey: "supplierProductArticle",
        header: "Артикул",
      },
      {
        accessorKey: "unit",
        header: "Единица измерения",
        enablePinning: true,
        size: 110,
      },
      columnHelper.group({
        id: "group",
        header: () => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-semibold text-red-600"
            onClick={() =>
              setSorting((prev) => {
                const cur = prev[0];
                return [{ id: "totalBase", desc: cur?.id === "totalBase" ? !cur.desc : true }];
              })
            }
          >
            Всего {sorting[0]?.id === "totalBase" ? (sorting[0].desc ? "↓" : "↑") : "⇅"}
          </button>
        ),
        // @ts-ignore
        columns: [
          // @ts-ignore
          columnHelper.accessor(
            (row: any) => {
              let res = 0;
              Object.keys(row).forEach((key) => {
                if (key.indexOf("_base") > -1) res += +row[key];
              });
              return res;
            },
            {
              id: "totalBase",
              header: () => null,
              enableSorting: true,
              sortDescFirst: true,
              cell: ({ getValue }) => {
                const res = Number(getValue()) || 0;
                return <span>{res ? Intl.NumberFormat("ru-RU").format(res) : ""}</span>;
              },
            }
          ),
          // @ts-ignore
          columnHelper.accessor(
            (row: any) => {
              let res = 0;
              Object.keys(row).forEach((key) => {
                if (key.indexOf("_act") > -1) res += +row[key];
              });
              return res;
            },
            {
              id: "totalAct",
              header: () => null,
              enableSorting: true,
              sortDescFirst: true,
              cell: ({ getValue }) => {
                const res = Number(getValue()) || 0;
                return <span>{res ? Intl.NumberFormat("ru-RU").format(res) : ""}</span>;
              },
            }
          ),
        ],
      }),
    ];
    if (date && date.from && date.to) {
      let from = dayjs(date.from);
      let to = dayjs(date.to).add(1, "day");
      for (var m = from; m.isBefore(to); m = m.add(1, "day")) {
        const dateKey = m.format("YYYY_MM_DD");
        if (!activeDateKeys.has(dateKey)) continue;
        cols.push(
          // @ts-ignore
          columnHelper.group({
            id: m.format("YYYY-MM-DD"),
            header: m.format("DD.MM.YYYY"),
            // @ts-ignore
            columns: [
              // @ts-ignore
              columnHelper.accessor(m.format("YYYY_MM_DD") + "_base", {
                cell: (info: any) => {
                  const v = info.getValue();
                  if (!v) return "";
                  return Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
                },
                header: () => "Опр.",
              }),
              // @ts-ignore
              columnHelper.accessor(m.format("YYYY_MM_DD") + "_act", {
                cell: (info: any) => {
                  const v = info.getValue();
                  if (!v) return "";
                  return Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
                },
                header: () => "Акт.",
              }),
            ],
          })
        );
      }
    }
    return cols;
  }, [date, activeDateKeys, sorting]);

  const table = useReactTable({
    data: search ? filteredData : (data?.data ?? defaultData),
    columns,
    pageCount: 100000,
    state: {
      pagination,
      sorting,
      rowPinning: {
        top: ["name"],
      },
      columnVisibility: {
        supplierProductArticle: showArticle,
      },
    },
    enablePinning: true,
    enableRowPinning: true,
    enableColumnPinning: true,
    enableSorting: true,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    getPaginationRowModel: getPaginationRowModel(),
  });

  const tableWithActual = useReactTable({
    data: search ? filteredData : (data?.data ?? defaultData),
    columns: columnsWithActual,
    pageCount: 100000,
    state: {
      pagination,
      sorting,
      rowPinning: {
        top: ["name"],
      },
      columnVisibility: {
        supplierProductArticle: showArticle,
      },
    },
    enablePinning: true,
    enableRowPinning: true,
    enableColumnPinning: true,
    enableSorting: true,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    getPaginationRowModel: getPaginationRowModel(),
  });

  useEffect(() => {
    table.setColumnPinning({
      left: ["name", "unit"],
    });
    tableWithActual.setColumnPinning({
      left: ["name", "unit"],
    });
  }, [table, tableWithActual]);

  const checkMismatch = (row: any) => {
    const original = row.original;
    let baseTotal = 0;
    let actTotal = 0;

    Object.keys(original).forEach((key) => {
      if (key.indexOf("_base") > -1) {
        baseTotal += +original[key];
      }
      if (key.indexOf("_act") > -1) {
        actTotal += +original[key];
      }
    });

    return baseTotal !== actTotal;
  };

  // const mismatchClass = 'bg-red-50 dark:bg-red-600';
  if (isMobileHook) {
    const mobileRows = (data?.data ?? []) as any[];
    return (
      <MobileReportCards
        rows={mobileRows}
        isLoading={isLoading}
        render={(r: any) => ({
          primary: r.name ?? "—",
          secondary: r.supplierProductArticle ?? "",
          fields: [
            { label: "Всего", value: (() => {
              const t = Object.keys(r).filter((k: string) => k.endsWith("_base")).reduce((s: number, k: string) => s + Number((r as any)[k] || 0), 0);
              return t ? `${Intl.NumberFormat("ru-RU").format(t)} ${r.unit ?? ""}`.trim() : "—";
            })() },
          ],
          details: (() => {
            const entries = Object.keys(r)
              .filter((k: string) => k.endsWith("_base") && Number((r as any)[k]))
              .map((k: string) => {
                const [y, mm, dd] = k.replace("_base", "").split("_");
                return { date: `${dd}.${mm}.${y}`, sortKey: `${y}${mm}${dd}`, value: Number((r as any)[k]) };
              })
              .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
            if (!entries.length) return null;
            return (
              <div className="space-y-1">
                {entries.map((e, i) => (
                  <div key={i} className="flex justify-between border-b border-dashed border-slate-200 pb-1 last:border-0 dark:border-slate-700">
                    <span className="text-muted-foreground">{e.date}</span>
                    <span className="font-medium tabular-nums">{Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(e.value)} {r.unit ?? ""}</span>
                  </div>
                ))}
              </div>
            );
          })(),
        })}
        onPrev={() => setPagination((p) => ({ ...p, pageIndex: Math.max(0, p.pageIndex - 1) }))}
        onNext={() => setPagination((p) => ({ ...p, pageIndex: p.pageIndex + 1 }))}
        canPrev={pageIndex > 0}
        canNext={data?.total ? (pageIndex + 1) * pageSize < data.total : mobileRows.length === pageSize}
        page={pageIndex}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Поиск по названию или артикулу..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {search && (
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setSearch("")}
          >
            Очистить
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowArticle((v) => !v)}
          className="h-9 shrink-0 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent"
        >
          {showArticle ? "Скрыть артикул" : "Артикул"}
        </button>
      </div>
      <div
        className={cn("incoming-sticky-wrapper rounded-md border relative overflow-x-auto", {
          visible: !showActualColumn,
          invisible: showActualColumn,
          "h-0": showActualColumn,
          "h-auto": !showActualColumn,
        })}
      >
        <Table className="min-w-[600px]">
          <TableHeader className="bg-slate-600 dark:bg-slate-100 z-20 sticky top-16">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="">
                {headerGroup.headers.map((header) => {
                  const { column } = header;
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      className="text-center border border-r-2 border-slate-400 bg-white text-slate-900 dark:text-zinc-100 dark:bg-slate-950"
                      style={{ ...getCommonPinningStyles(column) }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center relative"
                >
                  <div
                    role="status"
                    className="absolute -translate-x-1/2 -translate-y-1/2 top-2/4 left-1/2"
                  >
                    <svg
                      aria-hidden="true"
                      className="w-8 h-8 mr-2 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600"
                      viewBox="0 0 100 101"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                        fill="currentColor"
                      />
                      <path
                        d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                        fill="currentFill"
                      />
                    </svg>
                    <span className="sr-only">Loading...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                <TableRow
                  data-state={row.getIsSelected() && "selected"}
                  className="text-black cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900"
                  onClick={() => setExpandedRow(expandedRow === row.id ? null : row.id)}
                >
                  {row.getVisibleCells().map((cell) => {
                    const { column } = cell;
                    return (
                      <TableCell
                        key={cell.id}
                        className="border border-r-2 border-slate-400 text-center bg-white text-slate-900 dark:text-zinc-100 dark:bg-slate-950"
                        style={{ ...getCommonPinningStyles(column) }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {expandedRow === row.id && (
                  <TableRow>
                    <TableCell colSpan={row.getVisibleCells().length} className="bg-slate-50 dark:bg-slate-900 p-3 border-y-2 border-blue-300">
                      <PerDayDetails row={row.original as any} />
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div
        className={cn("incoming-sticky-wrapper rounded-md border relative overflow-x-auto", {
          invisible: !showActualColumn,
          visible: showActualColumn,
          "h-0": !showActualColumn,
          "h-auto": showActualColumn,
        })}
      >
        <Table className="min-w-[600px]">
          <TableHeader className="bg-slate-600 dark:bg-slate-100 z-20 sticky top-16">
            {tableWithActual.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="">
                {headerGroup.headers.map((header) => {
                  const { column } = header;
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      className="text-center border border-r-2 border-slate-400 bg-white text-slate-900 dark:text-zinc-100 dark:bg-slate-950"
                      style={{ ...getCommonPinningStyles(column) }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columnsWithActual.length}
                  className="h-24 text-center relative"
                >
                  <div
                    role="status"
                    className="absolute -translate-x-1/2 -translate-y-1/2 top-2/4 left-1/2"
                  >
                    <svg
                      aria-hidden="true"
                      className="w-8 h-8 mr-2 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600"
                      viewBox="0 0 100 101"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                        fill="currentColor"
                      />
                      <path
                        d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                        fill="currentFill"
                      />
                    </svg>
                    <span className="sr-only">Loading...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : tableWithActual.getRowModel().rows?.length ? (
              tableWithActual.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                <TableRow
                  data-state={row.getIsSelected() && "selected"}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900"
                  onClick={() => setExpandedRow(expandedRow === row.id ? null : row.id)}
                >
                  {row.getVisibleCells().map((cell) => {
                    const { column } = cell;
                    return (
                      <TableCell
                        key={cell.id}
                        className={`border border-r-2 border-slate-400 text-center text-slate-900 dark:text-zinc-100 ${checkMismatch(row) ? "bg-red-50 dark:bg-red-600" : "bg-white dark:bg-slate-950"}`}
                        style={{ ...getCommonPinningStyles(column) }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {expandedRow === row.id && (
                  <TableRow>
                    <TableCell colSpan={row.getVisibleCells().length} className="bg-slate-50 dark:bg-slate-900 p-3 border-y-2 border-blue-300">
                      <PerDayDetails row={row.original as any} showAct />
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columnsWithActual.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {/* <div className="h-2" /> */}
      <div className="flex flex-wrap gap-3 items-center justify-between pb-4 px-2 py-4">
        <div className="flex-1 text-sm text-muted-foreground"></div>
        <div className="flex items-center space-x-6 lg:space-x-8">
          <div className="flex items-center space-x-2">
            <p className="text-sm font-medium">Rows per page</p>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => {
                table.setPageSize(Number(value));
              }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue
                  placeholder={table.getState().pagination.pageSize}
                />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 30, 40, 50, 100, 200].map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex w-[100px] items-center justify-center text-sm font-medium">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {table.getPageCount()}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to first page</span>
            <DoubleArrowLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to last page</span>
            <DoubleArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
