"use client";
import React from "react";
import { useTranslations } from "next-intl";
import { Link } from "@admin/i18n/routing";
import { GraduationCap, Users, BarChart3, MonitorPlay, KeyRound } from "lucide-react";
import CanAccess from "@admin/components/can-access";

export default function AttestationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("attestation.nav");

  const navItems = [
    { href: "/attestation/tests", label: t("tests"), icon: GraduationCap, permission: "tests.list" },
    { href: "/attestation/employees", label: t("employees"), icon: Users, permission: "employees.list" },
    { href: "/attestation/analytics", label: t("analytics"), icon: BarChart3, permission: "attestation.analytics" },
    { href: "/attestation/kiosk", label: t("kiosk"), icon: MonitorPlay, permission: "attestation.run" },
    { href: "/attestation/pin", label: t("pin"), icon: KeyRound, permission: "attestation_layout" },
  ];

  return (
    <div className="md:container">
      <nav className="flex flex-wrap gap-1 border-b py-3 mb-6">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <CanAccess key={item.href} permission={item.permission}>
              <Link
                href={item.href}
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            </CanAccess>
          );
        })}
      </nav>
      <div className="pb-16">{children}</div>
    </div>
  );
}
