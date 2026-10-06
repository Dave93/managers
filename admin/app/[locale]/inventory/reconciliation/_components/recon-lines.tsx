"use client";
import { Fragment, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@admin/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { formatMoney, formatQty } from "@admin/lib/inventory/money";
import type { ReconLine } from "@backend/modules/inventory/reconcile/types";

const mismatch = (l: ReconLine) => l.diff_ab_qty !== null && Number(l.diff_ab_qty) !== 0;

export function ReconLines({ lines }: { lines: ReconLine[] }) {
  const t = useTranslations("inventory.reconcile");
  const [only, setOnly] = useState(false);
  const groups = useMemo(() => {
    const by = new Map<string, ReconLine[]>();
    for (const l of lines) {
      if (only && !mismatch(l)) continue;
      by.set(l.group_name, [...(by.get(l.group_name) ?? []), l]);
    }
    return [...by.entries()];
  }, [lines, only]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={only} onCheckedChange={setOnly} />
        {t("onlyMismatch")}
      </label>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("line.product")}</TableHead>
              <TableHead className="text-right">{t("line.a")}</TableHead>
              <TableHead className="text-right">{t("line.b")}</TableHead>
              <TableHead className="text-right">{t("line.c")}</TableHead>
              <TableHead className="text-right">{t("line.ab")}</TableHead>
              <TableHead className="text-right">{t("line.acSum")}</TableHead>
              <TableHead className="text-right">{t("line.bcSum")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(([group, items]) => (
              <Fragment key={group}>
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={7} className="font-medium">
                    {group}
                  </TableCell>
                </TableRow>
                {items.map((l) => (
                  <TableRow key={l.product_id} className={mismatch(l) ? "bg-orange-500/10" : ""}>
                    <TableCell>
                      {l.product_name}
                      {l.unit_name && <span className="ml-1 text-xs text-muted-foreground">{l.unit_name}</span>}
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {l.admin_state === "skipped" && <span>{t("flag.skipped")}</span>}
                        {l.admin_state === "absent" && <span className="text-orange-600">{t("flag.absent")}</span>}
                        {l.admin_counts_n > 1 && <span>{t("flag.multi")}</span>}
                        {l.unit_cost === null && <span>{t("flag.noCost")}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(l.admin_qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(l.iiko_fact_qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(l.book_qty)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${mismatch(l) ? "font-semibold text-orange-600" : ""}`}>
                      {formatQty(l.diff_ab_qty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(l.diff_ac_sum)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(l.iiko_fact_qty === null ? null : l.iiko_correction_sum)}</TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
