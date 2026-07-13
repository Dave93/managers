"use client";
import { DataTable } from "./data-table";
import { attestationEmployeeColumns } from "./columns";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import AttestationEmployeeFormSheet from "@admin/components/forms/attestation-employee/sheet";

export default function AttestationEmployeesPage() {
  const t = useTranslations("attestation");
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">
          {t("employees.title")}
        </h2>
        <AttestationEmployeeFormSheet>
          <Button>
            <Plus className="mr-2 h-4 w-4" /> {t("employees.new")}
          </Button>
        </AttestationEmployeeFormSheet>
      </div>
      <div className="py-10">
        <DataTable columns={attestationEmployeeColumns} />
      </div>
    </div>
  );
}
