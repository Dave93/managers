"use client";
import React from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select"
import { useRouter } from "next/navigation";

export default function ListBox() {
  const router = useRouter();
  const items = [
    {
      key: "outgoing_invoices",
      label: "Заказы",
      href: "/outgoing_invoices",
    },
    {
      key: "incoming invoices",
      label: "Приходная накладная (Таблица)",
      href: "/incoming_invoices",
    },
    {
      key: "incoming_with_items",
      label: "Приходная накладная (Детально)",
      href: "/incoming_with_items",
    },
    {
      key: "refund_invoices",
      label: "Возврат товаров",
      href: "/refund_invoices",
    },
    {
      key: "internal_transfer",
      label: "Внутреннее перемещение (Приход)",
      href: "/internal_transfer",
    },
    {
      key: "expenses_transfer",
      label: "Внутреннее перемещение (Расход)",
      href: "/expenses_transfer",
    },
    {
      key: "writeoff_items",
      label: "Акт Списания",
      href: "/writeoff_items",
    },
    {
      key: "report_olap",
      label: "Акт Реализации",
      href: "/report_olap",
    },
    // {
    //   key: "franchise_manager",
    //   label: "Приходная накладная (франчайзинг)",
    //   href: "/franchise_manager",
    // },
  ];

  return (
    <div className="px-4 w-full max-w-[400px]">
      <Select onValueChange={(value) => router.push(value)}>
        <SelectTrigger>
          <SelectValue placeholder="Выберите отчет" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.key} value={item.href}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
