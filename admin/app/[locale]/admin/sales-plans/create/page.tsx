"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { apiClient } from "@admin/utils/eden";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

type PlanItem = {
  product_id: string;
  product_name: string;
  planned_qty: number;
};

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export default function CreateSalesPlanPage() {
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const now = new Date();

  const [terminalId, setTerminalId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [items, setItems] = useState<PlanItem[]>([]);
  const [productSearch, setProductSearch] = useState("");

  // Fetch terminals
  const { data: terminalsData } = useQuery({
    queryKey: ["terminals_cached"],
    queryFn: async () => {
      const { data } = await apiClient.api.terminals.cached.get();
      return data;
    },
  });

  const terminals = (terminalsData as any[]) ?? [];

  // Search products by name
  const { data: productsData } = useQuery({
    queryKey: ["nomenclature_search", productSearch],
    queryFn: async () => {
      if (productSearch.length < 2) return [];
      const { data } = await apiClient.api.nomenclature_element_organization.get({
        query: {
          limit: "20",
          offset: "0",
          filters: JSON.stringify([
            { field: "name", operator: "contains", value: productSearch },
          ]),
        },
      });
      return (data as any)?.data ?? [];
    },
    enabled: productSearch.length >= 2,
  });

  const searchResults = (productsData as any[]) ?? [];

  const addProduct = (product: any) => {
    if (items.find((i) => i.product_id === product.id)) return;
    setItems([...items, {
      product_id: product.id,
      product_name: product.name,
      planned_qty: 0,
    }]);
    setProductSearch("");
  };

  const removeProduct = (productId: string) => {
    setItems(items.filter((i) => i.product_id !== productId));
  };

  const updateQty = (productId: string, qty: number) => {
    setItems(items.map((i) => (i.product_id === productId ? { ...i, planned_qty: qty } : i)));
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data, status } = await apiClient.api.sales_plans.post({
        terminal_id: terminalId,
        organization_id: organizationId,
        year: Number(year),
        month: Number(month),
        items: items.filter((i) => i.planned_qty > 0),
      });
      if (status !== 200) throw new Error((data as any)?.message || "Error");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales_plans"] });
      toast.success("План создан");
      router.push(`/${locale}/admin/sales-plans/list`);
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  // Set organization_id from selected terminal
  useEffect(() => {
    if (terminalId && terminals.length > 0) {
      const t = terminals.find((t: any) => t.id === terminalId);
      if (t) setOrganizationId(t.organization_id);
    }
  }, [terminalId, terminals]);

  return (
    <div className="max-w-3xl">
      <h2 className="text-3xl font-bold tracking-tight pb-4">Создать план продаж</h2>

      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Терминал</label>
            <Select value={terminalId} onValueChange={setTerminalId}>
              <SelectTrigger><SelectValue placeholder="Выберите терминал" /></SelectTrigger>
              <SelectContent>
                {terminals.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Год</label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2025">2025</SelectItem>
                <SelectItem value="2026">2026</SelectItem>
                <SelectItem value="2027">2027</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Месяц</label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((name, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Добавить продукт</label>
          <Input
            placeholder="Начните вводить название..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
          {searchResults.length > 0 && (
            <div className="border rounded-md mt-1 max-h-48 overflow-y-auto">
              {searchResults.map((p: any) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-b-0"
                  onClick={() => addProduct(p)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Продукт</th>
                  <th className="p-3 text-center font-medium w-40">План на месяц</th>
                  <th className="p-3 text-right font-medium w-20"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.product_id} className="border-b">
                    <td className="p-3">{item.product_name}</td>
                    <td className="p-3">
                      <Input
                        type="number"
                        min={0}
                        value={item.planned_qty || ""}
                        onChange={(e) => updateQty(item.product_id, Number(e.target.value))}
                        className="text-center"
                      />
                    </td>
                    <td className="p-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => removeProduct(item.product_id)}>✕</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-4">
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!terminalId || items.length === 0 || createMutation.isPending}
          >
            {createMutation.isPending ? "Сохранение..." : "Создать план"}
          </Button>
          <Button variant="outline" onClick={() => router.back()}>Отмена</Button>
        </div>
      </div>
    </div>
  );
}
