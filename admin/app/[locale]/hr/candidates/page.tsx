"use client"

import { DataTable } from "./data-table";
import { candidateColumns } from "./columns";
import CanAccess from "@admin/components/can-access";
import { CandidateSheet } from "@admin/components/forms/candidate/sheet";
import { useToast } from "@admin/components/ui/use-toast";
import { useSearchParams } from "next/navigation";
import { useState } from "react";


export default function CandidatesListPage() {
    const { toast } = useToast();
    const searchParams = useSearchParams();
    const vacancyId = searchParams.get('vacancyId') || '';

    const handleSubmit = async () => {
        toast({
            title: "Успех",
            description: "Список кандидатов обновлен",
        });
    };


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

        </div>
    );
}