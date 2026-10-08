"use client";
import { Fragment, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Switch } from "@admin/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatDateTime, formatDiff, formatQty } from "@admin/lib/inventory/money";
import { formatDay } from "@admin/lib/inventory/periods";
import type { BookBreakdown, BookView } from "@backend/modules/inventory/book/types";

/** Из чего сложилось книжное количество: начало месяца + приход − реализация ± перемещения − списания ± прочее. */
export function BookBreakdownView({ b, startDate, book }: { b: BookBreakdown; startDate: string; book: string }) {
  const t = useTranslations("inventory.book.breakdown");
  const tb = useTranslations("inventory.book");
  const rows: [string, string, string][] = [
    [t("start", { date: formatDay(startDate) }), "", b.start_qty],
    [t("invoice"), "+", b.in_invoice],
    [t("sales"), "−", b.out_sales],
    [t("transferIn"), "+", b.transfer_in],
    [t("transferOut"), "−", b.transfer_out],
    [t("writeoff"), "−", b.out_writeoff],
    [t("other"), "±", b.other_net],
  ];
  return (
    <div className="space-y-1 text-sm">
      {rows
        .filter(([, sign, v]) => sign === "" || Number(v) !== 0)
        .map(([label, sign, v]) => (
          <div key={label} className="flex max-w-md justify-between gap-4">
            <span className="text-muted-foreground">
              {sign && `${sign} `}
              {label}
            </span>
            <span className="tabular-nums">{formatQty(v)}</span>
          </div>
        ))}
      <div className="flex max-w-md justify-between gap-4 border-t pt-1 font-medium">
        <span>= {t("book")}</span>
        <span className="tabular-nums">{formatQty(book)}</span>
      </div>
      {!b.consistent && <div className="text-xs text-orange-600">{tb("inconsistent")}</div>}
    </div>
  );
}

export function BookCompare({
  countId,
  countDate,
  data,
  canRefresh,
  onRefreshed,
}: {
  countId: string;
  countDate: string;
  data: BookView;
  canRefresh: boolean;
  onRefreshed: () => void;
}) {
  const t = useTranslations("inventory.book");
  const locale = useLocale();
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: () => inventoryApi.refreshBook(countId),
    onSuccess: () => {
      toast.success(t("queued"));
      onRefreshed();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Как в форме инвентаризации iiko: сначала самые большие расхождения.
  const lines = useMemo(() => {
    const abs = (v: string | null) => (v === null ? -1 : Math.abs(Number(v)));
    return [...data.lines]
      .filter((l) => !onlyDiff || (l.diff_qty !== null && Number(l.diff_qty) !== 0))
      .sort((a, b) => abs(b.diff_qty) - abs(a.diff_qty) || a.product_name.localeCompare(b.product_name, "ru"));
  }, [data.lines, onlyDiff]);
  const monthStart = `${countDate.slice(0, 8)}01`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm text-muted-foreground">
          {data.fetched_at ? t("fetchedAt", { at: formatDateTime(data.fetched_at, locale) }) : t("loading")}
        </span>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={onlyDiff} onCheckedChange={setOnlyDiff} />
          {t("onlyDiff")}
        </label>
        {canRefresh && (
          <Button variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {t("refresh")}
          </Button>
        )}
      </div>
      {data.fetched_at && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">{t("col.n")}</TableHead>
                <TableHead>{t("col.code")}</TableHead>
                <TableHead>{t("col.product")}</TableHead>
                <TableHead>{t("col.unit")}</TableHead>
                <TableHead className="text-right">{t("col.fact")}</TableHead>
                <TableHead className="text-right">{t("col.book")}</TableHead>
                <TableHead className="text-right">{t("col.diff")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => {
                const diff = l.diff_qty !== null && Number(l.diff_qty) !== 0;
                return (
                  <Fragment key={l.product_id}>
                    <TableRow className="cursor-pointer" onClick={() => setOpen(open === l.product_id ? null : l.product_id)}>
                      <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="tabular-nums text-xs">{l.code ?? "—"}</TableCell>
                      <TableCell>
                        {l.product_name}
                        <div className="text-xs text-muted-foreground">
                          {!l.in_count ? t("notInCount") : l.fact_qty === null ? t("notCounted") : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{l.unit_name ?? ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(l.fact_qty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(l.book_qty)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${diff ? "font-semibold text-orange-600" : "text-muted-foreground"}`}>
                        {formatDiff(l.diff_qty)}
                      </TableCell>
                    </TableRow>
                    {open === l.product_id && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/30">
                          <BookBreakdownView b={l} startDate={monthStart} book={l.book_qty} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
