# Admin Sidebar Layout (shadcn sidebar-08) — Design

**Date:** 2026-07-17
**Status:** Approved (design)

## Problem

The office admin uses a top navigation bar (`AdminLayout` → `main-nav.tsx`). Replace it with a
shadcn sidebar layout modeled on the **sidebar-08** block (inset variant, icon-collapsible,
user menu in the footer). Scope: `AdminLayout` only — `ManagerLayout`, `PlaygroundLayout`,
`SalesPlanLayout` and nested section layouts (attestation, medical) are untouched. Menu
structure stays 1:1 with the current prod navigation.

A side goal: the local `main-nav.tsx` (hardcoded JSX) and the prod one (data-driven `nav`
array) have diverged. The sidebar reads from a single typed nav config, ending the divergence.

## Approach (chosen: hybrid)

Install only the missing shadcn primitives via CLI (`sidebar`, `breadcrumb`, `tooltip` — new
files, nothing overwritten; `use-mobile` hook arrives with `sidebar`). Write the app-level
components ourselves following sidebar-08's composition. Rejected: full `shadcn add sidebar-08`
(CLI could touch customized ui files; the block's page.tsx is useless here) and full manual
vendoring (needless retyping of the primitives).

## Components

### 1. Nav config — `admin/components/layout/nav-config.tsx`

```ts
type NavLeaf = { title: string; href: string; permission?: string };
type NavEntry =
  | { kind: "link"; title: string; href: string; icon: LucideIcon; permission?: string }
  | { kind: "group"; title: string; icon: LucideIcon; permission?: string; items: NavLeaf[] };
export function buildNav(locale: string): NavEntry[];
```

Content mirrors the **prod** `main-nav.tsx` nav array exactly (Настройки group, Организации,
Филиалы, Кассы, Аттестация group, Медосмотр, Детская площадка group, План продаж group,
Стоп-лист, Конфиги, Дашборд, Висячие заказы, Отчеты group, HR group) plus a lucide icon per
top-level entry. The implementation plan copies the entry list from the prod file verbatim
(prod is the authority; the local hardcoded nav is stale).

### 2. AppSidebar — `admin/components/layout/app-sidebar.tsx`

`<Sidebar variant="inset" collapsible="icon">`:

- **SidebarHeader**: brand tile (icon square + «Les Ailes» / «Office»), links to `/`.
- **SidebarContent**: one `SidebarGroup`. For each visible NavEntry: groups render as
  `Collapsible` items with chevron + `SidebarMenuSub` (sidebar-08 NavMain pattern); links render
  as flat `SidebarMenuButton` items. Icon-collapse mode shows tooltips (built into
  `SidebarMenuButton tooltip=`).
- **Permission gating**: one `useQuery(["my_permissions"])` (same fetch as `CanAccess`), then
  filter the config — an entry is visible when it has no `permission` or the user holds it;
  a group is visible when itself visible AND at least one child is. No per-item `CanAccess`
  wrappers.
- **Active state**: `usePathname()`; a leaf is active on exact match or prefix match
  (`pathname.startsWith(href)`); the containing group gets `defaultOpen`.
- **SidebarFooter**: `NavUser` — avatar (initials fallback), name/login from the same source
  `user-nav.tsx` uses today, `DropdownMenu` with «Выйти» (reuse the existing logout mutation
  from `user-nav.tsx`). Dropdown flips side on mobile via `useSidebar().isMobile`.

### 3. AdminLayout — `admin/components/layout/admin-layout.tsx` (rewrite)

```
<SidebarProvider>
  <AppSidebar />
  <SidebarInset>
    <header h-16: SidebarTrigger | Separator | <AdminBreadcrumbs /> | ml-auto: LanguageSwitcher, ModeToggle>
    <div class="flex flex-1 flex-col p-4 pt-0">{children}</div>
  </SidebarInset>
</SidebarProvider>
```

The decorative `Search` icon from the old header is dropped. `UserNav` moves into the sidebar
footer. Sidebar open/collapsed state persists via the provider's cookie (built in). Mobile
renders the sidebar in a `Sheet` (built in).

### 4. Breadcrumbs — `admin/components/layout/admin-breadcrumbs.tsx`

Match `usePathname()` against the nav config: group title (plain text) → leaf title (current
page, `BreadcrumbPage`). Unmatched paths render nothing (header still shows trigger/utilities).
First crumb `hidden md:block` as in sidebar-08.

### 5. CSS tokens

Tailwind v4 (CSS-first). In `admin/app/globals.css`: add `--sidebar-*` variables under `:root`
and `.dark` (standard shadcn values) and map them in the `@theme` block as
`--color-sidebar-*: var(--sidebar-*)` so `bg-sidebar`, `bg-sidebar-accent`, etc. resolve.
Verify the exact variable naming the installed `sidebar.tsx` expects (`--sidebar-background`
vs `--sidebar`) and match it.

## Out of scope / cleanup

- `main-nav.tsx` stays in the repo but is no longer imported by `AdminLayout`; prod copy
  becomes dead code — removed in a later cleanup, not this change.
- Other layouts and nested section layouts unchanged; they render inside `SidebarInset`.
- No menu regrouping, no new permissions.

## Testing (local, chrome)

- All nav entries/groups render per permissions; links navigate; active item highlighted;
  active group opens by default.
- Collapse to icon mode: tooltips show, groups still reachable; state survives reload (cookie).
- Breadcrumbs correct on nested pages (e.g. Аттестация → Тесты; Медосмотр).
- NavUser dropdown: name shown, logout works.
- Language switcher + theme toggle still work; dark mode sidebar tokens correct.
- Mobile viewport: sidebar opens as Sheet.
- `bunx tsc --noEmit` clean; `bun run build` passes.

## Deploy notes

New files + rewritten `admin-layout.tsx` + `globals.css` additions transfer cleanly; prod
`main-nav.tsx` is left in place (unused). Admin rebuild (node20) + `office_admin` restart on
explicit authorization.
