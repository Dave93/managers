"use client";
import { DataTable } from "./data-table";
import { attestationTestColumns } from "./columns";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import AttestationTestFormSheet from "@admin/components/forms/attestation-test/sheet";

export default function AttestationTestsPage() {
  const t = useTranslations("attestation");
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">{t("tests.title")}</h2>
        <AttestationTestFormSheet>
          <Button>
            <Plus className="mr-2 h-4 w-4" /> {t("tests.new")}
          </Button>
        </AttestationTestFormSheet>
      </div>
      <div className="py-10">
        <DataTable columns={attestationTestColumns} />
      </div>
    </div>
  );
}
