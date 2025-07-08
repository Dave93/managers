"use client";
import { ThemeProvider } from "@components/theme-provider";
import { Providers } from "@admin/store/provider";
import { useGetRole } from "@admin/utils/get_role";
import AdminLayout from "./admin-layout";
import NoRoleLayout from "./noRole-layout";
import ManagerLayout from "./manager-layout";
import { Toaster } from "@admin/components/ui/sonner"

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const roleCode = useGetRole();
  console.log("roleCode", roleCode);
  return (
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {roleCode && roleCode !== "manager" && (
          <AdminLayout>{children}</AdminLayout>
        )}
        {roleCode && roleCode === "manager" && (
          <ManagerLayout>{children}</ManagerLayout>
        )}
        {/* {roleCode === "franchise_manager" && (
            <ManagerLayout>{children}</ManagerLayout>
          )} */}
        {roleCode === null && <NoRoleLayout>{children}</NoRoleLayout>}
        {roleCode == undefined && (
          <div className="h-[100dvh] flex items-center justify-center">
            {children}
          </div>
        )}
        <Toaster />
      </ThemeProvider>
  );
}
