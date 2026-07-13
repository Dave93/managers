"use client";
import React from "react";
import CanAccess from "@admin/components/can-access";
import AttestationLayout from "@admin/components/layout/attestation-layout";

export default function AttestationSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CanAccess permission="attestation_layout">
      <AttestationLayout>{children}</AttestationLayout>
    </CanAccess>
  );
}
