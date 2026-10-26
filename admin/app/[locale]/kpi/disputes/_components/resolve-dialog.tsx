"use client";
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Textarea } from "@admin/components/ui/textarea";
import { kpiApi, type DisputeRow, type ReviewForm } from "@admin/lib/kpi-api";
import { resolveIssues, subjectLabel } from "@admin/lib/kpi/disputes";
import { KpiApiError, kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import { formatTashkent } from "@admin/lib/kpi/format";
import {
  changedItemIds,
  draftFromItems,
  reviewIssues,
  toItemInputs,
  type Draft,
  type DraftItem,
  type IssueCode,
} from "@admin/lib/kpi/review-form";
import { ItemScoreRow } from "../../_components/item-score-row";
import { PhotoThumbs } from "../../_components/photo-thumbs";
import { StaleNote } from "../../_components/stale-note";
import { qk, useKpiMe } from "../../_components/use-kpi";

const FALLBACK_COMMENT_MIN = 5;

export function ResolveDialog({ dispute, onClose }: { dispute: DisputeRow | null; onClose: () => void }) {
  // Тело держим по id спора: черновик баллов и комментарий не переживают смену спора.
  return (
    <Dialog open={dispute !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {dispute ? (
          <ResolveBody key={dispute.id} dispute={dispute} onClose={onClose} />
        ) : (
          <>
            <DialogTitle className="sr-only">Разбор спора</DialogTitle>
            <DialogDescription className="sr-only">Разбор спора</DialogDescription>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResolveBody({ dispute, onClose }: { dispute: DisputeRow; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useKpiMe();
  const commentMin = me.data?.settings.change_comment_min ?? FALLBACK_COMMENT_MIN;
  const [comment, setComment] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  // Какое решение пробовали отправить: ошибки «принять» не показываем после «Отклонить».
  const [tried, setTried] = useState<"accepted" | "rejected" | null>(null);
  const touched = tried !== null;

  const employeeId = dispute.employee_id;
  const isReview = dispute.subject_type === "review";

  const form = useQuery<ReviewForm, Error>({
    queryKey: qk.form(dispute.period, employeeId ?? ""),
    queryFn: () => kpiApi.reviews.form(dispute.period, employeeId!),
    enabled: isReview && employeeId !== null,
    retry: shouldRetry,
    // Пока HR правит баллы, форма под ним не должна меняться.
    refetchOnWindowFocus: false,
  });

  const violations = useQuery({
    queryKey: qk.violations({ period: dispute.period, employee_id: employeeId ?? "" }),
    queryFn: () => kpiApi.violations.list({ period: dispute.period, employee_id: employeeId! }),
    enabled: !isReview && employeeId !== null,
    retry: shouldRetry,
  });
  const violation = violations.data?.find((v) => v.id === dispute.subject_id) ?? null;

  const items = form.data?.items;
  const effective: Draft = useMemo(() => draft ?? (items ? draftFromItems(items) : {}), [draft, items]);
  const changed = items ? changedItemIds(items, effective).length : 0;
  const itemIssues = useMemo(
    () => (items ? reviewIssues(items, effective, "submit", "", 0) : []),
    [items, effective]
  );

  const resolve = useMutation({
    mutationFn: (body: Parameters<typeof kpiApi.disputes.resolve>[1]) => kpiApi.disputes.resolve(dispute.id, body),
    onSuccess: async () => {
      toast.success("Спор разобран");
      await Promise.all(
        [qk.disputesAll, qk.employeesAll, qk.violationsAll, qk.formAll].map((queryKey) => qc.invalidateQueries({ queryKey }))
      );
      onClose();
    },
    onError: (e) => {
      toast.error(kpiErrorText(e));
      // 409 (спор уже разобран, месяц закрыт и т. п.): список споров и форма на экране устарели.
      if (e instanceof KpiApiError && e.status === 409) {
        void qc.invalidateQueries({ queryKey: qk.disputesAll });
        void qc.invalidateQueries({ queryKey: qk.formAll });
      }
    },
  });

  const decide = (decision: "accepted" | "rejected") => {
    if (resolve.isPending) return;
    const subject = isReview ? "review" : "violation";
    const problems = resolveIssues(subject, decision, comment, decision === "accepted" ? changed : 0, commentMin);
    const blocked = problems.length > 0 || (isReview && decision === "accepted" && itemIssues.length > 0);
    if (blocked) {
      setTried(decision);
      return;
    }
    if (isReview && decision === "accepted") {
      if (!items) return;
      resolve.mutate({ decision, comment: comment.trim(), items: toItemInputs(items, effective) });
    } else {
      resolve.mutate({ decision, comment: comment.trim() });
    }
  };

  const setItem = (id: string, v: DraftItem) => setDraft({ ...effective, [id]: v });

  const commentProblems = touched
    ? resolveIssues(isReview ? "review" : "violation", "rejected", comment, 0, commentMin)
    : [];
  const acceptProblems = tried === "accepted"
    ? resolveIssues(isReview ? "review" : "violation", "accepted", comment, changed, commentMin).filter(
        (p) => !commentProblems.includes(p)
      )
    : [];

  const loading = isReview ? form.isPending && form.fetchStatus !== "idle" : violations.isPending && violations.fetchStatus !== "idle";
  const loadError = isReview ? form.error : violations.error;
  // Ошибка закрывает разбор, только пока данных нет: сбой обновления (например, после 409) не стирает правки баллов.
  const hasData = isReview ? form.data !== undefined : violations.data !== undefined;
  const busy = resolve.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Разбор спора</DialogTitle>
        <DialogDescription>
          {[dispute.employee_name, dispute.terminal_name, subjectLabel(dispute)].filter(Boolean).join(" · ")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
        <div className="text-xs text-muted-foreground">Причина спора</div>
        <p className="whitespace-pre-wrap break-words">{dispute.reason}</p>
      </div>

      {employeeId === null ? (
        <p role="alert" className="rounded-md border p-3 text-sm text-muted-foreground">
          Спор без сотрудника (балл филиала) разбирается в фазе 5
        </p>
      ) : loadError != null && !hasData ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(loadError)}
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : (
        <>
          {loadError != null && <StaleNote error={loadError} />}
          {isReview && form.data && (
            <div className="space-y-3">
              {form.data.items.map((item) => {
                const issue = tried === "accepted" ? itemIssues.find((i) => i.item_id === item.item_id)?.code : undefined;
                return (
                  <ItemScoreRow
                    key={item.item_id}
                    item={item}
                    value={effective[item.item_id] ?? { score: item.score, note: item.note ?? "" }}
                    onChange={(v) => setItem(item.item_id, v)}
                    disabled={busy}
                    issue={issue as IssueCode | undefined}
                  />
                );
              })}
            </div>
          )}
          {!isReview &&
            (violation ? (
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <div className="text-xs text-muted-foreground">{formatTashkent(violation.occurred_at)}</div>
                <div className="font-medium">{violation.item_title_ru ?? "Без пункта"}</div>
                <p className="whitespace-pre-wrap break-words">{violation.comment}</p>
                <PhotoThumbs photos={violation.photos} size="md" />
              </div>
            ) : (
              <p role="alert" className="rounded-md border p-3 text-sm text-muted-foreground">
                Нарушение не найдено или недоступно
              </p>
            ))}

          <div className="space-y-2">
            <Textarea
              rows={3}
              value={comment}
              disabled={busy}
              onChange={(e) => setComment(e.target.value)}
              aria-label="Комментарий к решению (его увидит сотрудник)"
              placeholder="Комментарий к решению (его увидит сотрудник)"
            />
            {commentProblems.map((p) => (
              <p key={p} role="alert" className="text-sm text-destructive">
                {p}
              </p>
            ))}
            {acceptProblems.map((p) => (
              <p key={p} role="alert" className="text-sm text-destructive">
                {p}
              </p>
            ))}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onClose}>
              Закрыть
            </Button>
            <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => decide("rejected")}>
              Отклонить
            </Button>
            {isReview ? (
              <Button type="button" className="h-11" disabled={busy || !form.data} onClick={() => decide("accepted")}>
                Принять с новыми баллами
              </Button>
            ) : (
              <Button type="button" className="h-11" disabled={busy || !violation} onClick={() => decide("accepted")}>
                Принять — отменить нарушение
              </Button>
            )}
          </DialogFooter>
        </>
      )}
    </>
  );
}
