"use client";
import { useQuery } from "@tanstack/react-query";
import { ThemeProvider } from "@components/theme-provider";
import { Providers } from "@admin/store/provider";
import { useGetRole } from "@admin/utils/get_role";
import AdminLayout from "./admin-layout";
import NoRoleLayout from "./noRole-layout";
import ManagerLayout from "./manager-layout";
import PlaygroundLayout from "./playground-layout";
import SalesPlanLayout from "./sales-plan-layout";
import { Toaster } from "@admin/components/ui/sonner"
import CanAccess from "../can-access";
import NoAccessNotice from "./no-access-notice";
import { apiClient } from "@admin/utils/eden";

// Every shell below is gated on one of these. A role holding NONE of them used
// to fall through all four <CanAccess> blocks and render literally nothing —
// a white screen on HTTP 200. Sections layered on top (attestation, passport)
// nest INSIDE these shells, so holding only a section permission such as
// `passport_layout` is exactly that case: the section grant is real, the shell
// grant is missing, and nothing tells anyone which. Keep this list in sync with
// the <CanAccess> blocks in the tree below.
const LAYOUT_PERMISSIONS = [
  "admin_layout",
  "manager_layout",
  "playground_layout",
  "sales_plan_layout",
];

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const roleCode = useGetRole();

  // Same query key the four <CanAccess> children use, so this is the same
  // cache entry and costs no extra request.
  const { data: permsData } = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
  });
  const perms: string[] = (permsData as any)?.permissions ?? [];
  // Only meaningful once permissions have actually arrived AND the user has a
  // role: `roleCode === null` is already handled by NoRoleLayout below, and
  // `undefined` means still loading.
  const shellDenied =
    !!permsData && !!roleCode && !LAYOUT_PERMISSIONS.some((p) => perms.includes(p));

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <CanAccess permission="admin_layout">

        <AdminLayout>{children}</AdminLayout>
      </CanAccess>
      <CanAccess permission="manager_layout">
        <ManagerLayout>{children}</ManagerLayout>
      </CanAccess>
      <CanAccess permission="playground_layout">
        <PlaygroundLayout>{children}</PlaygroundLayout>
      </CanAccess>
      <CanAccess permission="sales_plan_layout">
        <SalesPlanLayout>{children}</SalesPlanLayout>
      </CanAccess>
      {/* {roleCode === "franchise_manager" && (
            <ManagerLayout>{children}</ManagerLayout>
          )} */}
      {shellDenied && (
        <NoAccessNotice
          title="Нет доступа к разделам админки"
          missing={LAYOUT_PERMISSIONS}
          explanation="Ваша роль заведена, но ей не выдано ни одного права на оболочку админки, поэтому показать нечего. Чаще всего нужно admin_layout — именно внутри него открываются «Паспорт стажёра», «Аттестация», отчёты и остальные разделы. Отдельные права раздела (например passport_layout) без права на оболочку не работают."
        />
      )}
      {roleCode === null && <NoRoleLayout>{children}</NoRoleLayout>}
      {roleCode == undefined && (
        <div className="h-[100dvh] flex items-center justify-center">
          {children}
        </div>
      )}
      <Toaster richColors />
    </ThemeProvider>
  );
}
