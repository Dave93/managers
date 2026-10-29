"use client";

import { DataTable } from "./data-table";
import { usePositionsColumns } from "./columns";
import { useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { PositionsSheet } from "@admin/components/forms/position/sheet";

export default function PositionListPage() {
    const t = useTranslations("hrPages.position");
    const positionsColumns = usePositionsColumns();
    return (
        <div>
            <div className="flex justify-between">
                <h2 className="text-3xl font-bold tracking-tight">
                    {t("title")}
                </h2>
                <div className="flex items-center space-x-2">
                    <CanAccess permission="positions.add">
                        <PositionsSheet />
                    </CanAccess>
                </div>
            </div>
            <div className="py-10">
                <DataTable columns={positionsColumns} />
            </div>
        </div>
    );
}