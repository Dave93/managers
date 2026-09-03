"use client";
import { Suspense } from "react";
import { DataTable } from "./data-table";
import { stoplistColumns } from "./columns";
import StoplistFilterPanel from "./filter-panel";

function StoplistContent() {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4">
        <h2 className="text-3xl font-bold tracking-tight">Стоп-лист</h2>
        {/* History collection started on 2026-08-13; earlier days only hold
            the stops that were still open at the first sync. */}
        <span
          className="text-xs text-muted-foreground"
          title="История стоп-листа собирается с 13.08.2026; более ранние периоды неполные"
        >
          полные данные с 13.08.2026
        </span>
      </div>
      <div className="sticky top-16 z-10">
        <StoplistFilterPanel />
      </div>
      <div className="py-6">
        <DataTable columns={stoplistColumns} />
      </div>
    </div>
  );
}

export default function StoplistPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StoplistContent />
    </Suspense>
  );
}
