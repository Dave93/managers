"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import DeleteAction from "./delete-action";
import { work_schedules } from "@backend/../drizzle/schema";
import { WorkScheduleFormSheet } from "@admin/components/forms/schedule/sheet";

export const sheduleColumns: ColumnDef<typeof work_schedules.$inferSelect>[] = [
    {
        accessorKey: "name",
        header: "Название",
    },
    {
        accessorKey: "active",
        header: "статус",
    },
    {
        accessorKey: "days",
        header: "Требования",
    },
    {
        accessorKey: "start_time",
        header: "Nachalo"
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
