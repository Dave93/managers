"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { DataTable } from "./data-table";
import { getReportsColumns } from "./columns";
import { OutgoingFilters } from "./outgoing_filter";
import Back from "../manager_reports/Back";

import { ReportSwitcher } from "../manager_reports/ReportSwitcher";

export default function OutgoingListPage() {
  const t = useTranslations("reportsUi.reportNames");
  const ti = useTranslations("invoicesUi");
  const columns = useMemo(() => getReportsColumns(ti), [ti]);
  return (
    <div>
      <Back />
      <ReportSwitcher />
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">{t("long.orders")}</h2>
      </div>
      <OutgoingFilters />
      <div className="py-10">
        <DataTable columns={columns} />
      </div>
    </div>
  );
}
