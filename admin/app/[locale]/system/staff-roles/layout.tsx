"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import NoAccessNotice from "@admin/components/layout/no-access-notice";

// Справочник ролей закрыт тем же правом, что и справочник сотрудников:
// employees.list на чтение, employees.edit на запись. Отдельного права нет
// сознательно — после выката его не было бы ни у кого, и завести роль было бы
// некому. Гейт здесь по тому праву, которым страница реально пользуется.
export default function StaffRolesSectionLayout({
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
        title="Справочник ролей недоступен"
        missing={["employees.list"]}
        explanation="Раздел существует и работает, но вашей роли не выдано право на него. Справочник ролей общий со справочником сотрудников: из него берутся должности в форме сотрудника. Попросите администратора office выдать право вашей роли."
      />
    );
  return <>{children}</>;
}
