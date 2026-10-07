"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Textarea } from "@admin/components/ui/textarea";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime, formatMoney } from "@admin/lib/inventory/money";
import { canChooseDocument } from "@admin/lib/inventory/reconcile";
import type { ReconDetail } from "@backend/modules/inventory/reconcile/types";

function useErr() {
  const t = useTranslations("inventory.reconcile");
  return (e: Error) =>
    toast.error(e instanceof InventoryApiError && e.status === 409 && e.message === "already_running" ? t("alreadyRunning") : e.message);
}

export function ChooseDocument({ detail, onDone }: { detail: ReconDetail; onDone: () => void }) {
  const t = useTranslations("inventory.reconcile");
  const onError = useErr();
  const choose = useMutation({
    mutationFn: (docId: string) => inventoryApi.reconcile.chooseDocument(detail.id, docId),
    onSuccess: onDone,
    onError,
  });
  if (!canChooseDocument(detail)) return null;
  return (
    <div className="space-y-2 rounded border border-destructive/40 p-3">
      <div className="font-medium">{t("choose.title")}</div>
      <div className="text-sm text-muted-foreground">{t("choose.hint")}</div>
      {(detail.iiko_candidates ?? []).map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            №{c.num} · {c.comment ?? "—"} · {t("choose.shortage")} {formatMoney(c.shortage_sum)} · {t("choose.surplus")} {formatMoney(c.surplus_sum)}
          </span>
          <Button size="sm" disabled={choose.isPending} onClick={() => choose.mutate(c.id)}>
            {t("choose.pick")}
          </Button>
        </div>
      ))}
    </div>
  );
}

export function ReviewControls({ detail, onDone }: { detail: ReconDetail; onDone: () => void }) {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  const onError = useErr();
  const [comment, setComment] = useState(detail.review_comment ?? "");
  const set = useMutation({
    mutationFn: (status: "in_review" | "accepted") => inventoryApi.reconcile.setStatus(detail.id, status, comment.trim() || undefined),
    onSuccess: onDone,
    onError,
  });
  if (!["ready", "in_review", "accepted"].includes(detail.status)) return null;
  return (
    <div className="space-y-2 rounded border p-3">
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("review.comment")} rows={2} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={set.isPending}
          onClick={() => (comment.trim() ? set.mutate("in_review") : toast.error(t("review.commentRequired")))}
        >
          {t("review.toReview")}
        </Button>
        {detail.status !== "accepted" && (
          <Button disabled={set.isPending} onClick={() => set.mutate("accepted")}>
            {t("review.accept")}
          </Button>
        )}
        {detail.reviewed_by_name && (
          <span className="text-xs text-muted-foreground">
            {t("review.reviewedBy", { name: detail.reviewed_by_name, at: formatDateTime(detail.reviewed_at, locale) })}
          </span>
        )}
      </div>
    </div>
  );
}

export function CountsPanel({ detail }: { detail: ReconDetail }) {
  const t = useTranslations("inventory.reconcile");
  const tStatus = useTranslations("inventory.status");
  if (!detail.counts.length) return null;
  return (
    <div className="space-y-2 rounded border p-3">
      <div className="font-medium">{t("counts.title")}</div>
      {detail.counts.map((c) => (
        <div key={c.id} className="text-sm">
          {c.template_name} · {tStatus(c.status as any)}
        </div>
      ))}
    </div>
  );
}

export function RefreshButton({ detail, onQueued }: { detail: ReconDetail; onQueued: () => void }) {
  const t = useTranslations("inventory.reconcile");
  const onError = useErr();
  const refresh = useMutation({ mutationFn: () => inventoryApi.reconcile.refresh(detail.id), onSuccess: onQueued, onError });
  return (
    <Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
      {t("refresh")}
    </Button>
  );
}
