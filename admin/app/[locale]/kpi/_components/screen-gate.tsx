"use client";
import React from "react";
import { useTranslations } from "next-intl";
import NoAccessNotice from "@admin/components/layout/no-access-notice";
import { KPI_SCREEN_PERMS, canOpen, type KpiScreen } from "@admin/lib/kpi/access";
import { useKpiPerms } from "./use-kpi";

/** Гейт экрана: экран открывается любым из своих прав; `require` добавляет обязательное право. */
export function ScreenGate({
  screen,
  require,
  children,
}: {
  screen: KpiScreen;
  require?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("kpi");
  const nav = useTranslations("nav");
  const { ready, perms } = useKpiPerms();
  if (!ready) return <p className="p-6 text-sm text-muted-foreground">{t("gate.loading")}</p>;
  const title = t("gate.title", { title: nav(`kpi.${screen}`) });
  if (!canOpen(perms, screen))
    return (
      <NoAccessNotice
        title={title}
        missing={[...KPI_SCREEN_PERMS[screen]]}
        explanation={t("gate.explanation")}
      />
    );
  if (require && !perms.includes(require))
    return (
      <NoAccessNotice
        title={title}
        missing={[require]}
        explanation={t("gate.explanation")}
      />
    );
  return <>{children}</>;
}
