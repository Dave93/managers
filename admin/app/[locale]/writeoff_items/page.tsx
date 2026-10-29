"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "./data-table";
import { WriteoffFilters } from "./writeoff_filter";
import Back from "../manager_reports/Back";

import { ReportSwitcher } from "../manager_reports/ReportSwitcher";

export default function OutgoingListPage() {
  const t = useTranslations("reportsUi.reportNames");
  return (
    <div>
      <Back />
      <ReportSwitcher />
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">{t("long.writeoff")}</h2>
      </div>
      <WriteoffFilters />
      <div className="py-10">
        <DataTable />
      </div>
    </div>
  );
}
