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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";

import { Button } from "@admin/components/ui/buttonOrigin";

import { useMemo, useState } from "react";
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

import { ReportsWithRelations } from "@backend/modules/reports/dto/list.dto";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import { parseAsIsoDateTime } from "nuqs";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useReportsStatusesFilter } from "@admin/components/filters/reports-statuses/reports-statuses.hook";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<ReportsWithRelations, TValue>[];
}

export function DataTable<TData, TValue>({
  columns,
}: DataTableProps<TData, TValue>) {
  const now = new Date();
  const { dateRange } = useDateRangeState();
  const { startDate, endDate } = useMemo(() => {
    if (dateRange) {
      return {
        startDate: dateRange.from!,
        endDate: dateRange.to!,
      };
    }
    return { startDate: new Date(), endDate: new Date() };
  }, [dateRange]);
  const [terminals] = useTerminalsFilter();
  const [selectedStatus] = useReportsStatusesFilter();
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

  const filters = useMemo(() => {
    let res = [];
    res.push({
      field: "date",
      operator: "gte",
      value: startDate,
    });
    res.push({
      field: "date",
      operator: "lte",
      value: endDate,
    });
    if (terminals && terminals.length > 0) {
      res.push({
        field: "terminal_id",
        operator: "in",
        value: terminals,
      });
    }
    if (selectedStatus) {
      res.push({
        field: "status_id",
        operator: "eq",
        value: selectedStatus,
      });
    }
    return res;
  }, [startDate, endDate, terminals, selectedStatus]);

  const { data, isLoading } = useQuery({
    queryKey: [
      "reports",
      {
        limit: pageSize,
        offset: pageIndex * pageSize,
        fields:
          "id,date,reports_status.color,reports_status.label,terminals.name,users.first_name,users.last_name,total_amount,total_manager_price,difference,arryt_income,status_id",
        filters: JSON.stringify(filters),
      },
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.reports.get({
        query: {
          limit: pageSize.toString(),
          offset: (pageIndex * pageSize).toString(),
          fields:
            "id,date,reports_status.color,reports_status.label,terminals.name,users.first_name,users.last_name,total_amount,total_manager_price,difference,arryt_income,status_id",
          filters: JSON.stringify(filters),
        },
      });
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

  const table = useReactTable({
    data: data?.data ?? defaultData,
    columns,

    pageCount: data?.total ? Math.ceil(data!.total! / pageSize) : -1,
    state: {
      pagination,
    },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getPaginationRowModel: getPaginationRowModel(),
  });

  const totalAmount = useMemo(() => {
    if (data && data.data && Array.isArray(data.data)) {
      return data.data.reduce((acc, row) => {
        return acc + Number(row.total_amount);
      }, 0);
    } else {
      return 0;
    }
  }, [data]);

  const totalManager = useMemo(() => {
    if (data && data.data && Array.isArray(data.data)) {
      return data.data.reduce((acc, row) => {
        return acc + Number(row.total_manager_price);
      }, 0);
    } else {
      return 0;
    }
  }, [data]);

  const totalDifference = useMemo(() => {
    if (data && data.data && Array.isArray(data.data)) {
      return data.data.reduce((acc, row) => {
        return acc + Number(row.difference);
      }, 0);
    } else {
      return 0;
    }
  }, [data]);

  const totalArrytIncome = useMemo(() => {
    if (data && data.data && Array.isArray(data.data)) {
      return data.data.reduce((acc, row) => {
        return acc + Number(row.arryt_income);
      }, 0);
    } else {
      return 0;
    }
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
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
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
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
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          <TableFooter className="font-bold uppercase">
            <TableRow className="text-black">
              <TableCell>
                <div>Итого</div>
              </TableCell>
              <TableCell colSpan={3}></TableCell>
              <TableCell>
                {Intl.NumberFormat("ru-RU").format(totalAmount ?? 0)}
              </TableCell>
              <TableCell>
                {Intl.NumberFormat("ru-RU").format(totalManager ?? 0)}
              </TableCell>
              <TableCell>
                {Intl.NumberFormat("ru-RU").format(totalDifference ?? 0)}
              </TableCell>
              <TableCell>
                {Intl.NumberFormat("ru-RU").format(totalArrytIncome ?? 0)}
              </TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <div className="h-2" />
      <div className="flex items-center justify-between px-2">
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
                {[10, 20, 30, 40, 50].map((pageSize) => (
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
