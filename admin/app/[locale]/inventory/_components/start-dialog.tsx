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

export function StartDialog({ storeId, onCreated }: { storeId: string; onCreated: (id: string) => void }) {
  const t = useTranslations("inventory");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [period, setPeriod] = useState("");

  const templates = useQuery({
    queryKey: ["inventory_available_templates", storeId],
    queryFn: () => inventoryApi.availableTemplates(storeId),
    enabled: open && !!storeId,
  });
  const periods = useQuery({ queryKey: ["inventory_periods"], queryFn: inventoryApi.periods, enabled: open });

  useEffect(() => {
    if (templates.data?.length === 1) setTemplateId(templates.data[0].id);
  }, [templates.data]);
  useEffect(() => {
    if (periods.data?.periods.length) setPeriod((p) => p || periods.data!.periods[0]);
  }, [periods.data]);

  const create = useMutation({
    mutationFn: () => inventoryApi.createCount({ store_id: storeId, template_id: templateId, period }),
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
            {templates.data && templates.data.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("noTemplates")}</div>
            ) : (
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder={t("template")} />
                </SelectTrigger>
                <SelectContent>
                  {(templates.data ?? []).map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name} · {tpl.items_count}
                      {tpl.organization_name ? ` · ${tpl.organization_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
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
