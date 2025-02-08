"use client";
import ManagerReportPage from "@admin/components/reports/managerReportPage";
import { useGetRole } from "@admin/utils/get_role";
import { redirect } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

export default function Home() {
  const roleCode = useGetRole();
  const pathname = usePathname();
  const { data: session } = useSession();

  useEffect(() => {
    if (!session && !pathname.includes('/login')) {
      return redirect('/login');
    }
  }, [session, pathname]);
  return (
    <>
      {["manager"].includes(roleCode!) && (
        <ManagerReportPage />
      )}
      {roleCode !== "manager" && (
        <main className="flex min-h-screen flex-col items-center justify-between p-24">
          this is the home page
        </main>
      )}
    </>
  );
}
