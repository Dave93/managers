import { useGetRole } from "@admin/utils/get_role";
import { NavigationMenuDemo } from "@components/layout/main-nav";
import { Search } from "lucide-react";
import { UserNav } from "@components/layout/user-nav";
import { ModeToggle } from "@components/layout/mode-toggle";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
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
  );
}
