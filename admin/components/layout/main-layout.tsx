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
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const roleCode = useGetRole();
  return (
    <Providers>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <div className="flex-col">
          <div className="border-b sticky top-0">
            <div className="flex h-16 items-center px-4 bg-background">
              <NavigationMenuDemo />
              <div className="ml-auto flex items-center space-x-4">
                <Search />
                <UserNav />
                <ModeToggle />
              </div>
            </div>
          </div>
          <div className="mx-4 mt-10 mb-4">{children}</div>
        </div>

        <Toaster />
      </ThemeProvider>
    </Providers>
  );
}
