"use client";
import React from "react";
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
  return (
    <Select value={value ?? (allowAll ? ALL : undefined)} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger className={className} aria-label="Месяц">
        <SelectValue placeholder="Месяц" />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL}>Все месяцы</SelectItem>}
        {options.map((p) => (
          <SelectItem key={p} value={p}>
            {monthLabel(p)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
