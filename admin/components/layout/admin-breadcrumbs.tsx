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
