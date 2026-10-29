"use client";
import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { DataTable } from "./data-table";
import { OlapFilters } from "./olap_filters";

import { ReportSwitcher } from "../manager_reports/ReportSwitcher";

export default function ReportsListPage() {
  const t = useTranslations("reportsUi.reportNames");
  return (
    <div className="w-full overflow-hidden">
      <ReportSwitcher />
      <div className="flex justify-between">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {t("long.olap")}
        </h2>
      </div>
      <OlapFilters />
      <div className="py-4 sm:py-10">
        <DataTable />
      </div>
    </div>
  );
}