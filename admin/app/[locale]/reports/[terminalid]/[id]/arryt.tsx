"use client";

import { Label } from "@admin/components/ui/label";
import { useReportDataStore } from "@admin/store/states/report_data";
import { apiClient } from "@admin/utils/eden";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect } from "react";

interface ArrytProps {
  terminal_id: string;
  date: string;
}

export default function Arryt({ terminal_id, date }: ArrytProps) {
  const { setIncomesItem, setWithdraws } = useReportDataStore();
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

  useEffect(() => {
    if (data && typeof data === "object" && "withdraws" in data) {
      setWithdraws(
        data.withdraws.map((withdraw) => ({
          label: `${withdraw.first_name} ${withdraw.last_name}`,
          value: withdraw.amount,
        }))
      );
    }
  }, [data, setIncomesItem, setWithdraws]);

  return (
    <>
      {data &&
        typeof data === "object" &&
        "withdraws" in data &&
        data.withdraws.length > 0 &&
        data.withdraws.map((withdraw) => (
          <div
            className="flex space-x-1.5 items-center "
            key={`${withdraw.first_name} ${withdraw.last_name}`}
          >
            <Label className="w-2/3 text-xl">
              {withdraw.first_name} {withdraw.last_name}
            </Label>
            <Label className="w-1/3 text-xl pl-3 text-right">
              {Intl.NumberFormat("ru-RU").format(withdraw.amount)}
            </Label>
          </div>
        ))}
    </>
  );
}
