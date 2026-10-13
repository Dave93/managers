"use client";
import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { Link } from "@admin/i18n/routing";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime } from "@admin/lib/inventory/money";
import { periodLabel } from "@admin/lib/inventory/periods";
import { ChooseDocument, CountsPanel, RefreshButton, ReviewControls } from "../_components/recon-actions";
import { ReconLines } from "../_components/recon-lines";
import { ReconLog } from "../_components/recon-log";
import { ReconStatusBadge } from "../_components/recon-status-badge";
import { storeStatus, useReconStatus } from "../_components/fetch-panel";

function Detail({ id }: { id: string }) {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["recon_detail", id], queryFn: () => inventoryApi.reconcile.get(id) });
  const status = useReconStatus(q.data?.period);
  const reload = () => {
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ["recon_list", q.data?.period] });
  };
  // Загрузка этого склада (или всего месяца) закончилась — перечитать детали.
  const mine = q.data ? storeStatus(status.data, q.data.store_id)?.finished_at : undefined;
  const all = status.data?.finished_at;
  const finished = [mine, all].filter(Boolean).sort().pop();
  const calculatedAt = q.data?.calculated_at;
  useEffect(() => {
    if (finished && (!calculatedAt || Date.parse(finished) > Date.parse(calculatedAt) + 1000)) void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  if (!q.data) return <div>{q.error ? (q.error as Error).message : "…"}</div>;
  const d = q.data;
  return (
    <div className="space-y-4">
      <Link href="/inventory/reconciliation" className="text-sm underline">
        ← {t("back")}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{d.store_name}</h1>
        <ReconStatusBadge status={d.status} />
        {d.changed_after_accept && <span className="text-sm text-orange-600">{t("changedAfterAccept")}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{periodLabel(d.period, locale)}</span>
        <span>
          {d.iiko_document_num ? `№${d.iiko_document_num}` : "—"}
          {d.iiko_document_comment ? ` · ${d.iiko_document_comment}` : ""}
        </span>
        {d.iiko_doc_state === "unposted_after_fetch" && <span className="text-orange-600">{t("unposted")}</span>}
        <span>{t("fetchedAt", { at: formatDateTime(d.fetched_at, locale) })}</span>
        <RefreshButton detail={d} onQueued={() => void status.refetch()} />
      </div>
      <div className="w-fit rounded border p-2 text-sm">
        {t("col.mismatch")}: <b>{d.mismatch_ab_count}</b>
      </div>
      <ChooseDocument detail={d} onDone={() => { reload(); void status.refetch(); }} />
      <ReviewControls key={d.review_comment ?? ""} detail={d} onDone={reload} />
      <CountsPanel detail={d} />
      <Tabs defaultValue="lines">
        <TabsList>
          <TabsTrigger value="lines">{t("tabs.lines")}</TabsTrigger>
          <TabsTrigger value="log">{t("tabs.log")}</TabsTrigger>
        </TabsList>
        <TabsContent value="lines" className="pt-4">
          <ReconLines reconId={d.id} lines={d.lines} onChanged={() => void q.refetch()} />
        </TabsContent>
        <TabsContent value="log" className="pt-4">
          <ReconLog events={d.events} edits={d.branch_edits} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ReconciliationDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-3 pb-24 sm:p-4">
      <CanAccess permission="inventory.reconcile">
        <Detail id={id} />
      </CanAccess>
    </div>
  );
}
