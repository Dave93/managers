"use client";
import { ColumnDef } from "@tanstack/react-table";
import { permissions } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";
import { RolesPermissionsRelation } from "@backend/modules/roles_permissions/dto/roles_permissions.dto";
import { CheckIcon } from "lucide-react";

export const rolesPermissionsColumns: ColumnDef<RolesPermissionsRelation>[] = [
  {
    accessorKey: "name",
    cell: ({ row }) => {
      const record = row.original;
      return record.permissions.description;
    },
    header: "Заголовок",
  },
];

export const linkedRolesPermissionsColumns: ColumnDef<
  InferSelectModel<typeof permissions>
>[] = [
  {
    accessorKey: "selected",
    header: "",
    cell: ({ row }) => {
      const isSelected = row.getIsSelected();
      return isSelected ? <CheckIcon className="h-4 w-4" /> : null;
    },
  },
  {
    accessorKey: "name",
    cell: ({ row }) => {
      const record = row.original;
      return record.description;
    },
    header: "Заголовок",
  },
];
