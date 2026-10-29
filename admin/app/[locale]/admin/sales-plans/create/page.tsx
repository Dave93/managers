"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
import { useAuth } from "@admin/components/useAuth";

type PlanItem = {
  product_id: string;
  product_name: string;
  planned_qty: number;
};

const MONTH_KEYS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

export default function CreateSalesPlanPage() {
  const t = useTranslations("salesPlans");
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
  const { user } = useAuth();
  const userOrganizationId = (user as any)?.user?.organization_id;

  // Fetch terminals
  const { data: terminalsData } = useQuery({
    queryKey: ["terminals_cached"],
    queryFn: async () => {
      const { data } = await apiClient.api.terminals.cached.get();
      return data;
    },
  });

  const allTerminals = (terminalsData as any[]) ?? [];

  // Filter terminals by user's organization if set
  const terminals = userOrganizationId
    ? allTerminals.filter((t: any) => !t.organization_id || t.organization_id === userOrganizationId)
    : allTerminals;

  // Search products by name
  const { data: productsData } = useQuery({
    queryKey: ["nomenclature_search", productSearch],
    queryFn: async () => {
      if (productSearch.length < 2) return [];
      const { data } = await apiClient.api.nomenclature_element.get({
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
      toast.success(t("create.created"));
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
      <h2 className="text-3xl font-bold tracking-tight pb-4">{t("create.title")}</h2>

      <div className="space-y-6">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[180px]">
            <label className="text-sm font-medium mb-1 block">{t("create.terminal")}</label>
            <Select value={terminalId} onValueChange={setTerminalId}>
              <SelectTrigger><SelectValue placeholder={t("create.selectTerminal")} /></SelectTrigger>
              <SelectContent>
                {terminals.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t("create.year")}</label>
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
            <label className="text-sm font-medium mb-1 block">{t("create.month")}</label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_KEYS.map((key, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{t(`months.${key}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">{t("form.addProduct")}</label>
          <Input
            placeholder={t("form.searchPlaceholder")}
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
                  <th className="p-3 text-left font-medium">{t("form.product")}</th>
                  <th className="p-3 text-center font-medium w-40">{t("form.planPerMonth")}</th>
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
            {createMutation.isPending ? t("form.saving") : t("create.submit")}
          </Button>
          <Button variant="outline" onClick={() => router.back()}>{t("form.cancel")}</Button>
        </div>
      </div>
    </div>
  );
}
