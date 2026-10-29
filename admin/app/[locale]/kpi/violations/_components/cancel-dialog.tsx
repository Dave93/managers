"use client";
import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Textarea } from "@admin/components/ui/textarea";
import { kpiApi, type ViolationRow } from "@admin/lib/kpi-api";
import { kpiErrorText } from "@admin/lib/kpi/errors";
import { formatTashkent } from "@admin/lib/kpi/format";
import { VIOLATION_COMMENT_MIN, cancelReasonOk } from "@admin/lib/kpi/violation-form";
import { qk } from "../../_components/use-kpi";

/** Отмена нарушения. Причина — не меньше 3 букв или цифр: сервер проверяет её через commentOk(reason, 3). */
export function CancelViolationDialog({ violation, onClose }: { violation: ViolationRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setReason("");
    setTouched(false);
  }, [violation?.id]);

  const ok = cancelReasonOk(reason);

  const cancel = useMutation({
    mutationFn: (v: ViolationRow) => kpiApi.violations.cancel(v.id, reason.trim()),
    onSuccess: async () => {
      toast.success("Нарушение отменено");
      await Promise.all([qk.violationsAll, qk.formAll].map((queryKey) => qc.invalidateQueries({ queryKey })));
      onClose();
    },
    onError: (e) => toast.error(kpiErrorText(e)),
  });

  const submit = () => {
    if (!violation || cancel.isPending) return;
    if (!ok) {
      setTouched(true);
      return;
    }
    cancel.mutate(violation);
  };

  return (
    <Dialog open={violation !== null} onOpenChange={(o) => !o && !cancel.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Отменить нарушение</DialogTitle>
          <DialogDescription>
            {violation ? `${violation.employee_name}, ${formatTashkent(violation.occurred_at)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-label="Причина отмены"
            placeholder="Причина отмены"
          />
          <p className={touched && !ok ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
            Не меньше {VIOLATION_COMMENT_MIN} букв или цифр
          </p>
          <p className="text-xs text-muted-foreground">Причину отмены увидит сотрудник</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" disabled={cancel.isPending} onClick={onClose}>
            Назад
          </Button>
          <Button type="button" variant="destructive" className="h-11" disabled={cancel.isPending} onClick={submit}>
            Отменить нарушение
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
