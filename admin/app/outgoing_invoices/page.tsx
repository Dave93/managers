"use client";

import { DataTable } from "./data-table";
import { reportsColumns } from "./columns";
import { OutgoingFilters } from "./outgoing_filter";

export default function OutgoingListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Со склада</h2>
      </div>
      <OutgoingFilters />
      <div className="py-10">
        <DataTable columns={reportsColumns} />
      </div>
    </div>
  );
}
