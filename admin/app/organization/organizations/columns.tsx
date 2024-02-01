"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon, KeyRound } from "lucide-react";
import { Button } from "@components/ui/button";
import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";
import OrganizationsFormSheet from "@admin/components/forms/organizations/sheet";
import CanAccess from "@admin/components/can-access";
import CredentialsFormSheet from "@admin/components/forms/credentials/list_sheet";
import { organization } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export const organizationsColumns: ColumnDef<
  InferSelectModel<typeof organization>
>[] = [
  {
    accessorKey: "active",
    header: "Активен",
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
    accessorKey: "name",
    header: "Название",
  },
  {
    accessorKey: "code",
    header: "Код",
  },
  {
    accessorKey: "phone",
    header: "Телефон",
  },
  {
    accessorKey: "description",
    header: "Описание",
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-2">
          <CanAccess permission="organizations.edit">
            <OrganizationsFormSheet recordId={record.id}>
              <Button variant="outline" size="sm">
                <Edit2Icon className="h-4 w-4" />
              </Button>
            </OrganizationsFormSheet>
          </CanAccess>
          <CanAccess permission="organizations.delete">
            <DeleteAction recordId={record.id} />
          </CanAccess>
          <CredentialsFormSheet recordId={record.id} model="organization">
            <Button variant="secondary" size="sm">
              <KeyRound className="h-4 w-4" />
            </Button>
          </CredentialsFormSheet>
        </div>
      );
    },
  },
];
