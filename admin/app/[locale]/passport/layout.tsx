"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import PassportLayout from "@admin/components/layout/passport-layout";

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
  return <></>;
}
