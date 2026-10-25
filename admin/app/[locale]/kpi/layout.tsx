"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import NoAccessNotice from "@admin/components/layout/no-access-notice";

// Гейт раздела «KPI сотрудников», скопирован с app/[locale]/staff-board/layout.tsx.
// Право на раздел (kpi_layout) выдаётся отдельно от прав на экраны; экраны
// проверяются ещё раз в ScreenGate.
export default function KpiSectionLayout({
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
  if (!perms.includes("kpi_layout"))
    return (
      <NoAccessNotice
        title="Раздел «KPI сотрудников» недоступен"
        missing={["kpi_layout"]}
        explanation="Раздел работает, но вашей роли не выдано право на него. Право на раздел выдаётся отдельно от прав на экраны: оценки, нарушения, споры, повышения, настройки."
      />
    );
  // Дорожка minmax(0,1fr) обнуляет min-content раздела: иначе широкие таблицы растягивают
  // <main> шире окна. Внутренний div — сам элемент сетки, чтобы mx-auto max-w-* на страницах
  // работал как в обычном потоке, а не сжимался по содержимому.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)]">
      <div>{children}</div>
    </div>
  );
}
