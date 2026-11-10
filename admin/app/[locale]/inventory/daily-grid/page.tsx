"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { Link } from "@admin/i18n/routing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { inventoryApi } from "@admin/lib/inventory-api";
import { shortStoreName } from "@admin/lib/inventory/daily";
import { dailyGridPeriod, periodLabel, recentPeriods } from "@admin/lib/inventory/periods";
import type { DailyCell, DailyGrid, DailyGridGroup } from "@backend/modules/inventory/daily/types";

const pad = (n: number) => String(n).padStart(2, "0");

// «Дневные остатки» — только офис (inventory.templates): кто из складов филиалов вбивает пересчёт за каждый день.
export default function DailyGridPage() {
  const t = useTranslations("inventory.dailyGrid");
  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CanAccess permission="inventory.templates">
        <Grid />
      </CanAccess>
    </div>
  );
}

function Grid() {
  const t = useTranslations("inventory.dailyGrid");
  const locale = useLocale();
  const periods = useMemo(() => recentPeriods(new Date(), 13), []);
  const [period, setPeriod] = useState(() => dailyGridPeriod(new Date()));
  const q = useQuery({ queryKey: ["inventory_daily_grid", period], queryFn: () => inventoryApi.dailyGrid(period) });
  const g = q.data;
  const mm = period.slice(5, 7);

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

      <div className="space-y-1 text-sm text-muted-foreground">
        <div>{t("hint")}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>✅ {t("legend.submitted")}</span>
          <span>📝 {t("legend.draft")}</span>
          <span>
            <MonthlyMark /> {t("legend.monthly")}
          </span>
          {g?.entering_day && (
            <span>
              * {t("legend.entering", { date: `${pad(g.entering_day)}.${mm}`, n: g.complete_days })}
            </span>
          )}
        </div>
      </div>

      {q.error && <div className="text-destructive">{(q.error as Error).message}</div>}
      {g && g.days === 0 && <div className="text-muted-foreground">{t("empty")}</div>}
      {g && g.days > 0 && g.groups.length === 0 && <div className="text-muted-foreground">{t("noStores")}</div>}
      {g && g.days > 0 && g.groups.map((group) => <BrandTable key={group.brand} grid={g} group={group} />)}
    </div>
  );
}

function MonthlyMark() {
  return <span className="rounded bg-emerald-100 px-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100">М</span>;
}

function Cell({ cell }: { cell: DailyCell | null }) {
  const t = useTranslations("inventory.dailyGrid.legend");
  if (!cell) return null;
  const icon = cell.status === "submitted" ? "✅" : "📝";
  const title = [t(cell.status), cell.monthly ? t("monthly") : null].filter(Boolean).join(" · ");
  return (
    <Link href={`/inventory/${cell.count_id}`} title={title} className="inline-flex items-center gap-0.5 hover:opacity-70">
      <span>{icon}</span>
      {cell.monthly && <MonthlyMark />}
    </Link>
  );
}

const th = "border px-2 py-1.5 font-normal text-muted-foreground";
const td = "border px-2 py-1.5";

function BrandTable({ grid, group }: { grid: DailyGrid; group: DailyGridGroup }) {
  const t = useTranslations("inventory.dailyGrid");
  const days = Array.from({ length: grid.days }, (_, i) => i + 1);
  const isEntering = (d: number) => d === grid.entering_day;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{t(`brand.${group.brand}`)}</h2>
      {/* w-0 min-w-full: 31 столбец не растягивают страницу (main в layout без min-w-0) — прокручивается только таблица. */}
      <div className="w-0 min-w-full overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${th} sticky left-0 z-10 bg-background text-left`}>{t("col.store")}</th>
              {days.map((d) => (
                <th key={d} className={`${th} w-10 text-center tabular-nums`}>
                  {pad(d)}
                  {isEntering(d) && "*"}
                </th>
              ))}
              <th className={`${th} whitespace-nowrap text-center`}>{t("col.total", { n: grid.complete_days })}</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r) => (
              <tr key={r.store_id} className="hover:bg-muted/50">
                <td className={`${td} sticky left-0 z-10 whitespace-nowrap bg-background`}>{shortStoreName(r.store_name)}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className={`${td} text-center ${isEntering(i + 1) ? "bg-muted/40" : ""}`}>
                    <Cell cell={c} />
                  </td>
                ))}
                <td className={`${td} text-center tabular-nums ${r.submitted === 0 && grid.complete_days > 0 ? "font-semibold text-destructive" : ""}`}>
                  {r.submitted}
                </td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className={`${td} sticky left-0 z-10 bg-background`}>{t("totals")}</td>
              {group.totals.map((n, i) => (
                <td key={i} className={`${td} text-center tabular-nums ${isEntering(i + 1) ? "bg-muted/40" : ""}`}>
                  {n || ""}
                </td>
              ))}
              <td className={td} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
