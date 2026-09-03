"use client";
import { DataTable } from "./data-table";
import { stoplistColumns } from "./columns";
import StoplistFilterPanel from "./filter-panel";

export function HistoryView() {
  return (
    <div>
      <div className="sticky top-16 z-10">
        <StoplistFilterPanel />
      </div>
      <div className="py-6">
        <DataTable columns={stoplistColumns} />
      </div>
    </div>
  );
}
