"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import DeleteAction from "./delete-action";
import { positions } from "@backend/../drizzle/schema";
import { PositionsSheet } from "@admin/components/forms/position/sheet";

export const positionsColumns: ColumnDef<typeof positions.$inferSelect>[] = [
    {
        accessorKey: "title",
        header: "Название должности",
    },
    {
        accessorKey: "description",
        header: "Описание должности",
    },
    {
        accessorKey: "requirements",
        header: "Требования",
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const record = row.original;

            return (
                <div className="flex items-center space-x-2">
                    <PositionsSheet
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
