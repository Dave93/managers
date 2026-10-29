"use client";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import CanAccess from "@admin/components/can-access";
import { Link } from "@admin/i18n/routing";
import { Button } from "@admin/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatDay, periodLabel, recentPeriods } from "@admin/lib/inventory/periods";
import type { InterimReconRow } from "@backend/modules/inventory/book/types";
import { WorkerWarning } from "./worker-warning";

const ALL = "__all__";
/** Книжное ещё не пришло: снимок в очереди/загружается или отправленный пересчёт без снимка. */
export const bookPending = (r: InterimReconRow) => r.book_loading || (r.status === "submitted" && !r.book_fetched_at);
// Книжное может не прийти совсем (iiko упал, обработчик не запущен): первые 2 минуты ожидания
// опрашиваем каждые 3 с, дальше раз в 30 с, чтобы открытые вкладки не нагружали сервер без конца.
// Отсчёт — от момента, когда экран увидел ожидание, а не по числу обновлений запроса: тот счётчик
// живёт столько же, сколько кэш, и растёт от каждого refetch по фокусу окна.
export function usePollDelay() {
  const since = useRef<number | null>(null);
  return (pending: boolean): number | false => {
    if (!pending) {
      since.current = null;
      return false;
    }
    since.current ??= Date.now();
    return Date.now() - since.current < 120_000 ? 3000 : 30_000;
  };
}

/** ↻ в строке: снимок книжного заново по одному пересчёту (офис). */
export function InterimRowRefresh({ row, onQueued }: { row: InterimReconRow; onQueued: () => void }) {
  const t = useTranslations("inventory.reconcile.interim");
  const refresh = useMutation({
    mutationFn: () => inventoryApi.refreshBook(row.count_id),
    onSuccess: onQueued,
    onError: (e: Error) => toast.error(e.message),
  });
  const busy = row.book_loading || refresh.isPending;
  return (
    <Button
      variant="ghost"
      size="icon"
      title={busy ? t("loading") : t("refreshOne")}
      aria-label={t("refreshOne")}
      disabled={busy || row.status !== "submitted"}
      onClick={() => refresh.mutate()}
    >
      <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
    </Button>
  );
}

/** «Обновить книжное из iiko»: все отправленные промежуточные месяца или один склад (офис). */
function RefreshAll({ period, rows, onQueued }: { period: string; rows: InterimReconRow[]; onQueued: () => void }) {
  const t = useTranslations("inventory.reconcile");
  const ti = useTranslations("inventory.reconcile.interim");
  const stores = useMemo(() => {
    const by = new Map<string, string>();
    for (const r of rows) by.set(r.store_id, r.store_name);
    return [...by.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [rows]);
  const [storeId, setStoreId] = useState(ALL);
  const run = useMutation({
    mutationFn: () => inventoryApi.reconcile.interimRefresh(period, storeId === ALL ? undefined : storeId),
    onSuccess: (r) => {
      if (r.total === 0) toast.info(ti("refreshNothing"));
      else toast.success(ti("refreshQueued", { queued: r.queued, total: r.total }));
      onQueued();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const loading = rows.filter(bookPending).length;
  return (
    <div className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger className="h-11 w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allStores")}</SelectItem>
            {stores.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="lg" disabled={run.isPending || !rows.length} onClick={() => run.mutate()}>
          {ti("refreshAll")}
        </Button>
        {loading > 0 && <span className="text-sm text-muted-foreground">{ti("loading")} ({loading})</span>}
      </div>
      <WorkerWarning active={loading > 0} />
    </div>
  );
}

/** Сверка по дням: промежуточные пересчёты месяца против книжного количества iiko на конец дня. */
export function InterimOverview({ basePath = "/inventory/reconciliation/interim" }: { basePath?: string }) {
  const t = useTranslations("inventory.reconcile.interim");
  const tStatus = useTranslations("inventory.status");
  const locale = useLocale();
  const periods = useMemo(() => recentPeriods(new Date(), 13), []);
  const [period, setPeriod] = useState(periods[0]);
  const pollDelay = usePollDelay();
  const list = useQuery({
    queryKey: ["recon_interim_list", period],
    queryFn: () => inventoryApi.reconcile.interimList(period),
    // Пока где-то грузится книжное — опрашиваем, строка обновится сама.
    refetchInterval: (q) => pollDelay((q.state.data ?? []).some(bookPending)),
  });
  const refetch = () => void list.refetch();

  return (
    <div className="space-y-4">
      <Select value={period} onValueChange={setPeriod}>
        <SelectTrigger className="h-11 w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {periods.map((p) => (
            <SelectItem key={p} value={p}>
              {periodLabel(p, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <CanAccess permission="inventory.reconcile">
        <RefreshAll period={period} rows={list.data ?? []} onQueued={refetch} />
      </CanAccess>
      {list.data && list.data.length === 0 ? (
        <div className="text-muted-foreground">{t("empty")}</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("col.store")}</TableHead>
                <TableHead>{t("col.date")}</TableHead>
                <TableHead>{t("col.template")}</TableHead>
                <TableHead>{t("col.status")}</TableHead>
                <TableHead className="text-right">{t("col.mismatch")}</TableHead>
                <TableHead className="text-right">{t("col.checked")}</TableHead>
                <CanAccess permission="inventory.reconcile">
                  <TableHead className="w-10" />
                </CanAccess>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((r) => (
                <TableRow key={r.count_id}>
                  <TableCell>
                    <Link className="underline" href={`${basePath}/${r.count_id}`}>
                      {r.store_name}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDay(r.count_date)}</TableCell>
                  <TableCell>{r.template_name}</TableCell>
                  <TableCell>
                    {tStatus(r.status as any)}
                    {bookPending(r) && <div className="text-xs text-muted-foreground">{t("loading")}</div>}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${r.mismatch_count ? "font-semibold text-orange-600" : ""}`}>
                    {r.hidden ? <span className="text-xs text-muted-foreground">{t(r.hidden_reason === "month_end" ? "hiddenMonthEnd" : "hidden")}</span> : r.mismatch_count ? `${r.mismatch_count} / ${r.lines_counted}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.mismatch_count ? `${r.checked_count} / ${r.mismatch_count}` : "—"}
                  </TableCell>
                  <CanAccess permission="inventory.reconcile">
                    <TableCell className="text-right">
                      <InterimRowRefresh row={r} onQueued={refetch} />
                    </TableCell>
                  </CanAccess>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
