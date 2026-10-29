"use client";
import { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import DeleteAction from "./delete-action";
import { candidates } from "@backend/../drizzle/schema";
import { CandidateSheet } from "@admin/components/forms/candidate/sheet";


export function useCandidateColumns(): ColumnDef<typeof candidates.$inferSelect>[] {
    const t = useTranslations("hrPages.candidates");
    return useMemo<ColumnDef<typeof candidates.$inferSelect>[]>(() => [
    {
        accessorKey: "fullName",
        header: t("columns.fullName"),
    },
    {
        accessorKey: "phoneNumber",
        header: t("columns.phone"),
    },
    {
        accessorKey: "source",
        header: t("columns.source"),
    },
    {
        accessorKey: "vacancyId",
        header: t("columns.vacancy"),
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const record = row.original;

            return (
                <div className="flex items-center space-x-2">
                    <CandidateSheet
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
    ], [t]);
}
