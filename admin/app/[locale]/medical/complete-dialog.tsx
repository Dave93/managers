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
import { Textarea } from "@components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

// Preview only — the server recomputes the next due date authoritatively.
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

export function CompleteDialog({
  exam,
  onClose,
}: {
  exam: { examId: string; intervalMonths: number } | null;
  onClose: () => void;
}) {
  const t = useTranslations("medical");
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [result, setResult] = useState("fit");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (exam) {
      setDate(today);
      setResult("fit");
      setNotes("");
    }
  }, [exam]);

  const nextDate = useMemo(
    () =>
      exam && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? addMonthsClamped(date, exam.intervalMonths)
        : null,
    [exam, date]
  );

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.api.medical.exams({ id: exam!.examId }).complete.post({
        completed_date: date,
        result: result as any,
        ...(notes ? { notes } : {}),
      }),
    onSuccess: (res: any) => {
      if (res?.status && res.status >= 400) {
        toast.error(res?.error?.value?.message ?? "Error");
        return;
      }
      toast.success(t("toasts.completed"));
      qc.invalidateQueries({ queryKey: ["medical_exams"] });
      qc.invalidateQueries({ queryKey: ["medical_summary"] });
      qc.invalidateQueries({ queryKey: ["medical_employee"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={!!exam} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("completeDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("completeDialog.date")}</Label>
            <Input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("completeDialog.result")}</Label>
            <Select value={result} onValueChange={setResult}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fit">{t("completeDialog.fit")}</SelectItem>
                <SelectItem value="fit_restricted">
                  {t("completeDialog.fit_restricted")}
                </SelectItem>
                <SelectItem value="unfit">
                  {t("completeDialog.unfit")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("completeDialog.notes")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {nextDate && (
            <p className="text-sm text-muted-foreground">
              {t("completeDialog.nextInfo", {
                date: new Date(nextDate).toLocaleDateString("ru"),
              })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !date}
          >
            {t("completeDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
