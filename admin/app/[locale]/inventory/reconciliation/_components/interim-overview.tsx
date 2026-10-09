"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@admin/i18n/routing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatDay, periodLabel, recentPeriods } from "@admin/lib/inventory/periods";

/** Сверка по дням: промежуточные пересчёты месяца против книжного количества iiko на конец дня. */
export function InterimOverview({ basePath = "/inventory/reconciliation/interim" }: { basePath?: string }) {
  const t = useTranslations("inventory.reconcile.interim");
  const tStatus = useTranslations("inventory.status");
  const locale = useLocale();
  const periods = useMemo(() => recentPeriods(new Date(), 13), []);
  const [period, setPeriod] = useState(periods[0]);
  const list = useQuery({ queryKey: ["recon_interim_list", period], queryFn: () => inventoryApi.reconcile.interimList(period) });

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
                    {r.status === "submitted" && !r.book_fetched_at && <div className="text-xs text-muted-foreground">{t("loading")}</div>}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${r.mismatch_count ? "font-semibold text-orange-600" : ""}`}>
                    {r.hidden ? <span className="text-xs text-muted-foreground">{t("hidden")}</span> : r.mismatch_count ? `${r.mismatch_count} / ${r.lines_counted}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.mismatch_count ? `${r.checked_count} / ${r.mismatch_count}` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
