"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
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
  // По умолчанию — все товары филиала, если exord есть; иначе единственный шаблон.
  useEffect(() => {
    if (!options.data) return;
    setTemplateId((cur) => {
      if (cur) return cur;
      if (options.data.branch.available) return BRANCH;
      return options.data.templates.length === 1 ? options.data.templates[0].id : "";
    });
  }, [options.data]);
  useEffect(() => {
    if (periods.data?.periods.length) setPeriod((p) => p || periods.data!.periods[0]);
  }, [periods.data]);

  const create = useMutation({
    mutationFn: () =>
      inventoryApi.createCount({
        store_id: storeId,
        ...(templateId === BRANCH ? {} : { template_id: templateId }),
        ...(kind === "interim" ? { kind, count_date: countDate } : { period }),
      }),
    onSuccess: (r) => {
      setOpen(false);
      onCreated(r.id);
    },
    onError: (e: Error) => toast.error(t("errors.generic", { message: e.message })),
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
            {templates && templates.length === 0 && !branch?.available ? (
              <div className="text-sm text-muted-foreground">{t("noTemplates")}</div>
            ) : (
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder={t("template")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BRANCH} disabled={!branch?.available}>
                    {t("branchAll")} ·{" "}
                    {branch?.available ? t("itemsCount", { count: branch.items_for_store }) : t("branchUnavailable")}
                  </SelectItem>
                  {(templates ?? []).map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name} · {t("itemsCount", { count: tpl.items_for_store })}
                      {tpl.organization_name ? ` · ${tpl.organization_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {branch && !branch.available && (
            <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">{t("noExord")}</div>
          )}
          {kind === "interim" ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">{t("kind.date")}</div>
              <Input
                type="date"
                className="h-11"
                value={countDate}
                min={dates.data?.min}
                max={dates.data?.max}
                onChange={(e) => setCountDate(e.target.value)}
              />
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
            disabled={!templateId || (kind === "interim" ? !countDate : !period) || create.isPending}
          >
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
