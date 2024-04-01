"use client";

import { DataTable } from "./data-table";
import { reportsColumns } from "./columns";
import { WriteoffFilters } from "./writeoff_filter";

export default function OutgoingListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Акт Списания</h2>
      </div>
      <WriteoffFilters />
      <div className="py-10">
        <DataTable />
      </div>
    </div>
  );
}
