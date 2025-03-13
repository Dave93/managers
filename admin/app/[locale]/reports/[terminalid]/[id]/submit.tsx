"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogFooter,
  AlertDialogContent,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogHeader,
} from "@admin/components/ui/alert-dialog";
import { Button } from "@admin/components/ui/buttonOrigin";
import { CardFooter } from "@admin/components/ui/card";
import { toast } from "sonner";
import { useReportDataStore } from "@admin/store/states/report_data";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

type SubmitProps = {
  terminalId: string;
  id: string;
};
export default function ReportSubmit({ terminalId, id }: SubmitProps) {
  const {
    balance,
    editableExpenses,
    editableIncomes,
    totalIncome,
    totalExpenses,
  } = useReportDataStore();
  const router = useRouter();
  const balanceValue = balance();
  const totalIncomeValue = totalIncome();
  const totalExpensesValue = totalExpenses();
  const expenses = editableExpenses();
  const incomes = editableIncomes();
  const [minusDialogOpen, setMinusDialogOpen] = useState(false);

  const { data: isEditable } = useQuery({
    queryKey: ["is_editable_report", terminalId, id],
    queryFn: async () => {
      const { data } = await apiClient.api.reports.is_editable.get({
        query: {
          date: id,
          terminal_id: terminalId,
        },
      });
      return data;
    },
  });

  const onSuccessReport = () => {
    toast.success("Отчёт успешно отправлен");
    router.push("/");
  };

  const onErrorReport = (error: any) => {
    toast.error(error.message);
  };

  const assignRoleMutation = useMutation({
    mutationFn: (newTodo: {
      terminal_id: string;
      date: string | number;
      incomes: {
        type: string;
        amount: number | null;
        readonly: boolean;
        label: string;
      }[];
      expenses: {
        type: string;
        amount: number;
        label: string;
      }[];
    }) => {
      return apiClient.api.reports.post({
        ...newTodo,
      });
    },
    onSuccess: () => onSuccessReport(),
    onError: onErrorReport,
  });
  const isFormLoading = useMemo(() => {
    return assignRoleMutation.isPending; // || isSubmitLoading;
  }, [
    // selectedTime,
    // isLoading,
    assignRoleMutation.isPending,
    // isSubmitLoading
  ]);

  const onSubmit = useCallback(() => {
    if (balanceValue > 0) {
      setMinusDialogOpen(true);
      return;
    }
    const incomeTotal = totalIncomeValue;
    const expenseTotal = totalExpensesValue;
    const totalSum = incomeTotal + expenseTotal;
    //   if (data && "terminal_id" in data && data!.totalCashier > totalSum) {
    //     toast({
    //       variant: "destructive",
    //       title: "Ошибка",
    //       description:
    //         "Сумма меньше на " +
    //         Intl.NumberFormat("ru-RU").format(data!.totalCashier - totalSum),
    //       duration: 5000,
    //     });
    //     return;
    //   } else {
    assignRoleMutation.mutate({
      terminal_id: terminalId,
      date: id,
      incomes: incomes.map((income) => ({
        type: income.key,
        amount: income.value,
        readonly: income.readonly,
        label: income.key,
      })),
      expenses: expenses.map((expense) => ({
        type: "other_expenses",
        amount: expense.value ? +expense.value : 0,
        label: expense.label,
      })),
    });
    //   }
  }, [
    balanceValue,
    totalIncomeValue,
    totalExpensesValue,
    incomes,
    expenses,
    terminalId,
    id,
    assignRoleMutation,
  ]);

  if (!isEditable) {
    return null;
  }

  return (
    <>
      <CardFooter className="flex justify-between">
        <Button
          className="w-full space-x-2"
          disabled={isFormLoading}
          onClick={onSubmit}
        >
          {assignRoleMutation.isPending && (
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
      <AlertDialog open={minusDialogOpen} onOpenChange={setMinusDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-500 uppercase font-bold">
              Вы уверены, что хотите отправить отчёт?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xl">
              У Вас на кассе не хватает{" "}
              {Intl.NumberFormat("ru-RU").format(balanceValue)}
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
                  assignRoleMutation.mutate({
                    terminal_id: terminalId,
                    date: id,
                    incomes: incomes.map((income) => ({
                      type: income.key,
                      amount: income.value,
                      readonly: income.readonly,
                      label: income.key,
                    })),
                    expenses: expenses.map((expense) => ({
                      type: "other_expenses",
                      amount: expense.value ? +expense.value : 0,
                      label: expense.label,
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
    </>
  );
}
