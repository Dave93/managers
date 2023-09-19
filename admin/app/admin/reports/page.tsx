"use client";
import { DataTable } from "./data-table";
import { reportsColumns } from "./columns";

export default function ReportsListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Reports List</h2>
      </div>
      <div className="py-10">
        <DataTable columns={reportsColumns} />
      </div>
    </div>
  );
}
