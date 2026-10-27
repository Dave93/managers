"use client";
import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Textarea } from "@admin/components/ui/textarea";
import { kpiApi } from "@admin/lib/kpi-api";
import { kpiErrorText } from "@admin/lib/kpi/errors";
import { commentOk } from "@admin/lib/kpi/review-form";
import { qk } from "./use-kpi";

/** Открыть спор от имени сотрудника (оценка или нарушение). */
export function OpenDisputeDialog({
  subject,
  commentMin,
  onClose,
}: {
  subject: { type: "review" | "violation"; id: string; title: string } | null;
  commentMin: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setReason("");
    setTouched(false);
  }, [subject?.type, subject?.id]);

  const ok = commentOk(reason, commentMin);

  const open = useMutation({
    mutationFn: (s: NonNullable<typeof subject>) =>
      kpiApi.disputes.open({ subject_type: s.type, subject_id: s.id, reason: reason.trim() }),
    onSuccess: async () => {
      toast.success("Спор открыт");
      await Promise.all(
        [qk.employeesAll, qk.violationsAll, qk.disputesAll, qk.formAll].map((queryKey) => qc.invalidateQueries({ queryKey }))
      );
      onClose();
    },
    onError: (e) => toast.error(kpiErrorText(e)),
  });

  const submit = () => {
    if (!subject || open.isPending) return;
    if (!ok) {
      setTouched(true);
      return;
    }
    open.mutate(subject);
  };

  return (
    <Dialog open={subject !== null} onOpenChange={(o) => !o && !open.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Оспорить от имени сотрудника</DialogTitle>
          <DialogDescription>{subject?.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-label="Причина спора со слов сотрудника"
            placeholder="Причина спора со слов сотрудника"
          />
          <p className={touched && !ok ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
            Не меньше {commentMin} символов без пробелов
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" disabled={open.isPending} onClick={onClose}>
            Отмена
          </Button>
          <Button type="button" className="h-11" disabled={open.isPending} onClick={submit}>
            Открыть спор
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
