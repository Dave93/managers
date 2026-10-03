"use client";
import { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { Badge } from "@admin/components/ui/badge";

export type StoplistRow = {
  id: string;
  brand: string;
  terminal_id: number;
  terminal_name: string | null;
  product_id: number;
  product_name: string | null;
  started_at: string;
  ended_at: string | null;
  last_balance: number | null;
  seconds_stopped: number;
};

const BRAND_LABEL: Record<string, string> = {
  les: "Les Ailes",
  chopar: "Chopar",
};

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

function severityClass(totalSeconds: number): string {
  const s = Number(totalSeconds) || 0;
  if (s >= 3 * 86400) return "text-red-600 dark:text-red-400 font-semibold";
  if (s >= 86400) return "text-orange-600 dark:text-orange-400 font-medium";
  return "";
}

const fmtTs = (iso: string) => dayjs(iso).format("DD.MM.YYYY HH:mm");

export const stoplistColumns: ColumnDef<StoplistRow>[] = [
  {
    accessorKey: "product_name",
    header: "Продукт",
    cell: ({ row }) => row.original.product_name ?? `#${row.original.product_id}`,
  },
  {
    accessorKey: "terminal_name",
    header: "Филиал",
    cell: ({ row }) => row.original.terminal_name ?? `#${row.original.terminal_id}`,
  },
  {
    accessorKey: "brand",
    header: "Бренд",
    cell: ({ row }) => BRAND_LABEL[row.original.brand] ?? row.original.brand,
  },
  {
    accessorKey: "ended_at",
    header: "Статус",
    cell: ({ row }) =>
      row.original.ended_at ? (
        <Badge variant="outline">Снят</Badge>
      ) : (
        <Badge variant="destructive">В стопе</Badge>
      ),
  },
  {
    accessorKey: "started_at",
    header: "Поставлен",
    cell: ({ row }) => fmtTs(row.original.started_at),
  },
  {
    id: "ended_at_ts",
    accessorFn: (r) => r.ended_at,
    header: "Снят",
    cell: ({ row }) => (row.original.ended_at ? fmtTs(row.original.ended_at) : "—"),
  },
  {
    accessorKey: "seconds_stopped",
    header: "Длительность",
    cell: ({ row }) => (
      <span className={severityClass(row.original.seconds_stopped)}>
        {fmtDuration(row.original.seconds_stopped)}
      </span>
    ),
  },
  {
    accessorKey: "last_balance",
    header: "Остаток",
    cell: ({ row }) =>
      row.original.last_balance == null ? "—" : String(row.original.last_balance),
  },
];
