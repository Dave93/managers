"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon, KeyRound } from "lucide-react";
import { Button } from "@components/ui/button";

import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";
import OrganizationsFormSheet from "@admin/components/forms/organizations/sheet";
import CanAccess from "@admin/components/can-access";
import CredentialsFormSheet from "@admin/components/forms/credentials/list_sheet";
import { terminals } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export const terminalsColumns: ColumnDef<InferSelectModel<typeof terminals>>[] =
  [
    {
      accessorKey: "name",
      header: "Название",
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
