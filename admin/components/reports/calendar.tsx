"use client";

import { useMemo, useState } from "react";
import { hr, uzCyrl } from "date-fns/locale";
import { Calendar } from "@admin/components/ui/calendar";
import { useRouter } from "next/navigation";
import { trpc } from "@admin/utils/trpc";
import dayjs from "dayjs";

export function CalendarReport({ terminalId }: { terminalId: string }) {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const router = useRouter();

  const [
    { data: reportsStatus, isLoading: isReportsStatusLoading },
    { data: reportsByDate, isLoading: isReportsByDateLoading },
  ] = trpc.useQueries((t) => [
    t.reportsStatus.cachedReportsStatus({}),
    t.reports.listByDate({
      where: {
        terminal_id: terminalId,
        date: {
          gte: dayjs(date).startOf("month").toDate(),
          lt: dayjs(date).endOf("month").add(1, "day").toDate(),
        },
      },
      include: {
        reports_status_id: true,
      },
    }),
  ]);

  const modifiers = useMemo(() => {
    let res = {
      cancelled: [] as Date[],
      checking: [] as Date[],
      comfirmed: [] as Date[],
      sent: [] as Date[],
    };
    reportsByDate?.map((report) => {
      const date = new Date(report.date);
      const status = report.reports_status_id.code;
      if (status === "cancelled") {
        res.cancelled.push(date);
      } else if (status === "checking") {
        res.checking.push(date);
      } else if (status === "confirmed") {
        res.comfirmed.push(date);
      } else if (status === "sent") {
        res.sent.push(date);
      }
    });
    return res;
  }, [reportsByDate]);

  const [cancelledStyle, checkingStyle, confirmedStyle, sentStyle] =
    useMemo(() => {
      let cancelledStyle = {
        backgroundColor: "red",
        color: "white",
        borderRadius: "100%",
      };
      let checkingStyle = {
        backgroundColor: "#fbbf24",
        color: "white",
        borderRadius: "100%",
      };
      let confirmedStyle = {
        backgroundColor: "green",
        color: "white",
        borderRadius: "100%",
      };
      let sentStyle = {
        backgroundColor: "blue",
        color: "white",
        borderRadius: "100%",
      };

      if (reportsStatus && reportsStatus.length > 0) {
        const cancelled = reportsStatus.find(
          (status) => status.code === "cancelled"
        );
        const checking = reportsStatus.find(
          (status) => status.code === "checking"
        );
        const confirmed = reportsStatus.find(
          (status) => status.code === "confirmed"
        );
        const sent = reportsStatus.find((status) => status.code === "sent");

        if (cancelled) {
          cancelledStyle.backgroundColor = cancelled.color;
        }

        if (checking) {
          checkingStyle.backgroundColor = checking.color;
        }

        if (confirmed) {
          confirmedStyle.backgroundColor = confirmed.color;
        }

        if (sent) {
          sentStyle.backgroundColor = sent.color;
        }
      }

      return [cancelledStyle, checkingStyle, confirmedStyle, sentStyle];
    }, [reportsStatus]);

  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={(day, selectedDay) => {
        router.push(`/reports/${terminalId}/${dayjs(selectedDay).unix()}`);
      }}
      className="rounded-md border"
      locale={uzCyrl}
      modifiers={modifiers}
      modifiersStyles={{
        cancelled: cancelledStyle,
        checking: checkingStyle,
        confirmed: confirmedStyle,
        sent: sentStyle,
      }}
    />
  );
}
