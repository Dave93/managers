"use client";

import { Label } from "@admin/components/ui/label";
import { useReportDataStore } from "@admin/store/states/report_data";
import { apiClient } from "@admin/utils/eden";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";

interface ArrytIncomeProps {
  terminal_id: string;
  date: string;
}

export default function ArrytIncome({ terminal_id, date }: ArrytIncomeProps) {
  const { incomes } = useReportDataStore();

  const { data, isLoading } = useSuspenseQuery({
    queryKey: ["arryt", terminal_id, date],
    queryFn: async () => {
      const { data } = await apiClient.api.reports.arryt.post({
        date,
        terminal_id,
      });
      return data;
    },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 0,
  });

  const arrytIncome = useMemo(() => {
    let res = 0;
    if (data && typeof data === "object" && "customerPrice" in data) {
      res = data.customerPrice;
    }
    return res;
  }, [data]);
  return (
    <div className="flex space-x-1.5 items-center ">
      <Label className="w-2/3 text-xl">Yandex Dostavka</Label>
      <Label className="w-1/3 text-xl pl-3 text-right">
        {Intl.NumberFormat("ru-RU").format(arrytIncome ?? 0)}
      </Label>
    </div>
  );
}
