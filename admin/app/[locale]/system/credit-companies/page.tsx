"use client";

import { DataTable } from "./data-table";
import { creditCompaniesColumns } from "./columns";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus } from "lucide-react";
import CreditCompaniesFormSheet from "@admin/components/forms/credit_companies/sheet";

export default function CreditCompaniesListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Кредитные компании</h2>
        <div className="flex items-center space-x-2">
          <CreditCompaniesFormSheet>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Добавить компанию
            </Button>
          </CreditCompaniesFormSheet>
        </div>
      </div>
      <div className="py-10">
        <DataTable columns={creditCompaniesColumns} />
      </div>
    </div>
  );
}
