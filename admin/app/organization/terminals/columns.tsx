"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon, KeyRound } from "lucide-react";
import { Button } from "@components/ui/button";
import { RouterOutputs } from "@admin/utils/trpc";
import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";
import OrganizationsFormSheet from "@admin/components/forms/organizations/sheet";
import CanAccess from "@admin/components/can-access";
import CredentialsFormSheet from "@admin/components/forms/credentials/list_sheet";

export const terminalsColumns: ColumnDef<
  RouterOutputs["terminals"]["list"]["items"][0]
>[] = [
  {
    accessorKey: "name",
    header: "Название",
  },
  {
    accessorKey: "phone",
    header: "Телефон",
  },
  // {
  //   accessorKey: "description",
  //   header: "Описание",
  // },
  {
    id: "actions",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-2">
          <CanAccess permission="terminals.edit">
            <OrganizationsFormSheet recordId={record.id}>
              <Button variant="outline" size="sm">
                <Edit2Icon className="h-4 w-4" />
              </Button>
            </OrganizationsFormSheet>
          </CanAccess>
          {/* <CanAccess permission="terminals.delete">
            <DeleteAction recordId={record.id} />
          </CanAccess> */}
          <CredentialsFormSheet recordId={record.id} model="terminals">
            <Button variant="secondary" size="sm">
              <KeyRound className="h-4 w-4" />
            </Button>
          </CredentialsFormSheet>
        </div>
      );
    },
  },
];
