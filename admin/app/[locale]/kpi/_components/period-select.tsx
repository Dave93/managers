"use client";
import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { ALL } from "@admin/lib/kpi/filters";
import { monthLabel } from "@admin/lib/kpi/periods";

/** Выбор месяца. `value = null` — «Все месяцы», доступно только при `allowAll`. */
export function PeriodSelect({
  value,
  onChange,
  options,
  allowAll,
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: string[];
  allowAll?: boolean;
  className?: string;
}) {
  const t = useTranslations("kpi");
  const locale = useLocale();
  return (
    <Select value={value ?? (allowAll ? ALL : undefined)} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger className={className} aria-label={t("common.period.label")}>
        <SelectValue placeholder={t("common.period.label")} />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL}>{t("common.period.all")}</SelectItem>}
        {options.map((p) => (
          <SelectItem key={p} value={p}>
            {monthLabel(p, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
