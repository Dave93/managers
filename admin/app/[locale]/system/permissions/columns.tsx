"use client";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";

import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";
import PermissionsFormSheet from "@admin/components/forms/permissions/sheet";
import { permissions } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export function usePermissionsColumns(): ColumnDef<typeof permissions.$inferSelect>[] {
  const t = useTranslations("systemPages.columns");
  return useMemo<ColumnDef<typeof permissions.$inferSelect>[]>(
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
      accessorKey: "slug",
      header: t("code"),
    },
    {
      accessorKey: "description",
      header: t("description"),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const record = row.original;

        return (
          <div className="flex items-center space-x-2">
            <PermissionsFormSheet recordId={record.id}>
              <Button variant="outline" size="sm">
                <Edit2Icon className="h-4 w-4" />
              </Button>
            </PermissionsFormSheet>
            <DeleteAction recordId={record.id} />
          </div>
        );
      },
    },
      ],
    [t]
  );
}
