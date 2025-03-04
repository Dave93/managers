"use client";
import { ColumnDef } from "@tanstack/react-table";

import dayjs from "dayjs";
import { Stoplist } from "@backend/modules/stoplist/dto/list.dto";
import { Badge } from "@admin/components/ui/badge";

export const reportsColumns: ColumnDef<Stoplist>[] = [
  {
    accessorKey: "productName",
    header: "Продукт",
  },
  {
    accessorKey: "categoryName",
    header: "Категория",
  },
  {
    accessorKey: "terminalName",
    header: "Терминал",
  },
  {
    accessorKey: "status",
    header: "Статус",
    cell: ({ row }) => {
      const record = row.original;
      return record.status == "stop" ? (
        <Badge variant="destructive">На стопе</Badge>
      ) : (
        <Badge variant="success">Доступен</Badge>
      );
    },
  },
  {
    accessorKey: "dateAdd",
    header: "Дата добавления",
    cell: ({ row }) => {
      const record = row.original;
      return <span>{dayjs(record.dateAdd).format("DD.MM.YYYY HH:mm")}</span>;
    },
  },
  {
    accessorKey: "dateRemoved",
    header: "Дата удаления",
    cell: ({ row }) => {
      const record = row.original;
      return (
        <span>
          {record.dateRemoved
            ? dayjs(record.dateRemoved).format("DD.MM.YYYY HH:mm")
            : "Не удален"}
        </span>
      );
    },
  },
  {
    accessorKey: "difference",
    header: "Разница",
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
    header: "Причина",
  },
];
