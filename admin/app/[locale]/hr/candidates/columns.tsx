"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@components/ui/button";
import DeleteAction from "./delete-action";
import { candidates } from "@backend/../drizzle/schema";
import { CandidateSheet } from "@admin/components/forms/candidate/sheet";

export const candidateColumns: ColumnDef<typeof candidates.$inferSelect>[] = [
    {
        accessorKey: "fullName",
        header: "FIO1",
    },
    {
        accessorKey: "phoneNumber",
        header: "номер телефона",
    },
    {
        accessorKey: "source",
        header: "откуда узнали",
    },
    {
        accessorKey: "vacancyId",
        header: "вакансия",
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
];
