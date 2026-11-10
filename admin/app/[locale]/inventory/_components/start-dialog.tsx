"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@admin/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { inventoryApi } from "@admin/lib/inventory-api";
import { periodLabel } from "@admin/lib/inventory/periods";

// Сентинел для «Все товары филиала» в Select (SelectItem не принимает пустой value).
const BRANCH = "__branch__";

export function StartDialog({ storeId, onCreated }: { storeId: string; onCreated: (id: string) => void }) {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [period, setPeriod] = useState("");
  // Промежуточный — за прошедший день (spec 2026-10-08): дата вместо месяца.
  const [kind, setKind] = useState<"monthly" | "interim">("monthly");
  const [countDate, setCountDate] = useState("");
  const dates = useQuery({ queryKey: ["inventory_interim_dates"], queryFn: inventoryApi.interimDates, enabled: open });
  useEffect(() => {
    if (dates.data) setCountDate((d) => d || dates.data!.default);
  }, [dates.data]);

  const options = useQuery({
    queryKey: ["inventory_available_templates", storeId],
    queryFn: () => inventoryApi.availableTemplates(storeId),
    enabled: open && !!storeId,
  });
  const periods = useQuery({ queryKey: ["inventory_periods"], queryFn: inventoryApi.periods, enabled: open });

  const templates = options.data?.templates;
  const branch = options.data?.branch;
  // Месячный — только «Все товары филиала» (02.11.2026): месячный по шаблону (Kunlik) складывался
  // в сверке с iiko с настоящим месячным. Шаблоны — только для промежуточного.
  const monthly = kind === "monthly";
  const monthlyBlocked = monthly && branch !== undefined && !branch.available;
  // По умолчанию — все товары филиала, если exord есть; иначе единственный шаблон.
  useEffect(() => {
    if (!options.data) return;
    setTemplateId((cur) => {
      if (cur) return cur;
      if (options.data.branch.available) return BRANCH;
      return options.data.templates.length === 1 ? options.data.templates[0].id : "";
    });
  }, [options.data]);
  const selected = monthly ? (branch?.available ? BRANCH : "") : templateId;
  useEffect(() => {
    if (periods.data?.periods.length) setPeriod((p) => p || periods.data!.default || periods.data!.periods[0]);
  }, [periods.data]);

  const create = useMutation({
    mutationFn: () =>
      inventoryApi.createCount({
        store_id: storeId,
        ...(selected === BRANCH ? {} : { template_id: selected }),
        ...(kind === "interim" ? { kind, count_date: countDate } : { period }),
      }),
    onSuccess: (r) => {
      setOpen(false);
      onCreated(r.id);
    },
    onError: (e: Error) => toast.error(e.message === "month_accepted" ? t("errors.monthAccepted") : t("errors.generic", { message: e.message })),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="w-full sm:w-auto" disabled={!storeId}>
          {t("start")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("start")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">{t("kind.label")}</div>
            <Select value={kind} onValueChange={(v) => setKind(v as "monthly" | "interim")}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">{t("kind.monthly")}</SelectItem>
                <SelectItem value="interim">{t("kind.interim")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">{t("template")}</div>
            {monthlyBlocked ? (
              <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">{t("kind.monthlyNoExord")}</div>
            ) : !monthly && templates && templates.length === 0 && !branch?.available ? (
              <div className="text-sm text-muted-foreground">{t("noTemplates")}</div>
            ) : (
              <Select value={selected} onValueChange={setTemplateId} disabled={monthly}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder={t("template")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BRANCH} disabled={!branch?.available}>
                    {t("branchAll")} ·{" "}
                    {branch?.available ? t("itemsCount", { count: branch.items_for_store }) : t("branchUnavailable")}
                  </SelectItem>
                  {!monthly &&
                    (templates ?? []).map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name} · {t("itemsCount", { count: tpl.items_for_store })}
                        {tpl.organization_name ? ` · ${tpl.organization_name}` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            {monthly && !monthlyBlocked && <div className="text-xs text-muted-foreground">{t("kind.monthlyHint")}</div>}
          </div>
          {!monthly && branch && !branch.available && (
            <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">{t("noExord")}</div>
          )}
          {kind === "interim" ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">{t("kind.date")}</div>
              {/* Дата одна — вчера (решение 2 спеки, 19.10.2026): только показываем. */}
              <div className="flex h-11 items-center rounded-md border px-3 text-sm tabular-nums">
                {countDate ? countDate.split("-").reverse().join(".") : "…"}
              </div>
              <div className="text-xs text-muted-foreground">{t("kind.dateHint")}</div>
            </div>
          ) : (
          <div className="space-y-1">
            <div className="text-sm font-medium">{t("period")}</div>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder={t("period")} />
              </SelectTrigger>
              <SelectContent>
                {(periods.data?.periods ?? []).map((p) => (
                  <SelectItem key={p} value={p}>
                    {periodLabel(p, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}
        </div>
        <DialogFooter>
          <Button
            size="lg"
            onClick={() => create.mutate()}
            disabled={!selected || (kind === "interim" ? !countDate : !period) || create.isPending}
          >
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
