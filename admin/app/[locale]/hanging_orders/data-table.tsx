"use client";

import {
    ColumnDef,
    PaginationState,
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    useReactTable,
} from "@tanstack/react-table";

// Extend ColumnMeta to include sticky property
declare module '@tanstack/react-table' {
    interface ColumnMeta<TData, TValue> {
        sticky?: "left" | "right";
    }
}

import {
    Table,
    TableBody,
    TableCell,
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

import { hangingOrders } from "@backend/../drizzle/schema";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import { DateRange } from "react-day-picker";
import dayjs from "dayjs";

interface DataTableProps<TValue> {
    columns: ColumnDef<typeof hangingOrders.$inferSelect, TValue>[];
    searchTerm?: string;
    brandFilter?: string;
    statusFilter?: string;
    dateRange?: DateRange;
}

export function DataTable<TValue>({
    columns,
    searchTerm,
    brandFilter,
    statusFilter,
    dateRange,
}: DataTableProps<TValue>) {
    const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: 10,
    });

    // Create filters based on all filter parameters
    const filters = useMemo(() => {
        const filterArray = [];
        
        if (brandFilter && brandFilter !== "all") {
            filterArray.push({ field: "brand", operator: "eq", value: brandFilter });
        }
        
        if (statusFilter && statusFilter !== "all") {
            filterArray.push({ field: "status", operator: "eq", value: statusFilter });
        }
        
        if (searchTerm) {
            filterArray.push({ field: "orderId", operator: "contains", value: searchTerm });
        }
        
        if (dateRange?.from) {
            filterArray.push({ field: "date", operator: "gte", value: dayjs(dateRange.from).format('YYYY-MM-DD') });
        }
        
        if (dateRange?.to) {
            filterArray.push({ field: "date", operator: "lte", value: dayjs(dateRange.to).format('YYYY-MM-DD') });
        }
        return filterArray.length > 0 ? JSON.stringify(filterArray) : undefined;
    }, [brandFilter, statusFilter, searchTerm, dateRange]);

    const { data, isLoading } = useQuery({
        queryKey: [
            "hanging-orders",
            {
                limit: pageSize,
                offset: pageIndex * pageSize,
                ...(filters && { filters }),
            },
        ],
        queryFn: async () => {
            const queryParams: {
                limit: string;
                offset: string;
                sort: string;
                filters?: string;
            } = {
                limit: pageSize.toString(),
                offset: (pageIndex * pageSize).toString(),
                sort: "createdAt:desc",
            };
            
            if (filters) {
                queryParams.filters = filters;
            }
            
            const { data } = await apiClient.api["hanging-orders"].get({
                query: queryParams,
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
        // @ts-ignore
        columns: columns as ColumnDef<{ [x: string]: unknown; }, TValue>[],
        pageCount: data?.total ? Math.ceil(data.total / pageSize) : -1,
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
            <div className="rounded-md border overflow-x-auto">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => {
                            let stickyLeft = 0;
                            return (
                                <TableRow key={headerGroup.id}>
                                    {headerGroup.headers.map((header, index) => {
                                        const isSticky = header.column.columnDef.meta?.sticky === "left";
                                        let currentLeft = stickyLeft;
                                        
                                        // Рассчитываем позицию только для sticky колонок
                                        if (isSticky) {
                                            if (header.column.id === "brand") {
                                                currentLeft = 0;
                                                stickyLeft = 120;
                                            } else if (header.column.id === "conception") {
                                                currentLeft = 120;
                                                stickyLeft = 270;
                                            }
                                        }
                                        
                                        return (
                                            <TableHead 
                                                key={header.id}
                                                className={isSticky ? "sticky z-10 bg-background border-r shadow-sm" : ""}
                                                style={isSticky ? { 
                                                    left: `${currentLeft}px`,
                                                    minWidth: header.column.id === "brand" ? "120px" : "150px"
                                                } : {}}
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
                            );
                        })}
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
                            table.getRowModel().rows.map((row) => {
                                return (
                                    <TableRow
                                        key={row.id}
                                        data-state={row.getIsSelected() && "selected"}
                                    >
                                        {row.getVisibleCells().map((cell, index) => {
                                            const isSticky = cell.column.columnDef.meta?.sticky === "left";
                                            let currentLeft = 0;
                                            
                                            // Рассчитываем позицию только для sticky колонок
                                            if (isSticky) {
                                                if (cell.column.id === "brand") {
                                                    currentLeft = 0;
                                                } else if (cell.column.id === "conception") {
                                                    currentLeft = 120;
                                                }
                                            }
                                            
                                            return (
                                                <TableCell 
                                                    key={cell.id}
                                                    className={isSticky ? "sticky z-10 bg-background border-r shadow-sm" : ""}
                                                    style={isSticky ? { 
                                                        left: `${currentLeft}px`,
                                                        minWidth: cell.column.id === "brand" ? "120px" : "150px"
                                                    } : {}}
                                                >
                                                    {flexRender(
                                                        cell.column.columnDef.cell,
                                                        cell.getContext()
                                                    )}
                                                </TableCell>
                                            );
                                        })}
                                    </TableRow>
                                );
                            })
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={columns.length}
                                    className="h-24 text-center"
                                >
                                    Нет данных для отображения
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="h-2" />
            <div className="flex items-center justify-between px-2">
                <div className="flex-1 text-sm text-muted-foreground">
                    {data?.total && `Всего записей: ${data.total}`}
                </div>
                <div className="flex items-center space-x-6 lg:space-x-8">
                    <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium">Строк на странице</p>
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
                    Страница {table.getState().pagination.pageIndex + 1} из{" "}
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