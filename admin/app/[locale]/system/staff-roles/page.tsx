"use client";
import { DataTable } from "./data-table";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import StaffRoleFormSheet from "@admin/components/forms/staff-roles/sheet";

export default function StaffRolesPage() {
  const t = useTranslations("staffRoles");
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">{t("title")}</h2>
        <StaffRoleFormSheet>
          <Button>
            <Plus className="mr-2 h-4 w-4" /> {t("new")}
          </Button>
        </StaffRoleFormSheet>
      </div>
      <div className="py-10">
        <DataTable />
      </div>
    </div>
  );
}
