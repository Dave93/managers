"use client";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";
import RolesFormSheet from "@admin/components/forms/roles/sheet";
import CanAccess from "@admin/components/can-access";
import { roles } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export function useRolesColumns(): ColumnDef<typeof roles.$inferSelect>[] {
  const t = useTranslations("systemPages.columns");
  return useMemo<ColumnDef<typeof roles.$inferSelect>[]>(
    () => [
  {
    accessorKey: "active",
    header: t("active"),
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-2">
          <Switch checked={record.active} disabled />
        </div>
      );
    },
  },
  {
    accessorKey: "name",
    header: t("title"),
  },
  {
    accessorKey: "code",
    header: t("code"),
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-2">
          <RolesFormSheet recordId={record.id}>
            <Button variant="outline" size="sm">
              <Edit2Icon className="h-4 w-4" />
            </Button>
          </RolesFormSheet>
          <CanAccess permission="roles.delete">
            <DeleteAction recordId={record.id} />
          </CanAccess>
        </div>
      );
    },
  },
    ],
    [t]
  );
}
