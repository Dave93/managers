"use client";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { cn } from "@admin/lib/utils";
import CreditCompaniesFormSheet from "@admin/components/forms/credit_companies/sheet";
import type { CreditCompanyRow } from "@admin/lib/credit-api";

// Re-exported so existing `import type { CreditCompanyRow } from "./columns"`
// call sites (data-table.tsx) don't need to know the type actually lives in
// the credit-api wrapper.
export type { CreditCompanyRow };

// Exported so the company detail page's header (Task 5) reuses the same
// status colors/labels/money formatting instead of duplicating them.
export const STATUS_STYLES: Record<CreditCompanyRow["status"], string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  suspended: "bg-red-100 text-red-700 border-red-200",
  pending_verification: "bg-amber-100 text-amber-700 border-amber-200",
};

type TFn = ReturnType<typeof useTranslations>;

// `t` here is the "systemPages.creditCompanies" namespace translator.
export function getStatusLabel(status: CreditCompanyRow["status"], t: TFn) {
  return t(`status.${status}`);
}

export function formatSum(tiyins: number | null | undefined, unit: string) {
  const sum = (tiyins ?? 0) / 100;
  return `${new Intl.NumberFormat("ru-RU").format(sum)} ${unit}`;
}

// Hook flavour of formatSum with the currency unit already bound.
export function useFormatSum() {
  const t = useTranslations("systemPages.creditCompanies");
  const unit = t("sumUnit");
  return (tiyins: number | null | undefined) => formatSum(tiyins, unit);
}

// Not called from within a cell renderer — cell functions are invoked once
// per row in a loop (data-table.tsx's `table.getRowModel().rows.map(...)`),
// which would call `useCanAccess` a variable number of times per render and
// break the Rules of Hooks. The caller (the list page) calls the hook once
// at the top level and passes the result in here instead.
export function getCreditCompaniesColumns(canEdit: boolean, t: TFn): ColumnDef<CreditCompanyRow>[] {
  const unit = t("sumUnit");
  const columns: ColumnDef<CreditCompanyRow>[] = [
  {
    accessorKey: "name",
    header: t("columns.name"),
  },
  {
    accessorKey: "inn",
    header: t("columns.inn"),
    cell: ({ row }) => row.original.inn ?? "—",
  },
  {
    accessorKey: "status",
    header: t("columns.status"),
    cell: ({ row }) => {
      const record = row.original;
      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
              STATUS_STYLES[record.status]
            )}
          >
            {getStatusLabel(record.status, t)}
          </span>
          {record.overdue && (
            <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-red-100 text-red-700 border-red-200">
              {t("overdue")}
            </span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "posted",
    header: t("columns.debt"),
    cell: ({ row }) => formatSum(row.original.posted, unit),
  },
  {
    accessorKey: "reserved",
    header: t("columns.reserve"),
    cell: ({ row }) => formatSum(row.original.reserved, unit),
  },
  {
    id: "limits",
    header: t("columns.limits"),
    cell: ({ row }) => {
      const record = row.original;
      return (
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>{t("columns.limitTotal", { value: formatSum(record.limit_total, unit) })}</div>
          <div>{t("columns.limitDay", { value: formatSum(record.limit_daily, unit) })}</div>
          <div>{t("columns.limitMonth", { value: formatSum(record.limit_monthly, unit) })}</div>
        </div>
      );
    },
  },
  {
    accessorKey: "verified_at",
    header: t("columns.verified"),
    cell: ({ row }) => {
      const verifiedAt = row.original.verified_at;
      return verifiedAt ? new Date(verifiedAt).toLocaleDateString("ru-RU") : t("none");
    },
  },
  ];

  if (canEdit) {
    columns.push({
      id: "actions",
      header: t("columns.actions"),
      cell: ({ row }) => {
        const record = row.original;

        return (
          // Stops the row's own onClick (navigate to detail page) from also
          // firing when the edit sheet trigger inside it is clicked.
          <div
            className="flex items-center space-x-2"
            onClick={(e) => e.stopPropagation()}
          >
            <CreditCompaniesFormSheet recordId={record.id}>
              <Button variant="outline" size="sm">
                <Edit2Icon className="h-4 w-4" />
              </Button>
            </CreditCompaniesFormSheet>
          </div>
        );
      },
    });
  }

  return columns;
}
