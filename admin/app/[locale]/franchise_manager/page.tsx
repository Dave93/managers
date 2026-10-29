"use client";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@admin/components/ui/tabs";
import { DataTable } from "./data-table";
import { getReportsColumns } from "./columns";
import { InvoiceFilters } from "./franchise_filter";
import Back from "../manager_reports/Back";

export default function ReportsListPage() {
  const t = useTranslations("reportsUi.reportNames");
  const ti = useTranslations("invoicesUi");
  const columns = useMemo(() => getReportsColumns(ti), [ti]);
  return (
    <div>
      <Back />
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">
          {t("franchiseIncoming")}
        </h2>
      </div>
      <InvoiceFilters />
      <div className="py-10">
        <DataTable columns={columns} />
      </div>
    </div>
  );
}
