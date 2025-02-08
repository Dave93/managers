"use client";

import { CardTitle } from "@admin/components/ui/card";
import { useReportDataStore } from "@admin/store/states/report_data";

export default function MinusDiff() {
  const { balance } = useReportDataStore();
  const balanceValue = balance();
  return balanceValue > 0 ? (
    <div className="flex flex-col items-center text-red-500 font-bold">
      <CardTitle className="text-center text-4xl mt-6">
        Недостающая сумма
      </CardTitle>
      <div className="!text-4xl">
        {Intl.NumberFormat("ru-RU").format(balanceValue)}
      </div>
    </div>
  ) : null;
}
