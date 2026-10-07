"use client";
import { Fragment, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@admin/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime, formatDiff, formatQty } from "@admin/lib/inventory/money";
import type { ReconLine } from "@backend/modules/inventory/reconcile/types";

const mismatch = (l: ReconLine) => l.diff_ab_qty !== null && Number(l.diff_ab_qty) !== 0;

export function ReconLines({ reconId, lines, onChanged }: { reconId: string; lines: ReconLine[]; onChanged: () => void }) {
  const t = useTranslations("inventory.reconcile");
  const locale = useLocale();
  const [only, setOnly] = useState(false);
  // Отметка видна сразу, сервер подтверждает её перечитыванием деталей.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const isChecked = (l: ReconLine) => pending[l.product_id] ?? l.checked;

  const mark = useMutation({
    mutationFn: ({ productId, checked }: { productId: string; checked: boolean }) =>
      inventoryApi.reconcile.markLine(reconId, productId, checked),
    onMutate: ({ productId, checked }) => setPending((p) => ({ ...p, [productId]: checked })),
    onError: (e: Error, { productId }) => {
      setPending((p) => {
        const { [productId]: _, ...rest } = p;
        return rest;
      });
      toast.error(e.message);
    },
    onSuccess: onChanged,
  });

  const groups = useMemo(() => {
    const by = new Map<string, ReconLine[]>();
    for (const l of lines) {
      if (only && !mismatch(l)) continue;
      by.set(l.group_name, [...(by.get(l.group_name) ?? []), l]);
    }
    return [...by.entries()];
  }, [lines, only]);

  const diffs = lines.filter(mismatch);
  const checkedDiffs = diffs.filter(isChecked).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={only} onCheckedChange={setOnly} />
          {t("onlyMismatch")}
        </label>
        {diffs.length > 0 && (
          <span className="text-sm text-muted-foreground">{t("checkedCount", { done: checkedDiffs, total: diffs.length })}</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("line.product")}</TableHead>
              <TableHead className="text-right">{t("line.a")}</TableHead>
              <TableHead className="text-right">{t("line.b")}</TableHead>
              <TableHead className="text-right">{t("line.diff")}</TableHead>
              <TableHead className="text-center">{t("line.checked")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(([group, items]) => (
              <Fragment key={group}>
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={5} className="font-medium">
                    {group}
                  </TableCell>
                </TableRow>
                {items.map((l) => {
                  const diff = mismatch(l);
                  const checked = isChecked(l);
                  return (
                    <TableRow key={l.product_id} className={diff && !checked ? "bg-orange-500/10" : ""}>
                      <TableCell>
                        {l.product_name}
                        {l.unit_name && <span className="ml-1 text-xs text-muted-foreground">{l.unit_name}</span>}
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {l.admin_state === "skipped" && <span>{t("flag.skipped")}</span>}
                          {l.admin_state === "absent" && <span className="text-orange-600">{t("flag.absent")}</span>}
                          {l.admin_counts_n > 1 && <span>{t("flag.multi")}</span>}
                        </div>
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${diff ? "font-semibold" : ""}`}>{formatQty(l.admin_qty)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${diff ? "font-semibold" : ""}`}>{formatQty(l.iiko_fact_qty)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${diff ? "font-semibold text-orange-600" : "text-muted-foreground"}`}>
                        {formatDiff(l.diff_ab_qty)}
                      </TableCell>
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          className="h-5 w-5 cursor-pointer accent-primary"
                          checked={checked}
                          disabled={mark.isPending && mark.variables?.productId === l.product_id}
                          title={
                            l.checked && l.checked_by_name
                              ? t("checkedBy", { name: l.checked_by_name, at: formatDateTime(l.checked_at, locale) })
                              : undefined
                          }
                          onChange={(e) => mark.mutate({ productId: l.product_id, checked: e.target.checked })}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
