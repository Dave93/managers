"use client";
import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { kpiApi, type ReviewEvent } from "@admin/lib/kpi-api";
import { kpiErrorText, shouldRetry, type KpiApiError } from "@admin/lib/kpi/errors";
import { formatPct, formatTashkent } from "@admin/lib/kpi/format";
import { eventKindLabel } from "@admin/lib/kpi/status";
import { qk } from "../../_components/use-kpi";

export function ReviewHistory({ reviewId }: { reviewId: string }) {
  const events = useQuery<ReviewEvent[], KpiApiError>({
    queryKey: qk.events(reviewId),
    queryFn: () => kpiApi.reviews.events(reviewId),
    retry: shouldRetry,
  });
  // От новых к старым: порядок сервера не гарантирован, ISO-строки сравниваются как строки.
  const list = useMemo(
    () => [...(events.data ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)),
    [events.data]
  );

  if (events.error) {
    return (
      <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
        {kpiErrorText(events.error)}
      </p>
    );
  }
  if (events.isPending) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  if (list.length === 0) return <p className="text-sm text-muted-foreground">История пуста.</p>;

  return (
    <ul className="space-y-3">
      {list.map((e) => (
        <li key={e.id} className="space-y-1 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{eventKindLabel(e.kind)}</span>
            <span className="text-xs text-muted-foreground">
              {formatTashkent(e.created_at)} · {e.actor_name ?? "Система"}
            </span>
          </div>
          {e.old_score_pct !== e.new_score_pct && (
            <div className="tabular-nums">
              {formatPct(e.old_score_pct)} → {formatPct(e.new_score_pct)}
            </div>
          )}
          {e.changes.length > 0 && (
            <ul className="space-y-0.5 text-muted-foreground">
              {e.changes.map((c) => (
                <li key={c.item_id}>
                  {c.title_ru}: {c.old ?? "—"} → {c.new ?? "—"}
                </li>
              ))}
            </ul>
          )}
          {e.comment && <p className="italic">{e.comment}</p>}
        </li>
      ))}
    </ul>
  );
}
