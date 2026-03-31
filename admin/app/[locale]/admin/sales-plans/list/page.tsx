"use client";
import { Suspense } from "react";
import { DataTable } from "./data-table";

function SalesPlansContent() {
  return (
    <div>
      <div className="flex justify-between pb-4">
        <h2 className="text-3xl font-bold tracking-tight">Планы продаж</h2>
      </div>
      <DataTable />
    </div>
  );
}

export default function SalesPlansListPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SalesPlansContent />
    </Suspense>
  );
}
