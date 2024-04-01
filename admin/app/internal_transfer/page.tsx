"use client";

import { DataTable } from "./data-table";
import { reportsColumns } from "./columns";
import { InternalTransferFilters } from "./internal_filter";

export default function OutgoingListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">
          Внутренние переводы
        </h2>
      </div>
      <InternalTransferFilters />
      <div className="py-10">
        <DataTable columns={reportsColumns} />
      </div>
    </div>
  );
}
