"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@admin/lib/utils";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@components/ui/navigation-menu";
import CanAccess from "../can-access";

const components: { title: string; href: string; description: string }[] = [
  {
    title: "Alert Dialog",
    href: "/docs/primitives/alert-dialog",
    description:
      "A modal dialog that interrupts the user with important content and expects a response.",
  },
  {
    title: "Hover Card",
    href: "/docs/primitives/hover-card",
    description:
      "For sighted users to preview content available behind a link.",
  },
  {
    title: "Progress",
    href: "/docs/primitives/progress",
    description:
      "Displays an indicator showing the completion progress of a task, typically displayed as a progress bar.",
  },
  {
    title: "Scroll-area",
    href: "/docs/primitives/scroll-area",
    description: "Visually or semantically separates content.",
  },
  {
    title: "Tabs",
    href: "/docs/primitives/tabs",
    description:
      "A set of layered sections of content—known as tab panels—that are displayed one at a time.",
  },
  {
    title: "Tooltip",
    href: "/docs/primitives/tooltip",
    description:
      "A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it.",
  },
];

const settingsMenu: { title: string; href: string }[] = [
  {
    title: "Разрешения",
    href: "/system/permissions",
  },
  {
    title: "Роли",
    href: "/system/roles",
  },
  {
    title: "Пользователи",
    href: "/system/users",
  },
  {
    title: "Статус",
    href: "/system/reports_status",
  },
];

export function NavigationMenuDemo() {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Настройки</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px] ">
              {settingsMenu.map((component) => (
                <ListItem
                  key={component.title}
                  title={component.title}
                  href={component.href}
                />
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <CanAccess permission="organizations.list">
          <NavigationMenuItem>
            <Link href="/organization/organizations" legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Организации
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <CanAccess permission="terminals.list">
          <NavigationMenuItem>
            <Link href="/organization/terminals" legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Филиалы
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <CanAccess permission="reports.list">
          <NavigationMenuItem>
            <Link href="/admin/reports" legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Кассы
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <CanAccess permission="stoplist.list">
          <NavigationMenuItem>
            <Link href="/admin/stoplist" legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Стоп-лист
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <CanAccess permission="settings.list">
          <NavigationMenuItem>
            <Link href="/settings" legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Конфиги
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <CanAccess permission="incoming_invoice.list">
          <NavigationMenuItem>
            <Link href="/incoming_invoice" legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Приходная накладная
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
      </NavigationMenuList>
    </NavigationMenu>
  );
}

const ListItem = React.forwardRef<
  React.ElementRef<"a">,
  React.ComponentPropsWithoutRef<"a">
>(({ className, title, children, ...props }, ref) => {
  return (
    <li>
      <NavigationMenuLink asChild>
        <a
          ref={ref}
          className={cn(
            "block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
            className
          )}
          {...props}
        >
          <div className="text-sm font-medium leading-none">{title}</div>
          <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
            {children}
          </p>
        </a>
      </NavigationMenuLink>
    </li>
  );
});
ListItem.displayName = "ListItem";
