"use client";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@admin/components/ui/button";
import { periodLabel } from "@admin/lib/inventory/periods";
import type { OverlayDetail } from "@admin/lib/inventory/queue";
import { StatusBadge } from "./status-badge";

export function CountHeader({
  detail,
  online,
  pendingCount,
  rejectedCount,
  authExpired,
  onDismissRejected,
  onResendRejected,
}: {
  detail: OverlayDetail;
  online: boolean;
  pendingCount: number;
  rejectedCount: number;
  authExpired: boolean;
  onDismissRejected: () => void;
  onResendRejected: () => void;
}) {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const pct = detail.lines_total ? Math.round((detail.lines_done / detail.lines_total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{detail.store_name}</h1>
        <StatusBadge status={detail.status} />
        {detail.access === "read" && <span className="text-sm text-muted-foreground">{t("readOnly")}</span>}
      </div>
      <div className="text-sm text-muted-foreground">
        {detail.template_id ? detail.template_name : t("branchAll")} · {periodLabel(detail.period, locale)}
      </div>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 rounded bg-muted overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-sm tabular-nums">{t("progress", { done: detail.lines_done, total: detail.lines_total })}</span>
        <span className={`text-sm ${online ? "text-green-600" : "text-orange-600"}`}>
          {online ? "●" : "○"} {online ? t("sync.online") : t("sync.offline")}
        </span>
        {pendingCount > 0 && <span className="text-sm text-orange-600">{t("sync.pending", { count: pendingCount })}</span>}
      </div>
      {authExpired && (
        <div className="rounded border border-orange-500/40 bg-orange-500/10 p-3 text-sm">{t("sync.auth")}</div>
      )}
      {rejectedCount > 0 && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm flex items-start justify-between gap-3">
          <span>
            {detail.status === "draft" && detail.access === "write"
              ? t("sync.rejectedDraft", { count: rejectedCount })
              : t("sync.rejected", { count: rejectedCount })}
          </span>
          <div className="flex shrink-0 gap-1">
            {detail.status === "draft" && detail.access === "write" && (
              <Button size="sm" onClick={onResendRejected}>
                {t("sync.resend")}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onDismissRejected}>
              {t("sync.dismiss")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
