"use client";

import { useMemo, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@admin/components/ui/tabs";
import ProductGroupsKanban from "./kanban";

export default function ProductGroupsListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["organization"],
    queryFn: async () => {
      return await apiClient.api.organization.get({
        query: {
          fields: "id,name",
          limit: "1000",
          offset: "0",
        },
      });
    },
  });

  const tabs = useMemo(() => {
    const res: {
      id: string;
      title: string;
    }[] = [];
    if (data?.data?.data && Array.isArray(data.data.data)) {
      data.data.data.forEach((item) => {
        res.push({
          id: item.id,
          title: item.name,
        });
      });
    }
    return res;
  }, [data?.data]);

  const [activeTab, setActiveTab] = useState<string>("");

  // Set the first tab as active when data is loaded
  useMemo(() => {
    if (tabs.length > 0 && !activeTab) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Группы продуктов</h2>
      </div>
      <div className="py-10">
        {tabs.length > 0 && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              {tabs.map((item) => (
                <TabsTrigger key={item.id} value={item.id}>
                  {item.title}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((item) => (
              <TabsContent key={item.id} value={item.id}>
                <ProductGroupsKanban organizationId={item.id} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  );
}
