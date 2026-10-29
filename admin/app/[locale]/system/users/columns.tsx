"use client";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import UsersFormSheet from "@components/forms/users/sheet";

import { Badge } from "@components/ui/badge";
import { users } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export function useUsersColumns(): ColumnDef<typeof users.$inferSelect>[] {
  const t = useTranslations("systemPages.columns");
  return useMemo<ColumnDef<typeof users.$inferSelect>[]>(
    () => [
  {
    accessorKey: "status",
    header: t("status"),
    cell: ({ row }) => {
      const record = row.original;

      return (
        <Badge variant={record.status === "active" ? "default" : "destructive"}>
          {record.status}
        </Badge>
      );
    },
  },
  {
    accessorKey: "login",
    header: t("login"),
  },
  {
    accessorKey: "first_name",
    header: t("firstName"),
  },
  {
    accessorKey: "last_name",
    header: t("lastName"),
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-2">
          <UsersFormSheet recordId={record.id}>
            <Button variant="outline" size="sm">
              <Edit2Icon className="h-4 w-4" />
            </Button>
          </UsersFormSheet>
        </div>
      );
    },
  },
    ],
    [t]
  );
}
