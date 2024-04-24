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

import dayjs from "dayjs";
import { Badge } from "@admin/components/ui/badge";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import ReportItemsSheet from "./report-items";
import { cn } from "@admin/lib/utils";
import { reports, roles } from "@backend/../drizzle/schema";
import { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { ReportsWithRelations } from "@backend/modules/reports/dto/list.dto";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useToken from "@admin/store/get-token";

export const reportsColumns: ColumnDef<ReportsWithRelations>[] = [
  {
    accessorKey: "date",
    header: "Дата",
    cell: ({ row }) => {
      const record = row.original;
      return <span>{dayjs(record.date).format("DD.MM.YYYY")}</span>;
    },
  },
  {
    accessorKey: "status_id",
    header: "Статус",
    cell: function Cell({
      getValue,
      row: { index, original },
      column: { id },
      table,
    }) {
      const token = useToken();

      const queryClient = useQueryClient();
      const [isEditing, setIsEditing] = useState(false);
      const initialValue = getValue<string>();
      // We need to keep and update the state of the cell normally
      const [value, setValue] = useState<string | undefined>(
        initialValue ?? ""
      );

      const { data, isLoading } = useQuery({
        enabled: !!token,
        queryKey: ["report_status_cached"],
        queryFn: async () => {
          const { data } = await apiClient.api.reports_status.cached.get({
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          return data;
        },
      });

      const updateMutation = useMutation({
        mutationFn: (newTodo: {
          data: {
            status_id: string;
          };
          id: string;
        }) => {
          return apiClient.api.reports({ id: newTodo.id }).put(
            {
              data: newTodo.data,
            },
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );
        },
        onSuccess: () => {
          setIsEditing(false);
          queryClient.invalidateQueries({
            queryKey: ["reports"],
          });
        },
      });

      const saveStatus = () => {
        if (value)
          updateMutation.mutate({
            data: { status_id: value },
            id: original.id,
          });
      };

      return isEditing ? (
        <div className="flex space-x-2 items-center">
          <Select onValueChange={setValue} value={value}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data &&
                Array.isArray(data) &&
                data.map((item) => (
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
              backgroundColor: original.reports_status.color,
            }}
          >
            {original.reports_status.label}
          </Badge>
          <Button
            variant="outline"
            size="xs"
            onClick={() => setIsEditing(true)}
          >
            <Edit2Icon className="h-4 w-4" />
          </Button>
        </div>
      );
    },
  },
  {
    accessorKey: "terminal_id",
    header: "Терминал",
    cell: ({ row }) => {
      const record = row.original;

      return <span>{record.terminals.name}</span>;
    },
  },
  {
    accessorKey: "user_id",
    header: "Пользователь",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <span>{record.users.first_name + " " + record.users.last_name}</span>
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
            {Intl.NumberFormat("ru-RU").format(record.total_manager_price)}
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "difference",
    header: "Разница",
    cell: ({ row }) => {
      const record = row.original;
      const difference = record.difference;
      return (
        <div
          className={cn(
            ["flex items-center space-x-3 font-bold"],
            { "text-red-500": difference < 0 },
            { "text-green-500": difference > 0 }
          )}
        >
          <div>{Intl.NumberFormat("ru-RU").format(difference)}</div>
        </div>
      );
    },
  },
  {
    accessorKey: "arryt_income",
    header: "Излишка Arryt",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-3">
          <div>{Intl.NumberFormat("ru-RU").format(record.arryt_income)}</div>
        </div>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const record = row.original;

      return (
        <div className="flex items-center space-x-2">
          <ReportItemsSheet recordId={record.id} />
        </div>
      );
    },
  },
];
