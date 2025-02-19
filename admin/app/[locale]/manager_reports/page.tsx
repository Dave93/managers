"use client";
import { List } from "lucide-react";
import React from "react";
import ListBox from "./ListBox";
import Back from "./Back";
import dayjs from "dayjs";
import ManagerLayout from "@admin/components/layout/manager-layout";

export default function managarReports() {
  return (
    <div>
      <div className="font-bold text-2xl text-center py-5">
        {dayjs().format("DD.MM.YYYY HH:mm")}
      </div>
      <ListBox />
    </div>
  );
}
