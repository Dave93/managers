"use client";
import { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { Badge } from "@admin/components/ui/badge";

type PlaygroundTicket = {
  id: string;
  terminal_name: string | null;
  order_number: string;
  order_amount: number;
  children_count: number;
  is_used: boolean;
  used_at: string | null;
  created_at: string;
};

export const playgroundTicketsColumns: ColumnDef<PlaygroundTicket>[] = [
  {
    accessorKey: "id",
    header: "ID",
    cell: ({ row }) => {
      return <span className="font-mono">{row.original.id.substring(0, 8)}</span>;
    },
  },
  {
    accessorKey: "terminal_name",
    header: "Терминал",
  },
  {
    accessorKey: "order_number",
    header: "Номер заказа",
  },
  {
    accessorKey: "order_amount",
    header: "Сумма",
    cell: ({ row }) => {
      return (
        <span>
          {Intl.NumberFormat("ru-RU").format(row.original.order_amount)} сум
        </span>
      );
    },
  },
  {
    accessorKey: "children_count",
    header: "Кол-во детей",
  },
  {
    accessorKey: "is_used",
    header: "Статус",
    cell: ({ row }) => {
      const isUsed = row.original.is_used;
      return (
        <Badge variant={isUsed ? "destructive" : "default"}>
          {isUsed ? "Использован" : "Активен"}
        </Badge>
      );
    },
  },
  {
    accessorKey: "created_at",
    header: "Дата создания",
    cell: ({ row }) => {
      return <span>{dayjs(row.original.created_at).format("DD.MM.YYYY HH:mm")}</span>;
    },
  },
  {
    accessorKey: "used_at",
    header: "Дата использования",
    cell: ({ row }) => {
      const usedAt = row.original.used_at;
      return usedAt ? (
        <span>{dayjs(usedAt).format("DD.MM.YYYY HH:mm")}</span>
      ) : (
        <span>—</span>
      );
    },
  },
];
