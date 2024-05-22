"use client";

import {
  CellContext,
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

import { useEffect, useMemo, useState } from "react";

import useToken from "@admin/store/get-token";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import { invoice_items } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";
import { InvoiceItemsListDto } from "@backend/modules/invoice_items/dto/list.dto";
import { useCanAccess } from "@admin/components/use-can-access";

interface DataTableProps<TData, TValue> {
  invoiceId: string;
  invoiceDate: string;
}

export function InvoiceItemsTable<TData, TValue>({
  invoiceId,
  invoiceDate,
}: DataTableProps<TData, TValue>) {
  const token = useToken();
  const isFranchiseAccess = useCanAccess("franchise_manager.list");
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 100,
  });

  const columns = useMemo(() => {
    if (!isFranchiseAccess) {
      return [
        {
          accessorKey: "productName",
          header: "Название",
        },
        {
          accessorKey: "unit",
          header: "Единица измерения",
        },
        {
          accessorKey: "amount",
          header: "Количество",
        },
      ];
    } else {
      return [
        {
          accessorKey: "productName",
          header: "Название",
        },
        {
          accessorKey: "unit",
          header: "Единица измерения",
        },
        {
          accessorKey: "amount",
          header: "Количество",
        },
        {
          accessorKey: "sum",
          header: "Сумма",
          cell: ({ row }: CellContext<InvoiceItemsListDto, any>) => {
            const record = row.original;

            return <span>{Intl.NumberFormat("ru-RU").format(record.sum)}</span>;
          },
        },
      ];
    }
  }, [isFranchiseAccess]);

  const filters = [
    {
      field: "invoice_id",
      operator: "eq",
      value: invoiceId,
    },
    {
      field: "invoiceincomingdate",
      operator: "eq",
      value: invoiceDate,
    },
  ];

  const { data, isLoading } = useQuery({
    enabled: !!token,
    queryKey: [
      "invoice_items",
      {
        limit: pageSize,
        offset: pageIndex * pageSize,
        filters,
      },
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.invoice_items.get({
        query: {
          limit: pageSize.toString(),
          offset: (pageIndex * pageSize).toString(),
          filters: JSON.stringify(filters),
          fields:
            "id,actualAmount,amount,productId,invoiceincomingdate,productName,supplierProductArticle,unit",
        },
        headers: {
          Authorization: `Bearer ${token}`,
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

  const totalSum = useMemo(() => {
    let totals = 0;
    data?.data?.forEach((item) => {
      totals += item.sum;
    });

    return totals;
  }, [data, columns]);
  //test
  return (
    <div className="space-y-4 items-center ">
      <div className="rounded-md border relative">
        <Table>
          <TableHeader className="z-50 sticky top-0">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const { column } = header;
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      className="text-center "
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
            {isFranchiseAccess && (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-slate-900 font-bold text-lg dark:text-zinc-100 "
                >
                  Итого
                </TableCell>

                <TableCell className="text-slate-900 font-bold text-center text-lg dark:text-zinc-100 ">
                  <span>{Intl.NumberFormat("ru-RU").format(totalSum)}</span>
                </TableCell>
              </TableRow>
            )}
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
                >
                  {row.getVisibleCells().map((cell) => {
                    const { column } = cell;
                    return (
                      <TableCell
                        key={cell.id}
                        className="text-center bg-white text-slate-900 dark:text-zinc-100 dark:bg-slate-950"
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
      <div className="h-2" />
    </div>
  );
}
