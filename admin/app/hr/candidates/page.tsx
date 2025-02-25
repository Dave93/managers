"use client"

import { Metadata } from "next";
import { Button } from "@admin/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import { DataTable } from "./data-table";
import { candidateColumns } from "./columns";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import CanAccess from "@admin/components/can-access";
import { CandidateSheet } from "@admin/components/forms/candidate/sheet";


// export const metadata: Metadata = {
//     title: "Candidates",
//     description: "Manage candidates",
// };

export default function CandidatesPage() {

    return (
        <div className="">
            <div className="flex justify-between">
                <h1 className="text-3xl font-bold tracking-tight">
                    Анкета
                </h1>
                <div className="flex items-center space-x-2">
                    <CanAccess permission="candidates.add">
                        <CandidateSheet />
                    </CanAccess>
                </div>
            </div>
            <div className="py-10">
                <DataTable columns={candidateColumns} />
            </div>

        </div>
    );
}