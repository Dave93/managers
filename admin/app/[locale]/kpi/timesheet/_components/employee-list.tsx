"use client";
import React from "react";
import { useTranslations } from "next-intl";
import { formatShare, isPendingDay, nameOf, statusOf, totalsOf, type BranchStat, type Group } from "@admin/lib/kpi/timesheet";
import { cn } from "@admin/lib/utils";
import { CELL } from "../../_components/day-style";

/** Телефон: вместо матрицы — строки с именем, итогами и сжатой полоской месяца. */
export function EmployeeList({
  period,
  today,
  groups,
  showGroups,
  stats,
  onOpen,
}: {
  period: string;
  today: string;
  groups: Group[];
  showGroups: boolean;
  stats: Map<string, BranchStat>;
  onOpen: (employeeId: string, day: number | null) => void;
}) {
  const t = useTranslations("kpiScreens.timesheet");
  return (
    <div>
      {groups.map((g) => {
        const st = stats.get(g.id);
        return (
          <section key={g.id}>
            {showGroups && (
              <h2 className="flex flex-wrap items-baseline gap-x-3 pb-1 pt-5 text-sm font-semibold">
                {g.name}
                <span className="text-xs font-normal text-muted-foreground">
                  {t("group.meta", { n: g.employees.length })}
                  {st && st.share !== null ? ` · ${t("group.share", { share: formatShare(st.share) })}` : ""}
                </span>
                {st?.above && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                    {t("group.above")}
                  </span>
                )}
              </h2>
            )}
            <ul>
              {g.employees.map((e) => {
                const totals = totalsOf(e.days);
                return (
                  <li key={e.id} className="border-b last:border-b-0">
                    <button type="button" onClick={() => onOpen(e.id, null)} className="block w-full py-3 text-left">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className={cn("truncate text-sm", !e.active && "opacity-60")}>{nameOf(e)}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {totals.recorded === 0 ? (
                            "—"
                          ) : (
                            <>
                              <span className={totals.absent ? "font-medium text-red-600 dark:text-red-400" : ""}>
                                {t("cols.absent")} {totals.absent}
                              </span>
                              {" · "}
                              <span className={totals.late ? "font-medium text-amber-700 dark:text-amber-400" : ""}>
                                {t("cols.late")} {totals.late}
                              </span>
                            </>
                          )}
                        </span>
                      </span>
                      {e.role && <span className="block truncate text-xs text-muted-foreground">{e.role}</span>}
                      <span className="mt-2 flex h-3 gap-px" aria-hidden>
                        {e.days.map((d, i) => {
                          const s = statusOf(d);
                          const pending = !s && isPendingDay(period, i + 1, today);
                          return <span key={i} className={cn("flex-1 rounded-[1px]", s ? CELL[s] : pending ? "" : "bg-muted")} />;
                        })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
