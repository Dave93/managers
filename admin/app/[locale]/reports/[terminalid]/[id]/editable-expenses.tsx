"use client";

import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@admin/components/ui/input";
import { useReportDataStore } from "@admin/store/states/report_data";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { MinusCircle } from "lucide-react";
import { useEffect } from "react";
import { Label } from "@admin/components/ui/label";

type EditableExpensesProps = {
  terminal_id: string;
  date: string;
};

export default function EditableExpenses({
  terminal_id,
  date,
}: EditableExpensesProps) {
  const {
    editableExpenses,
    addExpensesItem,
    removeExpensesItemByIndex,
    updateExpensesItemLabelByIndex,
    updateExpensesItemValueByIndex,
    clearExpenses,
    readonlyExpenses,
    setReadOnlyExpenses,
    expenses,
  } = useReportDataStore();

  const expensesList = editableExpenses();
  const readonlyExpensesList = readonlyExpenses();

  const addExpense = () => {
    addExpensesItem({ label: "Основание", value: 0, readonly: false });
  };

  const { data } = useSuspenseQuery({
    queryKey: ["editable_expenses", terminal_id, date],
    queryFn: async () => {
      const { data } = await apiClient.api.reports["editable-expenses"].post({
        terminal_id,
        date,
      });
      return data;
    },
  });

  useEffect(() => {
    if (data) {
      clearExpenses();
      const readonlyExpenses = data.filter((item) => item.readonly);
      if (readonlyExpenses.length > 0) {
        setReadOnlyExpenses(readonlyExpenses);
      }

      const editableExpenses = data.filter((item) => !item.readonly);
      if (editableExpenses.length > 0) {
        editableExpenses.forEach((expense) => {
          addExpensesItem(expense);
        });
      }
    }
  }, [data, addExpensesItem, clearExpenses, setReadOnlyExpenses]);
  return (
    <>
      {expensesList.map((expense, index) => (
        <div className="grid w-full items-center gap-4" key={index}>
          <div className="flex py-1.5 items-center">
            <div className="w-2/3">
              <Input
                className=" ring-2 ring-ring ring-offset-2"
                placeholder="Основание"
                onChange={(e) => {
                  updateExpensesItemLabelByIndex(index, e.target.value);
                }}
                value={expense.label ?? ""}
              />
            </div>
            <div className="w-1/3 px-4">
              <Input
                className="ring-2 ring-ring ring-offset-2 text-right py-0 text-xl"
                placeholder="наличные"
                type="number"
                onChange={(e) =>
                  updateExpensesItemValueByIndex(
                    index,
                    e.target.value ? +e.target.value : 0
                  )
                }
                value={expense.value ?? 0}
              />
            </div>
            {index > 0 ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => removeExpensesItemByIndex(index)}
              >
                <MinusCircle className="text-red w-4 h-4" />
              </Button>
            ) : (
              <div className="w-11 h-4 px-3"></div>
            )}
          </div>
        </div>
      ))}

      {readonlyExpensesList.length > 0 &&
        readonlyExpensesList.map((expense, index) => (
          <div className="flex space-x-1.5 items-center " key={index}>
            <Label className="w-2/3 text-xl">{expense.label}</Label>
            <Label className="w-1/3 text-xl pl-3 text-right">
              {Intl.NumberFormat("ru-RU").format(expense.value)}
            </Label>
          </div>
        ))}

      <Button className="mt-2 w-full" onClick={addExpense}>
        Добавить
      </Button>
    </>
  );
}
