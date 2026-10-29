"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import DeleteAction from "./delete-action";
import { positions } from "@backend/../drizzle/schema";
import { PositionsSheet } from "@admin/components/forms/position/sheet";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

type TFn = ReturnType<typeof useTranslations>;

export const usePositionsColumns = (): ColumnDef<typeof positions.$inferSelect>[] => {
    const t = useTranslations("hrPages.position");
    return useMemo(() => getPositionsColumns(t), [t]);
};

export const getPositionsColumns = (t: TFn): ColumnDef<typeof positions.$inferSelect>[] => [
    {
        accessorKey: "title",
        header: t("columns.title"),
    },
    {
        accessorKey: "description",
        header: t("columns.description"),
    },
    {
        accessorKey: "requirements",
        header: t("columns.requirements"),
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
