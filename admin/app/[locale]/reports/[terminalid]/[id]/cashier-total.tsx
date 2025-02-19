"use client";

import { useReportDataStore } from "@admin/store/states/report_data";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Label } from "@admin/components/ui/label";
import { useEffect } from "react";
import { CardTitle } from "@admin/components/ui/card";
import { CardDescription } from "@admin/components/ui/card";
import { Skeleton } from "@admin/components/ui/skeleton";

interface CashierTotalProps {
  terminal_id: string;
  date: string;
}

export default function CashierTotal({ terminal_id, date }: CashierTotalProps) {
  const { setCashierTotal } = useReportDataStore();
  const { data } = useSuspenseQuery({
    queryKey: ["cashier_total", terminal_id, date],
    queryFn: async () => {
      const { data } = await apiClient.api.reports.cashier.post({
        date,
        terminal_id,
      });
      return data;
    },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 0,
  });

  useEffect(() => {
    setCashierTotal(data?.totalCashier ?? 0);
  }, [data, setCashierTotal]);

  return (
    <>
      <CardDescription className="text-center text-lg">
        {data && "terminal" in data && data.terminal.name
          ? data.terminal.name
          : ""}
      </CardDescription>
      <CardTitle className="text-center text-3xl">
        {Intl.NumberFormat("ru-RU").format(
          data && "totalCashier" in data && data?.totalCashier
            ? data?.totalCashier
            : 0
        )}
      </CardTitle>
    </>
  );
}
