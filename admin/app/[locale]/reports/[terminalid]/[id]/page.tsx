import { Suspense, useEffect, useState } from "react";
import {
  Card,
  CardContent, CardHeader,
  CardTitle
} from "@admin/components/ui/card";
import { Button } from "@admin/components/ui/buttonOrigin";
import Link from "next/link";

import { ChevronLeft } from "lucide-react";
import { Skeleton } from "@admin/components/ui/skeleton";
// @ts-ignore
import dayjs from "dayjs";
import ClickSum from "./click";
import { useGetRole } from "@admin/utils/get_role";
import EcommercePayments from "./ecommerce-payments";
import CashierTotal from "./cashier-total";
import Arryt from "./arryt";
import TotalExpenses from "./total-expenses";
import ArrytIncome from "./arryt-income";
import Balance from "./balance";
import EditableExpenses from "./editable-expenses";
import EditableIncomes from "./editable-incomes";
import MinusDiff from "./minus-diff";
import PaymeSum from "./payme";
import ReportSubmit from "./submit";
import { useReportDataStore } from "@admin/store/states/report_data";
import ReportsPageClient from "./page.client";

interface paramsProps {
  terminalid: string;
  id: string;
}

interface PageProps {
  params: Promise<paramsProps>;
}

export default async function ReportsPage(props: PageProps) {

  const { terminalid: terminalId, id } = await props.params;

  return (
    <ReportsPageClient terminalid={terminalId} id={id} />
  );
}
