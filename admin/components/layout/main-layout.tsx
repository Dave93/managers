"use client";
import { ThemeProvider } from "@components/theme-provider";
import { NavigationMenuDemo } from "@components/layout/main-nav";
import { Search } from "lucide-react";
import { UserNav } from "@components/layout/user-nav";
import { ModeToggle } from "@components/layout/mode-toggle";
import { Toaster } from "@components/ui/toaster";
import { Providers } from "@admin/store/provider";
import SessionLocalProvider from "@admin/store/session-provider";
import { useGetRole } from "@admin/utils/get_role";
import AdminLayout from "./admin-layout";
import NoRoleLayout from "./noRole-layout";
import ManagerLayout from "./manager-layout";
import { NextUIProvider } from "@nextui-org/system";
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const roleCode = useGetRole();
  // console.log("roleCode", roleCode);
  return (
    <Providers>
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
    </Providers>
  );
}
