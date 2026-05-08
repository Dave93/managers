"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@admin/components/useAuth";

type Composition = {
  composition_id: string;
  name: string;
  price_uzs: number;
  current_quantity: number;
  last_intent_quantity: number | null;
  last_intent_set_at: string | null;
};

function AsraboxStockContent() {
  const queryClient = useQueryClient();
  const [terminalId, setTerminalId] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, number>>({});

  const { user } = useAuth();
  const userOrganizationId = (user as any)?.user?.organization_id;

  // Terminals (cached, filtered by user's organization)
  const { data: terminalsData } = useQuery({
    queryKey: ["terminals_cached"],
    queryFn: async () => {
      const { data } = await apiClient.api.terminals.cached.get();
      return data;
    },
  });
  const allTerminals = (terminalsData as any[]) ?? [];
  const terminals = userOrganizationId
    ? allTerminals.filter(
        (t: any) => !t.organization_id || t.organization_id === userOrganizationId
      )
    : allTerminals;

  // Compositions for the selected terminal
  const compositionsQuery = useQuery({
    queryKey: ["asrabox_stock_compositions", terminalId],
    queryFn: async () => {
      if (!terminalId) return [] as Composition[];
      const { data, status } = await apiClient.api.asrabox.stock.compositions.get({
        query: { terminal_id: terminalId },
      });
      if (status !== 200) {
        const detail = (data as any)?.error || "Ошибка загрузки";
        throw new Error(detail);
      }
      return (data as Composition[]) ?? [];
    },
    enabled: !!terminalId,
  });

  // Reset drafts whenever the terminal or compositions change.
  useEffect(() => {
    if (compositionsQuery.data) {
      const next: Record<string, number> = {};
      for (const c of compositionsQuery.data) {
        next[c.composition_id] = c.current_quantity;
      }
      setDrafts(next);
    }
  }, [compositionsQuery.data, terminalId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = Object.entries(drafts).map(([composition_id, quantity]) => ({
        composition_id,
        quantity: Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : 0,
      }));
      const { data, status } = await apiClient.api.asrabox.stock.save.post({
        terminal_id: terminalId,
        items,
      });
      if (status !== 200) {
        throw new Error((data as any)?.error || "Ошибка сохранения");
      }
      return data;
    },
    onSuccess: (data: any) => {
      const updated = data?.updated?.length ?? 0;
      const errors = data?.errors?.length ?? 0;
      if (errors > 0) {
        toast.warning(`Сохранено ${updated}, ошибок ${errors}`);
      } else {
        toast.success(`Сохранено: ${updated}`);
      }
      queryClient.invalidateQueries({
        queryKey: ["asrabox_stock_compositions", terminalId],
      });
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const compositions = compositionsQuery.data ?? [];
  const hasChanges = useMemo(() => {
    return compositions.some(
      (c) => (drafts[c.composition_id] ?? c.current_quantity) !== c.current_quantity
    );
  }, [compositions, drafts]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Asrabox / Сток</h2>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Филиал:</span>
        <Select value={terminalId} onValueChange={setTerminalId}>
          <SelectTrigger className="w-[320px]">
            <SelectValue placeholder="Выберите филиал" />
          </SelectTrigger>
          <SelectContent>
            {terminals.map((t: any) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!terminalId ? (
        <div className="text-sm text-muted-foreground">
          Выберите филиал, чтобы увидеть товары asrabox.
        </div>
      ) : compositionsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      ) : compositionsQuery.isError ? (
        <div className="text-sm text-red-600">
          {(compositionsQuery.error as Error)?.message ?? "Ошибка"}
        </div>
      ) : compositions.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          Нет товаров asrabox. Запустите{" "}
          <code>php artisan asrabox_compositions:sync</code> на стороне laravel.
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-2">Наименование</th>
                  <th className="text-right p-2">Цена, сум</th>
                  <th className="text-right p-2">Сейчас</th>
                  <th className="text-right p-2">Последнее</th>
                  <th className="text-right p-2 w-32">Поставить</th>
                </tr>
              </thead>
              <tbody>
                {compositions.map((c) => (
                  <tr key={c.composition_id} className="border-t">
                    <td className="p-2">{c.name}</td>
                    <td className="p-2 text-right">
                      {c.price_uzs.toLocaleString("ru-RU")}
                    </td>
                    <td className="p-2 text-right">{c.current_quantity}</td>
                    <td className="p-2 text-right text-muted-foreground">
                      {c.last_intent_quantity ?? "—"}
                    </td>
                    <td className="p-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={drafts[c.composition_id] ?? 0}
                        onChange={(e) =>
                          setDrafts((d) => ({
                            ...d,
                            [c.composition_id]: Number(e.target.value || 0),
                          }))
                        }
                        className="text-right h-8"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!hasChanges || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function AsraboxStockPage() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <AsraboxStockContent />
    </Suspense>
  );
}
