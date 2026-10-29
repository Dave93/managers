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
import { useTranslations } from "next-intl";

export default function ListBox() {
  const router = useRouter();
  const t = useTranslations("reportsUi.reportNames");
  const tl = useTranslations("reportsUi");
  const items = [
    {
      key: "outgoing_invoices",
      label: t("long.orders"),
      href: "/outgoing_invoices",
    },
    {
      key: "incoming invoices",
      label: t("long.incomingTable"),
      href: "/incoming_invoices",
    },
    {
      key: "incoming_with_items",
      label: t("long.incomingDetail"),
      href: "/incoming_with_items",
    },
    {
      key: "refund_invoices",
      label: t("long.refund"),
      href: "/refund_invoices",
    },
    {
      key: "internal_transfer",
      label: t("long.internalIn"),
      href: "/internal_transfer",
    },
    {
      key: "expenses_transfer",
      label: t("long.internalOut"),
      href: "/expenses_transfer",
    },
    {
      key: "writeoff_items",
      label: t("long.writeoff"),
      href: "/writeoff_items",
    },
    {
      key: "report_olap",
      label: t("long.olap"),
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
          <SelectValue placeholder={tl("selectReport")} />
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
