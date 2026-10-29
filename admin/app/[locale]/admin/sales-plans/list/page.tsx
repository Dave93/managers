"use client";
import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { DataTable } from "./data-table";

function SalesPlansContent() {
  const t = useTranslations("salesPlans");
  return (
    <div>
      <div className="flex justify-between pb-4">
        <h2 className="text-3xl font-bold tracking-tight">{t("list.title")}</h2>
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
