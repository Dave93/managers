"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@admin/i18n/routing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { inventoryApi } from "@admin/lib/inventory-api";
import { periodLabel, recentPeriods } from "@admin/lib/inventory/periods";
import { StatusBadge } from "./status-badge";

const ALL = "__all__";

export function Overview() {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const periods = useMemo(() => recentPeriods(new Date(), 12), []);
  const [period, setPeriod] = useState(periods[0]);
  const [org, setOrg] = useState(ALL);

  const orgs = useQuery({ queryKey: ["inventory_orgs"], queryFn: inventoryApi.organizations });
  const rows = useQuery({
    queryKey: ["inventory_overview", period, org],
    queryFn: () => inventoryApi.overview(period, org === ALL ? undefined : org),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-48 h-11">
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
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="w-56 h-11">
            <SelectValue placeholder={t("overview.organization")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("overview.all")}</SelectItem>
            {(orgs.data ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("store")}</TableHead>
            <TableHead>{t("template")}</TableHead>
            <TableHead>{t("status.draft")} / {t("status.submitted")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows.data ?? []).flatMap((r) =>
            r.counts.length === 0
              ? [
                  <TableRow key={r.store_id}>
                    <TableCell>{r.store_name}</TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell className="text-destructive">{t("overview.notStarted")}</TableCell>
                    <TableCell />
                  </TableRow>,
                ]
              : r.counts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{r.store_name}</TableCell>
                    <TableCell>{c.template_name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={c.status} />
                        <span className="text-sm">{t("progress", { done: c.lines_done, total: c.lines_total })}</span>
                      </div>
                      {c.submitted_by_name && (
                        <div className="text-xs text-muted-foreground">{t("submittedBy", { name: c.submitted_by_name })}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link className="underline" href={`/inventory/${c.id}`}>
                        {t("overview.open")}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
