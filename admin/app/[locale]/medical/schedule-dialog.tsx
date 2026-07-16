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
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

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
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
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
