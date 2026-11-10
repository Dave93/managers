"use client";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@admin/i18n/routing";
import { formatDay, periodLabel } from "@admin/lib/inventory/periods";
import type { OpenCount } from "@backend/modules/inventory/book/types";

/** Какие пересчёты склада держат сверку «По дням» закрытой для филиала — со ссылками на них. */
export function OpenCountsList({ counts }: { counts: OpenCount[] }) {
  const ti = useTranslations("inventory.reconcile.interim");
  const tKind = useTranslations("inventory.kind");
  const tStatus = useTranslations("inventory.status");
  const locale = useLocale();
  if (!counts.length) return null;
  return (
    <div className="space-y-1">
      <div className="font-medium">{ti("openCounts")}</div>
      <ul className="space-y-2">
        {counts.map((c) => {
          const interim = c.kind === "interim";
          return (
            <li key={c.count_id}>
              <Link className="underline" href={`/inventory/${c.count_id}`}>
                {tKind(interim ? "interim" : "monthly")} · {interim ? formatDay(c.count_date) : periodLabel(c.period, locale)} · {c.template_name} ·{" "}
                {tStatus(c.status as any)}
              </Link>
              <div className="text-xs text-muted-foreground">{ti(c.status === "draft" ? "openDraftHint" : "openSubmittedHint")}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
