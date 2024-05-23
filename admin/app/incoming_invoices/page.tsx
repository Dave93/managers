"use client";
import React, { useState } from "react";
import { Tabs, Tab } from "@nextui-org/tabs";
import { DataTable } from "./data-table";
import { reportsColumns } from "./columns";
import { InvoiceFilters } from "./invoice_filters";
import Back from "../manager_reports/Back";

export default function ReportsListPage() {
  const [showActualColumn, setShowActualColumn] = useState(false);

  const toggleShowActualColumn = () => {
    setShowActualColumn((prev) => !prev);
  };
  return (
    <div>
      <Back />
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">
          Приходная накладная (Таблица)
        </h2>
      </div>
      <InvoiceFilters
        showActualColumn={showActualColumn}
        toggleShowActualColumn={toggleShowActualColumn}
      />
      <div className="py-10">
        <DataTable
          showActualColumn={showActualColumn}
          toggleShowActualColumn={toggleShowActualColumn}
        />
      </div>
    </div>
  );
}
