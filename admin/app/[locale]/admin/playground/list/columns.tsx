"use client";
import { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
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

export const usePlaygroundTicketsColumns = (): ColumnDef<PlaygroundTicket>[] => {
  const t = useTranslations("playgroundUi");
  return useMemo(
    () => [
      {
        accessorKey: "id",
        header: "ID",
        cell: ({ row }) => {
          return <span className="font-mono">{row.original.id.substring(0, 8)}</span>;
        },
      },
      {
        accessorKey: "terminal_name",
        header: t("columns.terminal"),
      },
      {
        accessorKey: "order_number",
        header: t("columns.orderNumber"),
      },
      {
        accessorKey: "order_amount",
        header: t("columns.amount"),
        cell: ({ row }) => {
          return (
            <span>
              {Intl.NumberFormat("ru-RU").format(row.original.order_amount)} {t("currency")}
            </span>
          );
        },
      },
      {
        accessorKey: "children_count",
        header: t("columns.childrenCount"),
      },
      {
        accessorKey: "is_used",
        header: t("columns.status"),
        cell: ({ row }) => {
          const isUsed = row.original.is_used;
          return (
            <Badge variant={isUsed ? "destructive" : "default"}>
              {isUsed ? t("status.used") : t("status.active")}
            </Badge>
          );
        },
      },
      {
        accessorKey: "created_at",
        header: t("columns.createdAt"),
        cell: ({ row }) => {
          return <span>{dayjs(row.original.created_at).format("DD.MM.YYYY HH:mm")}</span>;
        },
      },
      {
        accessorKey: "used_at",
        header: t("columns.usedAt"),
        cell: ({ row }) => {
          const usedAt = row.original.used_at;
          return usedAt ? (
            <span>{dayjs(usedAt).format("DD.MM.YYYY HH:mm")}</span>
          ) : (
            <span>—</span>
          );
        },
      },
    ],
    [t]
  );
};
