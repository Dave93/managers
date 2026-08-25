"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import { useLocale, useTranslations } from "next-intl";
import DeactivateAction from "./deactivate-action";
import StaffRoleFormSheet from "@admin/components/forms/staff-roles/sheet";
import type { StaffRole } from "@admin/lib/staff-roles";

export function useStaffRoleColumns(): ColumnDef<StaffRole>[] {
  const t = useTranslations("staffRoles");
  const locale = useLocale();
  const groupLabel = (g: string) =>
    ["kitchen", "front", "management", "other"].includes(g)
      ? t(`groups.${g}` as any)
      : g;

  return [
    {
      accessorKey: "active",
      header: t("columns.active"),
      cell: ({ row }) => <Switch checked={row.original.active} disabled />,
    },
    {
      accessorKey: "name_ru",
      header: t("columns.name"),
      cell: ({ row }) => {
        const r = row.original;
        // Оба названия видны сразу: узбекская латиница — рабочий перевод,
        // и кадровику проще править её, глядя на русское рядом.
        const primary = locale === "uz-Latn" ? r.name_uz : r.name_ru;
        const secondary = locale === "uz-Latn" ? r.name_ru : r.name_uz;
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium">{primary}</span>
              {r.is_trainee ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {t("traineeBadge")}
                </span>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground">{secondary}</div>
          </div>
        );
      },
    },
    {
      accessorKey: "code",
      header: t("columns.code"),
      cell: ({ row }) => (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">
          {row.original.code}
        </code>
      ),
    },
    {
      accessorKey: "group_key",
      header: t("columns.group"),
      cell: ({ row }) => groupLabel(row.original.group_key),
    },
    {
      accessorKey: "synonyms",
      header: t("columns.synonyms"),
      // Видно сразу, у каких ролей поисковые слова уже есть, а у каких пусто:
      // иначе «почему не находится» проверяется только открытием формы.
      cell: ({ row }) => {
        const syn = row.original.synonyms ?? [];
        if (!syn.length)
          return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex max-w-[220px] flex-wrap gap-1">
            {syn.map((w) => (
              <span
                key={w}
                className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {w}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      accessorKey: "employees_count",
      header: t("columns.employeesCount"),
      cell: ({ row }) => (
        <span
          className={
            row.original.employees_count ? "font-medium" : "text-muted-foreground"
          }
        >
          {row.original.employees_count ?? 0}
        </span>
      ),
    },
    { accessorKey: "sort", header: t("columns.sort") },
    {
      id: "actions",
      header: t("columns.actions"),
      cell: ({ row }) => (
        <div className="flex items-center space-x-2">
          <StaffRoleFormSheet recordId={row.original.id}>
            <Button variant="outline" size="sm">
              <Edit2Icon className="h-4 w-4" />
            </Button>
          </StaffRoleFormSheet>
          <DeactivateAction role={row.original} />
        </div>
      ),
    },
  ];
}
