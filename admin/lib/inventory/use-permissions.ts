"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";

// Тот же ключ и запрос, что в components/can-access.tsx: один кэш, без лишнего запроса.
export function useMyPermissions(): string[] | undefined {
  const { data } = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
  });
  return (data as any)?.permissions;
}
