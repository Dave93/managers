"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@admin/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@admin/components/ui/drawer";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/ru";
import "dayjs/locale/en";
import "dayjs/locale/uz-latn";
import "dayjs/locale/uz";
import { useAuth } from "@admin/components/useAuth";

dayjs.extend(relativeTime);
dayjs.locale("ru");

const MONTH_KEYS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

const DAYJS_LOCALES: Record<string, string> = {
  ru: "ru",
  en: "en",
  "uz-Latn": "uz-latn",
  "uz-Cyrl": "uz",
};

function getProgressColor(pct: number) {
  if (pct >= 70) return "text-green-600";
  if (pct >= 40) return "text-orange-500";
  return "text-red-500";
}

function getProgressBg(pct: number) {
  if (pct >= 70) return "bg-green-500";
  if (pct >= 40) return "bg-orange-500";
  return "bg-red-500";
}

function getProgressTrack(pct: number) {
  if (pct >= 70) return "bg-green-100";
  if (pct >= 40) return "bg-orange-100";
  return "bg-red-100";
}

type TerminalDashboard = {
  terminal_id: string;
  terminal_name: string | null;
  plan_id: string;
  items_count: number;
  total_planned: number;
  total_sold: number;
  progress_pct: number;
  last_sync: string | null;
  products: {
    item_id: string;
    product_name: string;
    monthly_target: number;
    daily_target: number;
    sold_today: number;
    sold_month: number;
    progress_pct: number;
  }[];
};

export default function SalesPlanDashboardPage() {
  const t = useTranslations("salesPlans");
  const locale = useLocale();
  const dayjsLocale = DAYJS_LOCALES[locale] ?? "ru";
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [selectedTerminal, setSelectedTerminal] = useState<TerminalDashboard | null>(null);
  const { user } = useAuth();
  const userOrganizationId = (user as any)?.user?.organization_id;

  const { data, isLoading } = useQuery({
    queryKey: ["sales_plan_dashboard", { year, month, organization_id: userOrganizationId }],
    queryFn: async () => {
      const query: any = { year, month };
      if (userOrganizationId) query.organization_id = userOrganizationId;
      const { data } = await apiClient.api.sales_plan_stats.dashboard.get({
        query,
      });
      return data;
    },
  });

  const terminals = ((data as any)?.terminals as TerminalDashboard[] | undefined) ?? [];

  return (
    <div>
      <div className="flex justify-between pb-4">
        <h2 className="text-3xl font-bold tracking-tight">{t("dashboard.title")}</h2>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="2025">2025</SelectItem>
            <SelectItem value="2026">2026</SelectItem>
            <SelectItem value="2027">2027</SelectItem>
          </SelectContent>
        </Select>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTH_KEYS.map((key, i) => (
              <SelectItem key={i + 1} value={String(i + 1)}>{t(`months.${key}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">{t("loading")}</div>
      ) : terminals.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">{t("dashboard.noData")}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {terminals.map((term) => (
            <button
              key={term.terminal_id}
              className="rounded-xl border bg-card p-4 shadow-sm text-left transition-colors hover:border-primary"
              onClick={() => setSelectedTerminal(term)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">{term.terminal_name || "Terminal"}</span>
                <span className={`text-xl font-bold ${getProgressColor(term.progress_pct)}`}>
                  {term.progress_pct}%
                </span>
              </div>
              <div className={`rounded-full h-2 ${getProgressTrack(term.progress_pct)}`}>
                <div
                  className={`h-full rounded-full ${getProgressBg(term.progress_pct)}`}
                  style={{ width: `${Math.min(term.progress_pct, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>{t("productsCount", { count: term.items_count })}</span>
                <span>
                  {term.last_sync
                    ? t("dashboard.lastSync", { time: dayjs(term.last_sync).locale(dayjsLocale).fromNow() })
                    : t("dashboard.noSync")}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Drawer open={!!selectedTerminal} onOpenChange={(open) => { if (!open) setSelectedTerminal(null); }}>
        <DrawerContent>
          {selectedTerminal && (
            <>
              <DrawerHeader>
                <DrawerTitle>{selectedTerminal.terminal_name}</DrawerTitle>
                <DrawerDescription>
                  {t("dashboard.drawerDescription", {
                    month: t(`months.${MONTH_KEYS[Number(month) - 1]}`),
                    year,
                    count: selectedTerminal.items_count,
                    progress: selectedTerminal.progress_pct,
                  })}
                </DrawerDescription>
              </DrawerHeader>
              <div className="overflow-y-auto px-4 pb-6 space-y-3">
                {selectedTerminal.products.map((p) => (
                  <div key={p.item_id} className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{p.product_name}</span>
                      <span className={`text-lg font-bold ${getProgressColor(p.progress_pct)}`}>
                        {p.progress_pct}%
                      </span>
                    </div>
                    <div className={`rounded-full h-2 ${getProgressTrack(p.progress_pct)}`}>
                      <div
                        className={`h-full rounded-full ${getProgressBg(p.progress_pct)}`}
                        style={{ width: `${Math.min(p.progress_pct, 100)}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("dashboard.planMonth")}</span>
                        <span className="font-medium">{p.monthly_target}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("dashboard.planDay")}</span>
                        <span className="font-medium">{p.daily_target}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("dashboard.today")}</span>
                        <span className="font-semibold">{p.sold_today}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("dashboard.thisMonth")}</span>
                        <span className="font-medium">{p.sold_month}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
