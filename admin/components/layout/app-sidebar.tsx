"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { ChevronRight, UtensilsCrossed } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@components/ui/sidebar";
import { useFilteredNav } from "./nav-config";
import { NavUser } from "./nav-user";

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const locale = useLocale();
  const nav = useFilteredNav();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={`/${locale}`}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <UtensilsCrossed className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Les Ailes</span>
                  <span className="truncate text-xs">Office</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {nav.map((e) =>
              e.kind === "link" ? (
                <SidebarMenuItem key={e.title}>
                  <SidebarMenuButton
                    asChild
                    tooltip={e.title}
                    isActive={isActive(e.href)}
                  >
                    <Link href={e.href}>
                      <e.icon />
                      <span>{e.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : (
                <Collapsible
                  key={e.title}
                  asChild
                  defaultOpen={e.items.some((it) => isActive(it.href))}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip={e.title}
                        isActive={e.items.some((it) => isActive(it.href))}
                      >
                        <e.icon />
                        <span>{e.title}</span>
                        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {e.items.map((it) => (
                          <SidebarMenuSubItem key={it.href}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={isActive(it.href)}
                            >
                              <Link href={it.href}>
                                <span>{it.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              )
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
