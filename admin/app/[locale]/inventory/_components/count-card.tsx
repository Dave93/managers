"use client";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@admin/i18n/routing";
import { periodLabel } from "@admin/lib/inventory/periods";
import type { InventoryCountSummary } from "@backend/modules/inventory/types";
import { StatusBadge } from "./status-badge";

export function CountCard({ count }: { count: InventoryCountSummary }) {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const pct = count.lines_total ? Math.round((count.lines_done / count.lines_total) * 100) : 0;
  return (
    <Link
      href={`/inventory/${count.id}`}
      className="block rounded-lg border p-4 min-h-[44px] hover:bg-muted/50 active:bg-muted transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{count.template_id ? count.template_name : t("branchAll")}</div>
        <StatusBadge status={count.status} />
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{periodLabel(count.period, locale)}</div>
      <div className="mt-3 h-2 rounded bg-muted overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-sm">{t("progress", { done: count.lines_done, total: count.lines_total })}</div>
      {count.participants.length > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">{t("participants", { names: count.participants.join(", ") })}</div>
      )}
      {count.submitted_by_name && (
        <div className="mt-1 text-xs text-muted-foreground">{t("submittedBy", { name: count.submitted_by_name })}</div>
      )}
    </Link>
  );
}
