"use client";

import React from "react";
import { Link, usePathname } from "@admin/i18n/routing";

const REPORTS: { href: string; title: string }[] = [
  { href: "/outgoing_invoices", title: "Заказы" },
  { href: "/incoming_invoices", title: "Прих. накл. (Таблица)" },
  { href: "/incoming_with_items", title: "Прих. накл. (Детально)" },
  { href: "/refund_invoices", title: "Возврат товаров" },
  { href: "/internal_transfer", title: "Внутр. перемещение (Приход)" },
  { href: "/expenses_transfer", title: "Внутр. перемещение (Расход)" },
  { href: "/writeoff_items", title: "Акт Списания" },
  { href: "/report_olap", title: "Акт Реализации" },
];

export function ReportSwitcher() {
  const pathname = usePathname();
  return (
    <div className="-mx-2 mb-3 flex gap-1 overflow-x-auto px-2 py-1">
      {REPORTS.map((r) => {
        const active = pathname === r.href || pathname?.endsWith(r.href);
        return (
          <Link key={r.href} href={r.href as any}>
            <span
              className={`block shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-accent dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              }`}
            >
              {r.title}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default ReportSwitcher;
