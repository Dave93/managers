"use client";
import { Fragment, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@admin/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import type { TurnoverLine, TurnoverStoreView } from "@backend/modules/inventory/turnover/types";
import { diffClass, formatDiff, formatQty } from "@admin/lib/inventory/money";
import { cellOf, columnsFor, isSigned, type TurnoverMode } from "@admin/lib/inventory/turnover";

export function StoreTable({ view }: { view: TurnoverStoreView }) {
  const t = useTranslations("inventory.turnover");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<TurnoverMode>("qty");
  const cols = columnsFor(view.columns, view.with_sums ? mode : "qty");
  const m = view.with_sums ? mode : "qty";
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const by = new Map<string, TurnoverLine[]>();
    for (const l of view.lines) {
      if (q && !l.name.toLowerCase().includes(q) && !(l.code ?? "").toLowerCase().includes(q)) continue;
      // В этом режиме одни нули (например, менялась только сумма) — строку не показываем.
      if (!Object.values((m === "sum" ? l.sum : l.qty) ?? {}).some((v) => Math.abs(Number(v)) > 0.00005)) continue;
      by.set(l.group_name, [...(by.get(l.group_name) ?? []), l]);
    }
    return [...by.entries()];
  }, [view.lines, search, m]);
  const span = 3 + cols.length;
  if (!view.lines.length) return <div className="text-muted-foreground">{t("empty")}</div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-11 w-full sm:w-80" placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        {view.with_sums && (
          <div className="inline-flex rounded border">
            {(["qty", "sum"] as const).map((x) => (
              <button key={x} type="button" onClick={() => setMode(x)} className={`px-3 py-2 text-sm ${mode === x ? "bg-primary text-primary-foreground" : ""}`}>
                {t(`mode.${x}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.code")}</TableHead>
              <TableHead>{t("col.product")}</TableHead>
              <TableHead>{t("col.unit")}</TableHead>
              {cols.map((c) => <TableHead key={c.key} className="text-right whitespace-nowrap">{t(`col.${c.key}`)}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(([group, items]) => (
              <Fragment key={group}>
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={span} className="font-medium">{group}</TableCell>
                </TableRow>
                {items.map((l) => (
                  <TableRow key={l.product_id}>
                    <TableCell className="tabular-nums text-xs">{l.code ?? "—"}</TableCell>
                    <TableCell>
                      {l.name}
                      {!l.consistent && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t("inconsistent")}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m === "qty" ? l.unit_name ?? "" : ""}</TableCell>
                    {cols.map((c) => {
                      const v = cellOf(l, c.key, m);
                      const hint = c.key === "transfer"
                        ? t("transferHint", {
                            in: formatQty(m === "sum" ? l.transfer.sum_in ?? "0" : l.transfer.qty_in),
                            out: formatQty(m === "sum" ? l.transfer.sum_out ?? "0" : l.transfer.qty_out),
                          })
                        : undefined;
                      return (
                        <TableCell key={c.key} title={hint} className={`text-right tabular-nums ${isSigned(c.key) ? diffClass(v) : ""}`}>
                          {isSigned(c.key) ? formatDiff(v) : formatQty(v)}
                        </TableCell>
                      );
                    })}
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
