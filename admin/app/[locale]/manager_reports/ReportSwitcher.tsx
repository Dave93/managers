"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@admin/i18n/routing";

const REPORTS: { href: string; titleKey: string }[] = [
  { href: "/outgoing_invoices", titleKey: "orders" },
  { href: "/incoming_invoices", titleKey: "incomingTable" },
  { href: "/incoming_with_items", titleKey: "incomingDetail" },
  { href: "/refund_invoices", titleKey: "refund" },
  { href: "/internal_transfer", titleKey: "internalIn" },
  { href: "/expenses_transfer", titleKey: "internalOut" },
  { href: "/writeoff_items", titleKey: "writeoff" },
  { href: "/report_olap", titleKey: "olap" },
];

export function ReportSwitcher() {
  const pathname = usePathname();
  const t = useTranslations("reportsUi.reportNames.short");
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
              {t(r.titleKey)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default ReportSwitcher;
