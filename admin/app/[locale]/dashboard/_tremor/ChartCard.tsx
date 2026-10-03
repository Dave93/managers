"use client";

import React from "react";
import { Card, CardContent } from "@admin/components/ui/card";
import { cn } from "@admin/lib/utils";
import type { OrgOption } from "./KpiAreaCard";

// Compact segmented org switch (Все / orgs) — shared Tremor-style control.
export function OrgToggle({
  organization,
  orgOptions,
  onOrganizationChange,
}: {
  organization?: string | null;
  orgOptions?: OrgOption[];
  onOrganizationChange?: (id: string) => void;
}) {
  if (!orgOptions || orgOptions.length === 0 || !onOrganizationChange) return null;
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-lg border">
      <button
        type="button"
        data-active={!organization}
        onClick={() => onOrganizationChange("")}
        className="px-3 py-1.5 text-xs font-medium text-muted-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
      >
        Все
      </button>
      {orgOptions.map((o) => (
        <button
          key={o.id}
          type="button"
          data-active={organization === o.id}
          onClick={() => onOrganizationChange(o.id)}
          className="border-l px-3 py-1.5 text-xs font-medium text-muted-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Props = {
  title: React.ReactNode;
  children: React.ReactNode;
  /** Optional subtitle / metric line under the title. */
  subtitle?: React.ReactNode;
  organization?: string | null;
  orgOptions?: OrgOption[];
  onOrganizationChange?: (id: string) => void;
  /** Extra header controls (right side, before the org toggle). */
  headerRight?: React.ReactNode;
  /** Footer row (e.g. interval tabs). */
  footer?: React.ReactNode;
  className?: string;
  /** Apply to the chart body wrapper. */
  bodyClassName?: string;
  /** Ref to the outer card element, e.g. for image export. */
  cardRef?: React.Ref<HTMLDivElement>;
};

// Generic Tremor-style card shell: clean header (title + org toggle) and a
// flexible body that fills the card height. Responsive by default — header
// wraps and the body shrinks (min-h-0) so charts fit narrow phone widths.
export default function ChartCard({
  title,
  children,
  subtitle,
  organization,
  orgOptions,
  onOrganizationChange,
  headerRight,
  footer,
  className,
  bodyClassName,
  cardRef,
}: Props) {
  return (
    <Card ref={cardRef} className={cn("flex h-full flex-col", className)}>
      <CardContent className="flex min-h-0 grow flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{title}</div>
            {subtitle && <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {headerRight}
            <OrgToggle
              organization={organization}
              orgOptions={orgOptions}
              onOrganizationChange={onOrganizationChange}
            />
          </div>
        </div>
        <div className={cn("min-h-0 grow", bodyClassName)}>{children}</div>
        {footer}
      </CardContent>
    </Card>
  );
}
