"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime } from "@admin/lib/inventory/money";
import { WorkerWarning } from "./worker-warning";
import type { ReconFetchOverview, ReconFetchState, ReconFetchStatus } from "@backend/modules/inventory/reconcile/types";

const RUNNING: ReconFetchState[] = ["queued", "stage1", "stage2"];
const ALL = "__all__";

const isRunning = (s: ReconFetchStatus | undefined) => !!s && RUNNING.includes(s.state);
const anyRunning = (o: ReconFetchOverview | undefined) => !!o && (isRunning(o) || o.stores.some(isRunning));

/** Статус загрузок месяца: «все склады» + отдельные склады. Один запрос на страницу, опрос — пока что-то идёт. */
export function useReconStatus(period: string | undefined) {
  return useQuery({
    queryKey: ["recon_status", period],
    queryFn: () => inventoryApi.reconcile.status(period!),
    enabled: !!period,
    refetchInterval: (q) => (anyRunning(q.state.data) ? 3000 : false),
  });
}

export function storeStatus(o: ReconFetchOverview | undefined, storeId: string): ReconFetchStatus | undefined {
  return o?.stores.find((s) => s.store_id === storeId);
}

/** Кнопка ↻ в строке списка: загрузка из iiko только этого склада; склады встают в очередь. */
export function RowRefresh({ reconId, storeId, period }: { reconId: string; storeId: string; period: string }) {
  const t = useTranslations("inventory.reconcile");
  const status = useReconStatus(period);
  const s = storeStatus(status.data, storeId);
  const busy = isRunning(s);
  const refresh = useMutation({
    mutationFn: () => inventoryApi.reconcile.refresh(reconId),
    onSuccess: () => void status.refetch(),
    onError: (e: Error) => toast.error(e instanceof InventoryApiError && e.status === 409 ? t("alreadyRunning") : e.message),
  });
  const title = s && s.state !== "done" ? (s.state === "failed" ? t("state.failed", { error: s.error ?? "" }) : t(`state.${s.state}`)) : t("refresh");
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      aria-label={t("refresh")}
      disabled={busy || refresh.isPending}
      onClick={() => refresh.mutate()}
      className={s?.state === "failed" ? "text-red-600 dark:text-red-500" : ""}
    >
      <RefreshCw className={`h-4 w-4 ${busy || refresh.isPending ? "animate-spin" : ""}`} />
    </Button>
  );
}

export function FetchPanel({ period }: { period: string }) {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  const qc = useQueryClient();
  const status = useReconStatus(period);
  // Склады месяца — как на «Остатках склада» у офиса: из обзора.
  const overview = useQuery({ queryKey: ["inventory_overview", period, ALL], queryFn: () => inventoryApi.overview(period) });
  const stores = (overview.data ?? []).map((r) => ({ id: r.store_id, name: r.store_name }));
  const storeName = (id: string) => stores.find((x) => x.id === id)?.name ?? id;
  const [storeId, setStoreId] = useState(ALL);
  const state = status.data?.state ?? "idle";
  const running = RUNNING.includes(state);
  const storesRunning = (status.data?.stores ?? []).filter(isRunning).length;

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

  // Загрузка склада закончилась — перечитать список (у нового склада появится строка); ошибка — сообщить.
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const list = status.data?.stores;
    if (!list) return;
    const first = seen.current === null;
    seen.current ??= new Map();
    let changed = false;
    for (const s of list) {
      if (!s.finished_at || seen.current.get(s.store_id!) === s.finished_at) continue;
      seen.current.set(s.store_id!, s.finished_at);
      if (first) continue;
      changed = true;
      if (s.state === "failed") toast.error(t("storeFailed", { store: storeName(s.store_id!), error: s.error ?? "" }));
    }
    if (changed) void qc.invalidateQueries({ queryKey: ["recon_list", period] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data, period, qc, t]);

  const one = storeId === ALL ? null : storeId;
  const start = useMutation({
    mutationFn: () => inventoryApi.reconcile.fetch(period, one ?? undefined),
    onSuccess: () => {
      if (one) toast.success(t("storeQueued", { store: storeName(one) }));
      else announced.current = "";
      void status.refetch();
    },
    onError: (e: Error) =>
      toast.error(e instanceof InventoryApiError && e.status === 409 ? t("alreadyRunning") : e.message),
  });
  const disabled = start.isPending || (one ? isRunning(storeStatus(status.data, one)) : running);

  const s = status.data;
  return (
    <div className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger className="h-11 w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allStores")}</SelectItem>
            {stores.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="lg" disabled={disabled} onClick={() => start.mutate()}>
          {t("fetch")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {s?.store_id && state !== "idle" ? `${t("storeScope", { store: storeName(s.store_id) })} · ` : ""}
          {state === "failed" ? t("state.failed", { error: s?.error ?? "" }) : t(`state.${state}`)}
          {s?.finished_at && state === "done" ? ` · ${formatDateTime(s.finished_at, locale)}` : ""}
          {storesRunning > 0 ? ` · ${t("storesRunning", { count: storesRunning })}` : ""}
        </span>
      </div>
      <WorkerWarning active={anyRunning(s)} />
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
