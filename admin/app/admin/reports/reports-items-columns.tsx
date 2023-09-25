"use client";
import { ColumnDef } from "@tanstack/react-table";
import { RouterOutputs } from "@admin/utils/trpc";
import { useMemo, useState } from "react";
import { Input } from "@admin/components/ui/input";
import { Button } from "@admin/components/ui/button";
import { Check } from "lucide-react";
import { useReportsItemsUpdate } from "@admin/store/apis/reports_items";

const editableSources = ["cash", "uzcard", "humo", "other_expenses"];
const editableStatusCode = ["checking", "confirmed", "rejected"];
export const reportsItemsColumns: ColumnDef<
  RouterOutputs["reportsItems"]["list"]["items"][0]
>[] = [
  {
    accessorKey: "group_id",
    header: "Группа",
    cell: ({ row }) => {
      const record = row.original;
      let value = "";

      if (record.report_groups_id?.parent_id_report_groups) {
        value =
          record.report_groups_id?.parent_id_report_groups?.name +
          " / " +
          record.report_groups_id?.name;
      } else if (record.report_groups_id) {
        value = record.report_groups_id?.name;
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
      const record = row.original;

      const [value, setValue] = useState(record.amount);

      const { mutateAsync: updateReportItem } = useReportsItemsUpdate({
        onSuccess: () => {
          setValue(value);
        },
      });

      const isEditable = useMemo(() => {
        return (
          editableSources.includes(record.source) &&
          editableStatusCode.includes(
            record.reports_id?.reports_status_id?.code
          )
        );
      }, [record.source, record.reports_id?.reports_status_id?.code]);

      const isChanged = useMemo(() => {
        return value !== record.amount;
      }, [value, record.amount]);

      const saveUpdate = async () => {
        await updateReportItem({
          where: {
            id_report_date: {
              id: record.id,
              report_date: record.report_date,
            },
          },
          data: {
            amount: +value,
          },
        });
      };

      return isEditable ? (
        <div className="flex items-center space-x-3">
          <Input
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
          {Intl.NumberFormat("ru-RU").format(record.amount)}
        </span>
      );
    },
  },
];
