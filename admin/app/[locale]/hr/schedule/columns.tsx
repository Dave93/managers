"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import DeleteAction from "./delete-action";
import { work_schedules } from "@backend/../drizzle/schema";
import { WorkScheduleFormSheet } from "@admin/components/forms/schedule/sheet";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

type TFn = ReturnType<typeof useTranslations>;

export const useSheduleColumns = (): ColumnDef<typeof work_schedules.$inferSelect>[] => {
    const t = useTranslations("hrPages.schedule");
    return useMemo(() => getSheduleColumns(t), [t]);
};

export const getSheduleColumns = (t: TFn): ColumnDef<typeof work_schedules.$inferSelect>[] => [
    {
        accessorKey: "name",
        header: t("columns.name"),
    },
    {
        accessorKey: "active",
        header: t("columns.status"),
    },
    {
        accessorKey: "days",
        header: t("columns.days"),
    },
    {
        accessorKey: "start_time",
        header: t("columns.startTime")
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const record = row.original;

            return (
                <div className="flex items-center space-x-2">
                    <WorkScheduleFormSheet
                        recordId={record.id}
                        trigger={
                            <Button variant="secondary" size="sm">
                                <Edit2Icon className="h-4 w-4" />
                            </Button>
                        }
                    />
                    <DeleteAction recordId={record.id} />
                </div>
            );
        },
    },
];
