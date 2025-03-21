"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import UsersFormSheet from "@components/forms/users/sheet";

import { Badge } from "@components/ui/badge";
import { users } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export const usersColumns: ColumnDef<typeof users.$inferSelect>[] = [
  {
    accessorKey: "status",
    header: "Статус",
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
    header: "Логин",
  },
  {
    accessorKey: "first_name",
    header: "Имя",
  },
  {
    accessorKey: "last_name",
    header: "Фамилия",
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
];
