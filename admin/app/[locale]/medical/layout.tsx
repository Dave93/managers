"use client";
import React from "react";
import CanAccess from "@admin/components/can-access";

export default function MedicalSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CanAccess permission="medical_layout">{children}</CanAccess>;
}
