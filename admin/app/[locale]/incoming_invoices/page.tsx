"use client";
import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { DataTable } from "./data-table";
import { InvoiceFilters } from "./invoice_filters";
import Back from "../manager_reports/Back";

import { ReportSwitcher } from "../manager_reports/ReportSwitcher";

export default function ReportsListPage() {
  const t = useTranslations("reportsUi.reportNames");
  return (
    <div>
      <Back />
      <ReportSwitcher />
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">
          {t("long.incomingTable")}
        </h2>
      </div>
      <InvoiceFilters />
      <div className="py-10">
        <DataTable />
      </div>
    </div>
  );
}
