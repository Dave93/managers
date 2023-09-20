"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon, KeyRound } from "lucide-react";
import { Button } from "@components/ui/button";
import { RouterOutputs } from "@admin/utils/trpc";
import dayjs from "dayjs";
import { Badge } from "@admin/components/ui/badge";

export const reportsColumns: ColumnDef<
  RouterOutputs["reports"]["list"]["items"][0]
>[] = [
  {
    accessorKey: "date",
    header: "Дата",
    cell: ({ row }) => {
      const record = row.original;
      return <span>{dayjs(record.date).format("DD.MM.YYYY")}</span>;
    },
  },
  {
    accessorKey: "status_id",
    header: "Статус",
    cell: ({ row }) => {
      const record = row.original;

      return <Badge variant="default">{record.reports_status_id.label}</Badge>;
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const record = row.original;

      return <div className="flex items-center space-x-2"></div>;
    },
  },
];
