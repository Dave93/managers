"use client";
import ManagerReportPage from "@admin/components/reports/managerReportPage";
import { useGetRole } from "@admin/utils/get_role";
import { redirect } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useAuth } from "@admin/components/useAuth";
import { useLocale, useTranslations } from "next-intl";

export default function Home() {
  const t = useTranslations("layoutUi");
  const locale = useLocale();
  const roleCode = useGetRole();
  const pathname = usePathname();
  const { user, loading } = useAuth();

  useEffect(() => {
    console.log("Home page auth state:", { user, loading, pathname });
    if (!user && !loading && !pathname.includes('/login')) {
      console.log("Redirecting to login from home page");
      return redirect(`/${locale}/login`);
    }
  }, [user, loading, pathname, locale]);
  return (
    <>
      {["manager"].includes(roleCode!) && (
        <ManagerReportPage />
      )}
      {roleCode !== "manager" && (
        <main className="flex min-h-screen flex-col items-center justify-between p-24">
          {t("homePlaceholder")}
        </main>
      )}
    </>
  );
}
