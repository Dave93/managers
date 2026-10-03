"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, Menu } from "lucide-react";
import { useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";

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
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@components/ui/collapsible";
import { Button } from "@admin/components/ui/button";
import { apiClient } from "@admin/utils/eden";

type NavLeaf = { title: string; href: string; permission?: string };
type NavEntry =
  | { kind: "link"; title: string; href: string; permission?: string }
  | { kind: "group"; title: string; permission?: string; items: NavLeaf[] };

function buildNav(locale: string): NavEntry[] {
  const p = (path: string) => `/${locale}${path}`;
  return [
    {
      kind: "group",
      title: "Настройки",
      items: [
        { title: "Разрешения", href: p("/system/permissions"), permission: "permissions.list" },
        { title: "Роли", href: p("/system/roles"), permission: "roles.list" },
        { title: "Пользователи", href: p("/system/users"), permission: "users.list" },
        { title: "Статус", href: p("/system/reports_status"), permission: "reports_status.list" },
        { title: "Группы продуктов", href: p("/system/product_groups"), permission: "product_groups.list" },
        { title: "Внешние партнёры", href: p("/system/external-partners"), permission: "external_partners.list" },
      ],
    },
    { kind: "link", title: "Организации", href: p("/organization/organizations"), permission: "organizations.list" },
    { kind: "link", title: "Филиалы", href: p("/organization/terminals"), permission: "terminals.list" },
    { kind: "link", title: "Кассы", href: p("/admin/reports"), permission: "reports.list" },
    {
      kind: "group",
      title: "Аттестация",
      permission: "attestation_layout",
      items: [
        { title: "Тесты", href: p("/attestation/tests"), permission: "tests.list" },
        { title: "Сотрудники", href: p("/attestation/employees"), permission: "employees.list" },
        { title: "Аналитика", href: p("/attestation/analytics"), permission: "attestation.analytics" },
        { title: "Пройти тест", href: p("/attestation/kiosk"), permission: "attestation.run" },
        { title: "Мой PIN", href: p("/attestation/pin"), permission: "attestation_layout" },
      ],
    },
    { kind: "link", title: "Медосмотр", href: p("/medical"), permission: "medical_layout" },
    {
      kind: "group",
      title: "Детская площадка",
      permission: "playground_tickets.list",
      items: [
        { title: "Сканирование", href: p("/admin/playground/scan"), permission: "playground_tickets.list" },
        { title: "Список билетов", href: p("/admin/playground/list"), permission: "playground_tickets.list" },
      ],
    },
    {
      kind: "group",
      title: "План продаж",
      permission: "sales_plans.list",
      items: [
        { title: "Планы", href: p("/admin/sales-plans/list"), permission: "sales_plans.list" },
        { title: "Дашборд", href: p("/admin/sales-plans/dashboard"), permission: "sales_plans.list" },
      ],
    },
    { kind: "link", title: "Стоп-лист", href: p("/admin/stoplist"), permission: "stoplist.list" },
    { kind: "link", title: "Конфиги", href: p("/settings"), permission: "settings.list" },
    { kind: "link", title: "Дашборд", href: p("/dashboard"), permission: "charts.list" },
    { kind: "link", title: "Висячие заказы", href: p("/hanging_orders"), permission: "hanging_orders.list" },
    {
      kind: "group",
      title: "Отчеты",
      items: [
        { title: "Заказы", href: p("/outgoing_invoices"), permission: "outgoing_invoices.list" },
        { title: "Приходная накладная (Таблица)", href: p("/incoming_invoices"), permission: "incoming_invoices.list" },
        { title: "Приходная накладная (Детально)", href: p("/incoming_with_items"), permission: "incoming_with_items.list" },
        { title: "Возврат товаров", href: p("/refund_invoices"), permission: "refund_invoices.list" },
        { title: "Внутреннее перемещение (Приход)", href: p("/internal_transfer"), permission: "internal_transfer.list" },
        { title: "Внутреннее перемещение (Расход)", href: p("/expenses_transfer"), permission: "internal_transfer.list" },
        { title: "Акт Списания", href: p("/writeoff_items"), permission: "writeoff_items.list" },
        { title: "Акт Реализации", href: p("/report_olap"), permission: "report_olap.list" },
      ],
    },
    {
      kind: "group",
      title: "HR",
      items: [
        { title: "Вакансии", href: p("/hr/vacancy"), permission: "vacancy.list" },
        { title: "Должность", href: p("/hr/position"), permission: "positions.list" },
        { title: "График Работ", href: p("/hr/schedule"), permission: "work_schedule.list" },
        { title: "Анкета", href: p("/hr/candidates"), permission: "candidates.list" },
      ],
    },
  ];
}

// Filters nav by user's permissions: links require their own permission;
// groups hide entirely when (a) the optional group-level permission is missing
// OR (b) no child item is allowed.
function useFilteredNav(): NavEntry[] {
  const locale = useLocale();
  const { data } = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => {
      const response = await apiClient.api.users.my_permissions.get();
      return response.data;
    },
  });
  return React.useMemo(() => {
    const perms: string[] | undefined = (data as any)?.permissions;
    if (!perms) return [];
    const has = (p?: string) => !p || perms.includes(p);
    const nav = buildNav(locale);
    const out: NavEntry[] = [];
    for (const e of nav) {
      if (e.kind === "link") {
        if (has(e.permission)) out.push(e);
      } else {
        if (e.permission && !has(e.permission)) continue;
        const items = e.items.filter((it) => has(it.permission));
        if (items.length === 0) continue;
        out.push({ ...e, items });
      }
    }
    return out;
  }, [data, locale]);
}

const dropdownTriggerCls =
  "flex items-center gap-2 h-9 px-4 py-2 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground rounded-md text-sm";

// Desktop horizontal navigation (>= md).
export function NavigationMenuDemo() {
  const nav = useFilteredNav();

  return (
    <NavigationMenu>
      <NavigationMenuList>
        {nav.map((entry) =>
          entry.kind === "link" ? (
            <NavigationMenuItem key={entry.title}>
              <Link href={entry.href} legacyBehavior passHref>
                <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                  {entry.title}
                </NavigationMenuLink>
              </Link>
            </NavigationMenuItem>
          ) : (
            <NavigationMenuItem key={entry.title}>
              <DropdownMenu>
                <DropdownMenuTrigger className={dropdownTriggerCls}>
                  {entry.title}
                  <ChevronDown size={18} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[340px]">
                  {entry.items.map((item) => (
                    <DropdownMenuItem key={item.title} asChild>
                      <Link href={item.href}>{item.title}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </NavigationMenuItem>
          )
        )}
      </NavigationMenuList>
    </NavigationMenu>
  );
}

// Mobile navigation (< md): hamburger that opens a left Sheet drawer. Groups
// are collapsible; tapping any link closes the drawer.
export function MobileNav() {
  const nav = useFilteredNav();
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Меню">
          <Menu className="h-6 w-6" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] overflow-y-auto p-0">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle>Меню</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col py-2">
          {nav.map((entry) =>
            entry.kind === "link" ? (
              <SheetClose asChild key={entry.title}>
                <Link
                  href={entry.href}
                  className="px-4 py-3 text-sm font-medium hover:bg-accent"
                >
                  {entry.title}
                </Link>
              </SheetClose>
            ) : (
              <Collapsible key={entry.title}>
                <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-accent [&[data-state=open]>svg]:rotate-180">
                  {entry.title}
                  <ChevronDown className="h-4 w-4 transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {entry.items.map((item) => (
                    <SheetClose asChild key={item.title}>
                      <Link
                        href={item.href}
                        className="block py-2.5 pl-8 pr-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {item.title}
                      </Link>
                    </SheetClose>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
