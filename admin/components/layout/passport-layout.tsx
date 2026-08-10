"use client";
import React from "react";
import { useTranslations } from "next-intl";
import { Link } from "@admin/i18n/routing";
import { BookOpen, UsersRound, Grid3x3, UserCheck } from "lucide-react";
import CanAccess from "@admin/components/can-access";

// Sub-nav shell for the trainee-passport section, mirroring
// components/layout/attestation-layout.tsx. Rendered inside AdminLayout's
// generic sidebar shell (passport is NOT a top-level layout branch in
// main-layout.tsx — see app/[locale]/passport/layout.tsx).
export default function PassportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("passport.nav");

  const navItems = [
    {
      href: "/passport/curriculum",
      label: t("curriculum"),
      icon: BookOpen,
      permission: "passport.curriculum.edit",
    },
    {
      href: "/passport/enrollments",
      label: t("enrollments"),
      icon: UsersRound,
      permission: "passport.enrollments.manage",
    },
    {
      href: "/passport/matrix",
      label: t("matrix"),
      icon: Grid3x3,
      permission: "passport.matrix.view",
    },
    {
      href: "/passport/mentors",
      label: t("mentors"),
      icon: UserCheck,
      // Seeded by task B2 — until that seed runs this item renders for nobody,
      // which is the intended fail-closed behaviour of CanAccess.
      permission: "passport.mentors.manage",
    },
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
