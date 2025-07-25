"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useLocale } from "next-intl";

import { cn } from "@admin/lib/utils";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle
} from "@components/ui/navigation-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu";
import { Button } from "@admin/components/ui/button";
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

const hrMenu: { title: string; href: string }[] = [
  {
    title: "Вакансии",
    href: "/hr/vacancy"
  },
  {
    title: "Должность",
    href: "/hr/position"
  },
  {
    title: "График Работ",
    href: "/hr/schedule"
  },
  {
    title: "Анкета",
    href: "/hr/candidates"
  }
]


export function NavigationMenuDemo() {
  const locale = useLocale();


  const settingsMenu: { title: string; href: string }[] = [
    {
      title: "Разрешения",
      href: `/${locale}/system/permissions`,
    },
    {
      title: "Роли",
      href: `/${locale}/system/roles`,
    },
    {
      title: "Пользователи",
      href: `/${locale}/system/users`,
    },
    {
      title: "Статус",
      href: `/${locale}/system/reports_status`,
    },
    {
      title: "Группы продуктов",
      href: `/${locale}/system/product_groups`,
    },
  ];

  const storeMenu: { title: string; href: string }[] = [
    {
      title: "Заказы",
      href: `/${locale}/outgoing_invoices`,
    },
    {
      title: "Приходная накладная (Таблица)",
      href: `/${locale}/incoming_invoices`,
    },
    {
      title: "Приходная накладная (Детально)",
      href: `/${locale}/incoming_with_items`,
    },
    {
      title: "Возврат товаров",
      href: `/${locale}/refund_invoices`,
    },
    {
      title: "Внутреннее перемещение (Приход)",
      href: `/${locale}/internal_transfer`,
    },
    {
      title: "Внутреннее перемещение (Расход)",
      href: `/${locale}/expenses_transfer`,
    },
    {
      title: "Акт Списания",
      href: `/${locale}/writeoff_items`,
    },
    {
      title: "Акт Реализации",
      href: `/${locale}/report_olap`,
    },
  ];

  return (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 h-9 px-4 py-2 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground rounded-md text-sm">
              Настройки
              <ChevronDown size={18} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[340px]">
              {settingsMenu.map((component) => (
                <DropdownMenuItem key={component.title} asChild>
                  <Link href={component.href}>
                    {component.title}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </NavigationMenuItem>
        <CanAccess permission="organizations.list">
          <NavigationMenuItem>
            <Link href={`/${locale}/organization/organizations`} legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Организации
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <CanAccess permission="terminals.list">
          <NavigationMenuItem>
            <Link href={`/${locale}/organization/terminals`} legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Филиалы
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <CanAccess permission="reports.list">
          <NavigationMenuItem>
            <Link href={`/${locale}/admin/reports`} legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Кассы
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <CanAccess permission="stoplist.list">
          <NavigationMenuItem>
            <Link href={`/${locale}/admin/stoplist`} legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Стоп-лист
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <CanAccess permission="settings.list">
          <NavigationMenuItem>
            <Link href={`/${locale}/settings`} legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Конфиги
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <CanAccess permission="charts.list">
          <NavigationMenuItem>
            <Link href={`/${locale}/dashboard`} legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Дашборд
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <CanAccess permission="hanging_orders.list">
          <NavigationMenuItem>
            <Link href={`/${locale}/hanging_orders`} legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Висячие заказы
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
        <NavigationMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 h-9 px-4 py-2 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground rounded-md text-sm">
              Отчеты
              <ChevronDown size={18} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[340px]">
              {storeMenu.map((component) => (
                <DropdownMenuItem key={component.title} asChild>
                  <Link href={component.href}>
                    {component.title}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 h-9 px-4 py-2 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground rounded-md text-sm">
              HR
              <ChevronDown size={18} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[340px]">
              {hrMenu.map((component) => (
                <DropdownMenuItem key={component.title} asChild>
                  <Link href={component.href}>
                    {component.title}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}

const ListItem = (
  {
    ref,
    className,
    title,
    children,
    ...props
  }: React.ComponentPropsWithoutRef<"a"> & {
    ref: React.RefObject<React.ElementRef<"a">>;
  }
) => {
  return (
    <li>
      <NavigationMenuLink asChild>
        <a
          ref={ref}
          className={cn(
            "block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
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
};
ListItem.displayName = "ListItem";
