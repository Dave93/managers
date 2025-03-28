"use client";

import { useState } from "react";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@admin/components/ui/sheet";
import { Badge } from "@admin/components/ui/badge";
import { DataTable } from "../candidates/data-table";
import { candidateColumns } from "../candidates/columns";
import { UsersIcon } from "lucide-react";

interface CandidatesSheetProps {
    vacancyId: string;
    vacancyTitle: string;
    candidatesCount: number;
}

export function CandidatesSheet({ vacancyId, vacancyTitle, candidatesCount }: CandidatesSheetProps) {
    const [open, setOpen] = useState(false);

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Badge 
                    variant="outline" 
                    className="flex items-center gap-1 px-2 cursor-pointer hover:bg-muted"
                >
                    <UsersIcon className="h-3 w-3" />
                    {candidatesCount}
                </Badge>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-3xl">
                <SheetHeader>
                    <SheetTitle>
                        Кандидаты на вакансию: {vacancyTitle}
                    </SheetTitle>
                </SheetHeader>
                <div className="m-6">
                    <DataTable columns={candidateColumns} vacancyId={vacancyId} />
                </div>
            </SheetContent>
        </Sheet>
    );
} 