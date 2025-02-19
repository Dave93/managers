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
import { InternalTransferListDto } from "@backend/modules/internal_transfer/dto/list.dto";

export const reportsColumns: ColumnDef<InternalTransferListDto>[] = [
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
    accessorKey: "documentNumber",
    header: "Документ",
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
  {
    accessorKey: "dateIncoming",
    header: "Дата",
    cell: ({ row }) => {
      const record = row.original;
      return (
        <span>{dayjs(record.dateIncoming!).format("DD.MM.YYYY HH:mm")}</span>
      );
    },
  },
];
