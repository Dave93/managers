"use client";

import { DataTable } from "./data-table";
import { vacancyColumns } from "./columns";
import VacancyFormSheet from "@components/forms/vacancy/sheet";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus } from "lucide-react";

export default function UsersListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Вакансии</h2>
        <div className="flex items-center space-x-2">
          <VacancyFormSheet>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Create
            </Button>
          </VacancyFormSheet>
        </div>
      </div>
      <div className="py-10">
        <DataTable columns={vacancyColumns} />
      </div>
    </div>
  );
}
