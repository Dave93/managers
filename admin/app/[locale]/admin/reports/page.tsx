"use client";
import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { DataTable } from "./data-table";
import { useReportsColumns } from "./columns";
import ReportsFilterPanel from "./filter-panel";

function ReportsContent() {
  const t = useTranslations("adminReports");
  const reportsColumns = useReportsColumns();
  return (
    <div>
      <div className="flex justify-between pb-4">
        <h2 className="text-3xl font-bold tracking-tight">{t("title")}</h2>
      </div>
      <div className="sticky top-16 z-10">
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
