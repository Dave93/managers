"use client";
import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@admin/components/ui/sheet";
import type { BoardEmployee } from "@admin/lib/kpi-api";
import { monthLabel } from "@admin/lib/kpi/periods";
import { nameOf } from "@admin/lib/kpi/timesheet";
import { Link } from "@admin/i18n/routing";
import { AttendanceMonth } from "../../_components/attendance-month";

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

  return (
    <Sheet open={e !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {e && (
          <>
            <SheetHeader className="space-y-1 pb-4 pr-12">
              <SheetTitle className="text-lg leading-6">{nameOf(e)}</SheetTitle>
              <SheetDescription>
                {[e.role, e.terminal_name, monthLabel(period, locale)].filter(Boolean).join(" · ")}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-8">
              <AttendanceMonth days={e.days} period={period} daysInMonth={daysInMonth} today={today} focusDay={focusDay} />
              <Link
                href={`/kpi/employee/${e.id}?period=${period}`}
                className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
              >
                {t("sheet.openCard")}
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
