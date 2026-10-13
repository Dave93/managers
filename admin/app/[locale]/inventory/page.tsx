"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "@admin/i18n/routing";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { inventoryApi } from "@admin/lib/inventory-api";
import { useMyPermissions } from "@admin/lib/inventory/use-permissions";
import { CountCard } from "./_components/count-card";
import { Overview } from "./_components/overview";
import { StartDialog } from "./_components/start-dialog";

const STORE_KEY = "inventory:store";

function readStore(): string {
  try {
    return window.localStorage.getItem(STORE_KEY) ?? "";
  } catch {
    return "";
  }
}

function MyStores() {
  const t = useTranslations("inventory");
  const router = useRouter();
  const qc = useQueryClient();
  const perms = useMyPermissions() ?? [];
  const stores = useQuery({ queryKey: ["inventory_stores"], queryFn: inventoryApi.stores });
  const [storeId, setStoreId] = useState("");

  useEffect(() => {
    if (!stores.data?.length) return;
    const saved = readStore();
    setStoreId(stores.data.some((s) => s.id === saved) ? saved : stores.data[0].id);
  }, [stores.data]);

  const pick = (id: string) => {
    setStoreId(id);
    try {
      window.localStorage.setItem(STORE_KEY, id);
    } catch {
      // не критично
    }
  };

  const counts = useQuery({
    queryKey: ["inventory_counts", storeId],
    queryFn: () => inventoryApi.listCounts(storeId),
    enabled: !!storeId,
  });

  if (stores.data && stores.data.length === 0) {
    return <div className="text-muted-foreground">{t("noStores")}</div>;
  }

  return (
    <div className="space-y-4">
      {(stores.data?.length ?? 0) > 1 && (
        <Select value={storeId} onValueChange={pick}>
          <SelectTrigger className="h-11 w-full sm:w-80">
            <SelectValue placeholder={t("chooseStore")} />
          </SelectTrigger>
          <SelectContent>
            {stores.data!.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {perms.includes("inventory.manage") && (
        <StartDialog
          storeId={storeId}
          onCreated={(id) => {
            void qc.invalidateQueries({ queryKey: ["inventory_counts", storeId] });
            router.push(`/inventory/${id}`);
          }}
        />
      )}
      {counts.data && counts.data.length === 0 && <div className="text-muted-foreground">{t("empty")}</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(counts.data ?? []).map((c) => (
          <CountCard key={c.id} count={c} />
        ))}
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const t = useTranslations("inventory");
  const perms = useMyPermissions() ?? [];
  const office = perms.includes("inventory.templates");
  return (
    <div className="p-4 pb-24 space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {office ? (
        <Tabs defaultValue="mine">
          <TabsList>
            <TabsTrigger value="mine">{t("tabs.mine")}</TabsTrigger>
            <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          </TabsList>
          <TabsContent value="mine" className="pt-4">
            <MyStores />
          </TabsContent>
          <TabsContent value="overview" className="pt-4">
            <Overview />
          </TabsContent>
        </Tabs>
      ) : (
        <MyStores />
      )}
    </div>
  );
}
