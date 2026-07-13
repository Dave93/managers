import { useGetRole } from "@admin/utils/get_role";
import { NavigationMenuDemo, MobileNav } from "@components/layout/main-nav";
import { Search } from "lucide-react";
import { UserNav } from "@components/layout/user-nav";
import { ModeToggle } from "@components/layout/mode-toggle";
import LanguageSwitcher from "@admin/components/ui/language-switcher";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-col">
      <div className="border-b sticky top-0 bg-white z-10">
        <div className="flex h-16 items-center px-4 bg-background">
          {/* Hamburger drawer on mobile, horizontal menu on >=md */}
          <div className="md:hidden">
            <MobileNav />
          </div>
          <div className="hidden md:block">
            <NavigationMenuDemo />
          </div>
          <div className="ml-auto flex items-center space-x-2 sm:space-x-4">
            <Search />
            <LanguageSwitcher />
            <UserNav />
            <ModeToggle />
          </div>
        </div>
      </div>
      <div className="mx-4 mt-6 md:mt-10 mb-4">{children}</div>
    </div>
  );
}
