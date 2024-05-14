"use client";
import React from "react";
import { Listbox, ListboxItem } from "@nextui-org/react";
import { ListboxWrapper } from "./ListboxWrapper";
import Back from "./Back";

export default function ListBox() {
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
    // {
    //   key: "franchise_manager",
    //   label: "Приходная накладная (франчайзинг)",
    //   href: "/franchise_manager",
    // },
  ];
  return (
    <div className="px-4">
      <ListboxWrapper>
        <Listbox
          items={items}
          aria-label="Dynamic Actions"
          // onAction={(key) => alert(key)}
        >
          {(item) => (
            <ListboxItem key={item.key} href={item.href} showDivider>
              {item.label}
            </ListboxItem>
          )}
        </Listbox>
      </ListboxWrapper>
    </div>
  );
}
