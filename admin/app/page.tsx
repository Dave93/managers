"use client";
import ManagerReportPage from "@admin/components/reports/managerReportPage";
import { useGetRole } from "@admin/utils/get_role";

export default function Home() {
  const roleCode = useGetRole();
  return (
    <>
      {["manager", "franchise_manager"].includes(roleCode!) && (
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
