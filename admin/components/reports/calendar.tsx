"use client";

import * as React from "react";
import { hr, uzCyrl } from "date-fns/locale";
import { Calendar } from "@admin/components/ui/calendar";
import { useRouter } from "next/navigation";
import { trpc } from "@admin/utils/trpc";

const cancelled: any = [new Date(2023, 7, 25)];
const checking: any = [new Date(2023, 7, 28)];
const comfirmed: any = [new Date(2023, 7, 27)];
const sent: any = [new Date(2023, 7, 26)];

//styles
const cancelledStyle = {
  backgroundColor: "red",
  color: "white",
  borderRadius: "100%",
};
const checkingStyle = {
  backgroundColor: "#fbbf24",
  color: "white",
  borderRadius: "100%",
};
const confirmedStyle = {
  backgroundColor: "green",
  color: "white",
  borderRadius: "100%",
};
const sentStyle = {
  backgroundColor: "blue",
  color: "white",
  borderRadius: "100%",
};

export function CalendarReport() {
  const [date, setDate] = React.useState<Date | undefined>(new Date());
  const router = useRouter();

  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={(day, selectedDay) => {
        router.push(
          `/reports/${selectedDay.toLocaleString("ru-RU", {
            year: "numeric",
            month: "numeric",
            day: "numeric",
          })}`
        );
      }}
      className="rounded-md border"
      locale={uzCyrl}
      modifiers={{
        cancelled,
        checking,
        comfirmed,
        sent,
      }}
      modifiersStyles={{
        cancelled: cancelledStyle,
        checking: checkingStyle,
        confirmed: confirmedStyle,
        sent: sentStyle,
      }}
    />
  );
}
