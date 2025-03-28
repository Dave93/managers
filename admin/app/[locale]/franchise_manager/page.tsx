"use client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@admin/components/ui/tabs";
import { DataTable } from "./data-table";
import { reportsColumns } from "./columns";
import { InvoiceFilters } from "./franchise_filter";
import Back from "../manager_reports/Back";

export default function ReportsListPage() {
  return (
    <div>
      <Back />
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">
          Приходная накладная (Франчайзинг)
        </h2>
      </div>
      <InvoiceFilters />
      <div className="py-10">
        <DataTable columns={reportsColumns} />
      </div>
    </div>
  );
}
