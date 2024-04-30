"use client";
import { Tabs, Tab } from "@nextui-org/tabs";
import { DataTable } from "./data-table";
import { reportsColumns } from "./columns";
import { InvoiceFilters } from "./incoming_filter";

export default function ReportsListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">
          Приходная накладная (Детально)
        </h2>
      </div>
      <InvoiceFilters />
      <div className="py-10">
        <DataTable columns={reportsColumns} />
      </div>
    </div>
  );
}
