# Admin Sidebar Layout (shadcn sidebar-08) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the office admin's top navigation with a shadcn sidebar-08-style inset sidebar (icon-collapsible, breadcrumbs header, user menu in the footer), per spec `docs/superpowers/specs/2026-07-17-admin-sidebar-layout-design.md`.

**Architecture:** Install only the missing shadcn primitives via CLI; write app components ourselves. A typed nav config (copied verbatim from the prod data-driven `main-nav.tsx` nav array — the authority) feeds both the sidebar and breadcrumbs. `AdminLayout` becomes `SidebarProvider → AppSidebar + SidebarInset`.

**Tech Stack:** Next.js 15, React 19, shadcn/ui (sidebar primitive), Tailwind **v4** (CSS-first `@theme` in `admin/app/globals.css`), TanStack Query, next-intl, lucide-react.

## Global Constraints

- Scope: `AdminLayout` only. `ManagerLayout`, `PlaygroundLayout`, `SalesPlanLayout`, nested section layouts — untouched.
- Menu 1:1 with prod nav array (saved at `/private/tmp/claude-502/-Users-macbookpro-development-managers/4be621e9-05fd-4a3a-907d-8fbf81791088/scratchpad/prod-main-nav.tsx`); no regrouping, no new permissions.
- Permission gating: single `useQuery(["my_permissions"])` + config filtering (no per-item CanAccess).
- Tailwind v4: sidebar color tokens go into `globals.css` (`:root`/`.dark` vars + `@theme` `--color-sidebar-*` mappings). Repo convention: vars hold HSL components, `@theme` wraps with `hsl(var(--x))`.
- `useAuth` hook is at `admin/components/useAuth.ts` → `{ user, signOut }`; `user.login` known field (others via any-cast).
- Local `main-nav.tsx` stays in repo, just no longer imported by `AdminLayout`.
- Deploy to prod ONLY on explicit user authorization (separate task).

---

### Task 1: Install shadcn primitives

**Files:**
- Create (via CLI): `admin/components/ui/sidebar.tsx`, `admin/components/ui/breadcrumb.tsx`, `admin/components/ui/tooltip.tsx`, `admin/components/ui/separator.tsx`, use-mobile hook (lands per `components.json` aliases, likely `admin/lib/hooks/use-mobile.ts*`)
- Possibly modified by CLI: `admin/app/globals.css`, `admin/package.json` (`@radix-ui/react-tooltip`, `@radix-ui/react-separator`)

**Interfaces:**
- Produces: `Sidebar, SidebarProvider, SidebarInset, SidebarTrigger, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton, useSidebar` from `@components/ui/sidebar`; `Breadcrumb*` from `@components/ui/breadcrumb`; `Separator` from `@components/ui/separator`.

- [ ] **Step 1:** From `admin/`: `bunx --bun shadcn@latest add sidebar breadcrumb tooltip separator` (accept installs; if it asks to overwrite an EXISTING file like `button` or `sheet` — answer NO).
- [ ] **Step 2:** Verify files exist: `ls admin/components/ui/sidebar.tsx admin/components/ui/breadcrumb.tsx admin/components/ui/tooltip.tsx admin/components/ui/separator.tsx` and find the use-mobile hook: `grep -rn "useIsMobile" admin --include="*.ts*" -l | grep -v node_modules`. Fix the import inside `sidebar.tsx` if the hook landed at a different path than it imports.
- [ ] **Step 3:** Check new npm deps installed: `grep -n "radix-ui/react-tooltip\|radix-ui/react-separator" admin/package.json` — if the CLI added deps, run `cd admin && bun install`.
- [ ] **Step 4:** `cd admin && bunx tsc --noEmit` — no NEW errors vs baseline (pre-existing merchants_api noise is baseline).
- [ ] **Step 5:** Commit.

```bash
git add admin/components/ui admin/lib admin/hooks admin/package.json admin/bun.lock* admin/app/globals.css 2>/dev/null
git commit -m "feat(admin): add shadcn sidebar/breadcrumb/tooltip/separator primitives"
```

---

### Task 2: Sidebar CSS tokens (Tailwind v4)

**Files:**
- Modify: `admin/app/globals.css` (`:root`, `.dark`, `@theme` block at line ~8)

- [ ] **Step 1:** Inspect which token names the installed `sidebar.tsx` uses: `grep -o "bg-sidebar[a-z-]*\|text-sidebar[a-z-]*\|border-sidebar[a-z-]*\|ring-sidebar[a-z-]*" admin/components/ui/sidebar.tsx | sort -u`. Two possibilities: classes like `bg-sidebar` (token `--color-sidebar`) or `bg-sidebar-background` (token `--color-sidebar-background`). Use the names you actually see below (the code assumes `bg-sidebar`).
- [ ] **Step 2:** If the CLI already injected sidebar vars into `globals.css` (check `grep -n "sidebar" admin/app/globals.css`), verify they follow the repo's `hsl(var(--x))` convention and skip to Step 4. Otherwise add to the `:root` block:

```css
    --sidebar: 0 0% 98%;
    --sidebar-foreground: 240 5.3% 26.1%;
    --sidebar-primary: 240 5.9% 10%;
    --sidebar-primary-foreground: 0 0% 98%;
    --sidebar-accent: 240 4.8% 95.9%;
    --sidebar-accent-foreground: 240 5.9% 10%;
    --sidebar-border: 220 13% 91%;
    --sidebar-ring: 217.2 91.2% 59.8%;
```

and to the `.dark` block:

```css
    --sidebar: 240 5.9% 10%;
    --sidebar-foreground: 240 4.8% 95.9%;
    --sidebar-primary: 224.3 76.3% 48%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 240 3.7% 15.9%;
    --sidebar-accent-foreground: 240 4.8% 95.9%;
    --sidebar-border: 240 3.7% 15.9%;
    --sidebar-ring: 217.2 91.2% 59.8%;
```

- [ ] **Step 3:** In the `@theme` block add (mirroring the existing `--color-*` style):

```css
  --color-sidebar: hsl(var(--sidebar));
  --color-sidebar-foreground: hsl(var(--sidebar-foreground));
  --color-sidebar-primary: hsl(var(--sidebar-primary));
  --color-sidebar-primary-foreground: hsl(var(--sidebar-primary-foreground));
  --color-sidebar-accent: hsl(var(--sidebar-accent));
  --color-sidebar-accent-foreground: hsl(var(--sidebar-accent-foreground));
  --color-sidebar-border: hsl(var(--sidebar-border));
  --color-sidebar-ring: hsl(var(--sidebar-ring));
```

- [ ] **Step 4:** Commit.

```bash
git add admin/app/globals.css
git commit -m "feat(admin): sidebar color tokens for tailwind v4 theme"
```

---

### Task 3: Nav config

**Files:**
- Create: `admin/components/layout/nav-config.tsx`

**Interfaces:**
- Produces:
  - `type NavLeaf = { title: string; href: string; permission?: string }`
  - `type NavEntry = { kind: "link"; title: string; href: string; icon: LucideIcon; permission?: string } | { kind: "group"; title: string; icon: LucideIcon; permission?: string; items: NavLeaf[] }`
  - `buildNav(locale: string): NavEntry[]`
  - `useFilteredNav(): NavEntry[]` (locale-aware via `useLocale()`, permission-filtered)

- [ ] **Step 1:** Create the file. The entry list is the prod nav array verbatim (from the saved prod file) with icons added:

```tsx
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
  Clock,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Settings2,
  Stethoscope,
  Store,
  Target,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavLeaf = { title: string; href: string; permission?: string };
export type NavEntry =
  | { kind: "link"; title: string; href: string; icon: LucideIcon; permission?: string }
  | { kind: "group"; title: string; icon: LucideIcon; permission?: string; items: NavLeaf[] };

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
      ],
    },
    { kind: "link", title: "Организации", href: p("/organization/organizations"), icon: Building2, permission: "organizations.list" },
    { kind: "link", title: "Филиалы", href: p("/organization/terminals"), icon: Store, permission: "terminals.list" },
    { kind: "link", title: "Кассы", href: p("/admin/reports"), icon: Banknote, permission: "reports.list" },
    {
      kind: "group",
      title: "Аттестация",
      icon: GraduationCap,
      permission: "attestation_layout",
      items: [
        { title: "Тесты", href: p("/attestation/tests"), permission: "tests.list" },
        { title: "Сотрудники", href: p("/attestation/employees"), permission: "employees.list" },
        { title: "Аналитика", href: p("/attestation/analytics"), permission: "attestation.analytics" },
        { title: "Пройти тест", href: p("/attestation/kiosk"), permission: "attestation.run" },
        { title: "Мой PIN", href: p("/attestation/pin"), permission: "attestation_layout" },
        { title: "PIN менеджеров", href: p("/attestation/manager-pins"), permission: "attestation.manage_pins" },
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
```

Note: before committing, diff the entry list against the saved prod file (`/private/tmp/claude-502/.../scratchpad/prod-main-nav.tsx`) — titles/hrefs/permissions must match; the prod list may lack the «PIN менеджеров» item (it exists in the LOCAL hardcoded nav) — keep it if it exists in either source.

- [ ] **Step 2:** `cd admin && bunx tsc --noEmit` → baseline-clean.
- [ ] **Step 3:** Commit.

```bash
git add admin/components/layout/nav-config.tsx
git commit -m "feat(admin): typed nav config shared by sidebar and breadcrumbs"
```

---

### Task 4: NavUser (sidebar footer)

**Files:**
- Create: `admin/components/layout/nav-user.tsx`

**Interfaces:**
- Consumes: `useAuth` from `@admin/components/useAuth` (`{ user, signOut }`), `useSidebar` from Task 1.
- Produces: `<NavUser />` (no props).

- [ ] **Step 1:** Create:

```tsx
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
  const u = user as any;
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
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
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
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
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
```

- [ ] **Step 2:** `bunx tsc --noEmit` → baseline-clean. Commit.

```bash
git add admin/components/layout/nav-user.tsx
git commit -m "feat(admin): sidebar footer user menu"
```

---

### Task 5: AppSidebar

**Files:**
- Create: `admin/components/layout/app-sidebar.tsx`

**Interfaces:**
- Consumes: `useFilteredNav`, `NavEntry` (Task 3), `NavUser` (Task 4), sidebar primitives (Task 1).
- Produces: `<AppSidebar />`.

- [ ] **Step 1:** Create:

```tsx
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
```

- [ ] **Step 2:** `bunx tsc --noEmit` → baseline-clean. Commit.

```bash
git add admin/components/layout/app-sidebar.tsx
git commit -m "feat(admin): app sidebar with permission-filtered nav"
```

---

### Task 6: Breadcrumbs + AdminLayout rewrite

**Files:**
- Create: `admin/components/layout/admin-breadcrumbs.tsx`
- Rewrite: `admin/components/layout/admin-layout.tsx`

**Interfaces:**
- Consumes: `buildNav` (Task 3), breadcrumb/sidebar primitives (Task 1), existing `ModeToggle` (`@components/layout/mode-toggle`), `LanguageSwitcher` (`@admin/components/ui/language-switcher`).

- [ ] **Step 1: Breadcrumbs.** Create `admin/components/layout/admin-breadcrumbs.tsx`:

```tsx
"use client";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@components/ui/breadcrumb";
import { buildNav } from "./nav-config";

// Longest-prefix match of the current path against the nav config.
export function AdminBreadcrumbs() {
  const pathname = usePathname();
  const locale = useLocale();
  let group: string | null = null;
  let page: string | null = null;
  let bestLen = 0;
  const match = (href: string) =>
    (pathname === href || pathname.startsWith(href + "/")) &&
    href.length > bestLen;
  for (const e of buildNav(locale)) {
    if (e.kind === "link") {
      if (match(e.href)) {
        group = null;
        page = e.title;
        bestLen = e.href.length;
      }
    } else {
      for (const it of e.items) {
        if (match(it.href)) {
          group = e.title;
          page = it.title;
          bestLen = it.href.length;
        }
      }
    }
  }
  if (!page) return null;
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {group && (
          <>
            <BreadcrumbItem className="hidden md:block">{group}</BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
          </>
        )}
        <BreadcrumbItem>
          <BreadcrumbPage>{page}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
```

- [ ] **Step 2: AdminLayout.** Replace the whole `admin/components/layout/admin-layout.tsx`:

```tsx
import { AppSidebar } from "@components/layout/app-sidebar";
import { AdminBreadcrumbs } from "@components/layout/admin-breadcrumbs";
import { ModeToggle } from "@components/layout/mode-toggle";
import LanguageSwitcher from "@admin/components/ui/language-switcher";
import { Separator } from "@components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@components/ui/sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex w-full items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <AdminBreadcrumbs />
            <div className="ml-auto flex items-center gap-2">
              <LanguageSwitcher />
              <ModeToggle />
            </div>
          </div>
        </header>
        <div className="flex flex-1 flex-col p-4 pt-0">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 3:** `bunx tsc --noEmit` → baseline-clean; `bun lint` → no new errors.
- [ ] **Step 4:** Commit.

```bash
git add admin/components/layout/admin-breadcrumbs.tsx admin/components/layout/admin-layout.tsx
git commit -m "feat(admin): sidebar-08 inset layout replaces top navigation"
```

---

### Task 7: Local verification

Dev servers: backend `cd backend && PORT=6761 bun run --watch src/index.ts`, admin `cd admin && bun dev` (6762). Chrome via chrome-attach (login admin/admin123).

- [ ] **Step 1:** `/ru/medical` — sidebar renders: brand tile, flat links with icons, groups with chevrons; «Медосмотр» highlighted (isActive).
- [ ] **Step 2:** Open «Аттестация» group → «Тесты» navigates; on `/ru/attestation/tests` the group is defaultOpen and «Тесты» highlighted; breadcrumbs «Аттестация › Тесты».
- [ ] **Step 3:** Collapse via trigger → icon rail, tooltips on hover, links still navigate; reload → state persisted (cookie).
- [ ] **Step 4:** NavUser: name/login shown, dropdown opens, «Выйти» logs out (redirect to login); log back in.
- [ ] **Step 5:** Theme toggle → dark sidebar tokens apply (sidebar visibly dark, борта корректные); language switcher still works (nav hrefs pick up locale).
- [ ] **Step 6:** Mobile: resize viewport to 375px → sidebar hidden, trigger opens Sheet.
- [ ] **Step 7:** `cd admin && bun run build` → succeeds.

---

### Task 8: Deploy to production (ONLY on explicit user authorization)

- [ ] **Step 1:** Ask for explicit authorization.
- [ ] **Step 2:** scp new files: `admin/components/ui/{sidebar,breadcrumb,tooltip,separator}.tsx`, use-mobile hook file, `admin/components/layout/{nav-config,nav-user,app-sidebar,admin-breadcrumbs,admin-layout}.tsx`, `admin/app/globals.css`, plus `admin/package.json` + lockfile if Task 1 added npm deps (then `bun install` on prod from `admin/`). Prod `main-nav.tsx` untouched (becomes unused by AdminLayout).
- [ ] **Step 3:** Commit on prod; rebuild admin with node20 PATH (`/root/.nvm/versions/node/v20.19.0/bin`); `pm2 restart office_admin --update-env`; `pm2 save`.
- [ ] **Step 4:** Verify: login 200, `/ru/medical` renders with sidebar (user eyeballs), pm2 online.

---

## Self-Review

- Spec coverage: primitives via CLI (T1), v4 CSS tokens with name-verification step (T2), nav config verbatim from prod + icons + useFilteredNav semantics (T3), NavUser with useAuth/logout (T4), AppSidebar inset+icon-collapse, active/defaultOpen, tooltips, gating via single query (T5), breadcrumbs longest-prefix + header layout + Search dropped + UserNav moved (T6), full manual test matrix incl. cookie persistence, dark mode, mobile Sheet (T7), deploy gated (T8). ✓
- Placeholders: none; the one conditional («if CLI injected vars») has explicit both-branch instructions. ✓
- Type consistency: `NavEntry`/`NavLeaf`/`buildNav`/`useFilteredNav` names match across T3/T5/T6; `NavUser` propless in T4/T5; import aliases consistent (`@components/ui/*`, `@admin/components/*`). ✓
