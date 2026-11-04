"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@admin/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import { periodLabel } from "@admin/lib/inventory/periods";
import type { OverlayDetail } from "@admin/lib/inventory/queue";

/** Офис переносит месячный пересчёт в другой месяц (04.11.2026): филиалы отправляли октябрь как ноябрь. */
export function ChangePeriodDialog({ detail, onDone }: { detail: OverlayDetail; onDone: () => void }) {
  const t = useTranslations("inventory.changePeriod");
  const tRoot = useTranslations("inventory");
  const locale = useLocale();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(detail.period_targets[0] ?? "");

  const move = useMutation({
    mutationFn: () => inventoryApi.changePeriod(detail.id, target),
    onSuccess: (r) => {
      setOpen(false);
      toast.success(t("done", { period: periodLabel(r.period, locale) }));
      void qc.invalidateQueries({ queryKey: ["inventory_counts", detail.store_id] });
      void qc.invalidateQueries({ queryKey: ["inventory_book", detail.id] });
      onDone();
    },
    onError: (e: Error) => {
      const body = e instanceof InventoryApiError ? e.body : null;      if (body?.error === "period_taken") toast.error(t("taken"));
      else if (body?.error === "period_closed") toast.error(t("closed", { period: periodLabel(body.period, locale) }));
      else toast.error(tRoot("errors.generic", { message: e.message }));
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setTarget(detail.period_targets[0] ?? "");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>{t("current", { period: periodLabel(detail.period, locale) })}</div>
          <div className="space-y-1">
            <div className="font-medium">{t("target")}</div>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue placeholder={t("target")} />
              </SelectTrigger>
              <SelectContent>
                {detail.period_targets.map((p) => (
                  <SelectItem key={p} value={p}>
                    {periodLabel(p, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-muted-foreground">{t("hint")}</div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button disabled={!target || move.isPending} onClick={() => move.mutate()}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
