"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { DatePickerField } from "@admin/components/ui/date-picker-field";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

// Preview only — the server applies the same rule authoritatively.
function addMonthsClamped(dateIso: string, months: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(
    Math.min(d, lastDay)
  ).padStart(2, "0")}`;
}

export function ScheduleDialog({
  target,
  onClose,
}: {
  target: {
    employeeId: string;
    startDate?: string | null;
    intervalMonths?: number | null;
  } | null;
  onClose: () => void;
}) {
  const t = useTranslations("medical");
  const qc = useQueryClient();
  const [startDate, setStartDate] = useState("");
  const [interval, setInterval] = useState("6");

  useEffect(() => {
    if (target) {
      setStartDate(target.startDate ?? "");
      setInterval(String(target.intervalMonths ?? 6));
    }
  }, [target]);

  const preview = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
    const fmt = (x: string) => new Date(x).toLocaleDateString("ru");
    const today = new Date().toISOString().slice(0, 10);
    const months = Number(interval) || 6;
    return startDate <= today
      ? t("scheduleDialog.passedInfo", {
          date: fmt(startDate),
          next: fmt(addMonthsClamped(startDate, months)),
        })
      : t("scheduleDialog.plannedInfo", { date: fmt(startDate) });
  }, [startDate, interval, t]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.api.medical.schedules.post({
        employee_id: target!.employeeId,
        start_date: startDate,
        interval_months: Number(interval),
      }),
    onSuccess: (res: any) => {
      if (res?.status && res.status >= 400) {
        toast.error(res?.error?.value?.message ?? "Error");
        return;
      }
      toast.success(t("toasts.scheduleSaved"));
      qc.invalidateQueries({ queryKey: ["medical_exams"] });
      qc.invalidateQueries({ queryKey: ["medical_summary"] });
      qc.invalidateQueries({ queryKey: ["medical_employee"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("scheduleDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("scheduleDialog.startDate")}</Label>
            <DatePickerField value={startDate} onChange={setStartDate} />
          </div>
          <div className="space-y-2">
            <Label>{t("scheduleDialog.interval")}</Label>
            <Input
              type="number"
              min={1}
              max={60}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            />
          </div>
          {preview && (
            <p className="text-sm text-muted-foreground">{preview}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !startDate}
          >
            {t("scheduleDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
