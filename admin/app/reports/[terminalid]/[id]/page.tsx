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
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import Link from "next/link";

import CanAccess from "@admin/components/can-access";
import { ChevronLeft, MinusCircle, XCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { trpc } from "@admin/utils/trpc";
import { Skeleton } from "@admin/components/ui/skeleton";
import { TimePicker } from "react-ios-time-picker";
import { useToast } from "@admin/components/ui/use-toast";

interface paramsProps {
  params: {
    terminalid: string;
    id: string;
  };
}

export default function ReportsPage(params: paramsProps) {
  const { toast } = useToast();
  const router = useRouter();

  const { terminalid: terminalId, id } = params.params;
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [minusDialogOpen, setMinusDialogOpen] = useState(false);
  const [incomes, setIncomes] = useState<
    {
      type: string;
      amount?: number | null | undefined;
      error?: string | null | undefined;
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

  const onSuccessReport = () => {
    toast({
      title: "Ураааа!!!",
      description: "Отчёт успешно отправлен",
      variant: "default",
      duration: 5000,
    });
    router.push("/");
  };

  const onErrorReport = (error: any) => {
    toast({
      title: "Ошибка",
      description: error.message,
      variant: "destructive",
      duration: 5000,
    });
  };

  const { mutateAsync: sendReport, isLoading: isSubmitLoading } =
    trpc.reports.setReportData.useMutation({
      onSuccess: () => onSuccessReport(),
      onError: onErrorReport,
    });

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

  const changeExpenseLabel = (index: number, value: string) => {
    const newExpenses = [...expenses];
    newExpenses[index][0].value = value;
    setExpenses(newExpenses);
  };

  const onSubmit = () => {
    if (minusDiff > 0) {
      setMinusDialogOpen(true);
      return;
    }

    const incomeTotal = incomes.reduce((acc, curr) => {
      return acc + Number(curr.amount);
    }, 0);

    const expenseTotal = expenses.reduce((acc, curr) => {
      const expense = curr[1];
      return acc + Number(+expense.value);
    }, 0);

    const totalSum = incomeTotal + expenseTotal;

    if (data!.totalCashier > totalSum) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description:
          "Сумма меньше на " +
          Intl.NumberFormat("ru-RU").format(data!.totalCashier - totalSum),
        duration: 5000,
      });
      return;
    } else {
      sendReport({
        terminal_id: terminalId,
        date: id,
        incomes: incomes.filter((income) => !income.readonly),
        expenses: expenses.map((expense) => ({
          type: "other_expenses",
          amount: expense[1].value ? +expense[1].value : 0,
          label: expense[0].value,
        })),
      });
    }
  };

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
    const dataExpensesSum =
      data?.expenses.reduce((acc, curr) => {
        return acc + Number(curr.amount);
      }, 0) ?? 0;

    return localExpensesSum + dataExpensesSum;
  }, [expenses, data?.expenses]);

  const minusDiff = useMemo(() => {
    if (data?.totalCashier) {
      return data?.totalCashier - incomesTotalSum - expensesTotalSum;
    } else {
      return 0;
    }
  }, [data?.totalCashier, incomesTotalSum, expensesTotalSum]);

  const isFormLoading = useMemo(() => {
    return !!selectedTime || isLoading || isSubmitLoading;
  }, [selectedTime, isLoading, isSubmitLoading]);

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
              {Intl.NumberFormat("ru-RU").format(data?.totalCashier ?? 0)}
            </CardTitle>
          )}
        </CardHeader>
        {data && data.editable && (
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
        )}
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
                    <Label className="w-1/3 text-xl pl-3">
                      {Intl.NumberFormat("ru-RU").format(item.amount ?? 0)}
                    </Label>
                  ) : (
                    <Input
                      name={item.type}
                      className="w-1/3 text-left text-xl pl-3"
                      placeholder="сум"
                      // value={item.amount ?? 0}
                      defaultValue={item.amount ?? 0}
                      type="number"
                      /** @ts-ignore */
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
                {Intl.NumberFormat("ru-RU").format(item.amount ?? 0)}
              </Label>
            </div>
          ))}
          {data &&
            data.editable &&
            expenses.map((item, index) => (
              <div className="grid w-full items-center gap-4" key={index}>
                <div className="flex space-x-1 py-1.5 items-center">
                  <Input
                    name={`expenses_${index}_${item[0].name}`}
                    className="w-2/3"
                    placeholder="Основание"
                    /** @ts-ignore */
                    onChange={(e) => changeExpenseLabel(index, e.target.value)}
                  />
                  <Input
                    name={`expenses_${index}_${item[1].name}`}
                    className="w-1/3"
                    placeholder="наличные"
                    type="number"
                    /** @ts-ignore */
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
          {data && data.editable && (
            <Button className="mt-2 w-full" onClick={addExpenses}>
              Добавить
            </Button>
          )}
          {minusDiff > 0 && (
            <div className="flex flex-col items-center text-red-500 font-bold">
              <CardTitle className="text-center text-4xl mt-6">
                Недостающая сумма
              </CardTitle>
              <div className="!text-4xl">
                {Intl.NumberFormat("ru-RU").format(minusDiff)}
              </div>
            </div>
          )}
        </CardContent>
        {data && data.editable && (
          <CardFooter className="flex justify-between">
            <Button
              className="w-full space-x-2"
              disabled={isFormLoading}
              onClick={onSubmit}
            >
              {isSubmitLoading && (
                <svg
                  className="animate-spin h-5 w-5 text-sky-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              )}
              <span>Отправить на проверку</span>
            </Button>
          </CardFooter>
        )}
      </Card>
      <AlertDialog open={minusDialogOpen} onOpenChange={setMinusDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-500 uppercase font-bold">
              Вы уверены, что хотите отправить отчёт?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xl">
              У Вас на кассе не хватает{" "}
              {Intl.NumberFormat("ru-RU").format(minusDiff)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Нет</AlertDialogCancel>
            <AlertDialogAction
              asChild
              className="bg-destructive text-white uppercase"
            >
              <Button
                variant="destructive"
                onClick={() => {
                  setMinusDialogOpen(false);
                  sendReport({
                    terminal_id: terminalId,
                    date: id,
                    incomes: incomes.filter((income) => !income.readonly),
                    expenses: expenses.map((expense) => ({
                      type: "other_expenses",
                      amount: expense[1].value ? +expense[1].value : 0,
                      label: expense[0].value,
                    })),
                  });
                }}
              >
                Да, уверен
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
