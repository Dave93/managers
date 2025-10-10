"use client";

import { useReportDataStore } from "@admin/store/states/report_data";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { useEffect } from "react";
const labels = {
  cash: "Наличные",
  uzcard: "Uzcard",
  humo: "Humo",
  uzum: "Uzum",
};

type EditableIncomesProps = {
  terminal_id: string;
  date: string;
};

export default function EditableIncomes({
  terminal_id,
  date,
}: EditableIncomesProps) {
  const {
    editableIncomes,
    setIncomesItem,
    setReadOnlyIncomes,
    readonlyIncomes,
  } = useReportDataStore();

  const incomesList = editableIncomes();
  const readonlyIncomesList = readonlyIncomes().filter((income: any) =>
    Object.keys(labels).includes(income.key)
  );

  const { data } = useSuspenseQuery({
    queryKey: ["editable_incomes", terminal_id, date],
    queryFn: async () => {
      const { data } = await apiClient.api.reports["editable-incomes"].post({
        terminal_id,
        date,
      });
      return data;
    },
  });

  useEffect(() => {
    if (data) {
      const readonlyIncomes = data.filter((item: any) => item.readonly);
      if (readonlyIncomes.length > 0) {
        setReadOnlyIncomes(readonlyIncomes);
      }

      const editableIncomes = data.filter((item: any) => !item.readonly);
      if (editableIncomes.length > 0) {
        editableIncomes.forEach((income: any) => {
          setIncomesItem(income);
        });
      }
    }
  }, [data, setIncomesItem, setReadOnlyIncomes]);

  return (
    <>
      {incomesList.map((income, index) => (
        <div className="flex space-x-1.5 items-center " key={index}>
          <Label className="w-2/3 text-xl">
            {labels[income.key as keyof typeof labels]}
          </Label>
          <Input
            name={`incomes_${index}_${income.value}`}
            className="w-1/3 ring-2 ring-ring ring-offset-2 text-right py-0 text-xl"
            placeholder={labels[income.key as keyof typeof labels]}
            type="number"
            onChange={(e) =>
              setIncomesItem({
                ...income,
                value: e.target.value ? +e.target.value : 0,
              })
            }
            defaultValue={income.value ?? 0}
          />
        </div>
      ))}
      {readonlyIncomesList.length > 0 &&
        readonlyIncomesList.map((income: any) => (
          <div className="flex space-x-1.5 items-center " key={income.key}>
            <Label className="w-2/3 text-xl">
              {labels[income.key as keyof typeof labels]}
            </Label>
            <Label className="w-1/3 text-xl pl-3 text-right">
              {Intl.NumberFormat("ru-RU").format(income.value)}
            </Label>
          </div>
        ))}
    </>
  );
}
