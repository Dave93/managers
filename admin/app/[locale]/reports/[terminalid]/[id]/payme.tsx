"use client";

import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { useReportDataStore } from "@admin/store/states/report_data";
import { apiClient } from "@admin/utils/eden";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect } from "react";

interface PaymeSumProps {
  terminal_id: string;
  date: string;
}

export default function PaymeSum({ terminal_id, date }: PaymeSumProps) {
  const { setIncomesItem } = useReportDataStore();
  const { data, isLoading } = useSuspenseQuery({
    queryKey: ["payme_sum", terminal_id, date],
    queryFn: async () => {
      const { data } = await apiClient.api.reports.payme.post({
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
    setIncomesItem({ key: "payme", value: data ?? 0, readonly: true });
  }, [data, setIncomesItem]);

  return (
    <div className="flex space-x-1.5 items-center ">
      <Label className="w-2/3 text-xl">Payme</Label>
      <Label className="w-1/3 text-xl pl-3 text-right">
        {Intl.NumberFormat("ru-RU").format(data ?? 0)}
      </Label>
    </div>
  );
}
