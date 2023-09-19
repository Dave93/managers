"use client";
import { ColumnDef } from "@tanstack/react-table";
import {
  CheckIcon,
  Edit2Icon,
  KeyRound,
  Minus,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@components/ui/button";
import { RouterOutputs } from "@admin/utils/trpc";
import dayjs from "dayjs";
import { Badge } from "@admin/components/ui/badge";
import { useState } from "react";
import { useCachedReportsStatusQuery } from "@admin/store/apis/reports_status";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import { Reports_status } from "@backend/lib/zod";
import { useReportsUpdate } from "@admin/store/apis/reports";

const statusColumn: Partial<
  ColumnDef<RouterOutputs["reports"]["list"]["items"][0]>
> = {
  accessorKey: "status_id",
  header: "Статус",
  cell: function Cell({
    getValue,
    row: { index, original },
    column: { id },
    table,
  }) {
    const [isEditing, setIsEditing] = useState(false);
    const initialValue = getValue();
    // We need to keep and update the state of the cell normally
    const [value, setValue] = useState<string>(initialValue);

    const { data, isLoading } = useCachedReportsStatusQuery({});

    const { mutateAsync: updateStatus } = useReportsUpdate({
      onSuccess: () => {
        setIsEditing(false);
      },
    });

    const saveStatus = () => {
      updateStatus({
        where: {
          id: original.id,
        },
        data: {
          status_id: value,
        },
      });
    };

    return isEditing ? (
      <div className="flex space-x-2 items-center">
        <Select onValueChange={setValue} value={value}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data?.map((item: Reports_status) => (
              <SelectItem value={item.id} key={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="destructive"
          size="xs"
          onClick={() => setIsEditing(false)}
        >
          <XIcon className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="xs" onClick={saveStatus}>
          <CheckIcon className="h-4 w-4" />
        </Button>
      </div>
    ) : (
      <div className="flex space-x-2">
        <Badge
          variant="default"
          className="uppercase text-white"
          style={{
            backgroundColor: original.reports_status_id.color,
          }}
        >
          {original.reports_status_id.label}
        </Badge>
        <Button variant="outline" size="xs" onClick={() => setIsEditing(true)}>
          <Edit2Icon className="h-4 w-4" />
        </Button>
      </div>
    );
  },
};

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
  statusColumn,
  {
    accessorKey: "terminal_id",
    header: "Терминал",
    cell: ({ row }) => {
      const record = row.original;

      return <span>{record.reports_terminal_id.name}</span>;
    },
  },
  {
    accessorKey: "user_id",
    header: "Пользователь",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <span>
          {record.reports_user_id.first_name +
            " " +
            record.reports_user_id.last_name}
        </span>
      );
    },
  },
  {
    accessorKey: "total_amount",
    header: "Сумма кассовых смен",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <span>{Intl.NumberFormat("ru-RU").format(record.total_amount)}</span>
      );
    },
  },
  {
    accessorKey: "total_manager_price",
    header: "Сумма менеджера",
    cell: ({ row }) => {
      const record = row.original;
      const difference = record.total_manager_price - record.total_amount;
      return (
        <div className="flex items-center space-x-3">
          <div>
            {Intl.NumberFormat("ru-RU").format(record.total_manager_price)} (
            {difference > 0 ? "+" : ""}
            {Intl.NumberFormat("ru-RU").format(difference)})
          </div>
        </div>
      );
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
