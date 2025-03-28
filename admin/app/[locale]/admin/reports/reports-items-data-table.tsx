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

import { useMemo, useState } from "react";

import { ReportsItemsWithRelation } from "@backend/modules/reports_items/dto/list.dto";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<ReportsItemsWithRelation, TValue>[];
  recordId: string;
}

export function DataTable<TData, TValue>({
  columns,
  recordId,
}: DataTableProps<TData, TValue>) {
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });

  const { data, isLoading } = useQuery({
    queryKey: [
      "reports_items",
      {
        limit: pageSize,
        offset: pageIndex * pageSize,
        fields: "id,group_id,label,type,amount,source,reports_status.code",
        filters: JSON.stringify([
          {
            field: "report_id",
            operator: "eq",
            value: recordId,
          },
        ]),
      },
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.reports_items.get({
        query: {
          limit: pageSize.toString(),
          offset: (pageIndex * pageSize).toString(),
          fields: "id,group_id,label,type,amount,source,reports_status.code",
          filters: JSON.stringify([
            {
              field: "report_id",
              operator: "eq",
              value: recordId,
            },
          ]),
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

  const incomeTotal = useMemo(() => {
    let total = 0;
    if (data && data.data && Array.isArray(data.data)) {
      data.data.forEach((item) => {
        if (item.type === "income") {
          // @ts-ignore
          total += item.amount;
        }
      });
    }
    return total;
  }, [data]);

  const outcomeTotal = useMemo(() => {
    let total = 0;

    if (data && data.data && Array.isArray(data.data)) {
      data.data.forEach((item) => {
        if (item.type === "outcome") {
          // @ts-ignore
          total += item.amount;
        }
      });
    }
    return total;
  }, [data]);

  const total = useMemo(() => {
    let total = 0;
    // @ts-ignore
    if (data && data.data && Array.isArray(data.data)) {
      data.data.forEach((item) => {
        // @ts-ignore
        total += item.amount;
      });
    }
    return total;
  }, [data]);

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
        </Table>
      </div>

      <div className="flex justify-between border-b-2 pb-1 font-bold">
        <div>Приход</div>
        <div>{Intl.NumberFormat("ru-RU").format(incomeTotal)}</div>
      </div>
      <div className="flex justify-between border-b-2 pb-1 font-bold">
        <div>Расход</div>
        <div>{Intl.NumberFormat("ru-RU").format(outcomeTotal)}</div>
      </div>
      <div className="flex justify-between border-b-2 pb-1 font-bold">
        <div>Итого</div>
        <div>{Intl.NumberFormat("ru-RU").format(total)}</div>
      </div>
    </div>
  );
}
