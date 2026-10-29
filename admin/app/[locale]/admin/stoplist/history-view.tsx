"use client";
import { DataTable } from "./data-table";
import { useStoplistColumns } from "./columns";
import StoplistFilterPanel from "./filter-panel";

export function HistoryView() {
  const columns = useStoplistColumns();
  return (
    <div>
      <div className="sticky top-16 z-10">
        <StoplistFilterPanel />
      </div>
      <div className="py-6">
        <DataTable columns={columns} />
      </div>
    </div>
  );
}
