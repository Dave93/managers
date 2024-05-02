"use client";
import { ColumnDef } from "@tanstack/react-table";

import { useMemo, useState } from "react";
import { Input } from "@admin/components/ui/input";
import { Button } from "@admin/components/ui/button";
import { Check } from "lucide-react";
import { ReportsItemsWithRelation } from "@backend/modules/reports_items/dto/list.dto";
import useToken from "@admin/store/get-token";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { roles } from "backend/drizzle/schema";

const editableSources = ["cash", "uzcard", "humo", "other_expenses"];
const editableStatusCode = ["checking", "confirmed", "rejected"];
export const reportsItemsColumns: ColumnDef<ReportsItemsWithRelation>[] = [
  {
    accessorKey: "group_id",
    header: "Группа",
    cell: ({ row }) => {
      const record = row.original;
      let value = "";

      if (record.report_groups) {
        value = record.report_groups?.name;
      }

      return <span>{value}</span>;
    },
  },
  {
    accessorKey: "label",
    header: "Заголовок",
  },
  {
    accessorKey: "type",
    header: "Тип",
    cell: ({ row }) => {
      const record = row.original;
      let value = "";

      if (record.type === "income") {
        value = "Доход";
      } else if (record.type === "outcome") {
        value = "Расход";
      }

      return <span>{value}</span>;
    },
  },
  {
    accessorKey: "amount",
    header: "Сумма",
    cell: function Cell({ row }) {
      const queryClient = useQueryClient();
      const token = useToken();
      const record = row.original;

      const [value, setValue] = useState(record.amount);

      const updateMutation = useMutation({
        mutationFn: (newTodo: {
          data: {
            amount: number;
          };
          id: string;
        }) => {
          // @ts-ignore
          return apiClient.api.reports_items[newTodo.id].put({
            data: newTodo.data,
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
        },
        onSuccess: () => {
          setValue(value);
          queryClient.invalidateQueries({
            queryKey: ["reports"],
          });
        },
      });

      const isEditable = useMemo(() => {
        return (
          editableSources.includes(record.source) &&
          editableStatusCode.includes(record.reports_status.code)
        );
      }, [record.source, record.reports_status.code]);

      const isChanged = useMemo(() => {
        return value !== record.amount;
      }, [value, record.amount]);

      const saveUpdate = async () => {
        updateMutation.mutate({
          // @ts-ignore
          data: { amount: +value },
          id: record.id,
        });
      };

      return isEditable ? (
        <div className="flex items-center space-x-3">
          <Input
            // @ts-ignore
            defaultValue={record.amount}
            /** @ts-ignore */
            onChange={(e) => setValue(e.target.value)}
            className="w-9/12"
            type="number"
          />
          {isChanged ? (
            <Button size="sm" variant="outline" onClick={saveUpdate}>
              <Check className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" variant="ghost">
              <div className="h-4 w-4"></div>
            </Button>
          )}
        </div>
      ) : (
        <span className="pl-3">
          {/* @ts-ignore */}
          {Intl.NumberFormat("ru-RU").format(record.amount)}
        </span>
      );
    },
  },
];
