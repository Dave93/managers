"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@admin/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@admin/components/ui/alert-dialog";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import Link from "next/link";

import CanAccess from "@admin/components/can-access";
import { ChevronLeft, MinusCircle, XCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@admin/components/ui/skeleton";
// @ts-ignore
import { TimePicker } from "react-ios-time-picker";
import { useToast } from "@admin/components/ui/use-toast";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { v4 as uuidv4 } from "uuid";
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

interface paramsProps {
  params: {
    terminalid: string;
    id: string;
  };
}

export default function ReportsPage(params: paramsProps) {
  const roleCode = useGetRole();
  const { clearData } = useReportDataStore();

  const { terminalid: terminalId, id } = params.params;
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const onChangeTime = (timeValue: string) => {
    setSelectedTime(timeValue);
  };

  const clearTime = () => {
    setSelectedTime(null);
  };

  useEffect(() => {
    clearData();
  }, []);

  return (
    <div className="mb-20">
      <div className="grid grid-cols-3 items-center">
        <Link href="/">
          <Button variant="outline" className="mt-2 mx-2">
            <ChevronLeft />
            Back
          </Button>
        </Link>
        <div className="font-bold text-2xl text-center">
          {dayjs.unix(+id).format("DD.MM.YYYY")}
        </div>
      </div>

      <Card className="m-2">
        <CardHeader>
          <Suspense
            fallback={<Skeleton className="w-36 text-xl h-7 rounded-full" />}
            key={`cashier-total-${id}-${terminalId}`}
          >
            <CashierTotal terminal_id={terminalId} date={id} />
          </Suspense>
          <MinusDiff />
        </CardHeader>
        {/* {data && "terminal_id" in data && data.editable && (
          <div className="mb-4">
            <div className="mx-auto w-60 flex flex-col items-center">
              <Label className="w-2/3 text-xl">Указать время</Label>
              <div className="space-x-2 flex">
                <div className="border-2 rounded-md">
                  <TimePicker value={selectedTime} onChange={onChangeTime} />
                </div>
                {selectedTime && (
                  <Button variant="destructive" size="icon" onClick={clearTime}>
                    <XCircleIcon className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
            {selectedTime && (
              <div
                className="flex items-center p-4 mb-4 text-sm text-red-800 border border-red-300 rounded-lg bg-red-50 dark:bg-gray-800 dark:text-red-400 dark:border-red-800 mx-4 my-3 relative"
                role="alert"
              >
                <svg
                  className="shrink-0 inline w-4 h-4 mr-3"
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z" />
                </svg>
                <span className="sr-only">Info</span>
                <div>
                  <span className="font-bold">
                    При выделенном времени нельзя отправить отчёт
                  </span>
                </div>
              </div>
            )}
          </div>
        )} */}

        <div className="my-3">
          <CardTitle className="text-center text-3xl my-2">
            Остаток на кассе
          </CardTitle>
          <Balance />
        </div>
        <CardContent className="mt-3">
          <div className="grid w-full items-center gap-4">
            {!!roleCode && (
              <>
                <Suspense
                  fallback={
                    <Skeleton className="w-36 text-xl h-7 rounded-full" />
                  }
                  key={`click-${id}-${terminalId}-${roleCode}`}
                >
                  <ClickSum terminal_id={terminalId} date={id} />
                </Suspense>
                <Suspense
                  fallback={
                    <Skeleton className="w-36 text-xl h-7 rounded-full" />
                  }
                  key={`payme-${id}-${terminalId}-${roleCode}`}
                >
                  <PaymeSum terminal_id={terminalId} date={id} />
                </Suspense>
                <Suspense
                  fallback={
                    <Skeleton className="w-36 text-xl h-7 rounded-full" />
                  }
                  key={`express-${id}-${terminalId}-${roleCode}`}
                >
                  <EcommercePayments terminal_id={terminalId} date={id} />
                </Suspense>
                <Suspense
                  fallback={
                    <Skeleton className="w-36 text-xl h-7 rounded-full" />
                  }
                  key={`arryt-income-${id}-${terminalId}-${roleCode}`}
                >
                  <ArrytIncome terminal_id={terminalId} date={id} />
                </Suspense>
              </>
            )}
            <Suspense
              fallback={<Skeleton className="w-36 text-xl h-7 rounded-full" />}
              key={`editable-incomes-${id}-${terminalId}-${roleCode}`}
            >
              <EditableIncomes terminal_id={terminalId} date={id} />
            </Suspense>
          </div>
          <CardTitle className="text-center text-3xl mt-6">Расход</CardTitle>
          <TotalExpenses />
          <Suspense
            fallback={<Skeleton className="w-36 text-xl h-7 rounded-full" />}
            key={`arryt-${id}-${terminalId}-${roleCode}`}
          >
            <Arryt terminal_id={terminalId} date={id} />
          </Suspense>
          <Suspense
            fallback={<Skeleton className="w-36 text-xl h-7 rounded-full" />}
            key={`editable-expenses-${id}-${terminalId}-${roleCode}`}
          >
            <EditableExpenses terminal_id={terminalId} date={id} />
          </Suspense>
          <MinusDiff />
        </CardContent>
        <ReportSubmit terminalId={terminalId} id={id} />
      </Card>
    </div>
  );
}
