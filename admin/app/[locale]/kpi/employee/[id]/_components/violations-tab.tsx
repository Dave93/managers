"use client";
import React from "react";
import { useLocale, useTranslations } from "next-intl";
import type { EmployeeCard } from "@admin/lib/kpi-api";
import { pickTitle } from "@admin/lib/kpi/employee-card";
import { formatTashkent } from "@admin/lib/kpi/format";
import { monthLabel } from "@admin/lib/kpi/periods";
import { cn } from "@admin/lib/utils";
import { KpiBadge } from "../../../_components/kpi-badge";
import { PhotoThumbs } from "../../../_components/photo-thumbs";

export function ViolationsTab({ card }: { card: EmployeeCard }) {
  const t = useTranslations("kpiScreens.employeeCard");
  const locale = useLocale();
  const items = card.violations.items;
  if (items.length === 0) return <p className="py-6 text-sm text-muted-foreground">{t("violations.none", { month: monthLabel(card.period, locale) })}</p>;
  return (
    <ul className="divide-y">
      {items.map((v) => (
        <li key={v.id} className={cn("space-y-1.5 py-3 text-sm", v.status === "cancelled" && "opacity-70")}>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums text-muted-foreground">{formatTashkent(v.occurred_at)}</span>
            {(v.item_title_ru || v.item_title_uz) && <span className="font-medium">{pickTitle(locale, v.item_title_ru, v.item_title_uz)}</span>}
            {v.status === "cancelled" && <KpiBadge tone="gray">{t("violations.cancelled")}</KpiBadge>}
          </p>
          <p>{v.comment}</p>
          {v.cancel_reason && <p className="text-muted-foreground">{t("violations.cancelReason", { reason: v.cancel_reason })}</p>}
          {v.photo_ids.length > 0 && <PhotoThumbs photos={v.photo_ids.map((id) => ({ id }))} />}
        </li>
      ))}
    </ul>
  );
}
