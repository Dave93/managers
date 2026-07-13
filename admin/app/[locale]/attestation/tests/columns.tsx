"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon, ListChecks } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import { Link } from "@admin/i18n/routing";
import DeleteAction from "./delete-action";
import AttestationTestFormSheet from "@admin/components/forms/attestation-test/sheet";
import { attestation_tests } from "@backend/../drizzle/schema";

export const attestationTestColumns: ColumnDef<
  typeof attestation_tests.$inferSelect
>[] = [
  {
    accessorKey: "active",
    header: "✓",
    cell: ({ row }) => <Switch checked={row.original.active} disabled />,
  },
  { accessorKey: "title", header: "Название" },
  { accessorKey: "passing_score", header: "%" },
  {
    id: "actions",
    cell: ({ row }) => {
      const record = row.original;
      return (
        <div className="flex items-center space-x-2">
          <Link href={`/attestation/tests/${record.id}/questions`}>
            <Button variant="outline" size="sm">
              <ListChecks className="h-4 w-4" />
            </Button>
          </Link>
          <AttestationTestFormSheet recordId={record.id}>
            <Button variant="outline" size="sm">
              <Edit2Icon className="h-4 w-4" />
            </Button>
          </AttestationTestFormSheet>
          <DeleteAction recordId={record.id} />
        </div>
      );
    },
  },
];
