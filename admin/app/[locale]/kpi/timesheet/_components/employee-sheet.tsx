"use client";
import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@admin/components/ui/sheet";
import type { BoardEmployee } from "@admin/lib/kpi-api";
import { monthLabel } from "@admin/lib/kpi/periods";
import {
  absentStreak,
  calendarCells,
  deviations,
  isPendingDay,
  nameOf,
  statusOf,
  totalsOf,
  weekdayOf,
} from "@admin/lib/kpi/timesheet";
import { cn } from "@admin/lib/utils";
import { CELL, pad2 } from "./day-style";

/** Карточка сотрудника за месяц: итоги, календарь и список отклонений. */
export function EmployeeSheet({
  employee,
  focusDay,
  period,
  daysInMonth,
  today,
  onClose,
}: {
  employee: BoardEmployee | null;
  focusDay: number | null;
  period: string;
  daysInMonth: number;
  today: string;
  onClose: () => void;
}) {
  const t = useTranslations("kpiScreens.timesheet");
  const locale = useLocale();
  const e = employee;
  const totals = e ? totalsOf(e.days) : null;
  const none = e && totals ? daysInMonth - totals.recorded : 0;
  const streak = e ? absentStreak(e.days) : 0;
  const wd = (d: number) => t(`wd.d${weekdayOf(period, d)}` as "wd.d0");

  return (
    <Sheet open={e !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {e && totals && (
          <>
            <SheetHeader className="space-y-1 pb-4 pr-12">
              <SheetTitle className="text-lg leading-6">{nameOf(e)}</SheetTitle>
              <SheetDescription>
                {[e.role, e.terminal_name, monthLabel(period, locale)].filter(Boolean).join(" · ")}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-8">
              {totals.recorded === 0 ? (
                <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t("sheet.noRecords")}</p>
              ) : (
                <>
                  <dl className="grid grid-cols-4 gap-3">
                    {(
                      [
                        ["ontime", totals.ontime],
                        ["late", totals.late],
                        ["absent", totals.absent],
                        ["none", none],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k}>
                        <dd className="text-2xl font-normal tabular-nums">{v}</dd>
                        <dt className="text-xs text-muted-foreground">{t(`sheet.summary.${k}`)}</dt>
                      </div>
                    ))}
                  </dl>
                  {streak >= 2 && <p className="text-sm text-red-700 dark:text-red-400">{t("sheet.streak", { n: streak })}</p>}
                </>
              )}

              <section aria-label={t("sheet.calendar")}>
                <h3 className="mb-2 text-sm font-medium">{t("sheet.calendar")}</h3>
                <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
                  {Array.from({ length: 7 }, (_, i) => (
                    <div key={i}>{t(`wd.d${i}` as "wd.d0")}</div>
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {calendarCells(period, daysInMonth).map((d, i) => {
                    if (d === null) return <div key={`lead-${i}`} />;
                    const entry = e.days[d - 1] ?? null;
                    const s = statusOf(entry);
                    const pending = !s && isPendingDay(period, d, today);
                    return (
                      <div
                        key={d}
                        className={cn(
                          "flex aspect-square flex-col items-center justify-center rounded-md text-sm tabular-nums",
                          s ? CELL[s] : pending ? "text-muted-foreground/50" : "border border-dashed text-muted-foreground",
                          s === "absent" && "text-white",
                          s === "late" && "text-amber-950",
                          focusDay === d && "ring-2 ring-foreground ring-offset-1 ring-offset-background"
                        )}
                      >
                        <span className="leading-none">{d}</span>
                        {s === "late" && entry && <span className="mt-0.5 text-[10px] leading-none">+{entry[1]}</span>}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-medium">{t("sheet.deviations")}</h3>
                {deviations(e.days).length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("sheet.noDeviations")}</p>
                ) : (
                  <ul className="divide-y">
                    {deviations(e.days).map(({ day, entry }) => (
                      <li key={day} className={cn("flex items-baseline gap-3 py-2 text-sm", focusDay === day && "font-medium")}>
                        <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
                          {pad2(day)}.{period.slice(5, 7)} {wd(day)}
                        </span>
                        <span className="min-w-0">
                          <span className={entry[0] === 2 ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}>
                            {entry[0] === 2 ? t("sheet.absent") : t("sheet.late", { min: entry[1] })}
                          </span>
                          {entry[0] === 1 && entry[2] && entry[3] && (
                            <span className="block text-xs text-muted-foreground">{t("sheet.times", { in: entry[2], out: entry[3] })}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <p className="text-xs text-muted-foreground">{t("note")}</p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
