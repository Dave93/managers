import { AppSidebar } from "@components/layout/app-sidebar";
import { AdminBreadcrumbs } from "@components/layout/admin-breadcrumbs";
import { ModeToggle } from "@components/layout/mode-toggle";
import LanguageSwitcher from "@admin/components/ui/language-switcher";
import { Separator } from "@components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@components/ui/sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex w-full items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <AdminBreadcrumbs />
            <div className="ml-auto flex items-center gap-2">
              <LanguageSwitcher />
              <ModeToggle />
            </div>
          </div>
        </header>
        <div className="flex flex-1 flex-col p-4 pt-0">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
