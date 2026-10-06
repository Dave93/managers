"use client";
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime } from "@admin/lib/inventory/money";
import type { ReconFetchState } from "@backend/modules/inventory/reconcile/types";

const RUNNING: ReconFetchState[] = ["queued", "stage1", "stage2"];

export function FetchPanel({ period }: { period: string }) {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["recon_status", period],
    queryFn: () => inventoryApi.reconcile.status(period),
    refetchInterval: (q) => (q.state.data && RUNNING.includes(q.state.data.state) ? 3000 : false),
  });
  const state = status.data?.state ?? "idle";
  const running = RUNNING.includes(state);

  // Сообщение «данные сохранены» — один раз, когда этап 1 закончился.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    const s = status.data;
    if (!s?.stage1_done_at || announced.current === s.stage1_done_at) return;
    if (announced.current !== null) toast.success(t("saved", { received: s.received.length, missing: s.missing.length }));
    announced.current = s.stage1_done_at;
    void qc.invalidateQueries({ queryKey: ["recon_list", period] });
  }, [status.data, period, qc, t]);
  useEffect(() => {
    if (state === "done") void qc.invalidateQueries({ queryKey: ["recon_list", period] });
  }, [state, period, qc]);

  const start = useMutation({
    mutationFn: () => inventoryApi.reconcile.fetch(period),
    onSuccess: () => {
      announced.current = "";
      void status.refetch();
    },
    onError: (e: Error) =>
      toast.error(e instanceof InventoryApiError && e.status === 409 ? t("alreadyRunning") : e.message),
  });

  const s = status.data;
  return (
    <div className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={running || start.isPending} onClick={() => start.mutate()}>
          {t("fetch")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {state === "failed" ? t("state.failed", { error: s?.error ?? "" }) : t(`state.${state}`)}
          {s?.finished_at && state === "done" ? ` · ${formatDateTime(s.finished_at, locale)}` : ""}
        </span>
      </div>
      {s && s.stage1_done_at && (
        <div className="text-sm">
          {t("saved", { received: s.received.length, missing: s.missing.length })}
          {s.missing.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-muted-foreground">{t("missingTitle")}</summary>
              <ul className="mt-1 list-disc pl-5">
                {s.missing.map((m) => (
                  <li key={m.store_id}>{m.store_name}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
