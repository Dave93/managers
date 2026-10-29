"use client";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import CanAccess from "@admin/components/can-access";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime } from "@admin/lib/inventory/money";

/** «Обработчик не запущен»: что-то ждёт загрузки из iiko дольше минуты, а очередь никто не разбирает. Только офис. */
export function WorkerWarning({ active }: { active: boolean }) {
  return (
    <CanAccess permission="inventory.reconcile">
      <Warning active={active} />
    </CanAccess>
  );
}

function Warning({ active }: { active: boolean }) {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  const q = useQuery({
    queryKey: ["inventory_worker_status"],
    queryFn: () => inventoryApi.reconcile.workerStatus(),
    enabled: active,
    refetchInterval: active ? 15_000 : false,
  });
  if (!active || !q.data?.stalled) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-medium">{t("worker.title")}</div>
        <div>{t("worker.hint", { since: formatDateTime(q.data.waiting_since!, locale) })}</div>
      </div>
    </div>
  );
}
