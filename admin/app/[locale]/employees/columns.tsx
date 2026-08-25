"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import { useLocale, useTranslations } from "next-intl";
import DeleteAction from "./delete-action";
import AttestationEmployeeFormSheet from "@admin/components/forms/attestation-employee/sheet";
import { employees } from "@backend/../drizzle/schema";
import { roleLabel, useStaffRoles, type StaffRole } from "@admin/lib/staff-roles";

type Employee = typeof employees.$inferSelect;

// Колонки стали хуком: подписи идут через next-intl, а должность — через
// справочник ролей, и то и другое требует React-контекста. Раньше это был
// модульный массив с русскими заголовками мимо переводов.
export function useAttestationEmployeeColumns(): ColumnDef<Employee>[] {
  const t = useTranslations("attestation.employees");
  const locale = useLocale();
  // Деактивированные роли тоже нужны: человек, стоящий на отключённой роли,
  // иначе показался бы с пустой должностью.
  const { data: roles } = useStaffRoles({ activeOnly: false });
  const byId = new Map<string, StaffRole>(
    (roles ?? []).map((r) => [r.id, r] as [string, StaffRole])
  );

  return [
    {
      accessorKey: "active",
      header: t("active"),
      cell: ({ row }) => <Switch checked={row.original.active} disabled />,
    },
    { accessorKey: "first_name", header: t("firstName") },
    { accessorKey: "last_name", header: t("lastName") },
    {
      accessorKey: "staff_role_id",
      header: t("role"),
      cell: ({ row }) => {
        const r = row.original.staff_role_id
          ? byId.get(row.original.staff_role_id)
          : undefined;
        // Роль не проставлена — показываем сырую строку должности, а не
        // прочерк: это единственное место, где такая должность ещё видна.
        if (!r)
          return (
            <span className="text-muted-foreground">
              {row.original.position ?? "—"}
            </span>
          );
        return (
          <div className="flex items-center gap-2">
            <span>{roleLabel(r, locale)}</span>
            {r.is_trainee ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {t("traineeBadge")}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: "grade",
      header: t("grade"),
      cell: ({ row }) =>
        row.original.grade == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          row.original.grade
        ),
    },
    {
      accessorKey: "shift",
      header: t("shift"),
      cell: ({ row }) => {
        const s = row.original.shift;
        if (s === "day") return t("shiftDay");
        if (s === "night") return t("shiftNight");
        return <span className="text-muted-foreground">—</span>;
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex items-center space-x-2">
          <AttestationEmployeeFormSheet recordId={row.original.id}>
            <Button variant="outline" size="sm">
              <Edit2Icon className="h-4 w-4" />
            </Button>
          </AttestationEmployeeFormSheet>
          <DeleteAction recordId={row.original.id} />
        </div>
      ),
    },
  ];
}
