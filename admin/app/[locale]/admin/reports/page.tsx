"use client";
import { Suspense } from "react";
import { DataTable } from "./data-table";
import { reportsColumns } from "./columns";
import ReportsFilterPanel from "./filter-panel";

function ReportsContent() {
  return (
    <div>
      <div className="flex justify-between pb-4">
        <h2 className="text-3xl font-bold tracking-tight">Кассы</h2>
      </div>
      <div className="sticky top-0 z-50">
        <ReportsFilterPanel />
      </div>
      <div className="py-10">
        <DataTable columns={reportsColumns} />
      </div>
    </div>
  );
}

export default function ReportsListPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ReportsContent />
    </Suspense>
  );
}
