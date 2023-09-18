"use client";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@admin/components/ui/card";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import Link from "next/link";

import CanAccess from "@admin/components/can-access";
import { ChevronLeft, MinusCircle } from "lucide-react";
import { useRouter } from "next/router";
import { trpc } from "@admin/utils/trpc";
import { Skeleton } from "@admin/components/ui/skeleton";

const profit = [
  {
    key: "cash",
    name: "Наличные",
    placeholder: "сум",
    readOnly: false,
    value: "Наличные",
  },
  {
    key: "terminal",
    name: "Терминал",
    placeholder: "сум",
    readOnly: false,
    value: "Терминал",
  },
  {
    key: "yandex",
    name: "Яндекс Еда",
    value: "4.300.000",
    readOnly: true,
    placeholder: "",
  },
  {
    key: "uzum",
    name: "Uzum Tezkor",
    value: "5.300.000",
    readOnly: true,
    placeholder: "",
  },
  {
    key: "express",
    name: "Express24",
    value: "6.300.000",
    readOnly: true,
    placeholder: "",
  },

  {
    key: "payme",
    name: "Payme",
    value: "7.300.000",
    readOnly: true,
    placeholder: "",
  },
  {
    key: "click",
    name: "Click",
    value: "8.300.000",
    readOnly: true,
    placeholder: "",
  },
];

const arryt = [
  {
    key: "arryt",
    name: "Arryt",
    value: "8.300.000",
    readOnly: true,
    placeholder: "",
  },
];

interface paramsProps {
  params: {
    terminalid: string;
    id: string;
  };
}

// profit.map((item) => (
//   <div className="flex space-x-1.5 items-center" key={item.key}>
//     <Label htmlFor={item.name} className="w-2/3 text-xl">
//       {item.name}
//     </Label>
//     {item.readOnly ? (
//       <Label htmlFor={item.value} className="w-1/3 text-xl">
//         {item.value}
//       </Label>
//     ) : (
//       <Input
//         name={item.key}
//         className="w-1/3 text-right"
//         placeholder={item.placeholder}
//       />
//     )}
//   </div>
// ));

export default function ReportsPage(params: paramsProps) {
  const [expenses, setExpenses] = useState([
    [
      {
        key: "expenseReasone",
        placeholder: "Основание",
        name: "reason",
        value: "Основание",
        readOnly: false,
      },
      {
        key: "expenseCoast",
        name: "coast",
        placeholder: "1.000.000",
        value: "1.000.000",
        readOnly: false,
      },
    ],
  ]);

  const addExpenses = () => {
    setExpenses([
      ...expenses,
      [
        {
          key: "expenseReasone",
          placeholder: "Основание",
          name: "reason",
          value: "Основание",
          readOnly: false,
        },
        {
          key: "expenseCoast",
          name: "coast",
          placeholder: "наличные",
          readOnly: false,
          value: "1.000.000",
        },
      ],
    ]);
  };

  const removeExpenses = (index: number) => {
    const newExpenses = [...expenses];
    newExpenses.splice(index, 1);
    setExpenses(newExpenses);
  };

  const { terminalid: terminalId, id } = params.params;
  console.log(params.params);
  const { data, isLoading } = trpc.reports.getUniqueReportsByDay.useQuery({
    terminal_id: terminalId,
    date: id,
  });

  return (
    <div className="mb-20">
      <Link href="/">
        <Button variant="outline" className="mt-2 mx-2">
          <ChevronLeft />
          Back
        </Button>
      </Link>

      <Card className="m-2">
        <CardHeader>
          {isLoading ? (
            <Skeleton className="w-[100px] h-[20px] rounded-full mx-auto" />
          ) : (
            <CardDescription className="text-center text-lg">
              {data?.terminal_name}
            </CardDescription>
          )}
          {isLoading ? (
            <Skeleton className="w-40 h-10 rounded-full mx-auto" />
          ) : (
            <CardTitle className="text-center text-3xl">
              {Intl.NumberFormat("ru-RU").format(data?.totalCashier)}
            </CardTitle>
          )}
        </CardHeader>
        <CardContent className="mt-3">
          <div className="grid w-full items-center gap-4">
            {isLoading ? (
              <>
                {Array.from({ length: 7 }).map((_, i) => (
                  <div
                    className="flex space-x-1.5 items-center justify-between"
                    key={i}
                  >
                    <Skeleton
                      key={i}
                      className="w-36 text-xl h-7 rounded-full"
                    />
                    <Skeleton
                      key={i}
                      className="w-1/3 text-xl h-7 rounded-full"
                    />
                  </div>
                ))}
              </>
            ) : (
              data.incomes.map((item) => (
                <div className="flex space-x-1.5 items-center" key={item.type}>
                  <Label className="w-2/3 text-xl">{item.label}</Label>
                  {item.readonly ? (
                    <Label className="w-1/3 text-xl">
                      {Intl.NumberFormat("ru-RU").format(item.amount)}
                    </Label>
                  ) : (
                    <Input
                      name={item.type}
                      className="w-1/3 text-right"
                      placeholder="сум"
                    />
                  )}
                </div>
              ))
            )}
          </div>
          <CardTitle className="text-center text-3xl mt-6">Расход</CardTitle>
          <CardDescription className="text-center text-lg ">
            1 000 000
          </CardDescription>
          {data?.expenses.map((item) => (
            <div className="flex space-x-1.5 items-center" key={item.label}>
              <Label className="w-2/3 text-xl">{item.label}</Label>
              <Label className="w-1/3 text-xl">
                {Intl.NumberFormat("ru-RU").format(item.amount)}
              </Label>
            </div>
          ))}
          {arryt.map((item) => (
            <div className="flex space-x-1.5 items-center" key={item.key}>
              <Label htmlFor={item.name} className="w-2/3 text-xl px-1">
                {item.name}
              </Label>
              <Label htmlFor={item.value} className="w-1/3 text-xl">
                {item.value}
              </Label>
            </div>
          ))}
          {expenses.map((item, index) => (
            <div className="grid w-full items-center gap-4" key={index}>
              <div className="flex space-x-1 py-1.5 items-center">
                <Input
                  name={`expenses_${index}_${item[0].name}`}
                  className="w-2/3"
                  placeholder="Основание"
                />
                <Input
                  name={`expenses_${index}_${item[1].name}`}
                  className="w-1/3"
                  placeholder="наличные"
                />
                {index > 0 ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => removeExpenses(index)}
                  >
                    <MinusCircle className="text-red w-4 h-4" />
                  </Button>
                ) : (
                  <div className="w-11 h-4 px-3"></div>
                )}
              </div>
            </div>
          ))}
          <Button className="mt-2 w-full" onClick={addExpenses}>
            Добавить
          </Button>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button className="w-full">Отправит на проверку</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
