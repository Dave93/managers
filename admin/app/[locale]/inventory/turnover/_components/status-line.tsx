"use client";
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@admin/components/ui/button";
import CanAccess from "@admin/components/can-access";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime } from "@admin/lib/inventory/money";
import { formatDay } from "@admin/lib/inventory/periods";
import { WorkerWarning } from "../../reconciliation/_components/worker-warning";

export function StatusLine({ period, fetchedAt, dataThrough, storeId }: { period: string; fetchedAt: string | null; dataThrough: string | null; storeId?: string }) {
  const t = useTranslations("inventory.turnover");
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      {dataThrough ? (
        <span>
          {t("through", { date: formatDay(dataThrough) })}
          {fetchedAt && ` · ${t("fetched", { at: formatDateTime(fetchedAt, locale) })}`}
        </span>
      ) : (
        <span>{t("noData")}</span>
      )}
      <CanAccess permission="inventory.reconcile">
        <Refresh period={period} storeId={storeId} />
      </CanAccess>
    </div>
  );
}

const busy = (x?: { state: string } | null) => !!x && ["queued", "running"].includes(x.state);

function Refresh({ period, storeId }: { period: string; storeId?: string }) {
  const t = useTranslations("inventory.turnover");
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["inventory_turnover_status", period],
    queryFn: () => inventoryApi.turnover.status(period),
    // Опрашиваем, пока идёт загрузка месяца или любого склада: у склада свой статус, а статус
    // месяца может оставаться «done» от ночной загрузки.
    refetchInterval: (q) => (q.state.data && (busy(q.state.data) || q.state.data.stores.some(busy)) ? 3000 : false),
  });
  const s = status.data;
  const mine = storeId ? s?.stores.find((x) => x.store_id === storeId) : s;
  // Загрузка всего месяца занимает и выбранный склад: повторный запрос получил бы 409.
  const active = busy(mine) || busy(s);
  // Данные перезапрашиваем на переходе «грузится → done», а не при каждом открытии:
  // статус «done» хранится в Redis 30 дней.
  const prevState = useRef<string | undefined>(undefined);
  useEffect(() => {
    const was = prevState.current;
    prevState.current = mine?.state;
    if (mine?.state === "done" && (was === "queued" || was === "running")) qc.invalidateQueries({ queryKey: ["inventory_turnover"] });
  }, [mine?.state, qc]);
  const m = useMutation({
    mutationFn: () => inventoryApi.turnover.refresh(period, storeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory_turnover_status", period] }),
  });
  return (
    <>
      <Button size="sm" variant="outline" disabled={active || m.isPending} onClick={() => m.mutate()}>
        <RefreshCw className={`mr-1 h-4 w-4 ${active ? "animate-spin" : ""}`} />
        {t("refresh")}
      </Button>
      {active && mine && mine.total > 0 && <span>{t("loading", { done: mine.done, total: mine.total })}</span>}
      {mine && mine.failed.length > 0 && <span className="text-destructive">{t("failedStores", { stores: mine.failed.length })}</span>}
      {m.error && <span className="text-destructive">{(m.error as Error).message}</span>}
      <WorkerWarning active={active} />
    </>
  );
}
