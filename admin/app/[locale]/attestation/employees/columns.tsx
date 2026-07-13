"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";
import AttestationEmployeeFormSheet from "@admin/components/forms/attestation-employee/sheet";
import { employees } from "@backend/../drizzle/schema";

export const attestationEmployeeColumns: ColumnDef<
  typeof employees.$inferSelect
>[] = [
  {
    accessorKey: "active",
    header: "✓",
    cell: ({ row }) => <Switch checked={row.original.active} disabled />,
  },
  { accessorKey: "first_name", header: "Имя" },
  { accessorKey: "last_name", header: "Фамилия" },
  { accessorKey: "position", header: "Должность" },
  {
    id: "actions",
    cell: ({ row }) => (
      <div className="flex items-center space-x-2">
        <AttestationEmployeeFormSheet recordId={row.original.id}>
          <Button variant="outline" size="sm">
            <Edit2Icon className="h-4 w-4" />
          </Button>
        </AttestationEmployeeFormSheet>
        <DeleteAction recordId={row.original.id} />
      </div>
    ),
  },
];
