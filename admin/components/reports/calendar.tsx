"use client";

import { useMemo, useState } from "react";
import { hr, uzCyrl } from "date-fns/locale";
import { Calendar } from "@admin/components/ui/calendar";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { reports_status } from "@backend/../drizzle/schema";
import { InferSelectModel } from "drizzle-orm";
import useToken from "@admin/store/get-token";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";

export function CalendarReport({
  terminalId,
  reportsStatus,
}: {
  terminalId: string;
  reportsStatus: InferSelectModel<typeof reports_status>[];
}) {
  const token = useToken();
  const [date, setDate] = useState<Date | undefined>(new Date());
  const router = useRouter();

  const { data: reportsByDate, isLoading: isReportsByDateLoading } = useQuery({
    enabled: !!token,
    queryKey: [
      "my_terminal_reports",
      {
        terminal_id: terminalId,
        fields:
          "id,date,terminal_id,cash_ids,total_amount,total_manager_price,difference,arryt_income,reports_status.code,reports_status.color,reports_status.id,reports_status.label",
        filters: JSON.stringify([
          {
            field: "date",
            operator: "gte",
            value: dayjs(date).startOf("month").toISOString(),
          },
          {
            field: "date",
            operator: "lt",
            value: dayjs(date).endOf("month").add(1, "day").toISOString(),
          },
        ]),
      },
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.reports.my_reports.get({
        query: {
          terminal_id: terminalId,
          fields:
            "id,date,terminal_id,cash_ids,total_amount,total_manager_price,difference,arryt_income,reports_status.code,reports_status.color,reports_status.id,reports_status.label",
          filters: JSON.stringify([
            {
              field: "date",
              operator: "gte",
              value: dayjs(date).startOf("month").toISOString(),
            },
            {
              field: "date",
              operator: "lt",
              value: dayjs(date).endOf("month").add(1, "day").toISOString(),
            },
          ]),
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return data;
    },
  });

  const modifiers = useMemo(() => {
    let res = reportsStatus.reduce((acc, status) => {
      acc[status.code] = [];
      return acc;
    }, {} as Record<string, Date[]>);
    reportsByDate &&
      Array.isArray(reportsByDate) &&
      reportsByDate?.map((report) => {
        const date = new Date(report.date);
        const status = report.reports_status.code;
        res[status].push(date);
      });
    return res;
  }, [reportsByDate, reportsStatus]);

  const modifiersStyles = useMemo(() => {
    return reportsStatus.reduce((acc, status) => {
      acc[status.code] = {
        backgroundColor: status.color,
        color: "white",
        borderRadius: "100%",
      };
      return acc;
    }, {} as Record<string, React.CSSProperties>);
  }, [reportsStatus]);

  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={(day, selectedDay) => {
        router.push(`/reports/${terminalId}/${dayjs(selectedDay).unix()}`);
      }}
      onMonthChange={(month) => {
        setDate(month);
      }}
      className="rounded-md border"
      locale={uzCyrl}
      modifiers={modifiers}
      modifiersStyles={modifiersStyles}
    />
  );
}
