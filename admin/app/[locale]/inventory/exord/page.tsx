"use client";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@admin/components/ui/badge";
import { Button } from "@admin/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import { suggestTerminal } from "@admin/lib/inventory/suggest";
import type { ExordStoreRow } from "@backend/modules/inventory/types";

type Status = "iiko" | "override" | "pending" | "none";

function statusOf(row: ExordStoreRow): Status {
  if (row.override_terminal_id) {
    return row.source === "override" && row.terminal_id === row.override_terminal_id ? "override" : "pending";
  }
  return row.source === "iiko" ? "iiko" : "none";
}

const ORDER: Record<Status, number> = { none: 0, pending: 1, override: 2, iiko: 3 };

export default function ExordMappingPage() {
  const t = useTranslations("inventory.exord");
  const tRoot = useTranslations("inventory");
  const locale = useLocale();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["exord_stores"], queryFn: inventoryApi.exordStores.list });
  const [choice, setChoice] = useState<Record<number, string>>({});

  const stores = data.data?.stores ?? [];
  const terminals = data.data?.terminals ?? [];
  const terminalName = useMemo(() => new Map(terminals.map((x) => [x.id, x.name])), [terminals]);

  // Филиалы, уже занятые магазинами exord (по iiko id или вручную), — для подсказок.
  const taken = useMemo(() => {
    const set = new Set<string>();
    for (const s of stores) {
      if (s.override_terminal_id) set.add(s.override_terminal_id);
      else if (s.source === "iiko" && s.terminal_id) set.add(s.terminal_id);
    }
    return set;
  }, [stores]);

  const suggestions = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of stores) {
      if (statusOf(s) !== "none") continue;
      const hit = suggestTerminal(s.name, terminals, taken);
      if (hit) m.set(s.exord_user_id, hit.id);
    }
    return m;
  }, [stores, terminals, taken]);

  // Начальный выбор: ручное → по iiko id → подсказка по названию.
  useEffect(() => {
    if (!data.data) return;
    const next: Record<number, string> = {};
    for (const s of data.data.stores) {
      next[s.exord_user_id] =
        s.override_terminal_id ?? (s.source === "iiko" ? s.terminal_id ?? "" : suggestions.get(s.exord_user_id) ?? "");
    }
    setChoice(next);
  }, [data.data, suggestions]);

  const save = useMutation({
    mutationFn: ({ userId, terminalId }: { userId: number; terminalId: string | null }) =>
      inventoryApi.exordStores.set(userId, terminalId),
    onSuccess: () => {
      toast.success(t("saved"));
      void qc.invalidateQueries({ queryKey: ["exord_stores"] });
    },
    onError: (e: Error) =>
      toast.error(
        e instanceof InventoryApiError && e.status === 409 && e.body?.by
          ? t("taken", { by: String(e.body.by) })
          : tRoot("errors.generic", { message: e.message })
      ),
  });

  const sorted = useMemo(
    () => [...stores].sort((a, b) => ORDER[statusOf(a)] - ORDER[statusOf(b)] || a.name.localeCompare(b.name)),
    [stores]
  );

  const syncedAt = data.data?.synced_at
    ? new Date(data.data.synced_at).toLocaleString(locale === "uz-Latn" ? "uz" : locale, { hour12: false })
    : null;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground max-w-3xl">{t("hint")}</p>
      {syncedAt && <p className="text-sm">{t("syncedAt", { date: syncedAt })}</p>}
      {data.data && stores.length === 0 && <p className="text-muted-foreground">{t("empty")}</p>}
      {stores.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("store")}</TableHead>
              <TableHead className="text-right">{t("products")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("terminal")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((s) => {
              const status = statusOf(s);
              const value = choice[s.exord_user_id] ?? "";
              const current = s.override_terminal_id ?? (s.source === "iiko" ? s.terminal_id : null);
              const dirty = value !== (current ?? "");
              const isSuggestion = status === "none" && value && value === suggestions.get(s.exord_user_id);
              return (
                <TableRow key={s.exord_user_id}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    {s.terminal_iiko_id && <div className="text-xs text-muted-foreground">iiko {s.terminal_iiko_id}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.product_count}</TableCell>
                  <TableCell>
                    <Badge variant={status === "none" ? "destructive" : status === "pending" ? "outline" : "secondary"}>
                      {status === "iiko"
                        ? t("statusIiko")
                        : status === "override"
                          ? t("statusOverride")
                          : status === "pending"
                            ? t("pending")
                            : t("statusNone")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <select
                      className="h-9 w-full min-w-56 rounded-md border bg-background px-2 text-sm"
                      value={value}
                      onChange={(e) => setChoice((c) => ({ ...c, [s.exord_user_id]: e.target.value }))}
                    >
                      <option value="">{t("choose")}</option>
                      {terminals.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                    {isSuggestion && <div className="mt-1 text-xs text-yellow-600">{t("suggested")}</div>}
                    {status === "iiko" && s.terminal_id && !dirty && (
                      <div className="mt-1 text-xs text-muted-foreground">{terminalName.get(s.terminal_id) ?? s.terminal_name}</div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={!value || !dirty || save.isPending}
                        onClick={() => save.mutate({ userId: s.exord_user_id, terminalId: value })}
                      >
                        {t("save")}
                      </Button>
                      {s.override_terminal_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={save.isPending}
                          onClick={() => save.mutate({ userId: s.exord_user_id, terminalId: null })}
                        >
                          {t("reset")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
