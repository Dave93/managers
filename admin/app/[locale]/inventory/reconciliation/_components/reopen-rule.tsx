"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { inventoryApi } from "@admin/lib/inventory-api";
import type { InventoryReopenRule } from "@backend/modules/inventory/types";

const RULES: InventoryReopenRule[] = ["until_iiko", "until_accept", "office_only"];

/** Кто может вернуть отправленный пересчёт в черновик — общая настройка для всех филиалов. */
export function ReopenRule() {
  const t = useTranslations("inventory.reconcile.reopenRule");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["inventory_reopen_rule"], queryFn: inventoryApi.reconcile.reopenRule });
  const save = useMutation({
    mutationFn: (rule: InventoryReopenRule) => inventoryApi.reconcile.setReopenRule(rule),
    onSuccess: (r) => {
      qc.setQueryData(["inventory_reopen_rule"], r);
      toast.success(t("saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!q.data) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("label")}</span>
      <Select value={q.data.rule} onValueChange={(v) => save.mutate(v as InventoryReopenRule)} disabled={save.isPending}>
        <SelectTrigger className="h-11 w-full sm:w-[28rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RULES.map((r) => (
            <SelectItem key={r} value={r}>
              {t(r)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
