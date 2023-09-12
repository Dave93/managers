"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@components/ui/button";
import { RouterOutputs } from "@admin/utils/trpc";
import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";
import ReportsStatusFormSheet from "@admin/components/forms/reports_status/sheet";

export const reportsStatusColumns: ColumnDef<
  RouterOutputs["reportsStatus"]["list"]["items"][0]
>[] = [
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
    header: "Код",
  },
  {
    accessorKey: "label",
    header: "Названия статуса",
  },
  {
    accessorKey: "color",
    header: "Цвет",
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
];
