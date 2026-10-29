"use client";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";

import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";
import ExternalPartnersFormSheet from "@admin/components/forms/external_partners/sheet";
import { externalPartners } from "@backend/../drizzle/schema";

export function useExternalPartnersColumns(): ColumnDef<typeof externalPartners.$inferSelect>[] {
  const t = useTranslations("systemPages.columns");
  return useMemo<ColumnDef<typeof externalPartners.$inferSelect>[]>(
    () => [
  {
    accessorKey: "is_active",
    header: t("active"),
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-2">
          <Switch checked={record.is_active ?? false} disabled />
        </div>
      );
    },
  },
  {
    accessorKey: "name",
    header: t("name"),
  },
  {
    accessorKey: "email",
    header: "Email",
  },
  {
    id: "actions",
    header: t("actions"),
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-2">
          <ExternalPartnersFormSheet recordId={record.id}>
            <Button variant="outline" size="sm">
              <Edit2Icon className="h-4 w-4" />
            </Button>
          </ExternalPartnersFormSheet>
          <DeleteAction recordId={record.id} />
        </div>
      );
    },
  },
    ],
    [t]
  );
}
