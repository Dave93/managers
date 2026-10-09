"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { Link } from "@admin/i18n/routing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { inventoryApi } from "@admin/lib/inventory-api";
import { periodLabel, recentPeriods } from "@admin/lib/inventory/periods";
import type { ReconOverviewRow, ReconStatus } from "@backend/modules/inventory/reconcile/types";
import { FetchPanel } from "./_components/fetch-panel";
import { ReconStatusBadge } from "./_components/recon-status-badge";
import { ReopenRule } from "./_components/reopen-rule";
import { InterimOverview } from "./_components/interim-overview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";

const ALL = "__all__";
const STATUSES: ReconStatus[] = ["needs_choice", "ready", "in_review", "accepted", "waiting_iiko"];

function AdminCell({ row }: { row: ReconOverviewRow }) {
  const t = useTranslations("inventory.reconcile.admin");
  return <span>{t(row.admin_state)}</span>;
}

function Overview() {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  // По умолчанию — прошлый месяц: его и сверяют 1–7 числа.
  const periods = useMemo(() => recentPeriods(new Date(), 13), []);
  const [period, setPeriod] = useState(periods[1]);
  const [status, setStatus] = useState<string>(ALL);
  const [org, setOrg] = useState<string>(ALL);

  const orgs = useQuery({ queryKey: ["inventory_orgs"], queryFn: inventoryApi.organizations });
  const list = useQuery({ queryKey: ["recon_list", period], queryFn: () => inventoryApi.reconcile.list(period) });

  const rows = (list.data ?? [])
    .filter((r) => status === ALL || r.status === status)
    .filter((r) => org === ALL || r.organization_id === org)
    .sort((a, b) => b.mismatch_ab_count - a.mismatch_ab_count);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
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
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("all")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="h-11 w-56">
            <SelectValue placeholder={t("organization")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("all")}</SelectItem>
            {(orgs.data ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FetchPanel period={period} />
      <ReopenRule />

      {list.data && list.data.length === 0 ? (
        <div className="text-muted-foreground">{t("empty")}</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("col.store")}</TableHead>
                <TableHead>{t("col.admin")}</TableHead>
                <TableHead>{t("col.document")}</TableHead>
                <TableHead>{t("col.status")}</TableHead>
                <TableHead className="text-right">{t("col.mismatch")}</TableHead>
                <TableHead className="text-right">{t("col.reopens")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link className="underline" href={`/inventory/reconciliation/${r.id}`}>
                      {r.store_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <AdminCell row={r} />
                  </TableCell>
                  <TableCell>
                    {r.iiko_document_num ? `№${r.iiko_document_num}` : "—"}
                    {r.iiko_document_comment && <span className="ml-1 text-xs text-muted-foreground">{r.iiko_document_comment}</span>}
                    {r.iiko_doc_state === "unposted_after_fetch" && <div className="text-xs text-orange-600">{t("unposted")}</div>}
                  </TableCell>
                  <TableCell>
                    <ReconStatusBadge status={r.status} />
                    {r.changed_after_accept && <div className="text-xs text-orange-600">{t("changedAfterAccept")}</div>}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${r.mismatch_ab_count ? "font-semibold text-orange-600" : ""}`}>
                    {r.mismatch_ab_count || "—"}
                  </TableCell>
                  {/* Повторные отправки: пересчёт возвращали в черновик и меняли после отправки. */}
                  <TableCell className={`text-right tabular-nums ${r.reopen_count ? "font-semibold text-orange-600" : ""}`}>
                    {r.reopen_count || "—"}
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

export default function ReconciliationPage() {
  const t = useTranslations("inventory.reconcile");
  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CanAccess permission="inventory.reconcile">
        <Tabs defaultValue="monthly">
          <TabsList>
            <TabsTrigger value="monthly">{t("mode.monthly")}</TabsTrigger>
            <TabsTrigger value="daily">{t("mode.daily")}</TabsTrigger>
          </TabsList>
          <TabsContent value="monthly" className="pt-4">
            <Overview />
          </TabsContent>
          <TabsContent value="daily" className="pt-4">
            <InterimOverview />
          </TabsContent>
        </Tabs>
      </CanAccess>
    </div>
  );
}
