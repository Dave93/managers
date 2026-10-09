"use client";
import { useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { InterimOverview } from "../reconciliation/_components/interim-overview";

/** Сверка по дням у менеджера филиала: свои склады, только просмотр. */
export default function DailyReconciliationPage() {
  const t = useTranslations("inventory.reconcile.interim");
  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CanAccess permission="inventory.count">
        <InterimOverview basePath="/inventory/daily" />
      </CanAccess>
    </div>
  );
}
