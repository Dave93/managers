"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { Link } from "@admin/i18n/routing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatMoney } from "@admin/lib/inventory/money";
import { periodLabel, recentPeriods } from "@admin/lib/inventory/periods";
import type { ReconOverviewRow, ReconStatus } from "@backend/modules/inventory/reconcile/types";
import { FetchPanel } from "./_components/fetch-panel";
import { ReconStatusBadge } from "./_components/recon-status-badge";

const ALL = "__all__";
const STATUSES: ReconStatus[] = ["needs_choice", "ready", "in_review", "accepted", "waiting_iiko"];

function AdminCell({ row }: { row: ReconOverviewRow }) {
  const t = useTranslations("inventory.reconcile.admin");
  const overdue = row.admin_state !== "submitted" && Date.now() >= Date.parse(row.deadline);
  if (overdue) return <span className="text-destructive">{t("overdue")}</span>;
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
    .sort((a, b) => Math.abs(Number(b.diff_ab_sum ?? 0)) - Math.abs(Number(a.diff_ab_sum ?? 0)));

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
                <TableHead className="text-right">{t("col.ab")}</TableHead>
                <TableHead className="text-right">{t("col.ac")}</TableHead>
                <TableHead className="text-right">{t("col.bc")}</TableHead>
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
                  <TableCell className="text-right tabular-nums">{r.mismatch_ab_count || "—"}</TableCell>
                  <TableCell className={`text-right tabular-nums ${Number(r.diff_ab_sum ?? 0) !== 0 ? "text-orange-600" : ""}`}>
                    {formatMoney(r.diff_ab_sum)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.diff_ac_sum)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.diff_bc_sum)}</TableCell>
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
        <Overview />
      </CanAccess>
    </div>
  );
}
