"use client";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@admin/i18n/routing";
import { Switch } from "@admin/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime, formatDiff, formatQty } from "@admin/lib/inventory/money";
import { formatDay } from "@admin/lib/inventory/periods";
import { BookBreakdownView } from "@admin/app/[locale]/inventory/_components/book-compare";
import type { InterimReconLine } from "@backend/modules/inventory/book/types";

const mismatch = (l: InterimReconLine) => l.diff_qty !== null && Number(l.diff_qty) !== 0;

export function InterimDetail({ id, readOnly = false, backHref = "/inventory/reconciliation" }: { id: string; readOnly?: boolean; backHref?: string }) {
  const t = useTranslations("inventory.reconcile");
  const ti = useTranslations("inventory.reconcile.interim");
  const locale = useLocale();
  const q = useQuery({ queryKey: ["recon_interim", id], queryFn: () => inventoryApi.reconcile.interimGet(id) });
  const [only, setOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const mark = useMutation({
    mutationFn: ({ productId, checked }: { productId: string; checked: boolean }) => inventoryApi.reconcile.interimMark(id, productId, checked),
    onMutate: ({ productId, checked }) => setPending((p) => ({ ...p, [productId]: checked })),
    onError: (e: Error, { productId }) => {
      setPending((p) => {
        const { [productId]: _, ...rest } = p;
        return rest;
      });
      toast.error(e.message);
    },
    onSuccess: () => void q.refetch(),
  });

  const groups = useMemo(() => {
    const by = new Map<string, InterimReconLine[]>();
    for (const l of q.data?.lines ?? []) {
      if (only && !mismatch(l)) continue;
      by.set(l.group_name, [...(by.get(l.group_name) ?? []), l]);
    }
    return [...by.entries()];
  }, [q.data, only]);

  if (!q.data) return <div>{q.error ? (q.error as Error).message : "…"}</div>;
  const d = q.data;
  const isChecked = (l: InterimReconLine) => pending[l.product_id] ?? l.checked;
  const checkedDiffs = d.lines.filter((l) => mismatch(l) && isChecked(l)).length;
  const monthStart = `${d.count_date.slice(0, 8)}01`;
  if (d.hidden) {
    return (
      <div className="space-y-4">
        <Link href={backHref} className="text-sm underline">
          ← {t("back")}
        </Link>
        <h1 className="text-xl font-semibold">{d.store_name}</h1>
        <div className="rounded border border-orange-500/40 bg-orange-500/10 p-3 text-sm">{ti("hiddenDetail")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-sm underline">
        ← {t("back")}
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{d.store_name}</h1>
        <div className="text-sm text-muted-foreground">
          {formatDay(d.count_date)} · {d.template_name}
          {d.book_fetched_at ? ` · ${ti("fetchedAt", { at: formatDateTime(d.book_fetched_at, locale) })}` : ` · ${ti("loading")}`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={only} onCheckedChange={setOnly} />
          {ti("onlyMismatch")}
        </label>
        {d.mismatch_count > 0 && (
          <span className="text-sm text-muted-foreground">{t("checkedCount", { done: checkedDiffs, total: d.mismatch_count })}</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("line.product")}</TableHead>
              <TableHead className="text-right">{t("line.a")}</TableHead>
              <TableHead className="text-right">{ti("iikoCol")}</TableHead>
              <TableHead className="text-right">{t("line.diff")}</TableHead>
              <TableHead className="text-center">{readOnly ? ti("checkedByOffice") : t("line.checked")}</TableHead>
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
                    <Fragment key={l.product_id}>
                      <TableRow className={`cursor-pointer ${diff && !checked ? "bg-orange-500/10" : ""}`} onClick={() => setOpen(open === l.product_id ? null : l.product_id)}>
                        <TableCell>
                          {l.product_name}
                          {l.unit_name && <span className="ml-1 text-xs text-muted-foreground">{l.unit_name}</span>}
                          {l.code && <div className="text-xs text-muted-foreground">{l.code}</div>}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${diff ? "font-semibold" : ""}`}>{formatQty(l.admin_qty)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${diff ? "font-semibold" : ""}`}>{formatQty(l.iiko_qty)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${diff ? "font-semibold text-orange-600" : "text-muted-foreground"}`}>
                          {formatDiff(l.diff_qty)}
                        </TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          {readOnly ? (
                            checked ? <span title={l.checked_by_name ? t("checkedBy", { name: l.checked_by_name, at: formatDateTime(l.checked_at, locale) }) : undefined}>✓</span> : null
                          ) : (
                          <input
                            type="checkbox"
                            className="h-5 w-5 cursor-pointer accent-primary"
                            checked={checked}
                            disabled={mark.isPending && mark.variables?.productId === l.product_id}
                            title={l.checked && l.checked_by_name ? t("checkedBy", { name: l.checked_by_name, at: formatDateTime(l.checked_at, locale) }) : undefined}
                            onChange={(e) => mark.mutate({ productId: l.product_id, checked: e.target.checked })}
                          />
                          )}
                        </TableCell>
                      </TableRow>
                      {open === l.product_id && l.iiko_qty !== null && (
                        <TableRow>
                          <TableCell colSpan={5} className="bg-muted/30">
                            <BookBreakdownView b={l} startDate={monthStart} book={l.iiko_qty} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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
