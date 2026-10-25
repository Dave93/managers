"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@admin/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { Textarea } from "@admin/components/ui/textarea";
import { kpiApi, type EmployeeRow, type ReviewForm } from "@admin/lib/kpi-api";
import { KpiApiError, kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import { employeeName } from "@admin/lib/kpi/filters";
import { formatPct, formatTashkent } from "@admin/lib/kpi/format";
import { monthLabel, submitOpen } from "@admin/lib/kpi/periods";
import {
  draftFromItems,
  issueText,
  previewPct,
  reviewIssues,
  reviewMode,
  toItemInputs,
  type Draft,
  type DraftItem,
  type FormIssue,
} from "@admin/lib/kpi/review-form";
import { ROW_STATUS, rowStatus } from "@admin/lib/kpi/status";
import { ItemScoreRow } from "../../_components/item-score-row";
import { KpiBadge } from "../../_components/kpi-badge";
import { OpenDisputeDialog } from "../../_components/open-dispute-dialog";
import { PhotoThumbs } from "../../_components/photo-thumbs";
import { StaleNote } from "../../_components/stale-note";
import { qk } from "../../_components/use-kpi";
import { ReviewHistory } from "./review-history";

const CONFIRM_TEXT = "Есть несохранённые изменения. Закрыть без сохранения?";

export function ReviewSheet({
  period,
  row,
  commentMin,
  onClose,
}: {
  period: string;
  row: EmployeeRow | null;
  commentMin: number;
  onClose: () => void;
}) {
  // Тело сообщает, есть ли несохранённые правки; закрытие панели решает снаружи.
  const dirtyRef = useRef(false);
  const requestClose = () => {
    if (dirtyRef.current && !window.confirm(CONFIRM_TEXT)) return;
    dirtyRef.current = false;
    onClose();
  };

  return (
    <Sheet open={row !== null} onOpenChange={(o) => !o && requestClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        {row ? (
          <ReviewSheetBody key={`${period}:${row.id}`} period={period} row={row} commentMin={commentMin} dirtyRef={dirtyRef} />
        ) : (
          <>
            <SheetTitle className="sr-only">Оценка сотрудника</SheetTitle>
            <SheetDescription className="sr-only">Оценка сотрудника</SheetDescription>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReviewSheetBody({
  period,
  row,
  commentMin,
  dirtyRef,
}: {
  period: string;
  row: EmployeeRow;
  commentMin: number;
  dirtyRef: React.MutableRefObject<boolean>;
}) {
  const qc = useQueryClient();
  const formKey = qk.form(period, row.id);
  const form = useQuery<ReviewForm, KpiApiError>({
    queryKey: formKey,
    queryFn: () => kpiApi.reviews.form(period, row.id),
    retry: shouldRetry,
  });
  const data = form.data;

  const [tab, setTab] = useState("form");
  const [draft, setDraft] = useState<Draft>({});
  const [dirty, setDirty] = useState(false);
  const [comment, setComment] = useState("");
  const [issues, setIssues] = useState<FormIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  // Синхронная защёлка: state обновится только после рендера, а второй тап приходит раньше.
  const latch = useRef(false);

  // Свежая форма пересобирает черновик, пока правок нет.
  useEffect(() => {
    if (data && !dirty) setDraft(draftFromItems(data.items));
  }, [data, dirty]);

  const hasEdits = dirty || comment.trim() !== "";
  useEffect(() => {
    dirtyRef.current = hasEdits;
    return () => {
      dirtyRef.current = false;
    };
  }, [hasEdits, dirtyRef]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const review = data?.review ?? row.review;
  const reviewId = review?.id ?? null;
  const mode = data ? reviewMode(data.can_edit, data.review?.status ?? null) : "readonly";
  const frozen = !data || mode === "readonly";
  const pct = data ? previewPct(items, draft) : null;
  const status = ROW_STATUS[rowStatus({ review, open_dispute: data?.open_dispute ?? row.open_dispute })];
  const issueByItem = new Map(issues.filter((i) => i.item_id).map((i) => [i.item_id!, i.code] as const));
  const commentIssue = issues.find((i) => i.code === "comment_required" || i.code === "no_changes");

  const valueOf = (itemId: string): DraftItem => {
    const it = items.find((i) => i.item_id === itemId)!;
    return draft[itemId] ?? { score: it.score, note: it.note ?? "" };
  };
  const setItem = (itemId: string, v: DraftItem) => {
    setDraft((d) => ({ ...d, [itemId]: v }));
    setDirty(true);
    setIssues((is) => is.filter((i) => i.item_id !== itemId));
  };

  const finish = (result: ReviewForm, okText: string) => {
    setDirty(false);
    setComment("");
    setIssues([]);
    qc.setQueryData(formKey, result);
    void qc.invalidateQueries({ queryKey: qk.employeesAll });
    if (result.review) void qc.invalidateQueries({ queryKey: qk.events(result.review.id) });
    toast.success(okText);
  };

  const fail = (e: unknown) => {
    if (e instanceof KpiApiError && e.code === "missing_items" && Array.isArray(e.body.items)) {
      setIssues((e.body.items as string[]).map((id) => ({ code: "score_required", item_id: id })));
    } else if (e instanceof KpiApiError && e.code === "note_required" && typeof e.body.item_id === "string") {
      setIssues([{ code: "note_required", item_id: e.body.item_id }]);
    }
    toast.error(kpiErrorText(e));
    // 409 значит, что форма на экране устарела (месяц закрыт, спор открыт, уже отправлена).
    if (e instanceof KpiApiError && e.status === 409) {
      void qc.invalidateQueries({ queryKey: formKey });
      void qc.invalidateQueries({ queryKey: qk.employeesAll });
    }
  };

  const run = async (action: "draft" | "submit" | "change") => {
    if (latch.current || !data) return;
    const found = reviewIssues(items, draft, action, comment, commentMin);
    if (found.length > 0) {
      setIssues(found);
      toast.error(issueText(found[0], commentMin));
      return;
    }
    latch.current = true;
    setBusy(true);
    setIssues([]);
    try {
      const inputs = toItemInputs(items, draft);
      if (action === "change") {
        finish(await kpiApi.reviews.change(data.review!.id, inputs, comment.trim()), "Изменения сохранены");
      } else if (action === "draft") {
        finish(await kpiApi.reviews.saveDraft(period, row.id, inputs), "Черновик сохранён");
      } else if (data.review) {
        finish(await kpiApi.reviews.submit(data.review.id, inputs), "Оценка отправлена");
      } else {
        const saved = await kpiApi.reviews.saveDraft(period, row.id, inputs);
        // Черновик уже на сервере: кладём его в кэш, чтобы повтор после ошибки отправки не создавал второй.
        qc.setQueryData(formKey, saved);
        finish(await kpiApi.reviews.submit(saved.review!.id), "Оценка отправлена");
      }
    } catch (e) {
      fail(e);
    } finally {
      latch.current = false;
      setBusy(false);
    }
  };

  const baseItems = items.filter((i) => i.group_key === "base");
  const extraItems = items.filter((i) => i.group_key === "extra");
  const renderItem = (i: (typeof items)[number]) => (
    <ItemScoreRow
      key={i.item_id}
      item={i}
      value={valueOf(i.item_id)}
      onChange={(v) => setItem(i.item_id, v)}
      disabled={frozen || busy}
      issue={issueByItem.get(i.item_id)}
    />
  );

  const canSubmit = data ? submitOpen(new Date(), data.deadlines) : false;
  const disputeBlocks = mode === "change" && data?.open_dispute === true;

  return (
    <>
      <SheetHeader className="space-y-1 border-b p-4 pr-12 text-left">
        <SheetTitle>{employeeName(row)}</SheetTitle>
        <SheetDescription asChild>
          <div className="space-y-1">
            <div>
              {row.terminal_name ?? "Филиал без названия"} · {data?.card.title_ru ?? row.card?.title_ru ?? "Без карты"} ·{" "}
              {monthLabel(period)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <KpiBadge tone={status.tone}>{status.label}</KpiBadge>
              <span className="tabular-nums">{formatPct(review?.score_pct ?? null)}</span>
            </div>
          </div>
        </SheetDescription>
      </SheetHeader>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="px-4 pt-3">
          <TabsList>
            <TabsTrigger value="form">Оценка</TabsTrigger>
            <TabsTrigger value="history" disabled={reviewId === null}>
              История
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="form" className="min-h-0 flex-1 flex-col data-[state=active]:flex">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {/* Ошибка закрывает форму, только пока данных нет: сбой фонового обновления не стирает правки. */}
            {form.error && !data ? (
              <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
                {kpiErrorText(form.error)}
              </p>
            ) : !data ? (
              <p className="text-sm text-muted-foreground">Загрузка…</p>
            ) : (
              <>
                {form.error && <StaleNote error={form.error} />}
                {baseItems.map(renderItem)}
                {extraItems.length > 0 && (
                  <>
                    <h3 className="pt-2 text-sm font-semibold">Дополнительные пункты</h3>
                    {extraItems.map(renderItem)}
                  </>
                )}
                {data.other_violations.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold">Нарушения без пункта</h3>
                    <ul className="space-y-2">
                      {data.other_violations.map((v) => (
                        <li key={v.id} className="space-y-1 rounded border p-2 text-sm">
                          <div className="text-xs text-muted-foreground">{formatTashkent(v.occurred_at)}</div>
                          <div>{v.comment}</div>
                          <PhotoThumbs photos={v.photos} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <div className="text-sm font-medium tabular-nums">Итог: {formatPct(pct)}</div>
              </>
            )}
          </div>

          {data && (
            <div className="sticky bottom-0 space-y-3 border-t bg-background p-4">
              {mode === "readonly" && (
                <div className="space-y-1 text-sm">
                  <div className="font-medium">Только просмотр</div>
                  <div className="text-muted-foreground">
                    {data.period_status === "closed" ? "Месяц закрыт" : "Нет прав на изменение этой оценки"}
                  </div>
                </div>
              )}

              {(mode === "new" || mode === "draft") && (
                <>
                  {!canSubmit && (
                    <p className="text-sm text-muted-foreground">
                      Отправка откроется {formatTashkent(data.deadlines.submit_opens_at)}
                    </p>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" disabled={busy} onClick={() => run("draft")}>
                      Сохранить черновик
                    </Button>
                    <Button type="button" className="h-11 w-full sm:w-auto" disabled={busy || !canSubmit} onClick={() => run("submit")}>
                      Отправить
                    </Button>
                  </div>
                </>
              )}

              {mode === "change" && (
                <>
                  {disputeBlocks && (
                    <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
                      По оценке открыт спор — изменить можно только через разбор спора
                    </p>
                  )}
                  <div className="space-y-1">
                    <Textarea
                      rows={2}
                      value={comment}
                      disabled={busy}
                      onChange={(e) => {
                        setComment(e.target.value);
                        setIssues((is) => is.filter((i) => i.code !== "comment_required" && i.code !== "no_changes"));
                      }}
                      aria-label="Комментарий к изменению"
                      placeholder="Комментарий к изменению"
                    />
                    <p className="text-xs text-muted-foreground">Не меньше {commentMin} символов без пробелов</p>
                    {commentIssue && (
                      <p role="alert" className="text-sm text-destructive">
                        {issueText(commentIssue, commentMin)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    {!data.open_dispute && !row.open_dispute && data.period_status === "open" && data.review && (
                      <Button type="button" variant="link" className="h-11" onClick={() => setDisputeOpen(true)}>
                        Оспорить от имени сотрудника
                      </Button>
                    )}
                    <Button
                      type="button"
                      className="h-11 w-full sm:w-auto"
                      disabled={busy || disputeBlocks}
                      onClick={() => run("change")}
                    >
                      Сохранить изменения
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-4">
          {reviewId && <ReviewHistory reviewId={reviewId} />}
        </TabsContent>
      </Tabs>

      <OpenDisputeDialog
        subject={
          disputeOpen && data?.review
            ? { type: "review", id: data.review.id, title: `Оценка: ${employeeName(row)}, ${monthLabel(period)}` }
            : null
        }
        commentMin={commentMin}
        onClose={() => setDisputeOpen(false)}
      />
    </>
  );
}
