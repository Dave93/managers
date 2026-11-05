"use client";
import React from "react";
import { useTranslations } from "next-intl";
import type { BoardDay, BoardDayOff } from "@admin/lib/kpi-api";
import { absentStreak, calendarCells, dayOffReasonText, deviations, isPendingDay, statusOf, totalsOf, weekdayOf } from "@admin/lib/kpi/timesheet";
import { cn } from "@admin/lib/utils";
import { CELL, pad2 } from "./day-style";

/**
 * Месяц сотрудника по дням: итоги, календарь с понедельника и список отклонений.
 * Общий для боковой панели табеля и карточки сотрудника; дни приходят в виде записей табеля.
 * off — причины выходных (номер дня → причина и автор): есть у табеля, в карточке сотрудника их нет.
 */
export function AttendanceMonth({
  days,
  off,
  period,
  daysInMonth,
  today,
  focusDay = null,
}: {
  days: readonly (BoardDay | null)[];
  off?: Record<string, BoardDayOff>;
  period: string;
  daysInMonth: number;
  today: string;
  focusDay?: number | null;
}) {
  const t = useTranslations("kpiScreens.timesheet");
  const totals = totalsOf(days);
  const none = daysInMonth - totals.recorded - totals.off;
  const streak = absentStreak(days);
  const wd = (d: number) => t(`wd.d${weekdayOf(period, d)}` as "wd.d0");
  const list = deviations(days);
  const reasonOf = (o: BoardDayOff) => dayOffReasonText(o, (c) => t(`reason.${c}` as "reason.sick"));
  const summary = [
    ["ontime", totals.ontime],
    ["late", totals.late],
    ["absent", totals.absent],
    ...(totals.off > 0 ? ([["dayoff", totals.off]] as const) : []),
    ["none", none],
  ] as const;

  return (
    <div className="space-y-6">
      {totals.recorded === 0 ? (
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t("sheet.noRecords")}</p>
      ) : (
        <>
          <dl className={cn("grid gap-3", totals.off > 0 ? "grid-cols-5" : "grid-cols-4")}>
            {summary.map(([k, v]) => (
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
            const entry = days[d - 1] ?? null;
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
                  s === "dayoff" && "text-sky-950 dark:text-sky-50",
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
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("sheet.noDeviations")}</p>
        ) : (
          <ul className="divide-y">
            {list.map(({ day, entry }) => (
              <li key={day} className={cn("flex items-baseline gap-3 py-2 text-sm", focusDay === day && "font-medium")}>
                <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
                  {pad2(day)}.{period.slice(5, 7)} {wd(day)}
                </span>
                <span className="min-w-0">
                  <span
                    className={
                      entry[0] === 2
                        ? "text-red-700 dark:text-red-400"
                        : entry[0] === 3
                          ? "text-sky-700 dark:text-sky-400"
                          : "text-amber-700 dark:text-amber-400"
                    }
                  >
                    {entry[0] === 2 ? t("sheet.absent") : entry[0] === 3 ? t("sheet.dayoff") : t("sheet.late", { min: entry[1] })}
                  </span>
                  {entry[0] === 1 && entry[2] && entry[3] && (
                    <span className="block text-xs text-muted-foreground">{t("sheet.times", { in: entry[2], out: entry[3] })}</span>
                  )}
                  {entry[0] === 3 && off?.[String(day)] && (
                    <span className="block text-xs text-muted-foreground">
                      {[reasonOf(off[String(day)]), off[String(day)].by ? t("sheet.dayoffBy", { name: off[String(day)].by! }) : null].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </div>
  );
}
