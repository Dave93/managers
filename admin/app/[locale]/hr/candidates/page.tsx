"use client"

import { Metadata } from "next";
import { Button } from "@admin/components/ui/buttonOrigin";
import { CalendarIcon, Plus } from "lucide-react";
import Link from "next/link";
import { DataTable } from "./data-table";
import { candidateColumns } from "./columns";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import CanAccess from "@admin/components/can-access";
import { CandidateSheet } from "@admin/components/forms/candidate/sheet";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { cn } from "@admin/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";
import { SelectContent, SelectValue, SelectItem, SelectTrigger, Select } from "@admin/components/ui/select";
import { Calendar } from "@admin/components/ui/calendar";
import type { DropdownNavProps, DropdownProps } from "react-day-picker"
import { parseZonedDateTime } from "@internationalized/date";
import { useState } from "react";



// export const metadata: Metadata = {
//     title: "Candidates",
//     description: "Manage candidates",
// };

export default function CandidatesListPage() {
    const searchParams = useSearchParams();
    const vacancyId = searchParams.get('vacancyId') || '';

    const handleSubmit = async () => {
        toast.success("Список кандидатов обновлен");
    };

    const [date, setDate] = useState(new Date("2024-04-04T00:00[UTC]"));

    const handleCalendarChange = (_value: string | number, _e: React.ChangeEventHandler<HTMLSelectElement>) => {
        const _event = {
            target: {
                value: String(_value),
            },
        } as React.ChangeEvent<HTMLSelectElement>
        _e(_event)
    }
    return (
        <div>
            <div className="flex justify-between">
                <h1 className="text-3xl font-bold tracking-tight">
                    Анкета
                </h1>
                <div className="flex items-center space-x-2">
                    <CanAccess permission="candidates.add">
                        <CandidateSheet />
                        {/* <CandidateSheet2 onSubmit={handleSubmit} vacancyId={vacancyId} /> */}
                    </CanAccess>
                </div>
            </div>
            <div className="py-10">
                <DataTable columns={candidateColumns} />
            </div>
            <Popover>
                <PopoverTrigger>
                    <Button
                        variant={"outline"}
                        className={cn(
                            "w-full justify-start text-left font-normal",
                            !date && "text-muted-foreground"
                        )}
                        aria-label="Select date"
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date.toLocaleDateString()}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0"
                >

                    davr
                </PopoverContent>
            </Popover>
            <Popover>
                <PopoverTrigger>Open</PopoverTrigger>
                <PopoverContent>Place content for the popover here.</PopoverContent>
            </Popover>
        </div>
    );
}