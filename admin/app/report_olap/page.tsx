"use client";
import React, { useState } from "react";
import { Tabs, Tab } from "@nextui-org/tabs";
import { DataTable } from "./data-table";
import { OlapFilters } from "./olap_filters";
import Back from "../manager_reports/Back";

export default function ReportsListPage() {
  return (
    <div>
      <Back />
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">
          Акт Реализации
        </h2>
      </div>
      <OlapFilters />
      <div className="py-10">
        <DataTable />
      </div>
    </div>
  );
}