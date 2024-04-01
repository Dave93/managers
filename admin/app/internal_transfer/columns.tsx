"use client";
import { ColumnDef } from "@tanstack/react-table";

import dayjs from "dayjs";
import {
  invoices,
  internal_transfer,
  internal_transfer_items,
} from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";
import { Minus, Plus } from "lucide-react";

export const reportsColumns: ColumnDef<
  InferSelectModel<typeof internal_transfer>
>[] = [
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
    accessorKey: "fromStoreName",
    header: "Склад из",
  },
  {
    accessorKey: "toStoreName",
    header: "Склад в",
    // cell: ({ row }) => {
    //   const record = row.original;
    //   return (
    //     <span>
    //       {record.storeFromId} - {record.storeToId}
    //     </span>
    //     // <span>{dayjs(record.dateIncoming!).format("DD.MM.YYYY HH:mm")}</span>
    //   );
    // },
  },
];
