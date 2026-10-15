"use client";
import { useTranslations } from "next-intl";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import type { TurnoverSummary } from "@backend/modules/inventory/turnover/types";
import { diffClass, formatDiff, formatQty } from "@admin/lib/inventory/money";
import { isSigned } from "@admin/lib/inventory/turnover";

export function SummaryTable({ data, onPick }: { data: TurnoverSummary; onPick: (storeId: string) => void }) {
  const t = useTranslations("inventory.turnover");
  const fmt = (key: string, v: string | undefined) => (isSigned(key as any) ? formatDiff(v ?? "0") : formatQty(v ?? "0"));
  const cls = (key: string, v: string | undefined) => (isSigned(key as any) ? diffClass(v ?? "0") : "");
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("col.store")}</TableHead>
            {data.columns.map((c) => <TableHead key={c.key} className="text-right whitespace-nowrap">{t(`col.${c.key}`)}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r) => (
            <TableRow key={r.store_id} className="cursor-pointer" onClick={() => onPick(r.store_id)}>
              <TableCell className="whitespace-nowrap">
                {r.store_name}
                {r.inconsistent > 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t("inconsistentCount", { n: r.inconsistent })}</span>}
              </TableCell>
              {data.columns.map((c) => <TableCell key={c.key} className={`text-right tabular-nums ${cls(c.key, r.sum[c.key])}`}>{fmt(c.key, r.sum[c.key])}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">{t("total")}</TableCell>
            {data.columns.map((c) => <TableCell key={c.key} className="text-right font-semibold tabular-nums">{fmt(c.key, data.total[c.key])}</TableCell>)}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
