"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { inventoryApi } from "@admin/lib/inventory-api";

export function AddProductDialog({ countId, online, onAdded }: { countId: string; online: boolean; onAdded: () => void }) {
  const t = useTranslations("inventory");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);

  const results = useQuery({
    queryKey: ["inventory_products", countId, debounced],
    queryFn: () => inventoryApi.products(debounced, countId),
    enabled: open && debounced.length >= 2,
  });

  const add = useMutation({
    mutationFn: (productId: string) => inventoryApi.addLine(countId, productId),
    onSuccess: () => {
      setOpen(false);
      setQ("");
      onAdded();
    },
    onError: (e: Error) => toast.error(t("errors.generic", { message: e.message })),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" disabled={!online} title={online ? undefined : t("addProduct.offline")}>
          {t("addProduct.button")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addProduct.title")}</DialogTitle>
        </DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("addProduct.search")} className="h-11" />
        <div className="max-h-80 overflow-y-auto divide-y">
          {results.data && results.data.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">{t("addProduct.nothing")}</div>
          )}
          {(results.data ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 min-h-[44px] py-2 hover:bg-muted"
              disabled={add.isPending}
              onClick={() => add.mutate(p.id)}
            >
              <div className="text-sm">{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {p.group_name}
                {p.unit_name ? ` · ${p.unit_name}` : ""}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
