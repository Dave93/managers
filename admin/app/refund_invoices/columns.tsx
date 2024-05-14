"use client";
import { ColumnDef } from "@tanstack/react-table";

import dayjs from "dayjs";
import { invoices } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";
import { Minus, Plus } from "lucide-react";

export const reportsColumns: ColumnDef<InferSelectModel<typeof invoices>>[] = [
  {
    accessorKey: "id",
    header: () => null,
    cell: ({ row }) => {
      return row.getCanExpand() ? (
        <button
          {...{
            onClick: row.getToggleExpandedHandler(),
            style: { cursor: "pointer" },
          }}
        >
          {row.getIsExpanded() ? <Minus /> : <Plus />}
        </button>
      ) : (
        "🔵"
      );
    },
  },
  {
    accessorKey: "incomingDocumentNumber",
    header: "Номер",
  },
  {
    accessorKey: "incomingDate",
    header: "Дата",
    cell: ({ row }) => {
      const record = row.original;
      return (
        <span>{dayjs(record.incomingDate!).format("DD.MM.YYYY HH:mm")}</span>
      );
    },
  },
];
