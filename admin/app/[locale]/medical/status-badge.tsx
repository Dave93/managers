"use client";
import { useTranslations } from "next-intl";
import { cn } from "@admin/lib/utils";

const STYLES: Record<string, string> = {
  unfit: "bg-red-100 text-red-700 border-red-200",
  overdue: "bg-red-100 text-red-700 border-red-200",
  due_soon: "bg-amber-100 text-amber-700 border-amber-200",
  ok: "bg-green-100 text-green-700 border-green-200",
  none: "bg-gray-100 text-gray-600 border-gray-200",
};

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations("medical.status");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STYLES[status] ?? STYLES.none
      )}
    >
      {t(status as any)}
    </span>
  );
}
