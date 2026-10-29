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

import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import RoleFilter from "./role-filter";
import { employees } from "@backend/../drizzle/schema";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";

import { TablePager } from "@admin/components/ui/table-pager";
interface DataTableProps<TValue> {
  columns: ColumnDef<typeof employees.$inferSelect, TValue>[];
}

export function DataTable<TValue>({ columns }: DataTableProps<TValue>) {
  const t = useTranslations("attestation.filters");
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

  // filter state (search/position debounced ~300ms)
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("");
  // Роль и свободный текст — РАЗНЫЕ параметры, а не один на двоих.
  //
  // Раньше список ролей писал название в ?position=, а тот ищет подстрокой:
  // «Повар» приводил 205 человек вместо 95. Теперь список шлёт ?staff_role_id=
  // с точным совпадением, а текстовое поле осталось для «ночь» и «2 разряд»,
  // которых в списке ролей нет. Гасить друг друга им больше незачем: вместе
  // они и означают «повара в ночь».
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [terminalId, setTerminalId] = useState("");
  const [active, setActive] = useState("");
  const [debSearch, setDebSearch] = useState("");
  const [debPosition, setDebPosition] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    const id = setTimeout(() => setDebPosition(position), 300);
    return () => clearTimeout(id);
  }, [position]);
  // any filter change → back to first page
  const roleParam = roleIds.join(",");
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [debSearch, debPosition, roleParam, terminalId, active]);

  const { data: terminalsData } = useQuery({
    queryKey: ["terminals_cached"],
    queryFn: () => apiClient.api.terminals.cached.get(),
  });
  const terminalList = [
    ...((terminalsData as any)?.data ?? terminalsData ?? []),
  ].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "ru"));

  const { data, isLoading } = useQuery({
    queryKey: [
      "attestation_employees",
      {
        limit: pageSize,
        offset: pageIndex * pageSize,
        search: debSearch,
        terminalId,
        position: debPosition,
        staff_role_id: roleParam,
        active,
      },
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.attestation.employees.get({
        query: {
          limit: pageSize.toString(),
          offset: (pageIndex * pageSize).toString(),
          ...(debSearch ? { search: debSearch } : {}),
          ...(terminalId ? { terminal_id: terminalId } : {}),
          ...(debPosition ? { position: debPosition } : {}),
          ...(roleParam ? { staff_role_id: roleParam } : {}),
          ...(active ? { active } : {}),
        },
      });
      return data;
    },
  });

  const resetFilters = () => {
    setSearch("");
    setPosition("");
    setRoleIds([]);
    setTerminalId("");
    setActive("");
  };

  const defaultData = useMemo(() => [], []);
  const pagination = useMemo(
    () => ({ pageIndex, pageSize }),
    [pageIndex, pageSize]
  );

  const table = useReactTable({
    data: data?.data ?? defaultData,
    columns,
    pageCount: data?.total ? Math.ceil(Number(data!.total!) / pageSize) : -1,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-[200px]"
        />
        <Select
          value={terminalId || "__all__"}
          onValueChange={(v) => setTerminalId(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="h-9 w-[220px]">
            <SelectValue placeholder={t("branch")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("all")}</SelectItem>
            {terminalList.map((term: any) => (
              <SelectItem key={term.id} value={term.id}>
                {term.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <RoleFilter value={roleIds} onChange={setRoleIds} />
        <Input
          placeholder={t("position")}
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          className="h-9 w-[160px]"
        />
        <Select
          value={active || "__all__"}
          onValueChange={(v) => setActive(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder={t("active")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("all")}</SelectItem>
            <SelectItem value="true">{t("activeYes")}</SelectItem>
            <SelectItem value="false">{t("activeNo")}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" className="h-9" onClick={resetFilters}>
          {t("reset")}
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
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
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  Loading...
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
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <TablePager
        pageIndex={table.getState().pagination.pageIndex}
        pageCount={table.getPageCount()}
        pageSize={table.getState().pagination.pageSize}
        total={data?.total}
        onPageChange={(i) => table.setPageIndex(i)}
        onPageSizeChange={(size) => table.setPageSize(size)}
      />
    </div>
  );
}
