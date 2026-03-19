"use client";
import { Suspense } from "react";
import { DataTable } from "./data-table";

function PlaygroundTicketsContent() {
  return (
    <div>
      <div className="flex justify-between pb-4">
        <h2 className="text-3xl font-bold tracking-tight">
          Билеты детской площадки
        </h2>
      </div>
      <DataTable />
    </div>
  );
}

export default function PlaygroundTicketsListPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlaygroundTicketsContent />
    </Suspense>
  );
}
