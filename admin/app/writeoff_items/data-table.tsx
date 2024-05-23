"use client";

import {
  Column,
  ColumnDef,
  PaginationState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";

import { Button } from "@components/ui/button";

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

import { ReportsWithRelations } from "@backend/modules/reports/dto/list.dto";
import useToken from "@admin/store/get-token";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import { Stoplist } from "@backend/modules/stoplist/dto/list.dto";
import { useStoplistFilterStore } from "./filters_store";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<Stoplist, TValue>[];
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

export function DataTable<TData, TValue>() {
  const date = useStoplistFilterStore((state) => state.date);
  const storeId = useStoplistFilterStore((state) => state.storeId);
  const productType = useStoplistFilterStore((state) => state.productType);
  const token = useToken();
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

  const filters = useMemo(() => {
    let res: {
      field: string;
      operator: string;
      value: string | string[];
    }[] = [];

    if (date?.from) {
      res.push({
        field: "writeoffincomingdate",
        operator: "gte",
        value: dayjs(date.from).startOf("day").add(5, "hour").toISOString(),
      });
    }

    if (date?.to) {
      res.push({
        field: "writeoffincomingdate",
        operator: "lte",
        value: dayjs(date.to).endOf("day").add(5, "hour").toISOString(),
      });
    }

    if (storeId) {
      res.push({
        field: "writeoff.storeId",
        operator: "eq",
        value: storeId,
      });
    }

    if (productType) {
      res.push({
        field: "nomenclature_element.type",
        operator: "in",
        value: productType.split("/"),
      });
    }
    // console.log(date);
    return JSON.stringify(res);
  }, [date, storeId, productType]);
  // console.log("date", date);
  const { data, isLoading } = useQuery({
    enabled: !!token && !!date,
    queryKey: [
      "writeoff",
      {
        limit: pageSize,
        offset: pageIndex * pageSize,
        filters,
      },
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.writeoff_items.get({
        query: {
          limit: pageSize.toString(),
          offset: (pageIndex * pageSize).toString(),
          filters,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      // console.log("data", data);
      return data;
    },
  });

  const defaultData = useMemo(() => [], []);

  const pagination = useMemo(
    () => ({
      pageIndex,
      pageSize,
    }),
    [pageIndex, pageSize]
  );

  const columnHelper = createColumnHelper();

  const columns = useMemo(() => {
    let cols: ColumnDef<Stoplist, TValue>[] = [
      {
        accessorKey: "name",
        header: "Название",
        enablePinning: true,
      },
      {
        accessorKey: "supplierProductArticle",
        header: "Артикул",
      },
      {
        accessorKey: "unit",
        header: "Единица измерения",
      },
    ];

    if (date && date.from && date.to) {
      let from = dayjs(date.from);
      let to = dayjs(date.to).add(1, "day");
      for (var m = from; m.isBefore(to); m = m.add(1, "day")) {
        cols.push({
          accessorKey: m.format("YYYY_MM_DD"),
          header: m.format("DD.MM.YYYY"),
          enablePinning: true,
          cell: (info) =>
            info.getValue()
              ? (Math.round(+info.getValue() * 1000) / 1000).toFixed(3)
              : "",
        });
      }
    }
    return cols;
  }, [date]);

  const table = useReactTable({
    data: data?.data ?? defaultData,
    // @ts-ignore
    columns,
    pageCount: 1000000,
    state: {
      pagination,
      rowPinning: {
        top: ["name"],
      },
    },
    enablePinning: true,
    enableRowPinning: true,
    enableColumnPinning: true,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getPaginationRowModel: getPaginationRowModel(),
  });

  useEffect(() => {
    table.setColumnPinning({
      left: ["name"],
    });
  }, [table]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border relative ">
        <Table wrapperClassName="h-screen">
          <TableHeader className="bg-slate-600 dark:bg-slate-100 z-50 sticky top-0">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
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
                  className="h-24 text-center relative "
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
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="text-black"
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
      {/* <div className="h-2" /> */}
      <div className="flex h-24 items-center justify-between pb-4 px-2">
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
