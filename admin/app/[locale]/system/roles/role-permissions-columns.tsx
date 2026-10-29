"use client";
import { ColumnDef } from "@tanstack/react-table";
import { permissions } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";
import { RolesPermissionsRelation } from "@backend/modules/roles_permissions/dto/roles_permissions.dto";
import { CheckIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

export function useRolesPermissionsColumns(): ColumnDef<RolesPermissionsRelation>[] {
  const t = useTranslations("systemPages.columns");
  return useMemo<ColumnDef<RolesPermissionsRelation>[]>(
    () => [
      {
        accessorKey: "name",
        cell: ({ row }) => {
          const record = row.original;
          return record.permissions.description;
        },
        header: t("title"),
      },
    ],
    [t]
  );
}

export function useLinkedRolesPermissionsColumns(): ColumnDef<
  typeof permissions.$inferSelect
>[] {
  const t = useTranslations("systemPages.columns");
  return useMemo<ColumnDef<typeof permissions.$inferSelect>[]>(
    () => [
      {
        accessorKey: "selected",
        header: "",
        cell: ({ row }) => {
          const isSelected = row.getIsSelected();
          return isSelected ? <CheckIcon className="h-4 w-4" /> : null;
        },
      },
      {
        accessorKey: "name",
        cell: ({ row }) => {
          const record = row.original;
          return record.description;
        },
        header: t("title"),
      },
    ],
    [t]
  );
}
