"use client";
import React, { memo, useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import type { BoardEmployee } from "@admin/lib/kpi-api";
import {
  formatShare,
  dayOffReasonText,
  isPendingDay,
  nameOf,
  statusOf,
  todayInPeriod,
  totalsOf,
  weekdayOf,
  type BranchStat,
  type Group,
} from "@admin/lib/kpi/timesheet";
import { cn } from "@admin/lib/utils";
import { CELL, EMPTY_DASH, pad2 } from "../../_components/day-style";

// Раскладка: имя 200px (липкое) + N клеток по 22px + два итога по 56px. Клетки 16px внутри ячейки 22px:
// на 31 день это 682px, вместе с именем и итогами около 1000px, то есть помещается в канву на экране 1440.
// Шире окна — прокрутка внутри панели, имя и шапка остаются на месте.
const DAY_W = "w-[22px] min-w-[22px]";

type Props = {
  period: string;
  daysInMonth: number;
  today: string;
  groups: Group[];
  /** Заголовки филиалов нужны, когда в списке больше одного филиала */
  showGroups: boolean;
  stats: Map<string, BranchStat>;
  onOpen: (employeeId: string, day: number | null) => void;
};

export function MonthMatrix({ period, daysInMonth, today, groups, showGroups, stats, onOpen }: Props) {
  const t = useTranslations("kpiScreens.timesheet");
  const tipRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);
  const todayDay = todayInPeriod(period, today);
  const colSpan = daysInMonth + 3;

  // Подсказка двигается мимо React: на 10 000 клеток состояние мыши не должно перерисовывать таблицу.
  const onMove = useCallback((ev: React.MouseEvent) => {
    const tip = tipRef.current;
    if (!tip) return;
    const td = (ev.target as HTMLElement).closest<HTMLElement>("td[data-tip]");
    if (!td) {
      tip.style.display = "none";
      return;
    }
    tip.textContent = td.dataset.tip ?? "";
    tip.style.display = "block";
    tip.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 14}px)`;
  }, []);
  const onLeave = useCallback(() => {
    if (tipRef.current) tipRef.current.style.display = "none";
  }, []);
  const onClick = useCallback(
    (ev: React.MouseEvent) => {
      const td = (ev.target as HTMLElement).closest<HTMLElement>("td[data-d]");
      const tr = td?.closest<HTMLElement>("tr[data-id]");
      if (td && tr) onOpen(tr.dataset.id!, Number(td.dataset.d));
    },
    [onOpen]
  );

  const tip = useMemo(
    () => ({
      ontime: t("tip.ontime"),
      absent: t("tip.absent"),
      dayoff: t("tip.dayoff"),
      none: t("tip.none"),
    }),
    [t]
  );
  const wd = useMemo(() => Array.from({ length: 7 }, (_, i) => t(`wd.d${i}` as "wd.d0")), [t]);

  return (
    <div className="relative max-h-[calc(100vh-17rem)] min-h-64 overflow-auto" onMouseMove={onMove} onMouseLeave={onLeave} onScroll={onLeave}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 top-0 z-30 min-w-[200px] border-b bg-background py-2 pr-3 text-left text-xs font-normal text-muted-foreground"
            >
              {t("cols.employee")}
            </th>
            {days.map((d) => {
              const weekend = weekdayOf(period, d) >= 5;
              return (
                <th
                  key={d}
                  scope="col"
                  className={cn("sticky top-0 z-20 border-b bg-background p-0 text-center font-normal", DAY_W)}
                >
                  <div className={cn("pt-1.5 text-[11px] tabular-nums", d === todayDay ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {d}
                  </div>
                  <div className={cn("pb-1.5 text-[11px]", weekend ? "font-medium text-foreground" : "text-muted-foreground")}>
                    {wd[weekdayOf(period, d)]}
                  </div>
                  {d === todayDay && <div className="mx-auto -mt-px h-0.5 w-4 bg-foreground" aria-hidden />}
                </th>
              );
            })}
            <th scope="col" className="sticky top-0 z-20 w-14 min-w-14 border-b bg-background py-2 pl-2 pr-3 text-right text-xs font-normal text-muted-foreground">
              {t("cols.absent")}
            </th>
            <th scope="col" className="sticky top-0 z-20 w-14 min-w-14 border-b bg-background py-2 pr-1 text-right text-xs font-normal text-muted-foreground">
              {t("cols.late")}
            </th>
          </tr>
        </thead>
        <tbody onClick={onClick}>
          {groups.map((g) => {
            const st = stats.get(g.id);
            return (
              <React.Fragment key={g.id}>
                {showGroups && (
                  <tr>
                    <td colSpan={colSpan} className="pb-1.5 pt-6">
                      <div className="sticky left-0 flex w-fit items-baseline gap-3">
                        <span className="text-sm font-semibold">{g.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {t("group.meta", { n: g.employees.length })}
                          {st && st.share !== null ? ` · ${t("group.share", { share: formatShare(st.share) })}` : ""}
                        </span>
                        {st?.above && (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                            {t("group.above")}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {g.employees.map((e) => (
                  <Row key={e.id} e={e} period={period} days={days} today={today} tip={tip} wd={wd} onName={onOpen} />
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <div
        ref={tipRef}
        role="presentation"
        className="pointer-events-none fixed left-0 top-0 z-50 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background"
      />
    </div>
  );
}

type RowProps = {
  e: BoardEmployee;
  period: string;
  days: number[];
  today: string;
  tip: { ontime: string; absent: string; dayoff: string; none: string };
  wd: string[];
  onName: (employeeId: string, day: number | null) => void;
};

const Row = memo(function Row({ e, period, days, today, tip, wd, onName }: RowProps) {
  const t = useTranslations("kpiScreens.timesheet");
  const totals = totalsOf(e.days);
  const hover = "group-hover:bg-muted";
  return (
    <tr data-id={e.id} className="group cursor-pointer">
      <th
        scope="row"
        className={cn("sticky left-0 z-10 h-9 min-w-[200px] bg-background pr-3 text-left font-normal", hover, !e.active && "opacity-60")}
      >
        <button type="button" onClick={() => onName(e.id, null)} className="block max-w-[190px] text-left outline-none focus-visible:underline">
          <span className="block truncate text-[13px] leading-4">{nameOf(e)}</span>
          {e.role && <span className="block truncate text-[11px] leading-4 text-muted-foreground">{e.role}</span>}
        </button>
      </th>
      {days.map((d) => {
        const entry = e.days[d - 1] ?? null;
        const s = statusOf(entry);
        // У выходного в подсказке ещё и причина (управляющий и HR её видят).
        const off = s === "dayoff" ? e.off?.[String(d)] : undefined;
        const reason = off ? ` · ${dayOffReasonText(off, (c) => t(`reason.${c}` as "reason.sick"))}` : "";
        const label = `${pad2(d)}.${period.slice(5, 7)} ${wd[weekdayOf(period, d)]}: ${
          s === "late" ? t("tip.late", { min: entry![1] }) : s ? `${tip[s]}${reason}` : tip.none
        }`;
        const pending = !s && isPendingDay(period, d, today);
        return (
          <td
            key={d}
            data-d={d}
            data-tip={pending ? undefined : label}
            className={cn("p-0 text-center", DAY_W, weekdayOf(period, d) >= 5 ? "bg-muted/40" : "", hover)}
          >
            {s ? (
              <span className={cn("mx-auto block size-4 rounded-[4px]", CELL[s])} />
            ) : pending ? null : (
              <span className={cn("mx-auto", EMPTY_DASH)} />
            )}
          </td>
        );
      })}
      <td className={cn("pl-2 pr-3 text-right text-[13px] tabular-nums", hover, totals.absent ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
        {totals.recorded === 0 ? "—" : totals.absent}
      </td>
      <td className={cn("pr-1 text-right text-[13px] tabular-nums", hover, totals.late ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
        {totals.recorded === 0 ? "—" : totals.late}
      </td>
    </tr>
  );
});
