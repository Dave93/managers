"use client";
import React from "react";
import { useTranslations } from "next-intl";
import { Link } from "@admin/i18n/routing";
import { GraduationCap, Users, BarChart3, MonitorPlay, KeyRound } from "lucide-react";

export default function AttestationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("attestation.nav");

  const navItems = [
    { href: "/attestation/tests", label: t("tests"), icon: GraduationCap },
    { href: "/attestation/employees", label: t("employees"), icon: Users },
    { href: "/attestation/analytics", label: t("analytics"), icon: BarChart3 },
    { href: "/attestation/kiosk", label: t("kiosk"), icon: MonitorPlay },
    { href: "/attestation/pin", label: t("pin"), icon: KeyRound },
  ];

  return (
    <div className="md:container">
      <nav className="flex flex-wrap gap-1 border-b py-3 mb-6">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="pb-16">{children}</div>
    </div>
  );
}
