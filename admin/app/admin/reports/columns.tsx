"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon, KeyRound } from "lucide-react";
import { Button } from "@components/ui/button";
import { RouterOutputs } from "@admin/utils/trpc";
import OrganizationsFormSheet from "@admin/components/forms/organizations/sheet";
import CanAccess from "@admin/components/can-access";
import CredentialsFormSheet from "@admin/components/forms/credentials/list_sheet";

export const reportsColumns: ColumnDef<
  RouterOutputs["reports"]["list"]["items"][0]
>[] = [
  {
    accessorKey: "date",
    header: "Дата",
  },
  {
    accessorKey: "status_id",
    header: "Статус",
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const record = row.original;

      return <div className="flex items-center space-x-2"></div>;
    },
  },
];
