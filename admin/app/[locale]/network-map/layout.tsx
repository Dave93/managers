"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import NoAccessNotice from "@admin/components/layout/no-access-notice";

// Карта сети живёт на том же праве, что и справочник сотрудников: экран не
// показывает ничего, чего нет в employees, он только раскладывает это по
// географии. Гейт скопирован с app/[locale]/employees/layout.tsx намеренно —
// два экрана на одном источнике данных должны открываться одним правом, иначе
// появляется третье состояние «список вижу, карту нет», которое никто не
// сможет объяснить пользователю.
export default function NetworkMapSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data } = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => {
      const response = await apiClient.api.users.my_permissions.get();
      return response.data;
    },
  });
  const perms: string[] = (data as any)?.permissions ?? [];
  if (!data) return <></>;
  if (!perms.includes("employees.list"))
    return (
      <NoAccessNotice
        title="Карта сети недоступна"
        missing={["employees.list"]}
        explanation="Экран показывает состав команд по филиалам и берёт его из общего справочника сотрудников, поэтому открывается тем же правом, что и справочник. Попросите администратора office выдать право вашей роли."
      />
    );
  return <>{children}</>;
}
