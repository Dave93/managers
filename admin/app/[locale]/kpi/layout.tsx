"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("kpiScreens.layout");
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
        title={t("noAccessTitle")}
        missing={["kpi_layout"]}
        explanation={t("noAccessExplanation")}
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
