"use client";
import { Suspense, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import CanAccess from "@admin/components/can-access";
import { inventoryApi } from "@admin/lib/inventory-api";
import { periodLabel } from "@admin/lib/inventory/periods";
import { useMyPermissions } from "@admin/lib/inventory/use-permissions";
import { StatusLine } from "./_components/status-line";
import { StoreTable } from "./_components/store-table";
import { SummaryTable } from "./_components/summary-table";

const ALL = "__all__";

export default function TurnoverPage() {
  return (
    <CanAccess permission="inventory.count">
      {/* Фильтры в URL (nuqs → useSearchParams): без границы Suspense `next build` падает на пререндере. */}
      <Suspense>
        <Turnover />
      </Suspense>
    </CanAccess>
  );
}

function Turnover() {
  const t = useTranslations("inventory.turnover");
  const locale = useLocale();
  const perms = useMyPermissions();
  const ready = perms !== undefined;
  const office = !!perms?.includes("inventory.templates");
  const [periodQ, setPeriod] = useQueryState("period", parseAsString);
  const [storeQ, setStore] = useQueryState("store", parseAsString);

  // Филиал — свои склады; офис — склады из сводной.
  const own = useQuery({ queryKey: ["inventory_stores"], queryFn: () => inventoryApi.stores(), enabled: ready && !office });
  const storeId = office ? (storeQ ?? ALL) : (storeQ ?? own.data?.[0]?.id ?? "");
  const periods = useQuery({
    queryKey: ["inventory_turnover", "periods", office ? null : storeId],
    queryFn: () => inventoryApi.turnover.periods(office ? undefined : storeId),
    enabled: ready && (office || !!storeId),
  });
  // По умолчанию — прошлый месяц (второй в списке), если он открыт; иначе первый открытый.
  const period = useMemo(() => {
    const list = periods.data ?? [];
    if (periodQ && list.some((p) => p.period === periodQ && p.open)) return periodQ;
    return (list[1]?.open ? list[1] : list.find((p) => p.open))?.period ?? "";
  }, [periods.data, periodQ]);

  const summary = useQuery({
    queryKey: ["inventory_turnover", "summary", period],
    queryFn: () => inventoryApi.turnover.summary(period),
    // И при выбранном складе: из сводной — список складов офиса (агрегаты SQL, дёшево).
    enabled: office && !!period,
  });
  const view = useQuery({
    queryKey: ["inventory_turnover", "store", period, storeId],
    queryFn: () => inventoryApi.turnover.store(period, storeId),
    enabled: !!period && !!storeId && storeId !== ALL,
  });
  const stores = office
    ? (summary.data?.rows ?? []).map((r) => ({ id: r.store_id, name: r.store_name }))
    : (own.data ?? []).map((s) => ({ id: s.id, name: s.name }));
  const selectedPeriod = periods.data?.find((p) => p.period === period);

  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <div className="flex flex-wrap gap-3">
        <Select value={period} onValueChange={(v) => setPeriod(v)}>
          <SelectTrigger className="h-11 w-full sm:w-56"><SelectValue placeholder={t("month")} /></SelectTrigger>
          <SelectContent>
            {(periods.data ?? []).map((p) => (
              <SelectItem key={p.period} value={p.period} disabled={!p.open}>
                {periodLabel(p.period, locale)}
                {!p.open && p.reason && <span className="ml-2 text-xs text-muted-foreground">{t(`closed.${p.reason}`)}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(office || stores.length > 1) && (
          <Select value={storeId} onValueChange={(v) => setStore(v === ALL ? null : v)}>
            <SelectTrigger className="h-11 w-full sm:w-96"><SelectValue placeholder={t("store")} /></SelectTrigger>
            <SelectContent>
              {office && <SelectItem value={ALL}>{t("allStores")}</SelectItem>}
              {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              {office && storeId !== ALL && !stores.some((s) => s.id === storeId) && view.data && (
                <SelectItem value={storeId}>{view.data.store_name}</SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
      </div>
      {period && (
        <StatusLine
          period={period}
          storeId={storeId === ALL ? undefined : storeId}
          fetchedAt={storeId === ALL ? selectedPeriod?.fetched_at ?? null : view.data?.fetched_at ?? null}
          dataThrough={storeId === ALL ? selectedPeriod?.data_through ?? null : view.data?.data_through ?? null}
        />
      )}
      {(summary.error || view.error) && <div className="text-sm text-destructive">{((summary.error || view.error) as Error).message}</div>}
      {storeId === ALL && summary.data && <SummaryTable data={summary.data} onPick={(id) => setStore(id)} />}
      {/* Без снимка за месяц строка состояния уже пишет «данных пока нет». */}
      {storeId !== ALL && view.data?.data_through && <StoreTable view={view.data} />}
    </div>
  );
}
