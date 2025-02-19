"use client";

import { CardDescription } from "@admin/components/ui/card";
import { useReportDataStore } from "@admin/store/states/report_data";

export default function TotalExpenses() {
  const { totalExpenses, expenses } = useReportDataStore();
  const totalExpensesValue = totalExpenses();
  return (
    <CardDescription className="text-center text-lg ">
      {Intl.NumberFormat("ru-RU").format(totalExpensesValue)}
    </CardDescription>
  );
}
