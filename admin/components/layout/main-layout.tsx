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
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const roleCode = useGetRole();
  return (
    <Providers>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {roleCode === "admin" && <AdminLayout children={children} />}
        {roleCode === "manager" && <ManagerLayout children={children} />}
        {roleCode === null && <NoRoleLayout children={children} />}
        <Toaster />
      </ThemeProvider>
    </Providers>
  );
}