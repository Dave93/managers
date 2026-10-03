"use client";

import {
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
} from "@components/ui/table";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  ALL,
  STAFF_ROLE_GROUPS,
  staffRolesApi,
  type StaffRole,
} from "@admin/lib/staff-roles";
import { useStaffRoleColumns } from "./columns";

// Пагинации здесь нет намеренно: справочник — тринадцать строк, и сервер
// отдаёт его целиком одним ответом. Листалка на таком списке была бы
// украшением, которое надо поддерживать.
export function DataTable() {
  const t = useTranslations("staffRoles");
  const columns = useStaffRoleColumns();

  const [search, setSearch] = useState("");
  const [debSearch, setDebSearch] = useState("");
  const [group, setGroup] = useState("");
  const [active, setActive] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["staff_roles", { search: debSearch, group, active }],
    queryFn: async () => {
      const res = await staffRolesApi.list({
        ...(debSearch ? { search: debSearch } : {}),
        ...(group ? { group } : {}),
        ...(active ? { active } : {}),
      });
      return (res?.data ?? []) as StaffRole[];
    },
  });

  const defaultData = useMemo<StaffRole[]>(() => [], []);

  const table = useReactTable({
    data: data ?? defaultData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("filters.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-[220px]"
        />
        <Select
          value={group || ALL}
          onValueChange={(v) => setGroup(v === ALL ? "" : v)}
        >
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue placeholder={t("columns.group")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
            {STAFF_ROLE_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>
                {t(`groups.${g}` as any)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={active || ALL}
          onValueChange={(v) => setActive(v === ALL ? "" : v)}
        >
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue placeholder={t("columns.active")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
            <SelectItem value="true">{t("filters.activeYes")}</SelectItem>
            <SelectItem value="false">{t("filters.activeNo")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="h-9"
          onClick={() => {
            setSearch("");
            setGroup("");
            setActive("");
          }}
        >
          {t("filters.reset")}
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
                <TableRow key={row.id} className={row.original.active ? "" : "opacity-60"}>
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
    </div>
  );
}
