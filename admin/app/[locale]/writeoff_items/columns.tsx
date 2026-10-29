"use client";
import { ColumnDef } from "@tanstack/react-table";

import dayjs from "dayjs";
import { Stoplist } from "@backend/modules/stoplist/dto/list.dto";
import { Badge } from "@admin/components/ui/badge";

export const getReportsColumns = (t: (key: string) => string): ColumnDef<Stoplist>[] => [
  {
    accessorKey: "productName",
    header: t("stoplistColumns.product"),
  },
  {
    accessorKey: "categoryName",
    header: t("stoplistColumns.category"),
  },
  {
    accessorKey: "terminalName",
    header: t("stoplistColumns.terminal"),
  },
  {
    accessorKey: "status",
    header: t("stoplistColumns.status"),
    cell: ({ row }) => {
      const record = row.original;
      return record.status == "stop" ? (
        <Badge variant="destructive">{t("stoplistColumns.onStop")}</Badge>
      ) : (
        <Badge variant="default">{t("stoplistColumns.available")}</Badge>
      );
    },
  },
  {
    accessorKey: "dateAdd",
    header: t("stoplistColumns.dateAdded"),
    cell: ({ row }) => {
      const record = row.original;
      return <span>{dayjs(record.dateAdd).format("DD.MM.YYYY HH:mm")}</span>;
    },
  },
  {
    accessorKey: "dateRemoved",
    header: t("stoplistColumns.dateRemoved"),
    cell: ({ row }) => {
      const record = row.original;
      return (
        <span>
          {record.dateRemoved
            ? dayjs(record.dateRemoved).format("DD.MM.YYYY HH:mm")
            : t("stoplistColumns.notRemoved")}
        </span>
      );
    },
  },
  {
    accessorKey: "difference",
    header: t("stoplistColumns.difference"),
    cell: ({ row }) => {
      const record = row.original;

      let difference = record.difference
        ? record.difference
        : dayjs().diff(dayjs(record.dateAdd), "minute");

      const totalHours = parseInt((difference / 60).toString());
      const totalMins = dayjs().minute(difference).format("mm");
      return `${totalHours}:${totalMins}`;
    },
  },
  {
    accessorKey: "reason",
    header: t("stoplistColumns.reason"),
  },
];
