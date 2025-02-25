"use client";
import { ThemeProvider } from "@components/theme-provider";
import { Toaster } from "@components/ui/toaster";
import { Providers } from "@admin/store/provider";
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
<<<<<<< HEAD
  // console.log("roleCode", roleCode);
=======
  console.log('roleCode', roleCode)
  console.log('davr')
>>>>>>> origin/main
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
