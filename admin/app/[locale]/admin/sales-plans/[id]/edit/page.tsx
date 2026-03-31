"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useLocale } from "next-intl";
import { apiClient } from "@admin/utils/eden";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { toast } from "sonner";

type PlanItem = {
  product_id: string;
  product_name: string;
  planned_qty: number;
};

export default function EditSalesPlanPage() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams();
  const planId = params.id as string;
  const queryClient = useQueryClient();

  const [items, setItems] = useState<PlanItem[]>([]);
  const [productSearch, setProductSearch] = useState("");

  const { data: planData, isLoading } = useQuery({
    queryKey: ["sales_plan", planId],
    queryFn: async () => {
      const { data } = await apiClient.api.sales_plans({ id: planId }).get();
      return data;
    },
  });

  useEffect(() => {
    if (planData && "items" in planData) {
      setItems(
        (planData as any).items.map((i: any) => ({
          product_id: i.product_id,
          product_name: i.product_name,
          planned_qty: i.planned_qty,
        }))
      );
    }
  }, [planData]);

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
    setItems([...items, { product_id: product.id, product_name: product.name, planned_qty: 0 }]);
    setProductSearch("");
  };

  const removeProduct = (productId: string) => {
    setItems(items.filter((i) => i.product_id !== productId));
  };

  const updateQty = (productId: string, qty: number) => {
    setItems(items.map((i) => (i.product_id === productId ? { ...i, planned_qty: qty } : i)));
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { data, status } = await apiClient.api.sales_plans({ id: planId }).patch({
        items: items.filter((i) => i.planned_qty > 0),
      });
      if (status !== 200) throw new Error((data as any)?.message || "Error");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales_plans"] });
      toast.success("План обновлён");
      router.push(`/${locale}/admin/sales-plans/list`);
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Загрузка...</div>;

  const plan = planData as any;

  return (
    <div className="max-w-3xl">
      <h2 className="text-3xl font-bold tracking-tight pb-4">
        Редактировать план — {plan?.terminal_name}
      </h2>

      <div className="space-y-6">
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
            onClick={() => updateMutation.mutate()}
            disabled={items.length === 0 || updateMutation.isPending}
          >
            {updateMutation.isPending ? "Сохранение..." : "Сохранить"}
          </Button>
          <Button variant="outline" onClick={() => router.back()}>Отмена</Button>
        </div>
      </div>
    </div>
  );
}
