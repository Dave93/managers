"use client";
import React from "react";
import { useLocale, useTranslations } from "next-intl";
import type { EmployeeCard } from "@admin/lib/kpi-api";
import { pickTitle } from "@admin/lib/kpi/employee-card";
import { formatTashkent } from "@admin/lib/kpi/format";
import { monthLabel } from "@admin/lib/kpi/periods";
import { SOURCE_LABEL_KEY } from "@admin/lib/kpi/status";
import { formatShare } from "@admin/lib/kpi/timesheet";

export function ReviewTab({ card }: { card: EmployeeCard }) {
  const t = useTranslations("kpiScreens.employeeCard");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  const r = card.review;
  if (!r) return <p className="py-6 text-sm text-muted-foreground">{t("review.none", { month: monthLabel(card.period, locale) })}</p>;
  const groups = (["base", "extra"] as const).map((g) => ({ g, items: r.items.filter((i) => i.group_key === g) })).filter((x) => x.items.length > 0);
  const score = (n: number | null) => (n === null ? t("review.noData") : formatShare(n));
  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-2 text-sm font-medium">{t("review.items")}</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-4 text-left font-normal">{t("review.item")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-normal">{t("review.score")}</th>
              <th scope="col" className="hidden py-2 pr-4 text-left font-normal sm:table-cell">{t("review.source")}</th>
              <th scope="col" className="hidden py-2 text-left font-normal md:table-cell">{t("review.note")}</th>
            </tr>
          </thead>
          {groups.map(({ g, items }) => (
            <tbody key={g}>
              {groups.length > 1 && (
                <tr>
                  <th colSpan={4} scope="colgroup" className="pb-1 pt-4 text-left text-xs font-medium text-muted-foreground">
                    {t(`review.${g}` as never)}
                  </th>
                </tr>
              )}
              {items.map((i) => (
                <tr key={i.item_id} className="border-b last:border-b-0 align-top">
                  <td className="py-2 pr-4">{pickTitle(locale, i.title_ru, i.title_uz)}</td>
                  <td className={`py-2 pr-4 text-right tabular-nums ${i.score !== null && i.score < 100 ? "text-red-600 dark:text-red-400" : ""}`}>{score(i.score)}</td>
                  <td className="hidden py-2 pr-4 text-muted-foreground sm:table-cell">{tk(SOURCE_LABEL_KEY[i.source])}</td>
                  <td className="hidden py-2 text-muted-foreground md:table-cell">{i.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </section>

      {r.changes.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium">{t("review.changes")}</h3>
          <ul className="divide-y">
            {r.changes.map((c, i) => (
              <li key={i} className="space-y-1 py-3 text-sm">
                <p>
                  <span className="text-muted-foreground">{formatTashkent(c.at)}: </span>
                  <span className="tabular-nums">
                    {score(c.old_score_pct)} → {score(c.new_score_pct)}
                  </span>
                </p>
                {c.comment && <p className="text-muted-foreground">{t("review.comment", { comment: c.comment })}</p>}
                {c.items.length > 0 && (
                  <ul className="text-xs text-muted-foreground">
                    {c.items.map((it, j) => (
                      <li key={j}>
                        {pickTitle(locale, it.title_ru, it.title_uz)}: {score(it.old)} → {score(it.new)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
