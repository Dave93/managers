"use client";
import React, { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { ScreenGate } from "../_components/screen-gate";
import { BranchTab } from "./_components/branch-tab";
import { CardsTab } from "./_components/cards-tab";
import { DeadlinesTab } from "./_components/deadlines-tab";
import { EmployeesTab } from "./_components/employees-tab";
import { EvaluatorsTab } from "./_components/evaluators-tab";
import { TiersTab } from "./_components/tiers-tab";

const TABS = [
  { value: "cards", label: "Карты" },
  { value: "evaluators", label: "Оценщики" },
  { value: "employees", label: "Сотрудники" },
  { value: "tiers", label: "Шкала" },
  { value: "deadlines", label: "Сроки" },
  { value: "branch", label: "Балл филиала" },
] as const;

export default function SettingsPage() {
  return (
    <ScreenGate screen="settings">
      <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Загрузка…</p>}>
        <SettingsScreen />
      </Suspense>
    </ScreenGate>
  );
}

function SettingsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const asked = params.get("tab");
  const tab = TABS.some((t) => t.value === asked) ? (asked as string) : TABS[0].value;

  const change = (value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", value);
    router.replace(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Настройки KPI</h1>
      <Tabs value={tab} onValueChange={change}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="h-9 px-4">
              {t.label}
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
