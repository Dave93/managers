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
    terminalId: string;
    id: string;
  };
}

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
          <CardDescription className="text-center text-lg">
            Les Ailes C-5.
          </CardDescription>
          <CardTitle className="text-center text-3xl">12 000 000</CardTitle>
        </CardHeader>
        <CardContent className="mt-3">
          <div className="grid w-full items-center gap-4">
            {profit.map((item) => (
              <div className="flex space-x-1.5 items-center">
                {item.readOnly}
                <Label htmlFor={item.name} className="w-2/3 text-xl">
                  {item.name}
                </Label>
                {item.readOnly ? (
                  <Label htmlFor={item.value} className="w-1/3 text-xl">
                    {item.value}
                  </Label>
                ) : (
                  <Input
                    name={item.key}
                    className="w-1/3 text-right"
                    placeholder={item.placeholder}
                  />
                )}
              </div>
            ))}
          </div>
          <CardTitle className="text-center text-3xl mt-6">Расход</CardTitle>
          <CardDescription className="text-center text-lg ">
            1 000 000
          </CardDescription>
          {arryt.map((item) => (
            <div className="flex space-x-1.5 items-center">
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
