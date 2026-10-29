"use client";
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { KPI_SCREEN_PERMS } from "@admin/lib/kpi/access";
import {
  Award,
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

// Один слаг или список: список означает «нужны все». Экран «К оплате» и планшет
// филиала сами требуют по два права, и пункт меню, который ведёт на панель
// отказа, хуже отсутствующего пункта. `{ any: [...] }` — хватает любого из прав:
// экраны KPI открываются оценщику или наблюдателю.
export type NavPermission = string | string[] | { any: readonly string[] };

// Переводчик раздела tickets.nav (useTranslations("tickets.nav")); остальное меню — через t (раздел nav).
export type TicketsNavT = (
  key: "group" | "list" | "payments" | "contractors" | "types" | "branch"
) => string;

// also — пути дочерних экранов вне href, на которых пункт тоже считается активным
// (подсветка в меню и хлебные крошки), например /kpi/branch/<id> для «Сети».
export type NavLeaf = { title: string; href: string; permission?: NavPermission; also?: string[] };

export function leafPaths(it: NavLeaf): string[] {
  return [it.href, ...(it.also ?? [])];
}
export type NavEntry =
  | {
      kind: "link";
      title: string;
      href: string;
      icon: LucideIcon;
      permission?: NavPermission;
    }
  | {
      kind: "group";
      title: string;
      icon: LucideIcon;
      permission?: NavPermission;
      items: NavLeaf[];
    };

// Mirrors the prod main-nav data (single source for sidebar + breadcrumbs).
export function buildNav(locale: string, t: (key: string) => string, tTickets: TicketsNavT): NavEntry[] {
  const p = (path: string) => `/${locale}${path}`;
  return [
    {
      kind: "group",
      title: t("settings"),
      icon: Settings2,
      items: [
        { title: t("permissions"), href: p("/system/permissions"), permission: "permissions.list" },
        { title: t("roles"), href: p("/system/roles"), permission: "roles.list" },
        { title: t("users"), href: p("/system/users"), permission: "users.list" },
        { title: t("status"), href: p("/system/reports_status"), permission: "reports_status.list" },
        { title: t("productGroups"), href: p("/system/product_groups"), permission: "product_groups.list" },
        { title: t("externalPartners"), href: p("/system/external-partners"), permission: "external_partners.list" },
        { title: t("creditCompanies"), href: p("/system/credit-companies"), permission: "credit.list" },
        // Справочник ролей в смене (staff_roles), из которого форма сотрудника
        // собирает должность. Живёт в настройках, а не в HR: рядом с «Должность»
        // (/hr/position) его бы приняли за ту же сущность, а это вакансия —
        // вилка, филиал, требования. Последним пунктом и по той же причине,
        // по которой он не первый: экран заводится раз в год.
        { title: t("staffRoles"), href: p("/system/staff-roles"), permission: "employees.list" },
      ],
    },
    { kind: "link", title: t("organizations"), href: p("/organization/organizations"), icon: Building2, permission: "organizations.list" },
    { kind: "link", title: t("branches"), href: p("/organization/terminals"), icon: Store, permission: "terminals.list" },
    { kind: "link", title: t("cashRegisters"), href: p("/admin/reports"), icon: Banknote, permission: "reports.list" },
    { kind: "link", title: t("employees"), href: p("/employees"), icon: Users, permission: "employees.list" },
    { kind: "link", title: t("networkMap"), href: p("/network-map"), icon: MapPinned, permission: "employees.list" },
    { kind: "link", title: t("staffBoard"), href: p("/staff-board"), icon: UsersRound, permission: "employees.list" },
    {
      kind: "group",
      title: t("inventory"),
      icon: ClipboardList,
      permission: "inventory.count",
      items: [
        { title: t("inventoryList"), href: p("/inventory"), permission: "inventory.count" },
        { title: t("inventoryStock"), href: p("/inventory/stock"), permission: "inventory.templates" },
        { title: t("inventoryTurnover"), href: p("/inventory/turnover"), permission: "inventory.count" },
        { title: t("inventoryTemplates"), href: p("/inventory/templates"), permission: "inventory.templates" },
        { title: t("inventoryReconciliation"), href: p("/inventory/reconciliation"), permission: "inventory.reconcile" },
      ],
    },
    {
      kind: "group",
      title: t("attestation"),
      icon: GraduationCap,
      permission: "attestation_layout",
      items: [
        { title: t("attestationTests"), href: p("/attestation/tests"), permission: "tests.list" },
        { title: t("attestationAnalytics"), href: p("/attestation/analytics"), permission: "attestation.analytics" },
        { title: t("attestationKiosk"), href: p("/attestation/kiosk"), permission: "attestation.run" },
        { title: t("attestationPin"), href: p("/attestation/pin"), permission: "attestation_layout" },
        { title: t("attestationManagerPins"), href: p("/attestation/manager-pins"), permission: "attestation.manage_pins" },
      ],
    },
    {
      kind: "group",
      title: t("passport"),
      icon: IdCard,
      permission: "passport_layout",
      items: [
        { title: t("passportCurriculum"), href: p("/passport/curriculum"), permission: "passport.curriculum.edit" },
        { title: t("passportEnrollments"), href: p("/passport/enrollments"), permission: "passport.enrollments.manage" },
        { title: t("passportMatrix"), href: p("/passport/matrix"), permission: "passport.matrix.view" },
        // passport.mentors.manage is seeded by stage-1b task B2; until then this
        // item is filtered out for everyone, which is the intended fail-closed
        // default for a page whose backend does not exist yet.
        { title: t("passportMentors"), href: p("/passport/mentors"), permission: "passport.mentors.manage" },
      ],
    },
    { kind: "link", title: t("medical"), href: p("/medical"), icon: Stethoscope, permission: "medical_layout" },
    {
      kind: "group",
      title: t("kpiGroup"),
      icon: Award,
      permission: "kpi_layout",
      items: [
        { title: t("kpi.reviews"), href: p("/kpi/reviews"), permission: { any: KPI_SCREEN_PERMS.reviews } },
        { title: t("kpi.violations"), href: p("/kpi/violations"), permission: { any: KPI_SCREEN_PERMS.violations } },
        { title: t("kpi.disputes"), href: p("/kpi/disputes"), permission: { any: KPI_SCREEN_PERMS.disputes } },
        { title: t("kpi.month"), href: p("/kpi/month"), permission: { any: KPI_SCREEN_PERMS.month } },
        { title: t("kpi.raises"), href: p("/kpi/raises"), permission: { any: KPI_SCREEN_PERMS.raises } },
        { title: t("kpi.attendance"), href: p("/kpi/attendance"), permission: { any: KPI_SCREEN_PERMS.attendance } },
        { title: t("kpi.network"), href: p("/kpi/network"), also: [p("/kpi/branch")], permission: { any: KPI_SCREEN_PERMS.network } },
        { title: t("kpi.revenue_plans"), href: p("/kpi/revenue-plans"), permission: { any: KPI_SCREEN_PERMS.revenue_plans } },
        { title: t("kpi.sanitary"), href: p("/kpi/sanitary/new"), permission: { any: KPI_SCREEN_PERMS.sanitary } },
        { title: t("kpi.settings"), href: p("/kpi/settings"), permission: { any: KPI_SCREEN_PERMS.settings } },
      ],
    },
    // Заявки. Право пункта берётся с самого экрана, а не с плана. Офисный
    // список читает GET /tickets, а он проверяет tickets.list; но сессия без
    // филиалов и без tickets.list_all получает там 200 с пустым списком, то есть
    // «нет заявок» вместо «нет филиалов». Поэтому пункт показывается только тем,
    // у кого есть оба права; менеджеру филиала достаточно «Заявок филиала».
    // «К оплате» и «Заявки филиала» тоже требуют по два права. Группа без
    // своего permission: useFilteredNav прячет её, когда не осталось пунктов.
    {
      kind: "group",
      title: tTickets("group"),
      icon: Wrench,
      items: [
        { title: tTickets("list"), href: p("/tickets"), permission: ["tickets.list_all", "tickets.list"] },
        { title: tTickets("payments"), href: p("/tickets/payments"), permission: ["tickets.payment.approve", "tickets.list"] },
        { title: tTickets("contractors"), href: p("/tickets/contractors"), permission: "tickets.contractors.manage" },
        { title: tTickets("types"), href: p("/tickets/types"), permission: "tickets.types.manage" },
      ],
    },
    { kind: "link", title: tTickets("branch"), href: p("/branch-tickets"), icon: Wrench, permission: ["tickets.create", "tickets.list"] },
    {
      kind: "group",
      title: t("playground"),
      icon: Baby,
      permission: "playground_tickets.list",
      items: [
        { title: t("playgroundScan"), href: p("/admin/playground/scan"), permission: "playground_tickets.list" },
        { title: t("playgroundList"), href: p("/admin/playground/list"), permission: "playground_tickets.list" },
      ],
    },
    {
      kind: "group",
      title: t("salesPlan"),
      icon: Target,
      permission: "sales_plans.list",
      items: [
        { title: t("salesPlans"), href: p("/admin/sales-plans/list"), permission: "sales_plans.list" },
        { title: t("salesPlanDashboard"), href: p("/admin/sales-plans/dashboard"), permission: "sales_plans.list" },
      ],
    },
    { kind: "link", title: t("stoplist"), href: p("/admin/stoplist"), icon: Ban, permission: "stoplist.list" },
    { kind: "link", title: t("configs"), href: p("/settings"), icon: Wrench, permission: "settings.list" },
    { kind: "link", title: t("dashboard"), href: p("/dashboard"), icon: LayoutDashboard, permission: "charts.list" },
    { kind: "link", title: t("hangingOrders"), href: p("/hanging_orders"), icon: Clock, permission: "hanging_orders.list" },
    {
      kind: "group",
      title: t("reports"),
      icon: FileText,
      items: [
        { title: t("outgoingInvoices"), href: p("/outgoing_invoices"), permission: "outgoing_invoices.list" },
        { title: t("incomingInvoices"), href: p("/incoming_invoices"), permission: "incoming_invoices.list" },
        { title: t("incomingWithItems"), href: p("/incoming_with_items"), permission: "incoming_with_items.list" },
        { title: t("refundInvoices"), href: p("/refund_invoices"), permission: "refund_invoices.list" },
        { title: t("internalTransferIn"), href: p("/internal_transfer"), permission: "internal_transfer.list" },
        { title: t("internalTransferOut"), href: p("/expenses_transfer"), permission: "internal_transfer.list" },
        { title: t("writeoffItems"), href: p("/writeoff_items"), permission: "writeoff_items.list" },
        { title: t("reportOlap"), href: p("/report_olap"), permission: "report_olap.list" },
      ],
    },
    {
      kind: "group",
      title: t("hr"),
      icon: Users,
      items: [
        { title: t("hrVacancy"), href: p("/hr/vacancy"), permission: "vacancy.list" },
        { title: t("hrPosition"), href: p("/hr/position"), permission: "positions.list" },
        { title: t("hrSchedule"), href: p("/hr/schedule"), permission: "work_schedule.list" },
        { title: t("hrCandidates"), href: p("/hr/candidates"), permission: "candidates.list" },
      ],
    },
  ];
}

// Permission-filtered nav; same my_permissions query CanAccess uses.
export function useFilteredNav(): NavEntry[] {
  const locale = useLocale();
  const t = useTranslations("nav");
  const tTickets = useTranslations("tickets.nav");
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
    const has = (p?: NavPermission) =>
      !p ||
      (typeof p === "string"
        ? perms.includes(p)
        : Array.isArray(p)
          ? p.every((x) => perms.includes(x))
          : p.any.some((x) => perms.includes(x)));
    const out: NavEntry[] = [];
    for (const e of buildNav(locale, t, tTickets)) {
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
  }, [data, locale, t, tTickets]);
}
