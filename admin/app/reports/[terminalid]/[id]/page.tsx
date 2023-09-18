"use client";
import { useEffect, useMemo, useState } from "react";
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
import { ChevronLeft, MinusCircle, XCircleIcon } from "lucide-react";
import { useRouter } from "next/router";
import { trpc } from "@admin/utils/trpc";
import { Skeleton } from "@admin/components/ui/skeleton";
import { TimePicker } from "react-ios-time-picker";
import { useToast } from "@admin/components/ui/use-toast";

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

export default function ReportsPage(params: paramsProps) {
  const { toast } = useToast();
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [incomes, setIncomes] = useState<
    {
      type: string;
      amount?: number;
      error?: string;
      readonly: boolean;
      label: string;
    }[]
  >([]);
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
        value: "0",
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
          value: "0",
        },
      ],
    ]);
  };

  const removeExpenses = (index: number) => {
    const newExpenses = [...expenses];
    newExpenses.splice(index, 1);
    setExpenses(newExpenses);
  };

  const onChangeTime = (timeValue: string) => {
    setSelectedTime(timeValue);
  };

  const clearTime = () => {
    setSelectedTime(null);
  };

  const changeExpenseValue = (index: number, value: string) => {
    const newExpenses = [...expenses];
    newExpenses[index][1].value = value;
    setExpenses(newExpenses);
  };

  const onSubmit = () => {
    const incomeTotal = incomes.reduce((acc, curr) => {
      return acc + Number(curr.amount);
    }, 0);

    const expenseTotal = expenses.reduce((acc, curr) => {
      const expense = curr[1];
      return acc + Number(+expense.value);
    }, 0);

    const totalSum = incomeTotal + expenseTotal;

    if (data.totalCashier > totalSum) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description:
          "Сумма меньше на " +
          Intl.NumberFormat("ru-RU").format(data.totalCashier - totalSum),
        duration: 5000,
      });
      return;
    }
  };

  const { terminalid: terminalId, id } = params.params;
  const { data, isLoading } = trpc.reports.getUniqueReportsByDay.useQuery(
    {
      terminal_id: terminalId,
      date: id,
      time: selectedTime,
    },
    {
      refetchOnWindowFocus: false,
    }
  );

  const changeIncomeValue = (index: number, value: string) => {
    const newIncomes = [...incomes];
    newIncomes[index].amount = +value;
    setIncomes(newIncomes);
  };

  const incomesTotalSum = useMemo(() => {
    return incomes.reduce((acc, curr) => {
      return acc + Number(curr.amount);
    }, 0);
  }, [incomes]);

  const expensesTotalSum = useMemo(() => {
    const localExpensesSum = expenses.reduce((acc, curr) => {
      const expense = curr[1];
      return acc + Number(+expense.value);
    }, 0);
    const dataExpensesSum = data?.expenses.reduce((acc, curr) => {
      return acc + Number(curr.amount);
    }, 0);

    return localExpensesSum + dataExpensesSum;
  }, [expenses, data?.expenses]);

  useEffect(() => {
    if (data) {
      setIncomes(data.incomes);
    }
  }, [data]);

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
                className="flex-shrink-0 inline w-4 h-4 mr-3"
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
        <CardTitle className="text-center text-3xl mt-6">
          Остаток на кассе
        </CardTitle>
        <CardDescription className="text-center text-lg ">
          {Intl.NumberFormat("ru-RU").format(incomesTotalSum)}
        </CardDescription>
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
              incomes.map((item, index) => (
                <div className="flex space-x-1.5 items-center" key={item.type}>
                  <Label className="w-2/3 text-xl">{item.label}</Label>
                  {item.readonly ? (
                    <Label className="w-1/3 text-xl">
                      {Intl.NumberFormat("ru-RU").format(item.amount ?? 0)}
                    </Label>
                  ) : (
                    <Input
                      name={item.type}
                      className="w-1/3 text-left text-xl pl-0"
                      placeholder="сум"
                      value={item.amount}
                      onChange={(e) => changeIncomeValue(index, e.target.value)}
                    />
                  )}
                </div>
              ))
            )}
          </div>
          <CardTitle className="text-center text-3xl mt-6">Расход</CardTitle>
          <CardDescription className="text-center text-lg ">
            {Intl.NumberFormat("ru-RU").format(expensesTotalSum)}
          </CardDescription>
          {data?.expenses.map((item) => (
            <div className="flex space-x-1.5 items-center" key={item.label}>
              <Label className="w-2/3 text-xl">{item.label}</Label>
              <Label className="w-1/3 text-xl">
                {Intl.NumberFormat("ru-RU").format(item.amount)}
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
                  onChange={(e) => changeExpenseValue(index, e.target.value)}
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
          <Button
            className="w-full"
            disabled={!!selectedTime || isLoading}
            onClick={onSubmit}
          >
            Отправить на проверку
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
