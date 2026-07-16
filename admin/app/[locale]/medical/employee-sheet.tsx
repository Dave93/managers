"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@components/ui/sheet";
import { Button } from "@admin/components/ui/buttonOrigin";
import { useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { StatusBadge } from "./status-badge";

export function EmployeeSheet({
  employeeId,
  onClose,
  onComplete,
  onSchedule,
}: {
  employeeId: string | null;
  onClose: () => void;
  onComplete: (examId: string, intervalMonths: number) => void;
  onSchedule: (
    employeeId: string,
    startDate?: string | null,
    intervalMonths?: number | null
  ) => void;
}) {
  const t = useTranslations("medical");
  const { data: res } = useQuery({
    queryKey: ["medical_employee", employeeId],
    queryFn: () => apiClient.api.medical.employees({ id: employeeId! }).get({}),
    enabled: !!employeeId,
  });
  const d = ((res as any)?.data ?? null) as any;
  const fmt = (x: string) => new Date(x).toLocaleDateString("ru");

  return (
    <Sheet open={!!employeeId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto p-6">
        {d?.employee && (
          <>
            <SheetHeader>
              <SheetTitle>
                {d.employee.first_name} {d.employee.last_name}
              </SheetTitle>
            </SheetHeader>
            <div className="mt-6 space-y-6">
              {!d.schedule && (
                <p className="text-muted-foreground">{t("sheet.noSchedule")}</p>
              )}
              {d.projections?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">
                    {t("sheet.upcoming")}
                  </h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {d.projections.slice(0, 6).map((p: string) => (
                      <li key={p} className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-gray-300" />
                        {fmt(p)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.open_exam && (
                <div className="border rounded-md p-3">
                  <div className="text-sm font-semibold">{t("sheet.next")}</div>
                  <div className="text-lg">
                    {fmt(d.open_exam.planned_due_date)}
                  </div>
                </div>
              )}
              <div>
                <h4 className="text-sm font-semibold mb-2">
                  {t("sheet.history")}
                </h4>
                {d.history?.length ? (
                  <ul className="space-y-3">
                    {d.history.map((h: any) => (
                      <li key={h.id} className="border-l-2 pl-3 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {fmt(h.completed_date)}
                          </span>
                          <StatusBadge
                            status={h.result === "unfit" ? "unfit" : "ok"}
                          />
                          <span className="text-xs text-muted-foreground">
                            {t(`completeDialog.${h.result}` as any)}
                          </span>
                        </div>
                        {h.notes && (
                          <div className="text-sm text-muted-foreground">
                            {h.notes}
                          </div>
                        )}
                        {h.recorded_by_name && (
                          <div className="text-xs text-muted-foreground">
                            {t("sheet.recordedBy")}: {h.recorded_by_name}{" "}
                            {h.recorded_by_last_name}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
              <CanAccess permission="medical.edit">
                <div className="flex gap-2 pt-2">
                  {d.open_exam && (
                    <Button
                      onClick={() =>
                        onComplete(
                          d.open_exam.id,
                          d.schedule?.interval_months ?? 6
                        )
                      }
                    >
                      {t("completeDialog.title")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() =>
                      onSchedule(
                        d.employee.id,
                        d.schedule?.start_date,
                        d.schedule?.interval_months
                      )
                    }
                  >
                    {t("scheduleDialog.title")}
                  </Button>
                </div>
              </CanAccess>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
