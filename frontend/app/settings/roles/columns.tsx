"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@components/ui/button";
import PermissionsForm from "./form";
import { RouterOutputs } from "@frontend/utils/trpc";
import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";

export const rolesColumns: ColumnDef<
  RouterOutputs["roles"]["list"]["items"][0]
>[] = [
  {
    accessorKey: "active",
    header: "Активен",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-2">
          <Switch checked={record.active} readOnly />
        </div>
      );
    },
  },
  {
    accessorKey: "name",
    header: "Заголовок",
  },
  {
    accessorKey: "code",
    header: "Код",
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-2">
          <PermissionsForm recordId={record.id}>
            <Button variant="outline" size="sm">
              <Edit2Icon className="h-4 w-4" />
            </Button>
          </PermissionsForm>
          <DeleteAction recordId={record.id} />
        </div>
      );
    },
  },
];
