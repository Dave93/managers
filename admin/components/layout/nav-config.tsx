"use client";
import * as React from "react";
import { useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  Ban,
  Banknote,
  Baby,
  Building2,
  ClipboardList,
  Clock,
  FileText,
  GraduationCap,
  IdCard,
  LayoutDashboard,
  MapPinned,
  Settings2,
  Stethoscope,
  Store,
  Target,
  Users,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavLeaf = { title: string; href: string; permission?: string };
export type NavEntry =
  | {
      kind: "link";
      title: string;
      href: string;
      icon: LucideIcon;
      permission?: string;
    }
  | {
      kind: "group";
      title: string;
      icon: LucideIcon;
      permission?: string;
      items: NavLeaf[];
    };

// Mirrors the prod main-nav data (single source for sidebar + breadcrumbs).
export function buildNav(locale: string): NavEntry[] {
  const p = (path: string) => `/${locale}${path}`;
  return [
    {
      kind: "group",
      title: "Настройки",
      icon: Settings2,
      items: [
        { title: "Разрешения", href: p("/system/permissions"), permission: "permissions.list" },
        { title: "Роли", href: p("/system/roles"), permission: "roles.list" },
        { title: "Пользователи", href: p("/system/users"), permission: "users.list" },
        { title: "Статус", href: p("/system/reports_status"), permission: "reports_status.list" },
        { title: "Группы продуктов", href: p("/system/product_groups"), permission: "product_groups.list" },
        { title: "Внешние партнёры", href: p("/system/external-partners"), permission: "external_partners.list" },
        { title: "Кредитные компании", href: p("/system/credit-companies"), permission: "credit.list" },
        // Справочник ролей в смене (staff_roles), из которого форма сотрудника
        // собирает должность. Живёт в настройках, а не в HR: рядом с «Должность»
        // (/hr/position) его бы приняли за ту же сущность, а это вакансия —
        // вилка, филиал, требования. Последним пунктом и по той же причине,
        // по которой он не первый: экран заводится раз в год.
        { title: "Роли сотрудников", href: p("/system/staff-roles"), permission: "employees.list" },
      ],
    },
    { kind: "link", title: "Организации", href: p("/organization/organizations"), icon: Building2, permission: "organizations.list" },
    { kind: "link", title: "Филиалы", href: p("/organization/terminals"), icon: Store, permission: "terminals.list" },
    { kind: "link", title: "Кассы", href: p("/admin/reports"), icon: Banknote, permission: "reports.list" },
    { kind: "link", title: "Сотрудники", href: p("/employees"), icon: Users, permission: "employees.list" },
    { kind: "link", title: "Карта сети", href: p("/network-map"), icon: MapPinned, permission: "employees.list" },
    { kind: "link", title: "Состав филиалов", href: p("/staff-board"), icon: UsersRound, permission: "employees.list" },
    {
      kind: "group",
      title: "Инвентаризация",
      icon: ClipboardList,
      permission: "inventory.count",
      items: [
        { title: "Инвентаризации", href: p("/inventory"), permission: "inventory.count" },
        { title: "Шаблоны инвентаризаций", href: p("/inventory/templates"), permission: "inventory.templates" },
        { title: "Сверка с iiko", href: p("/inventory/reconciliation"), permission: "inventory.reconcile" },
      ],
    },
    {
      kind: "group",
      title: "Аттестация",
      icon: GraduationCap,
      permission: "attestation_layout",
      items: [
        { title: "Тесты", href: p("/attestation/tests"), permission: "tests.list" },
        { title: "Аналитика", href: p("/attestation/analytics"), permission: "attestation.analytics" },
        { title: "Пройти тест", href: p("/attestation/kiosk"), permission: "attestation.run" },
        { title: "Мой PIN", href: p("/attestation/pin"), permission: "attestation_layout" },
        { title: "PIN менеджеров", href: p("/attestation/manager-pins"), permission: "attestation.manage_pins" },
      ],
    },
    {
      kind: "group",
      title: "Паспорт стажёра",
      icon: IdCard,
      permission: "passport_layout",
      items: [
        { title: "Программы обучения", href: p("/passport/curriculum"), permission: "passport.curriculum.edit" },
        { title: "Стажировки", href: p("/passport/enrollments"), permission: "passport.enrollments.manage" },
        { title: "Матрица", href: p("/passport/matrix"), permission: "passport.matrix.view" },
        // passport.mentors.manage is seeded by stage-1b task B2; until then this
        // item is filtered out for everyone, which is the intended fail-closed
        // default for a page whose backend does not exist yet.
        { title: "Наставники", href: p("/passport/mentors"), permission: "passport.mentors.manage" },
      ],
    },
    { kind: "link", title: "Медосмотр", href: p("/medical"), icon: Stethoscope, permission: "medical_layout" },
    {
      kind: "group",
      title: "Детская площадка",
      icon: Baby,
      permission: "playground_tickets.list",
      items: [
        { title: "Сканирование", href: p("/admin/playground/scan"), permission: "playground_tickets.list" },
        { title: "Список билетов", href: p("/admin/playground/list"), permission: "playground_tickets.list" },
      ],
    },
    {
      kind: "group",
      title: "План продаж",
      icon: Target,
      permission: "sales_plans.list",
      items: [
        { title: "Планы", href: p("/admin/sales-plans/list"), permission: "sales_plans.list" },
        { title: "Дашборд", href: p("/admin/sales-plans/dashboard"), permission: "sales_plans.list" },
      ],
    },
    { kind: "link", title: "Стоп-лист", href: p("/admin/stoplist"), icon: Ban, permission: "stoplist.list" },
    { kind: "link", title: "Конфиги", href: p("/settings"), icon: Wrench, permission: "settings.list" },
    { kind: "link", title: "Дашборд", href: p("/dashboard"), icon: LayoutDashboard, permission: "charts.list" },
    { kind: "link", title: "Висячие заказы", href: p("/hanging_orders"), icon: Clock, permission: "hanging_orders.list" },
    {
      kind: "group",
      title: "Отчеты",
      icon: FileText,
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
      icon: Users,
      items: [
        { title: "Вакансии", href: p("/hr/vacancy"), permission: "vacancy.list" },
        { title: "Должность", href: p("/hr/position"), permission: "positions.list" },
        { title: "График Работ", href: p("/hr/schedule"), permission: "work_schedule.list" },
        { title: "Анкета", href: p("/hr/candidates"), permission: "candidates.list" },
      ],
    },
  ];
}

// Permission-filtered nav; same my_permissions query CanAccess uses.
export function useFilteredNav(): NavEntry[] {
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
    const out: NavEntry[] = [];
    for (const e of buildNav(locale)) {
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
