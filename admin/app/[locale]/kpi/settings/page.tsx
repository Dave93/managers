"use client";
import React, { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { ScreenGate } from "../_components/screen-gate";
import { BranchTab } from "./_components/branch-tab";
import { CardsTab } from "./_components/cards-tab";
import { DeadlinesTab } from "./_components/deadlines-tab";
import { EmployeesTab } from "./_components/employees-tab";
import { EvaluatorsTab } from "./_components/evaluators-tab";
import { TiersTab } from "./_components/tiers-tab";

const TABS = [
  { value: "cards", labelKey: "settings.page.tabs.cards" },
  { value: "evaluators", labelKey: "settings.page.tabs.evaluators" },
  { value: "employees", labelKey: "settings.page.tabs.employees" },
  { value: "tiers", labelKey: "settings.page.tabs.tiers" },
  { value: "deadlines", labelKey: "settings.page.tabs.deadlines" },
  { value: "branch", labelKey: "settings.page.tabs.branch" },
] as const;

export default function SettingsPage() {
  return (
    <ScreenGate screen="settings">
      <SettingsSuspense />
    </ScreenGate>
  );
}

function SettingsSuspense() {
  const t = useTranslations("kpi");
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">{t("settings.page.loading")}</p>}>
      <SettingsScreen />
    </Suspense>
  );
}

function SettingsScreen() {
  const t = useTranslations("kpi");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const asked = params.get("tab");
  const tab = TABS.some((x) => x.value === asked) ? (asked as string) : TABS[0].value;

  const change = (value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", value);
    router.replace(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">{t("settings.page.title")}</h1>
      <Tabs value={tab} onValueChange={change}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map((x) => (
            <TabsTrigger key={x.value} value={x.value} className="h-9 px-4">
              {t(x.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="cards">
          <CardsTab />
        </TabsContent>
        <TabsContent value="evaluators">
          <EvaluatorsTab />
        </TabsContent>
        <TabsContent value="employees">
          <EmployeesTab />
        </TabsContent>
        <TabsContent value="tiers">
          <TiersTab />
        </TabsContent>
        <TabsContent value="deadlines">
          <DeadlinesTab />
        </TabsContent>
        <TabsContent value="branch">
          <BranchTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
