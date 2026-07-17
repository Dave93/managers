"use client";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@components/ui/sidebar";
import { useAuth } from "@admin/components/useAuth";

export function NavUser() {
  const { user, signOut } = useAuth();
  const { isMobile } = useSidebar();
  // /api/users/me returns { user, role }; unwrap either shape.
  const u = ((user as any)?.user ?? user) as any;
  const name =
    [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.login || "";
  const initials =
    (name || "U")
      .split(" ")
      .map((w: string) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{name}</span>
                {u?.login && name !== u.login && (
                  <span className="truncate text-xs">{u.login}</span>
                )}
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{name}</p>
                {u?.login && (
                  <p className="text-xs leading-none text-muted-foreground">
                    {u.login}
                  </p>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()}>
              <LogOut />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
