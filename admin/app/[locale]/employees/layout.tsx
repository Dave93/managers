"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import NoAccessNotice from "@admin/components/layout/no-access-notice";

// Справочник сотрудников — общий: на него опираются и аттестация (попытки,
// вход по PIN в киоске), и паспорт стажёра (стажировки заводятся на employees).
// Раньше страница жила внутри раздела аттестации, и её layout пускал только
// держателей attestation_layout или attestation.run — поэтому сотрудник с правом
// employees.list, но без аттестационных прав, получал пустой экран вместо списка.
// Здесь гейт по тому праву, которым эта страница реально пользуется.
export default function EmployeesSectionLayout({
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
        title="Справочник сотрудников недоступен"
        missing={["employees.list"]}
        explanation="Раздел существует и работает, но вашей роли не выдано право на него. Справочник общий: на нём держатся и аттестация, и паспорт стажёра. Попросите администратора office выдать право вашей роли."
      />
    );
  return <>{children}</>;
}
