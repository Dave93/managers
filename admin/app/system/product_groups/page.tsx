"use client";

import { useMemo, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import useToken from "@admin/store/get-token";
import { Tabs, Tab } from "@nextui-org/tabs";
import ProductGroupsKanban from "./kanban";

export default function ProductGroupsListPage() {
  const token = useToken();

  const { data, isLoading } = useQuery({
    queryKey: ["organization"],
    queryFn: async () => {
      return await apiClient.api.organization.get({
        query: {
          fields: "id,name",
          limit: "1000",
          offset: "0",
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    },
    enabled: !!token,
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

  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Группы продуктов</h2>
      </div>
      <div className="py-10">
        <Tabs
          aria-label="Dynamic tabs"
          items={tabs}
          radius="full"
          variant="bordered"
        >
          {(item) => (
            <Tab key={item.id} value={item.id} title={item.title}>
              <ProductGroupsKanban organizationId={item.id} />
            </Tab>
          )}
        </Tabs>
      </div>
    </div>
  );
}
