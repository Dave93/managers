"use client";
import { Tabs, Tab } from "@nextui-org/tabs";
import { DataTable } from "./data-table";
import { reportsColumns } from "./columns";
import { StoplistFilters } from "./stoplist_filters";

export default function ReportsListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Stoplist</h2>
      </div>
      <StoplistFilters />
      <Tabs variant="underlined" aria-label="Tabs variants">
        <Tab key="table" title="Таблицей">
          <div className="py-10">
            <DataTable columns={reportsColumns} />
          </div>
        </Tab>
        <Tab key="dashboard" title="Dashboard" />
      </Tabs>
    </div>
  );
}
