"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Switch } from "@admin/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { inventoryApi } from "@admin/lib/inventory-api";
import { formatQty } from "@admin/lib/inventory/money";
import { formatDay, recentPeriods } from "@admin/lib/inventory/periods";
import { useMyPermissions } from "@admin/lib/inventory/use-permissions";
import { BookBreakdownView } from "../_components/book-compare";

const STORE_KEY = "inventory:stock-store";

function Movement({ storeId, productId }: { storeId: string; productId: string }) {
  const t = useTranslations("inventory.stock");
  const q = useQuery({ queryKey: ["inventory_stock_mv", storeId, productId], queryFn: () => inventoryApi.stockMovement(storeId, productId) });
  if (!q.data) return <div className="text-sm text-muted-foreground">{q.error ? (q.error as Error).message : "…"}</div>;
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{t("movement", { from: formatDay(q.data.from) })}</div>
      <BookBreakdownView b={q.data} startDate={q.data.from} book={q.data.book_qty} />
    </div>
  );
}

export default function StockPage() {
  const t = useTranslations("inventory.stock");
  const tRoot = useTranslations("inventory");
  const locale = useLocale();
  const perms = useMyPermissions() ?? [];
  const office = perms.includes("inventory.templates");
  // Свои склады у филиала; офису — все склады из обзора текущего месяца.
  const mine = useQuery({ queryKey: ["inventory_stores"], queryFn: inventoryApi.stores, enabled: !office });
  const period = useMemo(() => recentPeriods(new Date(), 1)[0], []);
  const all = useQuery({ queryKey: ["inventory_overview", period, "__all__"], queryFn: () => inventoryApi.overview(period), enabled: office });
  const stores = office
    ? (all.data ?? []).map((r) => ({ id: r.store_id, name: r.store_name }))
    : (mine.data ?? []).map((s) => ({ id: s.id, name: s.name }));

  const [storeId, setStoreId] = useState("");
  useEffect(() => {
    if (!stores.length || storeId) return;
    let saved = "";
    try {
      saved = window.localStorage.getItem(STORE_KEY) ?? "";
    } catch {
      // не критично
    }
    setStoreId(stores.some((s) => s.id === saved) ? saved : stores[0].id);
  }, [stores, storeId]);
  const pick = (id: string) => {
    setStoreId(id);
    setOpen(null);
    try {
      window.localStorage.setItem(STORE_KEY, id);
    } catch {
      // не критично
    }
  };

  const stock = useQuery({ queryKey: ["inventory_stock", storeId], queryFn: () => inventoryApi.stock(storeId), enabled: !!storeId });
  const [search, setSearch] = useState("");
  const [onlyNegative, setOnlyNegative] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const by = new Map<string, NonNullable<typeof stock.data>["lines"]>();
    for (const l of stock.data?.lines ?? []) {
      if (q && !l.name.toLowerCase().includes(q)) continue;
      if (onlyNegative && Number(l.qty) >= 0) continue;
      by.set(l.group_name, [...(by.get(l.group_name) ?? []), l]);
    }
    return [...by.entries()];
  }, [stock.data, search, onlyNegative]);

  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {stores.length > 1 && (
        <Select value={storeId} onValueChange={pick}>
          <SelectTrigger className="h-11 w-full sm:w-96">
            <SelectValue placeholder={tRoot("chooseStore")} />
          </SelectTrigger>
          <SelectContent>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {stock.data?.hidden ? (
        <div className="rounded border border-orange-500/40 bg-orange-500/10 p-3 text-sm">{t("hidden")}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Input className="h-11 w-full sm:w-80" placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={onlyNegative} onCheckedChange={setOnlyNegative} />
              {t("onlyNegative")}
            </label>
            {stock.data?.at && <span className="text-sm text-muted-foreground">{t("at", { at: stock.data.at.replace("T", " ").slice(0, 16) })}</span>}
          </div>
          {stock.error && <div className="text-sm text-destructive">{(stock.error as Error).message}</div>}
          {stock.data && stock.data.lines.length === 0 && <div className="text-muted-foreground">{t("empty")}</div>}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("col.code")}</TableHead>
                  <TableHead>{t("col.product")}</TableHead>
                  <TableHead>{t("col.unit")}</TableHead>
                  <TableHead className="text-right">{t("col.qty")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(([group, items]) => (
                  <Fragment key={group}>
                    <TableRow className="bg-muted/50">
                      <TableCell colSpan={4} className="font-medium">
                        {group}
                      </TableCell>
                    </TableRow>
                    {items.map((l) => (
                      <Fragment key={l.product_id}>
                        <TableRow className="cursor-pointer" onClick={() => setOpen(open === l.product_id ? null : l.product_id)}>
                          <TableCell className="tabular-nums text-xs">{l.code ?? "—"}</TableCell>
                          <TableCell>{l.name}</TableCell>
                          <TableCell className="text-muted-foreground">{l.unit_name ?? ""}</TableCell>
                          <TableCell className={`text-right tabular-nums ${Number(l.qty) < 0 ? "font-semibold text-destructive" : ""}`}>
                            {formatQty(l.qty)}
                          </TableCell>
                        </TableRow>
                        {open === l.product_id && (
                          <TableRow>
                            <TableCell colSpan={4} className="bg-muted/30">
                              <Movement storeId={storeId} productId={l.product_id} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
