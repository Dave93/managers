"use client";
import { Tabs, Tab } from "@nextui-org/tabs";
import { DataTable } from "./data-table";
import { reportsColumns } from "./columns";
import { RefundFilters } from "./refund_filter";
import Back from "../manager_reports/Back";

export default function ReportsListPage() {
  return (
    <div>
      <Back />
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Возврат товаров</h2>
      </div>
      <RefundFilters />
      <div className="py-10">
        <DataTable columns={reportsColumns} />
      </div>
    </div>
  );
}
