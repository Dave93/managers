"use client";

import { Label } from "@admin/components/ui/label";
import { useReportDataStore } from "@admin/store/states/report_data";
import { apiClient } from "@admin/utils/eden";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect } from "react";

interface EcommercePaymentsProps {
  terminal_id: string;
  date: string;
}

export default function EcommercePayments({
  terminal_id,
  date,
}: EcommercePaymentsProps) {
  const { setIncomesItem } = useReportDataStore();
  const { data } = useSuspenseQuery({
    queryKey: ["ecommerce_payments", terminal_id, date],
    queryFn: async () => {
      const { data } = await apiClient.api.reports.express.post({
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
    setIncomesItem({
      key: "express",
      value: data?.express ?? 0,
      readonly: true,
    });
    setIncomesItem({
      key: "yandex_eats",
      value: data?.yandex_eats ?? 0,
      readonly: true,
    });
    setIncomesItem({
      key: "my_uzcard",
      value: data?.my_uzcard ?? 0,
      readonly: true,
    });
    setIncomesItem({ key: "wolt", value: data?.wolt ?? 0, readonly: true });
  }, [data, setIncomesItem]);

  return (
    <>
      {/* <div className="flex space-x-1.5 items-center">
        <Label className="w-2/3 text-xl">Express</Label>
        <Label className="w-1/3 text-xl pl-3 text-right">
          {Intl.NumberFormat("ru-RU").format(data?.express ?? 0)}
        </Label>
      </div> */}
      <div className="flex space-x-1.5 items-center">
        <Label className="w-2/3 text-xl">Yandex Eats</Label>
        <Label className="w-1/3 text-xl pl-3 text-right">
          {Intl.NumberFormat("ru-RU").format(data?.yandex_eats ?? 0)}
        </Label>
      </div>
      <div className="flex space-x-1.5 items-center">
        <Label className="w-2/3 text-xl">My Uzcard</Label>
        <Label className="w-1/3 text-xl pl-3 text-right">
          {Intl.NumberFormat("ru-RU").format(data?.my_uzcard ?? 0)}
        </Label>
      </div>
      <div className="flex space-x-1.5 items-center">
        <Label className="w-2/3 text-xl">Wolt</Label>
        <Label className="w-1/3 text-xl pl-3 text-right">
          {Intl.NumberFormat("ru-RU").format(data?.wolt ?? 0)}
        </Label>
      </div>
    </>
  );
}
