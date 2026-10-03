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
      inventoryApi.createCount(
        templateId === BRANCH ? { store_id: storeId, period } : { store_id: storeId, template_id: templateId, period }
      ),
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
        </div>
        <DialogFooter>
          <Button size="lg" onClick={() => create.mutate()} disabled={!templateId || !period || create.isPending}>
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
