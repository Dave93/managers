"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@components/ui/button";

import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";
import CanAccess from "@admin/components/can-access";
import CredentialsAddFormSheet from "./form_sheet";
import { credentials } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";

export const credentialsColumns: ColumnDef<
  InferSelectModel<typeof credentials>
>[] = [
  {
    accessorKey: "key",
    header: "Ключ",
  },
  {
    accessorKey: "type",
    header: "Тип",
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-2">
          <CanAccess permission="credentials.edit">
            <CredentialsAddFormSheet
              credentialId={record.id}
              recordId={record.model_id}
              model={record.model}
            >
              <Button variant="outline" size="sm">
                <Edit2Icon className="h-4 w-4" />
              </Button>
            </CredentialsAddFormSheet>
          </CanAccess>
          <CanAccess permission="credentials.delete">
            <DeleteAction recordId={record.id} />
          </CanAccess>
        </div>
      );
    },
  },
];
