"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import AttestationLayout from "@admin/components/layout/attestation-layout";

// attestation_layout holders (office) get the full section with sub-nav;
// attestation.run holders (branch-manager tablets) get a bare kiosk view —
// without this fallback the kiosk page rendered as an empty screen for them.
export default function AttestationSectionLayout({
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
  if (perms.includes("attestation_layout"))
    return <AttestationLayout>{children}</AttestationLayout>;
  if (perms.includes("attestation.run")) return <>{children}</>;
  return <></>;
}
