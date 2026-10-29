"use client";
import React from "react";
import NoAccessNotice from "@admin/components/layout/no-access-notice";
import { KPI_SCREEN_PERMS, KPI_SCREEN_TITLE, canOpen, type KpiScreen } from "@admin/lib/kpi/access";
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
  const { ready, perms } = useKpiPerms();
  if (!ready) return <p className="p-6 text-sm text-muted-foreground">Загрузка…</p>;
  const title = `Экран «${KPI_SCREEN_TITLE[screen]}» недоступен`;
  if (!canOpen(perms, screen))
    return (
      <NoAccessNotice
        title={title}
        missing={[...KPI_SCREEN_PERMS[screen]]}
        explanation="Экран открывается любым из перечисленных прав."
      />
    );
  if (require && !perms.includes(require))
    return (
      <NoAccessNotice
        title={title}
        missing={[require]}
        explanation="Экран открывается любым из перечисленных прав."
      />
    );
  return <>{children}</>;
}
