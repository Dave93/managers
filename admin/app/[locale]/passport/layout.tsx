"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import PassportLayout from "@admin/components/layout/passport-layout";
import NoAccessNotice from "@admin/components/layout/no-access-notice";

// Gate for the whole /passport subtree, copied from
// app/[locale]/attestation/layout.tsx. Only passport_layout holders get in —
// there is deliberately no second "run" branch like attestation's kiosk
// fallback: the trainee/mentor surface of the passport is the Telegram
// miniapp, not this admin.
export default function PassportSectionLayout({
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
  if (perms.includes("passport_layout"))
    return <PassportLayout>{children}</PassportLayout>;
  // Never render nothing: a silent blank area inside a working shell reads as
  // a broken page, and the reader has no way to learn that the fix is a grant.
  return (
    <NoAccessNotice
      title="Раздел «Паспорт стажёра» недоступен"
      missing={["passport_layout"]}
      explanation="Раздел существует и работает, но вашей роли не выдано право на него. Право на раздел выдаётся отдельно от прав на его экраны (программы обучения, стажировки, матрица, наставники)."
    />
  );
}
