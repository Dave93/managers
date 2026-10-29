"use client";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
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

type T = (key: string, values?: Record<string, string | number>) => string;

export function fmtDuration(t: T, totalSeconds: number): string {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return t("duration.daysHours", { days, hours });
  if (hours > 0) return t("duration.hoursMinutes", { hours, minutes });
  return t("duration.minutes", { minutes });
}

function severityClass(totalSeconds: number): string {
  const s = Number(totalSeconds) || 0;
  if (s >= 3 * 86400) return "text-red-600 dark:text-red-400 font-semibold";
  if (s >= 86400) return "text-orange-600 dark:text-orange-400 font-medium";
  return "";
}

const fmtTs = (iso: string) => dayjs(iso).format("DD.MM.YYYY HH:mm");

export function useStoplistColumns(): ColumnDef<StoplistRow>[] {
  const t = useTranslations("stoplistPage");
  return useMemo<ColumnDef<StoplistRow>[]>(() => [
  {
    accessorKey: "product_name",
    header: t("columns.product"),
    cell: ({ row }) => row.original.product_name ?? `#${row.original.product_id}`,
  },
  {
    accessorKey: "terminal_name",
    header: t("columns.terminal"),
    cell: ({ row }) => row.original.terminal_name ?? `#${row.original.terminal_id}`,
  },
  {
    accessorKey: "brand",
    header: t("columns.brand"),
    cell: ({ row }) => BRAND_LABEL[row.original.brand] ?? row.original.brand,
  },
  {
    accessorKey: "ended_at",
    header: t("columns.status"),
    cell: ({ row }) =>
      row.original.ended_at ? (
        <Badge variant="outline">{t("badges.released")}</Badge>
      ) : (
        <Badge variant="destructive">{t("badges.stopped")}</Badge>
      ),
  },
  {
    accessorKey: "started_at",
    header: t("columns.placed"),
    cell: ({ row }) => fmtTs(row.original.started_at),
  },
  {
    id: "ended_at_ts",
    accessorFn: (r) => r.ended_at,
    header: t("columns.released"),
    cell: ({ row }) => (row.original.ended_at ? fmtTs(row.original.ended_at) : "—"),
  },
  {
    accessorKey: "seconds_stopped",
    header: t("columns.duration"),
    cell: ({ row }) => (
      <span className={severityClass(row.original.seconds_stopped)}>
        {fmtDuration(t, row.original.seconds_stopped)}
      </span>
    ),
  },
  {
    accessorKey: "last_balance",
    header: t("columns.balance"),
    cell: ({ row }) =>
      row.original.last_balance == null ? "—" : String(row.original.last_balance),
  },
  ], [t]);
}
