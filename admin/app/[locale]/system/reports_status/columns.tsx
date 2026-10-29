"use client";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";

import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";
import ReportsStatusFormSheet from "@admin/components/forms/reports_status/sheet";
import { reports_status } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export function useReportsStatusColumns(): ColumnDef<typeof reports_status.$inferSelect>[] {
  const t = useTranslations("systemPages.columns");
  return useMemo<ColumnDef<typeof reports_status.$inferSelect>[]>(
    () => [
    // {
    //   accessorKey: "active",
    //   header: "Активен",
    //   cell: ({ row }) => {
    //     const record = row.original;

    //     return (
    //       <div className="flex items-center space-x-2">
    //         <Switch />
    //       </div>
    //     );
    //   },
    // },
    {
      accessorKey: "code",
      header: t("code"),
    },
    {
      accessorKey: "label",
      header: t("statusLabel"),
    },
    {
      accessorKey: "color",
      header: t("color"),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const record = row.original;

        return (
          <div className="flex items-center space-x-2">
            <ReportsStatusFormSheet recordId={record.id}>
              <Button variant="outline" size="sm">
                <Edit2Icon className="h-4 w-4" />
              </Button>
            </ReportsStatusFormSheet>
            <DeleteAction recordId={record.id} />
          </div>
        );
      },
    },
      ],
    [t]
  );
}
