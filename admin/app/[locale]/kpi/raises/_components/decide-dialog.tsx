"use client";
import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { Textarea } from "@admin/components/ui/textarea";
import { kpiApi, type RaiseRow } from "@admin/lib/kpi-api";
import { kpiErrorText } from "@admin/lib/kpi/errors";
import { formatSum } from "@admin/lib/kpi/format";
import { quarterLabel } from "@admin/lib/kpi/periods";
import { commentReason, decisionBody, decisionIssues, type DecisionInput } from "@admin/lib/kpi/raises";
import { qk } from "../../_components/use-kpi";

export function DecideDialog({ row, cap, onClose }: { row: RaiseRow | null; cap: number; onClose: () => void }) {
  // Тело держим по id строки: введённое не переживает смену строки.
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {row ? (
          <DecideBody key={row.id} row={row} cap={cap} onClose={onClose} onPending={setPending} />
        ) : (
          <>
            <DialogTitle className="sr-only">Решение по повышению</DialogTitle>
            <DialogDescription className="sr-only">Решение по повышению</DialogDescription>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DecideBody({ row, cap, onClose, onPending }: { row: RaiseRow; cap: number; onClose: () => void; onPending: (p: boolean) => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<DecisionInput["status"]>("approved");
  const [amount, setAmount] = useState(String(row.suggested_amount));
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);

  const input: DecisionInput = { status, amount, comment };
  const issues = decisionIssues(row, input, cap);
  const reason = commentReason(row, input);
  const unresolved = row.status === "proposed" || row.status === "insufficient";
  const hardBlock = issues.includes("stale") || issues.includes("periods_open");
  const quarter = row.quarter_start;

  const decide = useMutation({
    mutationFn: () => kpiApi.raises.decide(row.id, decisionBody(input)),
    onSuccess: (updated) => {
      qc.setQueryData<RaiseRow[]>(qk.raises(quarter), (rows) => rows?.map((r) => (r.id === updated.id ? updated : r)));
      toast.success("Решение сохранено");
      onClose();
    },
    onError: (e) => toast.error(kpiErrorText(e)),
  });

  const save = () => {
    if (decide.isPending || hardBlock) return;
    if (issues.length > 0) {
      setTouched(true);
      return;
    }
    decide.mutate();
  };

  const busy = decide.isPending;
  useEffect(() => {
    onPending(busy);
    return () => onPending(false);
  }, [busy, onPending]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Решение по повышению</DialogTitle>
        <DialogDescription>
          {[row.employee_name, row.terminal_name, quarterLabel(quarter)].filter(Boolean).join(" · ")}
        </DialogDescription>
      </DialogHeader>

      <p className="text-sm text-muted-foreground">Предложение: {formatSum(row.suggested_amount)}</p>

      {issues.includes("periods_open") && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          Не все месяцы квартала закрыты — решение сохранить нельзя
        </p>
      )}
      {row.stale && unresolved && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          Оценки менялись после расчёта — нажмите «Пересчитать»
        </p>
      )}

      <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Решение">
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="radio"
            name={`decision-${row.id}`}
            checked={status === "approved"}
            disabled={busy}
            onChange={() => setStatus("approved")}
          />
          Утвердить
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="radio"
            name={`decision-${row.id}`}
            checked={status === "rejected"}
            disabled={busy}
            onChange={() => setStatus("rejected")}
          />
          Отказать
        </label>
      </div>

      {status === "approved" && (
        <div className="space-y-1">
          <Input
            inputMode="numeric"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Сумма повышения"
            className="h-11"
          />
          {issues.includes("bad_amount") && (
            <p role="alert" className="text-sm text-destructive">
              Сумма — целое число от 0 до {formatSum(cap)}
            </p>
          )}
        </div>
      )}

      <div className="space-y-1">
        {reason !== null && <p className="text-sm text-muted-foreground">Нужен комментарий: {reason}</p>}
        <Textarea
          rows={3}
          value={comment}
          disabled={busy}
          onChange={(e) => setComment(e.target.value)}
          aria-label="Комментарий"
          placeholder="Комментарий"
        />
        {touched && issues.includes("comment_required") && (
          <p role="alert" className="text-sm text-destructive">
            Нужен комментарий
          </p>
        )}
      </div>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onClose}>
          Отмена
        </Button>
        <Button type="button" className="h-11" disabled={busy || hardBlock} onClick={save}>
          Сохранить
        </Button>
      </DialogFooter>
    </>
  );
}
